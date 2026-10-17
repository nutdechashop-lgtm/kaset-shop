// Shop operations on the local data record { customers, products, bills, receipts }.
// Pure logic (no DOM) so it can be tested in Node and reused when the data moves online.
import { round2, allocatePayment, payBills, billBalance } from './interest.js';

export const RATES = [2, 1.75, 1.5, 1.25, 1, 0.5, 0];
export const GRACE_MONTHS = [1, 2, 3, 4, 5, 6];

export const DEFAULT_SETTINGS = {
  name: '', address: '', phone: '', taxId: '',
  prefix: '01',        // shown in front of bill numbers, e.g. 01-BS6910170001
  defaultRate: 2,      // % per 30 days
  defaultGraceMonths: 4,
};

export function emptyData() {
  return { customers: [], products: [], bills: [], receipts: [] };
}

// Local calendar date (the shop's computer clock) as ISO yyyy-mm-dd.
export function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Day prefix of a document number, e.g. 01-BS691017
export function docHead(prefix, kind, iso) {
  const [y, m, d] = iso.split('-');
  return `${prefix ? prefix + '-' : ''}${kind}${String(+y + 543).slice(2)}${m}${d}`;
}
// Highest running number already used for that day
export function maxRunning(head, existingNos) {
  let max = 0;
  for (const n of existingNos) if (n && n.startsWith(head)) { const s = parseInt(n.slice(head.length), 10); if (s > max) max = s; }
  return max;
}

// Same numbering as the old program: <prefix>-<kind><BE yy><mm><dd><running 4 digits per day>
export function docNo(prefix, kind, iso, existingNos) {
  const head = docHead(prefix, kind, iso);
  return head + String(maxRunning(head, existingNos) + 1).padStart(4, '0');
}

export function nextCustomerCode(customers) {
  let max = 0;
  for (const c of customers) { const n = parseInt(c.code, 10); if (Number.isFinite(n) && n > max) max = n; }
  return String(max + 1).padStart(3, '0');
}

export function nextProductCode(products) {
  let max = 0; // counts deleted products too, so a code is never reused
  for (const p of products) { const n = parseInt(p.code, 10); if (Number.isFinite(n) && n > max) max = n; }
  return String(max + 1).padStart(6, '0');
}

// Zones already used, most common first — for the free-text zone suggestions.
export function zones(customers) {
  const n = new Map();
  for (const c of customers) if (c.zone) n.set(c.zone, (n.get(c.zone) || 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([z]) => z);
}

// Save a sale. input: { date, type: 'cash'|'credit', customerCode, lines: [{code, qty, price}], discount, rate, graceMonths, by, note }
// Mutates data (adds the bill, deducts stock) and returns the new bill.
export function createSale(data, settings, input, opts = {}) {
  const date = input.date || todayIso();
  const type = input.type === 'credit' ? 'credit' : 'cash';
  const prodBy = new Map(data.products.map((p) => [p.code, p]));
  const lines = (input.lines || []).filter((l) => l.code && Number(l.qty) > 0).map((l) => {
    const p = prodBy.get(l.code);
    if (!p) throw new Error('ไม่พบสินค้ารหัส ' + l.code);
    const qty = Number(l.qty), price = Number(l.price ?? p.price);
    return { code: p.code, name: p.name, unit: p.unit, qty, price, amount: round2(qty * price), date };
  });
  if (!lines.length) throw new Error('ยังไม่มีรายการสินค้า');
  const noPrice = lines.find((l) => !(l.price > 0));
  if (noPrice) throw new Error(`ใส่ราคาของ "${noPrice.name}" ก่อน`);
  if (type === 'credit' && !input.customerCode) throw new Error('ขายเงินเชื่อต้องเลือกลูกค้า');
  if (input.customerCode && !data.customers.some((c) => c.code === input.customerCode)) throw new Error('ไม่พบลูกค้ารหัส ' + input.customerCode);
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const discount = round2(Number(input.discount) || 0);
  if (discount < 0 || discount > subtotal) throw new Error('ส่วนลดไม่ถูกต้อง');
  const total = round2(subtotal - discount);
  const graceMonths = type === 'credit' ? Number(input.graceMonths) || 0 : 0;
  const bill = {
    no: opts.no || docNo(settings.prefix, 'BS', date, data.bills.map((b) => b.no)),
    series: 'BS', date, type, customerCode: input.customerCode || '',
    rate: type === 'credit' ? Number(input.rate ?? settings.defaultRate) : 0,
    graceDays: graceMonths * 30,
    subtotal, discount, total,
    status: type === 'credit' && total > 0 ? 'open' : 'paid',
    principalLeft: type === 'credit' ? total : 0, accruedInterest: 0,
    paidDate: type === 'cash' ? date : null, receiptNo: null, interestPaid: 0,
    lines, by: input.by || '', note: input.note || '', createdAt: new Date().toISOString(), edits: 0,
  };
  for (const l of lines) { const p = prodBy.get(l.code); if (!p.noStock) p.stock = round2((p.stock || 0) - l.qty); }
  data.bills.push(bill);
  return bill;
}

// Debts per customer as of a date: { code → { bills, principal, interest, total } }
export function customerDebts(data, asOf) {
  const out = new Map();
  for (const b of data.bills) {
    if (b.type !== 'credit' || b.status !== 'open') continue;
    const bal = billBalance(b, asOf);
    const x = out.get(b.customerCode) || { bills: [], principal: 0, interest: 0, total: 0 };
    x.bills.push({ ...b, balance: bal });
    x.principal = round2(x.principal + bal.principal);
    x.interest = round2(x.interest + bal.interest);
    x.total = round2(x.total + bal.total);
    out.set(b.customerCode, x);
  }
  for (const x of out.values()) x.bills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : 1));
  return out;
}

// Receive a debt payment.
// input: { customerCode, date, mode: 'amount'|'bills', amount, billNos, by }
// Interest first, then principal, oldest bill first. Mutates the bills and returns the receipt.
export function receivePayment(data, settings, input, opts = {}) {
  const date = input.date || todayIso();
  const open = data.bills.filter((b) => b.customerCode === input.customerCode && b.type === 'credit' && b.status === 'open');
  if (!open.length) throw new Error('ลูกค้ารายนี้ไม่มียอดค้าง');
  let res;
  if (input.mode === 'bills') {
    if (!input.billNos?.length) throw new Error('ยังไม่ได้เลือกบิล');
    res = payBills(open, input.billNos, date);
  } else {
    const amount = round2(Number(input.amount) || 0);
    if (amount <= 0) throw new Error('ใส่จำนวนเงินที่รับ');
    res = allocatePayment(open, amount, date);
  }
  const rows = res.rows.filter((r) => r.payInterest > 0 || r.payPrincipal > 0);
  if (!rows.length) throw new Error('ไม่มีบิลที่ถูกชำระ');
  const no = opts.no || docNo(settings.prefix, 'RP', date, data.receipts.map((r) => r.no));
  const byNo = new Map(res.updated.map((b) => [b.no, b]));
  for (let i = 0; i < data.bills.length; i++) {
    const u = byNo.get(data.bills[i].no);
    if (!u || !rows.some((r) => r.no === u.no)) continue;
    const row = rows.find((r) => r.no === u.no);
    data.bills[i] = { ...u, interestPaid: round2((data.bills[i].interestPaid || 0) + row.payInterest), receiptNo: u.status === 'paid' ? no : data.bills[i].receiptNo };
  }
  // What the customer owed on every open bill at the moment of payment (printed on the receipt).
  const owed = open.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : 1))
    .map((b) => { const bal = billBalance(b, date); return { no: b.no, date: b.date, principal: bal.principal, interest: bal.interest, total: bal.total }; });
  const owedTotal = round2(owed.reduce((s, x) => s + x.total, 0));
  const receipt = {
    no, date, customerCode: input.customerCode, mode: input.mode === 'bills' ? 'bills' : 'amount',
    owed, owedTotal,
    rows: rows.map((r) => ({ no: r.no, date: r.date, principal: r.payPrincipal, interest: r.payInterest, total: round2(r.payPrincipal + r.payInterest), principalLeft: r.principalLeft })),
    totalPrincipal: res.totalPrincipal, totalInterest: res.totalInterest,
    total: round2(res.totalPrincipal + res.totalInterest),
    received: input.mode === 'bills' ? round2(res.totalPrincipal + res.totalInterest) : round2(Number(input.amount)),
    change: res.change, by: input.by || '', createdAt: new Date().toISOString(),
  };
  receipt.remaining = round2(owedTotal - receipt.total);
  data.receipts.push(receipt);
  return receipt;
}

// Money in for a day: cash sales + debt payments received.
export function daySummary(data, iso) {
  const bills = data.bills.filter((b) => b.date === iso && b.status !== 'cancelled' && b.source !== 'programkaset');
  const receipts = data.receipts.filter((r) => r.date === iso && r.source !== 'programkaset');
  const cash = round2(bills.filter((b) => b.type === 'cash').reduce((s, b) => s + b.total, 0));
  const credit = round2(bills.filter((b) => b.type === 'credit').reduce((s, b) => s + b.total, 0));
  const paid = round2(receipts.reduce((s, r) => s + (r.total || 0), 0));
  return { bills: bills.length, cash, credit, receipts: receipts.length, paid, moneyIn: round2(cash + paid) };
}

// ---------- editing / cancelling a saved bill ----------
// A credit bill that has already received any payment can't be changed (the receipts would no longer add up).
export function billLockReason(b) {
  if (!b) return 'ไม่พบบิล';
  if (b.status === 'cancelled') return 'บิลนี้ถูกยกเลิกแล้ว';
  if (b.type === 'credit' && (b.status === 'paid' || (b.principalLeft ?? b.total) < b.total || b.interestFrom || b.receiptNo))
    return 'บิลเงินเชื่อที่รับชำระไปแล้ว (บางส่วนหรือทั้งหมด) แก้ไขหรือยกเลิกไม่ได้';
  return null;
}

const snapshot = (b) => ({ lines: b.lines, subtotal: b.subtotal, discount: b.discount, total: b.total, rate: b.rate, graceDays: b.graceDays });

// changes: { lines: [{code, qty, price, name?, unit?}], discount, rate, graceMonths }
// Returns the new bill and the stock change per product (+ = goes back into stock).
export function editBill(products, bill, changes, { by = '', reason = '', at = new Date().toISOString() } = {}) {
  const lock = billLockReason(bill); if (lock) throw new Error(lock);
  const prodBy = new Map(products.map((p) => [p.code, p]));
  const oldLine = new Map(bill.lines.map((l) => [l.code, l]));
  const lines = (changes.lines || []).filter((l) => l.code && Number(l.qty) > 0).map((l) => {
    const p = prodBy.get(l.code), o = oldLine.get(l.code);
    if (!p && !o) throw new Error('ไม่พบสินค้ารหัส ' + l.code);
    const qty = Number(l.qty), price = Number(l.price ?? p?.price ?? o?.price);
    return { code: l.code, name: p?.name || o?.name, unit: p?.unit || o?.unit, qty, price, amount: round2(qty * price), date: bill.date };
  });
  if (!lines.length) throw new Error('บิลต้องมีอย่างน้อย 1 รายการ ถ้าคืนทั้งหมดให้ใช้ "ยกเลิกบิล"');
  const noPrice = lines.find((l) => !(l.price > 0));
  if (noPrice) throw new Error(`ใส่ราคาของ "${noPrice.name}" ก่อน`);
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const discount = round2(Number(changes.discount) || 0);
  if (discount < 0 || discount > subtotal) throw new Error('ส่วนลดไม่ถูกต้อง');
  const total = round2(subtotal - discount);
  const credit = bill.type === 'credit';
  const next = {
    ...bill, lines, subtotal, discount, total,
    rate: credit ? Number(changes.rate ?? bill.rate) : 0,
    graceDays: credit ? (changes.graceMonths != null ? Number(changes.graceMonths) * 30 : bill.graceDays || 0) : 0,
    principalLeft: credit ? total : 0,
    status: credit ? (total > 0 ? 'open' : 'paid') : bill.status,
    edits: (bill.edits || 0) + 1,
    editHistory: [...(bill.editHistory || []), { at, by, reason, before: snapshot(bill) }],
  };
  const stock = new Map();
  const qtyOf = (ls) => { const m = new Map(); for (const l of ls) m.set(l.code, (m.get(l.code) || 0) + l.qty); return m; };
  const before = qtyOf(bill.lines), after = qtyOf(lines);
  for (const code of new Set([...before.keys(), ...after.keys()])) {
    const p = prodBy.get(code); if (!p || p.noStock) continue;
    const d = round2((before.get(code) || 0) - (after.get(code) || 0));
    if (d) stock.set(code, d);
  }
  return { bill: next, stock };
}

export function cancelBill(products, bill, { by = '', reason = '', at = new Date().toISOString() } = {}) {
  const lock = billLockReason(bill); if (lock) throw new Error(lock);
  const prodBy = new Map(products.map((p) => [p.code, p]));
  const stock = new Map();
  for (const l of bill.lines) { const p = prodBy.get(l.code); if (p && !p.noStock) stock.set(l.code, round2((stock.get(l.code) || 0) + l.qty)); }
  return { bill: { ...bill, status: 'cancelled', principalLeft: 0, cancelledAt: at, cancelledBy: by, cancelReason: reason }, stock };
}

// Describe what an edit changes, for the approval screen.
export function diffLines(oldLines, newLines) {
  const o = new Map(oldLines.map((l) => [l.code, l])), n = new Map(newLines.map((l) => [l.code, l]));
  const out = [];
  for (const [code, l] of n) {
    const p = o.get(code);
    if (!p) out.push({ kind: 'add', name: l.name, qty: l.qty, price: l.price });
    else if (p.qty !== l.qty || p.price !== l.price) out.push({ kind: 'change', name: l.name, from: `${p.qty} × ${p.price}`, to: `${l.qty} × ${l.price}` });
  }
  for (const [code, l] of o) if (!n.has(code)) out.push({ kind: 'remove', name: l.name, qty: l.qty });
  return out;
}

// Amount in Thai words, as printed on bills: 4280 → "สี่พันสองร้อยแปดสิบบาทถ้วน"
export function bahtText(amount) {
  const n = Math.round((Number(amount) || 0) * 100);
  if (n === 0) return 'ศูนย์บาทถ้วน';
  const digit = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const unit = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  const group = (num) => { // 0..999999
    const s = String(num); let out = '';
    for (let i = 0; i < s.length; i++) {
      const d = +s[i], pos = s.length - i - 1;
      if (!d) continue;
      if (pos === 1 && d === 1) out += 'สิบ';
      else if (pos === 1 && d === 2) out += 'ยี่สิบ';
      else if (pos === 0 && d === 1 && s.length > 1) out += 'เอ็ด';
      else out += digit[d] + unit[pos];
    }
    return out;
  };
  const words = (num) => { // any size, millions repeat
    if (num < 1000000) return group(num);
    return words(Math.floor(num / 1000000)) + 'ล้าน' + group(num % 1000000);
  };
  const neg = n < 0 ? 'ลบ' : '';
  const abs = Math.abs(n), baht = Math.floor(abs / 100), satang = abs % 100;
  return neg + (baht ? words(baht) + 'บาท' : '') + (satang ? words(satang) + 'สตางค์' : 'ถ้วน');
}

// ---------- interest rate change on an open credit bill ----------
// The new rate applies to the period that hasn't been paid yet (same as changing it at payment in the old program).
export function changeBillRate(bill, rate, { by = '', reason = '', at = new Date().toISOString() } = {}) {
  if (!bill || bill.type !== 'credit' || bill.status !== 'open') throw new Error('เปลี่ยนอัตราได้เฉพาะบิลเงินเชื่อที่ยังค้าง');
  const r = Number(rate);
  if (!RATES.includes(r)) throw new Error('อัตราดอกไม่ถูกต้อง');
  if (r === bill.rate) throw new Error('อัตราเดิมอยู่แล้ว');
  return { ...bill, rate: r, rateHistory: [...(bill.rateHistory || []), { at, by, reason, from: bill.rate, to: r }] };
}

// ---------- stock transfers to another shop (only the source shop's stock goes down) ----------
function transferLines(products, lines) {
  const prodBy = new Map(products.map((p) => [p.code, p]));
  const out = (lines || []).filter((l) => l.code && Number(l.qty) > 0).map((l) => {
    const p = prodBy.get(l.code);
    if (!p) throw new Error('ไม่พบสินค้ารหัส ' + l.code);
    return { code: p.code, name: p.name, unit: p.unit, qty: Number(l.qty) };
  });
  if (!out.length) throw new Error('ยังไม่มีรายการสินค้า');
  return out;
}
const qtyMap = (lines) => { const m = new Map(); for (const l of lines) m.set(l.code, round2((m.get(l.code) || 0) + l.qty)); return m; };
function stockDelta(products, before, after) {
  const prodBy = new Map(products.map((p) => [p.code, p]));
  const out = new Map(), b = qtyMap(before), a = qtyMap(after);
  for (const code of new Set([...b.keys(), ...a.keys()])) {
    const p = prodBy.get(code); if (!p || p.noStock) continue;
    const d = round2((b.get(code) || 0) - (a.get(code) || 0));
    if (d) out.set(code, d);
  }
  return out;
}
export function makeTransfer(products, input, no) {
  const to = String(input.to || '').trim();
  if (!to) throw new Error('ใส่ร้านปลายทาง');
  const lines = transferLines(products, input.lines);
  const transfer = { no, date: input.date || todayIso(), to, lines, note: input.note || '', by: input.by || '', status: 'active', edits: 0, createdAt: new Date().toISOString() };
  return { transfer, stock: stockDelta(products, [], lines) };
}
export function editTransfer(products, t, changes, { by = '', at = new Date().toISOString() } = {}) {
  if (t.status === 'cancelled') throw new Error('รายการโอนนี้ถูกยกเลิกแล้ว');
  const lines = transferLines(products, changes.lines);
  const to = String(changes.to ?? t.to).trim();
  if (!to) throw new Error('ใส่ร้านปลายทาง');
  const next = { ...t, to, lines, note: changes.note ?? t.note, edits: (t.edits || 0) + 1, editHistory: [...(t.editHistory || []), { at, by, before: { to: t.to, lines: t.lines } }] };
  return { transfer: next, stock: stockDelta(products, t.lines, lines) };
}
export function cancelTransfer(products, t, { by = '', reason = '', at = new Date().toISOString() } = {}) {
  if (t.status === 'cancelled') throw new Error('รายการโอนนี้ถูกยกเลิกแล้ว');
  return { transfer: { ...t, status: 'cancelled', cancelledAt: at, cancelledBy: by, cancelReason: reason }, stock: stockDelta(products, t.lines, []) };
}

// ---------- lists for the debtor screens and the bank PDF ----------
export function overdueBills(data, asOf, days = 180) {
  const limit = new Date(Date.parse(asOf + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);
  return data.bills.filter((b) => b.type === 'credit' && b.status === 'open' && b.date <= limit)
    .map((b) => ({ ...b, balance: billBalance(b, asOf), age: Math.round((Date.parse(asOf) - Date.parse(b.date)) / 86400000) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
// Debtors grouped by village (zone). opts: { zones: [..] } or { codes: [..] }; empty = everyone.
export function bankList(data, asOf, opts = {}) {
  const debts = customerDebts(data, asOf);
  const cus = new Map(data.customers.map((c) => [c.code, c]));
  const groups = new Map();
  for (const [code, d] of debts) {
    const c = cus.get(code) || { code, name: 'รหัส ' + code, zone: '' };
    const zone = c.zone || 'ไม่ระบุหมู่บ้าน';
    if (opts.zones?.length && !opts.zones.includes(zone)) continue;
    if (opts.codes?.length && !opts.codes.includes(code)) continue;
    const g = groups.get(zone) || { zone, rows: [], total: 0 };
    g.rows.push({ code, name: c.name, bills: d.bills.length, principal: d.principal, interest: d.interest, total: d.total });
    g.total = round2(g.total + d.total);
    groups.set(zone, g);
  }
  const list = [...groups.values()].sort((a, b) => a.zone.localeCompare(b.zone, 'th'));
  for (const g of list) g.rows.sort((a, b) => a.name.localeCompare(b.name, 'th'));
  return { groups: list, people: list.reduce((s, g) => s + g.rows.length, 0), total: round2(list.reduce((s, g) => s + g.total, 0)) };
}
// One shop at a glance (home screen / admin overview).
export function shopSnapshot(data, asOf) {
  const debts = customerDebts(data, asOf);
  let principal = 0, interest = 0, bills = 0;
  for (const d of debts.values()) { principal += d.principal; interest += d.interest; bills += d.bills.length; }
  return {
    today: daySummary(data, asOf), debtors: debts.size, openBills: bills,
    principal: round2(principal), interest: round2(interest), debt: round2(principal + interest),
    overdue: overdueBills(data, asOf).length,
    pending: (data.requests || []).filter((r) => r.status === 'pending').length,
    negativeStock: (data.products || []).filter((p) => !p.deleted && !p.noStock && p.stock < 0).length,
    noPrice: (data.products || []).filter((p) => !p.deleted && !p.price).length,
  };
}

// ---------- cost PIN (4 digits, issued by the super-admin) ----------
export function newPin() {
  const a = new Uint32Array(1); globalThis.crypto.getRandomValues(a);
  return String(a[0] % 10000).padStart(4, '0');
}
export async function hashPin(pin, salt) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
