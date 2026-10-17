// Credit interest rules (same as the old program):
//   interest = principal × rate% × days ÷ 30, daily, on principal only (no compounding)
//   counting starts at the bill date, or after the grace period for sale-event bills
//   a payment covers interest first, then principal (oldest bill first)

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const DAY = 86400000;
const toDay = (iso) => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY);
export const daysBetween = (fromIso, toIso) => Math.max(0, toDay(toIso) - toDay(fromIso));

export function addDays(iso, n) {
  return new Date((toDay(iso) + n) * DAY).toISOString().slice(0, 10);
}

// Date interest starts counting for a bill: bill date, or end of grace (graceDays = months × 30).
export function interestStart(bill) {
  return bill.graceDays ? addDays(bill.date, bill.graceDays) : bill.date;
}

// Interest owed on one open credit bill as of `asOf` (ISO date).
export function interestDue(bill, asOf) {
  if (bill.type !== 'credit' || bill.status !== 'open' || !bill.rate) return round2(bill.accruedInterest || 0);
  const from = bill.interestFrom || interestStart(bill);
  const days = daysBetween(from, asOf);
  const fresh = (bill.principalLeft ?? bill.total) * (bill.rate / 100) * days / 30;
  return round2((bill.accruedInterest || 0) + fresh);
}

export function billBalance(bill, asOf) {
  const principal = bill.status === 'open' ? (bill.principalLeft ?? bill.total) : 0;
  const interest = bill.status === 'open' ? interestDue(bill, asOf) : 0;
  return { principal: round2(principal), interest, total: round2(principal + interest) };
}

// Split a payment across bills: all interest first (oldest bill first), then principal oldest first.
// Returns per-bill allocation and updated copies of the bills; does not mutate input.
export function allocatePayment(bills, amount, asOf) {
  const open = bills.filter((b) => b.type === 'credit' && b.status === 'open')
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : 1));
  let left = round2(amount);
  const rows = open.map((b) => ({ bill: b, interest: interestDue(b, asOf), principal: round2(b.principalLeft ?? b.total), payInterest: 0, payPrincipal: 0 }));
  for (const r of rows) { const p = Math.min(left, r.interest); r.payInterest = round2(p); left = round2(left - p); }
  for (const r of rows) { const p = Math.min(left, r.principal); r.payPrincipal = round2(p); left = round2(left - p); }
  const updated = rows.map((r) => {
    const principalLeft = round2(r.principal - r.payPrincipal);
    const accruedInterest = round2(r.interest - r.payInterest);
    const done = principalLeft <= 0 && accruedInterest <= 0;
    return { ...r.bill, principalLeft, accruedInterest, interestFrom: asOf, status: done ? 'paid' : 'open', paidDate: done ? asOf : r.bill.paidDate };
  });
  return {
    rows: rows.map((r) => ({ no: r.bill.no, date: r.bill.date, principal: r.principal, interest: r.interest, payInterest: r.payInterest, payPrincipal: r.payPrincipal, principalLeft: round2(r.principal - r.payPrincipal) })),
    updated, change: left,
    totalInterest: round2(rows.reduce((s, r) => s + r.payInterest, 0)),
    totalPrincipal: round2(rows.reduce((s, r) => s + r.payPrincipal, 0)),
  };
}

// Pay whole selected bills (principal + interest) — "ชำระตามบิล".
export function payBills(bills, billNos, asOf) {
  const pick = new Set(billNos);
  const chosen = bills.filter((b) => pick.has(b.no));
  const total = chosen.reduce((s, b) => s + billBalance(b, asOf).total, 0);
  return allocatePayment(chosen, round2(total), asOf);
}
