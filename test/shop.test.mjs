// Run: node test/shop.test.mjs
import assert from 'node:assert/strict';
import { debtSummary, stockSummary, categoryList, DEFAULT_CATEGORIES, salesReport, closeSummary, stalePayers, lastPaidDate, isLow, lowStock, receiptLockReason, voidReceipt, changeBillRate, makeTransfer, editTransfer, cancelTransfer, overdueBills, bankList, shopSnapshot, newPin, hashPin, bahtText, editBill, cancelBill, billLockReason, diffLines, createSale, receivePayment, customerDebts, docNo, nextCustomerCode, zones, daySummary, emptyData, DEFAULT_SETTINGS } from '../src/shop.js';

const settings = { ...DEFAULT_SETTINGS, prefix: '01' };
const data = emptyData();
data.customers.push({ code: '001', name: 'ลุงมี', zone: 'วังวัด' }, { code: '018', name: 'ป้าตา', zone: 'ดงพลับ' }, { code: '019', name: 'น้าแดง', zone: 'วังวัด' });
data.products.push(
  { code: '000001', name: 'ปุ๋ย 16-16-16', unit: 'กระสอบ', price: 1050, stock: 10 },
  { code: '000002', name: 'ยาฆ่าหญ้า', unit: 'ขวด', price: 350, stock: 1 },
  { code: '000003', name: 'ไถแปร', unit: 'ไร่', price: 400, noStock: true, stock: 0 },
);

// Numbering matches the old program
assert.equal(docNo('01', 'BS', '2026-10-15', ['01-BS6910150002', '01-BS6910140009']), '01-BS6910150003');
assert.equal(nextCustomerCode(data.customers), '020');
assert.deepEqual(zones(data.customers), ['วังวัด', 'ดงพลับ']);

// Cash sale: stock goes down (can go negative), service items untouched
const cash = createSale(data, settings, { date: '2026-10-17', type: 'cash', lines: [{ code: '000002', qty: 2 }, { code: '000003', qty: 5 }] });
assert.equal(cash.no, '01-BS6910170001');
assert.equal(cash.total, 2700); assert.equal(cash.status, 'paid');
assert.equal(data.products[1].stock, -1);
assert.equal(data.products[2].stock, 0);

// Credit sales
assert.throws(() => createSale(data, settings, { type: 'credit', lines: [{ code: '000001', qty: 1 }] }), /เลือกลูกค้า/);
const a = createSale(data, settings, { date: '2026-08-01', type: 'credit', customerCode: '018', rate: 2, lines: [{ code: '000001', qty: 3 }] });
const b = createSale(data, settings, { date: '2026-09-03', type: 'credit', customerCode: '018', rate: 1.5, lines: [{ code: '000001', qty: 4, price: 1050 }], discount: 50 });
assert.equal(a.total, 3150); assert.equal(b.total, 4150); assert.equal(a.status, 'open');
assert.equal(data.products[0].stock, 3);

// Sale-event bill with 4-month grace: no interest inside the window
const g = createSale(data, settings, { date: '2026-10-09', type: 'credit', customerCode: '019', rate: 2, graceMonths: 4, lines: [{ code: '000001', qty: 1 }] });
assert.equal(g.graceDays, 120);
assert.equal(customerDebts(data, '2027-02-06').get('019').interest, 0);

// Debts as of 15 Oct: interest 157.50 + 87.15
const d = customerDebts(data, '2026-10-15').get('018');
assert.equal(d.principal, 7300); assert.equal(d.interest, 244.65); assert.equal(d.total, 7544.65);

// Pay by amount 5000: interest first, then oldest principal
const r1 = receivePayment(data, settings, { customerCode: '018', date: '2026-10-15', mode: 'amount', amount: 5000 });
assert.equal(r1.no, '01-RP6910150001');
assert.equal(r1.totalInterest, 244.65); assert.equal(r1.totalPrincipal, 4755.35); assert.equal(r1.total, 5000);
assert.equal(data.bills.find((x) => x.no === a.no).status, 'paid');
assert.equal(data.bills.find((x) => x.no === a.no).receiptNo, r1.no);
const left = data.bills.find((x) => x.no === b.no);
assert.equal(left.status, 'open'); assert.equal(left.principalLeft, 2544.65);

// Interest restarts from the payment date on the remaining principal
const d2 = customerDebts(data, '2026-11-14').get('018');
assert.equal(d2.interest, 38.17); // 2544.65 × 1.5% × 30/30

// Pay by bill clears it fully
const r2 = receivePayment(data, settings, { customerCode: '018', date: '2026-11-14', mode: 'bills', billNos: [b.no] });
assert.equal(r2.total, 2582.82);
assert.equal(customerDebts(data, '2026-11-14').has('018'), false);
assert.throws(() => receivePayment(data, settings, { customerCode: '018', mode: 'amount', amount: 10 }), /ไม่มียอดค้าง/);

// Overpayment returns change
createSale(data, settings, { date: '2026-11-14', type: 'credit', customerCode: '001', rate: 0, lines: [{ code: '000003', qty: 1 }] });
const r3 = receivePayment(data, settings, { customerCode: '001', date: '2026-11-14', mode: 'amount', amount: 500 });
assert.equal(r3.total, 400); assert.equal(r3.change, 100);

const s = daySummary(data, '2026-11-14');
assert.equal(s.paid, 2982.82); assert.equal(s.credit, 400);

data.products.push({ code: '000004', name: 'ปุ๋ยไม่มีราคา', unit: 'ถุง', price: 0, stock: 0 });
assert.throws(() => createSale(data, settings, { type: 'cash', lines: [{ code: '000004', qty: 1 }] }), /ใส่ราคา/);
assert.equal(createSale(data, settings, { type: 'cash', lines: [{ code: '000004', qty: 1, price: 99 }] }).total, 99);
// Editing an unpaid credit bill: return 2 sacks, stock comes back, principal follows the new total
const e1 = createSale(data, settings, { date: '2026-11-20', type: 'credit', customerCode: '019', rate: 2, lines: [{ code: '000001', qty: 5 }] });
const stockBefore = data.products[0].stock;
const ed = editBill(data.products, e1, { lines: [{ code: '000001', qty: 3, price: 1050 }, { code: '000003', qty: 1, price: 400 }], discount: 0, rate: 1.5 }, { by: 'แม่', reason: 'คืนของ' });
assert.equal(ed.bill.total, 3550); assert.equal(ed.bill.principalLeft, 3550); assert.equal(ed.bill.edits, 1); assert.equal(ed.bill.rate, 1.5);
assert.equal(ed.stock.get('000001'), 2); assert.equal(ed.stock.has('000003'), false);
assert.equal(ed.bill.editHistory[0].before.total, 5250);
assert.deepEqual(diffLines(e1.lines, ed.bill.lines).map((d) => d.kind).sort(), ['add', 'change']);
assert.equal(data.products[0].stock, stockBefore); // pure: nothing mutated
// Cancelling returns all stock
const cn = cancelBill(data.products, e1, { by: 'แม่' });
assert.equal(cn.bill.status, 'cancelled'); assert.equal(cn.stock.get('000001'), 5);
// A credit bill that already got a payment is locked
assert.match(billLockReason(data.bills.find((x) => x.no === a.no)), /รับชำระ/);
assert.throws(() => editBill(data.products, data.bills.find((x) => x.no === a.no), { lines: [] }), /รับชำระ/);
assert.equal(bahtText(4280), 'สี่พันสองร้อยแปดสิบบาทถ้วน');
assert.equal(bahtText(5000), 'ห้าพันบาทถ้วน');
assert.equal(bahtText(21), 'ยี่สิบเอ็ดบาทถ้วน');
assert.equal(bahtText(11), 'สิบเอ็ดบาทถ้วน');
assert.equal(bahtText(101), 'หนึ่งร้อยเอ็ดบาทถ้วน');
assert.equal(bahtText(1670876), 'หนึ่งล้านหกแสนเจ็ดหมื่นแปดร้อยเจ็ดสิบหกบาทถ้วน');
assert.equal(bahtText(74243.96), 'เจ็ดหมื่นสี่พันสองร้อยสี่สิบสามบาทเก้าสิบหกสตางค์');
assert.equal(bahtText(0.5), 'ห้าสิบสตางค์');
// receipt keeps what was owed before paying
assert.equal(r1.owedTotal, 7544.65); assert.equal(r1.remaining, 2544.65); assert.equal(r1.owed.length, 2);
// rate change applies to the unpaid period
const gb = data.bills.find((x) => x.customerCode === '019' && x.status === 'open');
const cr = changeBillRate(gb, 1, { by: 'แม่', reason: 'ลูกค้าประจำ' });
assert.equal(cr.rate, 1); assert.equal(cr.rateHistory[0].from, 2);
assert.throws(() => changeBillRate(data.bills.find((x) => x.no === a.no), 1), /ยังค้าง/);
assert.throws(() => changeBillRate(gb, 3), /ไม่ถูกต้อง/);
// transfers: only source stock goes down; edit adjusts by the difference; cancel returns it
const tr = makeTransfer(data.products, { to: 'สาขาโป่งแค', lines: [{ code: '000001', qty: 4 }, { code: '000003', qty: 2 }], by: 'สมศรี' }, '01-TR6910170001');
assert.equal(tr.stock.get('000001'), -4); assert.equal(tr.stock.has('000003'), false); // service item has no stock
const te = editTransfer(data.products, tr.transfer, { lines: [{ code: '000001', qty: 1 }] });
assert.equal(te.stock.get('000001'), 3); assert.equal(te.transfer.edits, 1);
const tc = cancelTransfer(data.products, te.transfer, { by: 'สมศรี' });
assert.equal(tc.stock.get('000001'), 1); assert.equal(tc.transfer.status, 'cancelled');
assert.throws(() => makeTransfer(data.products, { to: '', lines: [{ code: '000001', qty: 1 }] }), /ปลายทาง/);
// overdue (> 6 months) and bank list
const od = { customers: [{ code: '1', name: 'ก', zone: 'หนองบัว' }, { code: '2', name: 'ข', zone: 'ดอนสัก' }], products: [], receipts: [], requests: [{ status: 'pending' }],
  bills: [{ no: 'x1', date: '2026-01-10', type: 'credit', status: 'open', rate: 0, total: 1000, principalLeft: 1000, customerCode: '1' },
          { no: 'x2', date: '2026-09-10', type: 'credit', status: 'open', rate: 0, total: 500, principalLeft: 500, customerCode: '2' }] };
assert.deepEqual(overdueBills(od, '2026-10-17').map((b) => b.no), ['x1']);
const bl = bankList(od, '2026-10-17');
assert.equal(bl.total, 1500); assert.equal(bl.groups.length, 2); assert.equal(bl.groups[0].zone, 'ดอนสัก');
assert.equal(bankList(od, '2026-10-17', { zones: ['หนองบัว'] }).total, 1000);
assert.equal(bankList(od, '2026-10-17', { codes: ['2'] }).people, 1);
const snap = shopSnapshot(od, '2026-10-17'); assert.equal(snap.debt, 1500); assert.equal(snap.overdue, 1); assert.equal(snap.pending, 1);
// PIN
const pin = newPin(); assert.match(pin, /^\d{4}$/);
assert.equal(await hashPin('1234', 's'), await hashPin('1234', 's')); assert.notEqual(await hashPin('1234', 's'), await hashPin('1235', 's'));
// cancelling a wrong receipt puts the bills back exactly
{
  const dd = emptyData(); dd.customers.push({ code: '1', name: 'ก' }); dd.products.push({ code: 'p', name: 'x', unit: 'u', price: 1000, stock: 0 });
  const b1 = createSale(dd, settings, { date: '2026-08-01', type: 'credit', customerCode: '1', rate: 2, lines: [{ code: 'p', qty: 1 }] });
  const b2 = createSale(dd, settings, { date: '2026-09-01', type: 'credit', customerCode: '1', rate: 2, lines: [{ code: 'p', qty: 2 }] });
  const orig = JSON.stringify(dd.bills);
  const owedBefore = customerDebts(dd, '2026-10-15').get('1').total;
  const wrong = receivePayment(dd, settings, { customerCode: '1', date: '2026-10-01', mode: 'amount', amount: 1500 });
  assert.equal(dd.bills[0].status, 'paid');
  const cur = (r) => dd.bills.filter((b) => r.rows.some((x) => x.no === b.no));
  // a later payment on the same bill locks the earlier receipt
  const later = receivePayment(dd, settings, { customerCode: '1', date: '2026-10-05', mode: 'amount', amount: 100 });
  assert.match(receiptLockReason(wrong, cur(wrong)), /ใหม่กว่า/);
  const v2 = voidReceipt(later, cur(later), { by: 'แม่', reason: 'ทดสอบ' });
  for (const b of v2.bills) dd.bills[dd.bills.findIndex((x) => x.no === b.no)] = b;
  assert.equal(receiptLockReason(wrong, cur(wrong)), null);
  const v = voidReceipt(wrong, cur(wrong), { by: 'แม่', reason: 'ใส่ยอดผิด' });
  for (const b of v.bills) dd.bills[dd.bills.findIndex((x) => x.no === b.no)] = b;
  assert.equal(v.receipt.status, 'void');
  const strip = (arr) => JSON.stringify(JSON.parse(arr).map(({ lastReceiptNo, receiptNo, interestPaid, accruedInterest, interestFrom, paidDate, ...b }) => b));
  assert.equal(strip(JSON.stringify(dd.bills)), strip(orig));
  assert.equal(customerDebts(dd, '2026-10-15').get('1').total, owedBefore);
  assert.match(receiptLockReason(v.receipt, cur(wrong)), /ยกเลิกไปแล้ว/);
  assert.match(receiptLockReason({ no: 'old', rows: [] }, []), /ก่อนมีระบบ/);
  dd.receipts = dd.receipts.map((r) => (r.no === wrong.no ? v.receipt : r.no === later.no ? v2.receipt : r));
  assert.equal(daySummary(dd, '2026-10-01').paid, 0);
}
// low stock: below the product's own alert level; off when 0; services never
assert.equal(isLow({ stock: 9, minStock: 10 }), true); assert.equal(isLow({ stock: 10, minStock: 10 }), false);
assert.equal(isLow({ stock: -1, minStock: 0 }), false); assert.equal(isLow({ stock: 0, minStock: 5, noStock: true }), false);
assert.deepEqual(lowStock([{ name: 'a', stock: 8, minStock: 10 }, { name: 'b', stock: 1, minStock: 20 }, { name: 'c', stock: 50, minStock: 20 }]).map((p) => p.name), ['b', 'a']);
// debtors with no payment for more than 6 months
{
  const sd = { customers: [{ code: 'a', lastPaidAt: '2026-01-05' }, { code: 'b' }, { code: 'c', lastPaidAt: '2026-01-01' }, { code: 'd' }], products: [], receipts: [{ customerCode: 'c', date: '2026-09-01' }],
    bills: [{ no: '1', customerCode: 'a', type: 'credit', status: 'open', date: '2025-12-01', rate: 0, total: 100, principalLeft: 100 },
            { no: '2', customerCode: 'b', type: 'credit', status: 'open', date: '2026-02-01', rate: 0, total: 50, principalLeft: 50 },
            { no: '3', customerCode: 'c', type: 'credit', status: 'open', date: '2025-11-01', rate: 0, total: 70, principalLeft: 70 },
            { no: '4', customerCode: 'd', type: 'credit', status: 'open', date: '2025-10-01', rate: 0, total: 90, principalLeft: 60, interestFrom: '2026-08-01' }] };
  assert.equal(lastPaidDate(sd, 'c'), '2026-09-01'); assert.equal(lastPaidDate(sd, 'd'), '2026-08-01'); assert.equal(lastPaidDate(sd, 'b'), null);
  assert.deepEqual(stalePayers(sd, '2026-10-19').map((r) => r.code), ['a', 'b']); // a: paid Jan, b: never paid since Feb
  // paying updates the customer's last payment date
  receivePayment(sd, settings, { customerCode: 'a', date: '2026-10-19', mode: 'amount', amount: 10 });
  assert.equal(sd.customers[0].lastPaidAt, '2026-10-19');
}
{
  const cd = { bills: [{ no: 'a', date: '2026-10-19', type: 'cash', total: 100, by: 'A', status: 'paid' }, { no: 'b', date: '2026-10-19', type: 'credit', total: 300, by: 'B', status: 'open' }, { no: 'c', date: '2026-10-19', type: 'cash', total: 50, by: 'A', status: 'cancelled' }],
    receipts: [{ no: 'r', date: '2026-10-19', total: 70, totalPrincipal: 60, totalInterest: 10, by: 'B' }, { no: 'v', date: '2026-10-19', total: 999, status: 'void', by: 'B' }] };
  const cs = closeSummary(cd, '2026-10-19');
  assert.equal(cs.cash, 100); assert.equal(cs.credit, 300); assert.equal(cs.paid, 70); assert.equal(cs.cashIn, 170); assert.equal(cs.paidInterest, 10);
  assert.deepEqual(cs.people.find((p) => p.name === 'B'), { name: 'B', cash: 0, paid: 70, credit: 300 });
}
{
  const prods = [{ code: 'p', name: 'ปุ๋ย', unit: 'ถุง', cost: 80 }, { code: 'q', name: 'ยา', unit: 'ขวด' }];
  const bills = [{ no: '1', date: '2026-10-01', type: 'cash', status: 'paid', subtotal: 300, discount: 30, total: 270, lines: [{ code: 'p', qty: 2, amount: 200 }, { code: 'q', qty: 1, amount: 100 }] },
                 { no: '2', date: '2026-10-02', type: 'credit', status: 'open', subtotal: 100, discount: 0, total: 100, lines: [{ code: 'p', qty: 1, amount: 100 }] },
                 { no: '3', date: '2026-10-02', type: 'cash', status: 'cancelled', subtotal: 999, total: 999, lines: [] }];
  const rcp = [{ date: '2026-10-02', total: 120, totalPrincipal: 100, totalInterest: 20 }, { date: '2026-10-02', total: 50 }];
  const rep = salesReport(bills, rcp, prods, '2026-10-01', '2026-10-31');
  assert.equal(rep.totals.sales, 370); assert.equal(rep.totals.cash, 270); assert.equal(rep.totals.bills, 2);
  // bill1: costed 200 → gross 40, discount 30 × 200/300 = 20 → 20; bill2: 20 → 40
  assert.equal(rep.totals.profit, 40); assert.equal(rep.totals.noCostLines, 1);
  assert.equal(rep.paid.interest, 20); assert.equal(rep.paid.noSplit, 1); assert.equal(rep.items[0].code, 'p'); assert.equal(rep.items[0].qty, 3);
  assert.equal(rep.monthly[0].profit, 40);
}
{ // product categories
  assert.deepEqual(categoryList({}, []), DEFAULT_CATEGORIES);
  assert.deepEqual(categoryList({ categories: ['ข', 'ก'] }, [{ category: 'ค' }, { category: 'ก' }, { category: 'ง', deleted: true }]), ['ข', 'ก', 'ค']);
  assert.deepEqual(categoryList({ categories: [] }, []), []);
}
{ // switch a bill between cash and credit
  const prods = [{ code: 'p', name: 'P', unit: 'u', price: 100, stock: 10 }];
  const cash = { no: 'B1', date: '2026-10-01', type: 'cash', customerCode: '', rate: 0, graceDays: 0, subtotal: 200, discount: 0, total: 200, status: 'paid', principalLeft: 0, paidDate: '2026-10-01', lines: [{ code: 'p', name: 'P', unit: 'u', qty: 2, price: 100, amount: 200 }] };
  assert.throws(() => editBill(prods, cash, { lines: cash.lines, type: 'credit' }), /ลูกค้า/);
  const { bill: cr, stock } = editBill(prods, cash, { lines: cash.lines, type: 'credit', customerCode: 'c1', rate: 2, graceMonths: 0 });
  assert.equal(cr.type, 'credit'); assert.equal(cr.status, 'open'); assert.equal(cr.principalLeft, 200); assert.equal(cr.rate, 2); assert.equal(cr.paidDate, null); assert.equal(stock.size, 0);
  assert.equal(cr.editHistory[0].before.type, 'cash');
  const { bill: back } = editBill(prods, cr, { lines: cr.lines, type: 'cash' });
  assert.equal(back.type, 'cash'); assert.equal(back.status, 'paid'); assert.equal(back.principalLeft, 0); assert.equal(back.rate, 0); assert.equal(back.customerCode, 'c1');
}
{ // summaries
  const data = { customers: [{ code: 'a', name: 'ก', zone: 'z2', phone: '1' }, { code: 'b', name: 'ข', zone: 'z1' }], receipts: [],
    bills: [{ no: 'B1', type: 'credit', status: 'open', customerCode: 'a', date: '2026-01-01', total: 100, principalLeft: 100, rate: 0, graceDays: 0 },
      { no: 'B2', type: 'credit', status: 'open', customerCode: 'b', date: '2026-10-01', total: 300, principalLeft: 300, rate: 0, graceDays: 0 },
      { no: 'B3', type: 'cash', status: 'paid', customerCode: 'b', date: '2026-10-01', total: 50 }] };
  const s = debtSummary(data, '2026-10-26');
  assert.equal(s.people, 2); assert.equal(s.total, 400); assert.equal(s.rows[0].code, 'b'); assert.equal(s.overdueBills, 1);
  assert.equal(debtSummary(data, '2026-10-26', { filter: 'overdue' }).people, 1);
  assert.equal(debtSummary(data, '2026-10-26', { sort: 'zone' }).rows[0].code, 'b');
  const st = stockSummary([{ code: '1', name: 'x', category: 'B', stock: 2, cost: 10, price: 15 }, { code: '2', name: 'y', category: 'A', stock: -1, cost: 5 }, { code: '3', name: 'z', category: '', noStock: true }], { categories: ['A', 'B'] });
  assert.equal(st.groups[0].category, 'A'); assert.equal(st.value, 20); assert.equal(st.negative, 1); assert.equal(st.count, 3);
  assert.equal(stockSummary([{ code: '1', name: 'x', stock: 2 }, { code: '2', name: 'y', stock: 0 }], { filter: 'instock' }).count, 1);
}
console.log('ALL SHOP CHECKS PASSED');
