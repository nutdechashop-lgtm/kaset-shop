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
  let max = 0;
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
  const receipt = {
    no, date, customerCode: input.customerCode, mode: input.mode === 'bills' ? 'bills' : 'amount',
    rows: rows.map((r) => ({ no: r.no, date: r.date, principal: r.payPrincipal, interest: r.payInterest, total: round2(r.payPrincipal + r.payInterest), principalLeft: r.principalLeft })),
    totalPrincipal: res.totalPrincipal, totalInterest: res.totalInterest,
    total: round2(res.totalPrincipal + res.totalInterest),
    received: input.mode === 'bills' ? round2(res.totalPrincipal + res.totalInterest) : round2(Number(input.amount)),
    change: res.change, by: input.by || '', createdAt: new Date().toISOString(),
  };
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
