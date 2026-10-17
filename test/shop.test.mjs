// Run: node test/shop.test.mjs
import assert from 'node:assert/strict';
import { createSale, receivePayment, customerDebts, docNo, nextCustomerCode, zones, daySummary, emptyData, DEFAULT_SETTINGS } from '../src/shop.js';

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
console.log('ALL SHOP CHECKS PASSED');
