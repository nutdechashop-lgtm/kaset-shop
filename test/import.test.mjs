// Run: node test/import.test.mjs <path to Chemi2003NEW.MDB>
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { inspect, importDatabase } from '../src/importer.js';
import { interestDue, allocatePayment, payBills, round2 } from '../src/interest.js';

const bytes = readFileSync(process.argv[2]);
const info = inspect(bytes);
console.log('inspect:', info);

const all = importDatabase(bytes, {});
console.log('summary (all years):', all.summary);

// Known facts from the real shop data
assert.equal(all.summary.customers, 214);
assert.equal(all.summary.products, 396); // 406 minus 10 expense entries
assert.equal(all.summary.removedNonProducts.length, 10);
assert.ok(all.products.some((p) => p.name.startsWith('ค่าจัดการแปลงนา')), 'service that was sold stays');
assert.ok(!all.products.some((p) => p.name === 'ค่าไฟ'));
assert.equal(all.summary.openBills, 391);
assert.equal(all.summary.openPrincipal, 1670876);
const b = all.bills.find((x) => x.no === '01-BS6910150003');
assert.ok(b, 'bill from photo');
assert.equal(b.total, 6410); assert.equal(b.rate, 1.5); assert.equal(b.customerCode, '018'); assert.equal(b.type, 'credit');
assert.equal(b.lines.length, 2); assert.equal(b.lines[0].amount + b.lines[1].amount, 6410);
const cus = all.customers.find((c) => c.code === '018');
console.log('customer 018:', cus, ' bill lines:', b.lines.map((l) => `${l.code} ${l.name} ${l.qty}×${l.price}`));

// Interest must match old receipt 01-RP6910150002 (customer 113, paid 2026-10-15): 3,323.96
const rcpBills = all.bills.filter((x) => x.receiptNo === '01-RP6910150002');
assert.equal(rcpBills.length, 12);
const reopened = rcpBills.map((x) => ({ ...x, status: 'open', principalLeft: x.total, accruedInterest: 0, interestFrom: null }));
const totalInt = round2(reopened.reduce((s, x) => s + interestDue(x, '2026-10-15'), 0));
console.log('recomputed interest for RP6910150002:', totalInt, ' old program said:', round2(rcpBills.reduce((s, x) => s + x.interestPaid, 0)));
assert.equal(totalInt, 3323.96);
const pb = payBills(reopened, reopened.map((x) => x.no), '2026-10-15');
assert.equal(round2(pb.totalInterest + pb.totalPrincipal), 74243.96); // receipt total

// Partial payment: interest first, then principal oldest first; interest restarts from payment date
const one = [{ no: 'A', date: '2026-08-01', type: 'credit', status: 'open', rate: 2, total: 3150, principalLeft: 3150 },
  { no: 'B', date: '2026-09-03', type: 'credit', status: 'open', rate: 1.5, total: 4150, principalLeft: 4150 }];
const r = allocatePayment(one, 5000, '2026-10-15');
assert.equal(r.totalInterest, 244.65); // 157.50 + 87.15
assert.equal(r.updated[0].status, 'paid');
assert.equal(r.updated[1].principalLeft, 2544.65);
assert.equal(interestDue(r.updated[1], '2026-11-14'), round2(2544.65 * 0.015)); // 30 days later

// Grace: 120-day grace, no interest inside the window
const g = { no: 'G', date: '2026-10-09', type: 'credit', status: 'open', rate: 2, total: 5150, graceDays: 120 };
assert.equal(interestDue(g, '2027-02-05'), 0);
assert.equal(interestDue(g, '2027-02-06'), 0);
assert.equal(interestDue(g, '2027-03-08'), round2(5150 * 0.02));

// Year range
const recent = importDatabase(bytes, { fromYear: 2569, toYear: 2569 });
console.log('summary 2569 only (+ open bills kept):', recent.summary);
assert.ok(recent.bills.every((x) => x.date >= '2026-01-01' || x.status === 'open'));
assert.equal(recent.summary.openBills, 391);
const strict = importDatabase(bytes, { fromYear: 2569, toYear: 2569, keepOpenBills: false });
assert.ok(strict.bills.every((x) => x.date >= '2026-01-01'));
console.log('\nALL CHECKS PASSED');
