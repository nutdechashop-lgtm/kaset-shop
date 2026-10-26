// Shop operations on the local data record { customers, products, bills, receipts }.
// Pure logic (no DOM) so it can be tested in Node and reused when the data moves online.
import { round2, allocatePayment, payBills, billBalance, daysBetween } from './interest.js';

export const RATES = [2, 1.75, 1.5, 1.25, 1, 0.5, 0];
export const GRACE_MONTHS = [1, 2, 3, 4, 5, 6];

// Product categories a new shop starts with (each shop can add, rename, reorder or remove them).
export const DEFAULT_CATEGORIES = ['สารกำจัดเชื้อรา', 'สารกำจัดเพลี้ย', 'สารกำจัดแมลง', 'สารกำจัดวัชพืช (นาข้าว)', 'สารกำจัดวัชพืช (พืชไร่)', 'ปุ๋ยกระสอบ', 'ปุ๋ยเกล็ด', 'ฮอร์โมน'];
// The shop's category list in its order, plus any category a product uses that is not on the list yet.
export function categoryList(settings, products = []) {
  const list = Array.isArray(settings?.categories) ? settings.categories.filter(Boolean) : [...DEFAULT_CATEGORIES];
  for (const p of products) if (p.category && !p.deleted && !list.includes(p.category)) list.push(p.category);
  return list;
}
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
  const before = [];
  for (let i = 0; i < data.bills.length; i++) {
    const u = byNo.get(data.bills[i].no);
    if (!u || !rows.some((r) => r.no === u.no)) continue;
    const row = rows.find((r) => r.no === u.no);
    before.push(payState(data.bills[i]));
    data.bills[i] = { ...u, interestPaid: round2((data.bills[i].interestPaid || 0) + row.payInterest), receiptNo: u.status === 'paid' ? no : (data.bills[i].receiptNo ?? null), lastReceiptNo: no };
  }
  // What the customer owed on every open bill at the moment of payment (printed on the receipt).
  const owed = open.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : 1))
    .map((b) => { const bal = billBalance(b, date); return { no: b.no, date: b.date, principal: bal.principal, interest: bal.interest, total: bal.total, items: (b.lines || []).map((l) => ({ name: l.name || '', qty: l.qty, unit: l.unit || '', amount: l.amount })) }; });
  const owedTotal = round2(owed.reduce((s, x) => s + x.total, 0));
  const receipt = {
    no, date, customerCode: input.customerCode, mode: input.mode === 'bills' ? 'bills' : 'amount',
    owed, owedTotal,
    rows: rows.map((r) => ({ no: r.no, date: r.date, principal: r.payPrincipal, interest: r.payInterest, total: round2(r.payPrincipal + r.payInterest), principalLeft: r.principalLeft })),
    totalPrincipal: res.totalPrincipal, totalInterest: res.totalInterest,
    total: round2(res.totalPrincipal + res.totalInterest),
    received: input.mode === 'bills' ? round2(res.totalPrincipal + res.totalInterest) : round2(Number(input.amount)),
    change: res.change, by: input.by || '', createdAt: new Date().toISOString(),
    before, // each paid bill as it was before this receipt, so the receipt can be cancelled
  };
  receipt.remaining = round2(owedTotal - receipt.total);
  data.receipts.push(receipt);
  const cust = data.customers?.find((c) => c.code === input.customerCode);
  if (cust && !(cust.lastPaidAt > date)) cust.lastPaidAt = date;
  return receipt;
}

// The bill fields a payment changes (null instead of undefined so it can be stored).
const PAY_FIELDS = ['principalLeft', 'accruedInterest', 'interestFrom', 'status', 'paidDate', 'receiptNo', 'interestPaid', 'lastReceiptNo'];
function payState(b) { const o = { no: b.no }; for (const k of PAY_FIELDS) o[k] = b[k] ?? null; return o; }

// ---------- cancelling a wrong receipt ----------
// bills: the current bills this receipt paid. Only the latest payment on every one of them can be undone.
export function receiptLockReason(receipt, bills) {
  if (!receipt) return 'ไม่พบใบเสร็จ';
  if (receipt.status === 'void') return 'ใบเสร็จนี้ยกเลิกไปแล้ว';
  if (!receipt.before) return 'ใบเสร็จนี้ออกก่อนมีระบบยกเลิกใบเสร็จ (หรือมาจากโปรแกรมเก่า) ยกเลิกในโปรแกรมไม่ได้';
  const by = new Map((bills || []).map((b) => [b.no, b]));
  for (const r of receipt.rows) {
    const b = by.get(r.no);
    if (!b) return 'ไม่พบบิล ' + r.no;
    if (b.lastReceiptNo !== receipt.no) return `บิล ${r.no} มีการรับชำระหลังใบเสร็จนี้แล้ว ต้องยกเลิกใบเสร็จที่ใหม่กว่าก่อน`;
  }
  return null;
}
// Returns the receipt marked void and the bills put back exactly as they were before it.
export function voidReceipt(receipt, bills, { by = '', reason = '', at = new Date().toISOString() } = {}) {
  const lock = receiptLockReason(receipt, bills); if (lock) throw new Error(lock);
  const prev = new Map(receipt.before.map((x) => [x.no, x]));
  const restored = bills.filter((b) => prev.has(b.no)).map((b) => { const { no, ...st } = prev.get(b.no); return { ...b, ...st }; });
  return { receipt: { ...receipt, status: 'void', voidBy: by, voidReason: reason, voidAt: at }, bills: restored };
}

// End-of-day cash check: what came in on one day, split by type and by person.
export function closeSummary(data, iso) {
  const bills = data.bills.filter((b) => b.date === iso && b.status !== 'cancelled' && b.source !== 'programkaset').sort((a, b) => (a.no < b.no ? -1 : 1));
  const receipts = data.receipts.filter((r) => r.date === iso && r.status !== 'void' && r.source !== 'programkaset').sort((a, b) => (a.no < b.no ? -1 : 1));
  const sum = (arr, k = 'total') => round2(arr.reduce((t, x) => t + (x[k] || 0), 0));
  const cash = bills.filter((b) => b.type === 'cash'), credit = bills.filter((b) => b.type === 'credit');
  const people = new Map();
  const add = (who, k, v) => { const p = people.get(who || '-') || { name: who || '-', cash: 0, paid: 0, credit: 0 }; p[k] = round2(p[k] + v); people.set(who || '-', p); };
  for (const b of cash) add(b.by, 'cash', b.total);
  for (const b of credit) add(b.by, 'credit', b.total);
  for (const r of receipts) add(r.by, 'paid', r.total);
  return {
    date: iso, cashBills: cash, creditBills: credit, receipts,
    cash: sum(cash), credit: sum(credit), paid: sum(receipts), paidPrincipal: sum(receipts, 'totalPrincipal'), paidInterest: sum(receipts, 'totalInterest'),
    cashIn: round2(sum(cash) + sum(receipts)), people: [...people.values()],
  };
}

// Money in for a day: cash sales + debt payments received.
export function daySummary(data, iso) {
  const bills = data.bills.filter((b) => b.date === iso && b.status !== 'cancelled' && b.source !== 'programkaset');
  const receipts = data.receipts.filter((r) => r.date === iso && r.source !== 'programkaset' && r.status !== 'void');
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
    return 'บิลเงินเชื่อที่รับชำระไปแล้ว (บางส่วนหรือทั้งหมด) แก้ไขหรือยกเลิกไม่ได้ · ถ้ารับชำระผิด ให้ยกเลิกใบเสร็จก่อน (หน้าลูกหนี้ → ประวัติรับชำระ)';
  return null;
}

const snapshot = (b) => ({ lines: b.lines, subtotal: b.subtotal, discount: b.discount, total: b.total, rate: b.rate, graceDays: b.graceDays, type: b.type, customerCode: b.customerCode || '' });

// changes: { lines: [{code, qty, price, name?, unit?}], discount, rate, graceMonths, type?, customerCode? }
// type switches the bill between cash and credit (credit needs a customer).
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
  const type = changes.type === 'credit' || changes.type === 'cash' ? changes.type : bill.type;
  const customerCode = changes.customerCode !== undefined ? (changes.customerCode || '') : (bill.customerCode || '');
  const credit = type === 'credit';
  if (credit && !customerCode) throw new Error('บิลเงินเชื่อต้องเลือกลูกค้า');
  const next = {
    ...bill, type, customerCode, lines, subtotal, discount, total,
    rate: credit ? Number(changes.rate ?? (bill.rate || 2)) : 0,
    graceDays: credit ? (changes.graceMonths != null ? Number(changes.graceMonths) * 30 : bill.graceDays || 0) : 0,
    principalLeft: credit ? total : 0,
    status: credit ? (total > 0 ? 'open' : 'paid') : 'paid',
    paidDate: credit ? null : (bill.type === 'cash' ? bill.paidDate || bill.date : bill.date),
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
// ---------- debtors who have not paid for a long time ----------
// Last payment = newest of: the customer's lastPaidAt, their receipts in memory, partial payments on open bills.
// Never paid → counted from their oldest open bill.
export function lastPaidDate(data, code) {
  let last = data.customers?.find((c) => c.code === code)?.lastPaidAt || '';
  for (const r of data.receipts || []) if (r.customerCode === code && r.status !== 'void' && r.date > last) last = r.date;
  for (const b of data.bills || []) if (b.customerCode === code && b.status === 'open' && b.interestFrom && b.interestFrom > last) last = b.interestFrom;
  return last || null;
}
export function stalePayers(data, asOf, days = 180) {
  const out = [];
  for (const [code, d] of customerDebts(data, asOf)) {
    const last = lastPaidDate(data, code);
    const oldest = d.bills.reduce((m, b) => (!m || b.date < m ? b.date : m), '');
    const since = last || oldest;
    const n = daysBetween(since, asOf);
    if (n > days) out.push({ code, lastPaid: last, oldestBill: oldest, days: n, principal: d.principal, interest: d.interest, total: d.total, bills: d.bills.length });
  }
  return out.sort((a, b) => b.days - a.days || b.total - a.total);
}

// ---------- sales & profit report ----------
// bills / receipts: those dated from..to (already fetched). products: for today's cost price.
export function salesReport(bills, receipts, products, from, to) {
  const cost = new Map((products || []).map((p) => [p.code, Number(p.cost) || 0]));
  const name = new Map((products || []).map((p) => [p.code, p]));
  const inRange = (d) => d >= from && d <= to;
  const sold = bills.filter((b) => inRange(b.date) && b.status !== 'cancelled');
  const rcp = receipts.filter((r) => inRange(r.date) && r.status !== 'void');
  const t = { bills: sold.length, cash: 0, credit: 0, sales: 0, discount: 0, profit: 0, costedSales: 0, noCostLines: 0 };
  const days = new Map(), items = new Map();
  const day = (d) => days.get(d) || (days.set(d, { date: d, bills: 0, cash: 0, credit: 0, paid: 0, interest: 0, profit: 0 }), days.get(d));
  for (const b of sold) {
    const dd = day(b.date); dd.bills++;
    dd[b.type === 'credit' ? 'credit' : 'cash'] += b.total; t[b.type === 'credit' ? 'credit' : 'cash'] += b.total;
    t.sales += b.total; t.discount += b.discount || 0;
    let costed = 0, gross = 0;
    for (const l of b.lines || []) {
      const c = cost.get(l.code) || 0;
      const it = items.get(l.code) || { code: l.code, name: l.name || name.get(l.code)?.name || l.code, unit: l.unit || name.get(l.code)?.unit || '', qty: 0, amount: 0, profit: 0, noCost: !c };
      it.qty += l.qty; it.amount += l.amount;
      if (c) { const g = l.amount - l.qty * c; it.profit += g; gross += g; costed += l.amount; } else t.noCostLines++;
      items.set(l.code, it);
    }
    const share = b.subtotal ? costed / b.subtotal : 0;
    const prof = gross - (b.discount || 0) * share;
    dd.profit += prof; t.profit += prof; t.costedSales += costed;
  }
  const paid = { receipts: rcp.length, total: 0, principal: 0, interest: 0, noSplit: 0 };
  for (const r of rcp) {
    const dd = day(r.date); dd.paid += r.total || 0; paid.total += r.total || 0;
    if (r.totalInterest === undefined) { paid.noSplit++; continue; }
    paid.principal += r.totalPrincipal || 0; paid.interest += r.totalInterest || 0; dd.interest += r.totalInterest || 0;
  }
  const r2 = (o) => { for (const k of Object.keys(o)) if (typeof o[k] === 'number') o[k] = round2(o[k]); return o; };
  const daily = [...days.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).map(r2);
  const months = new Map();
  for (const d of daily) { const m = d.date.slice(0, 7); const x = months.get(m) || { month: m, bills: 0, cash: 0, credit: 0, paid: 0, interest: 0, profit: 0 }; for (const k of ['bills', 'cash', 'credit', 'paid', 'interest', 'profit']) x[k] += d[k]; months.set(m, x); }
  return { from, to, totals: r2(t), paid: r2(paid), daily, monthly: [...months.values()].map(r2), items: [...items.values()].map(r2).sort((a, b) => b.amount - a.amount) };
}

// ---------- low-stock alerts ----------
// minStock = alert when stock drops below this (0 / empty = no alert). Service items never alert.
export const MIN_PRESETS = [5, 10, 20, 30, 50];
export const isLow = (p) => !!p && !p.deleted && !p.noStock && Number(p.minStock) > 0 && (Number(p.stock) || 0) < Number(p.minStock);
export function lowStock(products) {
  return (products || []).filter(isLow).sort((a, b) => (a.stock / a.minStock) - (b.stock / b.minStock) || a.name.localeCompare(b.name, 'th'));
}

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
    lowStock: lowStock(data.products).length,
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

// ---------- printed summaries for the super-admin ----------
// Debtors of one shop. opts: { filter: 'all' | 'overdue' (a bill older than 6 months) | 'stale' (no payment for 6 months),
// sort: 'total' | 'zone' | 'code', withInterest: true }
export function debtSummary(data, asOf, opts = {}) {
  const { filter = 'all', sort = 'total', withInterest = true } = opts;
  const debts = customerDebts(data, asOf);
  const cus = new Map((data.customers || []).map((c) => [c.code, c]));
  const limit = new Date(Date.parse(asOf + 'T00:00:00Z') - 180 * 86400000).toISOString().slice(0, 10);
  const stale = filter === 'stale' ? new Set(stalePayers(data, asOf).map((x) => x.code)) : null;
  let rows = [];
  for (const [code, d] of debts) {
    if (filter === 'overdue' && !d.bills.some((b) => b.date <= limit)) continue;
    if (stale && !stale.has(code)) continue;
    const c = cus.get(code) || { code, name: 'รหัส ' + code, zone: '' };
    const bills = d.bills.map((b) => ({ no: b.no, date: b.date, principal: b.balance.principal, interest: withInterest ? b.balance.interest : 0, total: withInterest ? b.balance.total : b.balance.principal }));
    rows.push({ code, name: c.name, zone: c.zone || '', phone: c.phone || '', bills, principal: d.principal, interest: withInterest ? d.interest : 0, total: withInterest ? d.total : d.principal });
  }
  rows.sort(sort === 'zone' ? (a, b) => a.zone.localeCompare(b.zone, 'th') || a.name.localeCompare(b.name, 'th')
    : sort === 'code' ? (a, b) => (a.code < b.code ? -1 : 1) : (a, b) => b.total - a.total);
  const sum = (k) => round2(rows.reduce((s, r) => s + r[k], 0));
  return { rows, people: rows.length, bills: rows.reduce((s, r) => s + r.bills.length, 0), principal: sum('principal'), interest: sum('interest'), total: sum('total'),
    overdueBills: rows.reduce((s, r) => s + r.bills.filter((b) => b.date <= limit).length, 0) };
}
// Products of one shop. opts: { cats: [..] (empty = all), filter: 'all' | 'instock' | 'low' | 'negative' | 'noprice', categories: shop order }
export function stockSummary(products, opts = {}) {
  const { cats = [], filter = 'all', categories = [] } = opts;
  const order = new Map(categories.map((c, i) => [c, i]));
  const list = (products || []).filter((p) => !p.deleted && (!cats.length || cats.includes(p.category || ''))
    && (filter === 'instock' ? !p.noStock && p.stock > 0 : filter === 'low' ? isLow(p) : filter === 'negative' ? !p.noStock && p.stock < 0 : filter === 'noprice' ? !(p.price > 0) : true))
    .map((p) => ({ code: p.code, name: p.name, unit: p.unit || '', category: p.category || '', stock: p.noStock ? null : Number(p.stock) || 0, price: Number(p.price) || 0, cost: Number(p.cost) || 0,
      value: !p.noStock && p.stock > 0 && p.cost > 0 ? round2(p.stock * p.cost) : 0 }))
    .sort((a, b) => (order.has(a.category) ? order.get(a.category) : 1e6) - (order.has(b.category) ? order.get(b.category) : 1e6) || a.name.localeCompare(b.name, 'th'));
  const groups = [];
  for (const p of list) { let g = groups[groups.length - 1]; if (!g || g.category !== p.category) groups.push(g = { category: p.category, items: [], qty: 0, value: 0 }); g.items.push(p); if (p.stock > 0) g.qty = round2(g.qty + p.stock); g.value = round2(g.value + p.value); }
  return { groups, count: list.length, negative: list.filter((p) => p.stock < 0).length, noCost: list.filter((p) => p.stock !== null && !(p.cost > 0)).length, value: round2(list.reduce((s, p) => s + p.value, 0)) };
}
