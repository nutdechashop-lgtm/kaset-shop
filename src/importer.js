// Reads the old programkaset (Chemi) database file and maps it to the new data model.
// Works in the browser and in Node: pass the file contents as a Uint8Array / Buffer.
import MDBReader from 'mdb-reader';
import { round2 } from './interest.js';

export const MAIN_DB_NAME = /^chemi2003new\.mdb$/i;

// Old program stores Buddhist-era dates as text "2569/10/15" → ISO "2026-10-15".
export function beToIso(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  let y = +m[1];
  if (y > 2400) y -= 543;
  return `${y}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}
export const beYear = (v) => { const m = String(v ?? '').match(/^(\d{4})/); return m ? +m[1] : null; };

const str = (v) => (v == null ? '' : String(v).trim());
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
// Product / customer codes may come back numeric (leading zeros lost): product codes are 6 digits.
const prodCode = (v) => { const s = str(v).replace(/\.0+$/, ''); return /^\d+$/.test(s) && s.length < 6 ? s.padStart(6, '0') : s; };
const cusCode = (v) => { const s = str(v).replace(/\.0+$/, ''); return /^\d+$/.test(s) && s.length < 3 ? s.padStart(3, '0') : s; };

// Read only the columns we use — the old tables have 50–90 columns and reading all of them is slow.
function table(reader, name, columns) {
  if (!reader.getTableNames().includes(name)) return [];
  const t = reader.getTable(name);
  if (!columns) return t.getData();
  const have = new Set(t.getColumnNames());
  return t.getData({ columns: columns.filter((c) => have.has(c)) });
}

// Quick look before importing: what the file holds and which years have bills.
export function inspect(bytes) {
  const reader = new MDBReader(bytes);
  const names = reader.getTableNames();
  const need = ['Cus', 'Prod', 'DocCtrl', 'Data'];
  const missing = need.filter((n) => !names.includes(n));
  if (missing.length) throw new Error('ไม่ใช่ไฟล์ของโปรแกรมเก่า (ไม่พบตาราง ' + missing.join(', ') + ')');
  const years = {};
  for (const r of reader.getTable('DocCtrl').getData({ columns: ['DocNo', 'DocDate', 'DocType'] })) {
    if (!/^BS/.test(str(r.DocType))) continue;
    const y = beYear(r.DocDate); if (y) (years[y] ||= new Set()).add(str(r.DocNo));
  }
  const comp = table(reader, 'Compp')[0] || {};
  return {
    shopName: str(comp.CompDes),
    customers: reader.getTable('Cus').rowCount,
    products: reader.getTable('Prod').rowCount,
    years: Object.fromEntries(Object.entries(years).sort().map(([y, s]) => [y, s.size])),
  };
}

// Full import. opts: { fromYear, toYear (Buddhist era), keepOpenBills: true }
export function importDatabase(bytes, opts = {}) {
  const reader = new MDBReader(bytes);
  const { fromYear = 0, toYear = 9999, keepOpenBills = true } = opts;
  const warnings = [];

  // Shop header
  const comp = table(reader, 'Compp')[0] || {};
  const shop = { name: str(comp.CompDes), address: str(comp.CompAddress), phone: str(comp.CompTel).replace(/\.0+$/, ''), taxId: str(comp.CompTax) };
  if (shop.phone && /^\d{9}$/.test(shop.phone)) shop.phone = '0' + shop.phone;

  // Customers — zone = short address (village)
  const customers = table(reader, 'Cus', ['CusCode', 'CusDes', 'CusDesFull', 'CusTel', 'CusAddress', 'CusRate']).map((r) => ({
    code: cusCode(r.CusCode), name: str(r.CusDes) || str(r.CusDesFull), phone: str(r.CusTel),
    zone: str(r.CusAddress), rate: num(r.CusRate),
  })).filter((c) => c.code);

  // Products
  const groups = Object.fromEntries(table(reader, 'ProdGroup').map((g) => [str(g.ProdGroupCode), str(g.ProdGroupDes)]));
  const products = table(reader, 'Prod', ['ProdCode', 'ProdDes', 'ProdDesFull', 'ProdUnit', 'ProdCost', 'ProdPrice', 'ProdGroupCode', 'ProdTypeCode']).map((r) => ({
    code: prodCode(r.ProdCode), name: str(r.ProdDes) || str(r.ProdDesFull), unit: str(r.ProdUnit) || 'หน่วย',
    cost: num(r.ProdCost), price: num(r.ProdPrice), group: groups[str(r.ProdGroupCode)] || str(r.ProdGroupCode),
    noStock: str(r.ProdTypeCode) !== '' && str(r.ProdTypeCode) !== '1', stock: 0,
  })).filter((p) => p.code);
  const prodByCode = new Map(products.map((p) => [p.code, p]));

  // Stock: latest period balance per product
  const stk = table(reader, 'StkBal', ['Period', 'ProdCode', 'Bal']);
  const latest = stk.reduce((m, r) => (str(r.Period) > m ? str(r.Period) : m), '');
  for (const r of stk) if (str(r.Period) === latest) { const p = prodByCode.get(prodCode(r.ProdCode)); if (p) p.stock = num(r.Bal); }

  // Bill headers: the old program keeps several snapshot rows per bill; the last row (highest Id) wins,
  // and a bill counts as paid / cancelled if any snapshot says so.
  const heads = new Map();
  const cancelledNos = new Set();
  for (const r of table(reader, 'DocCtrl', ['Id', 'DocType', 'DocNo', 'PayStt', 'CancelStt', 'DocDate', 'DueDate', 'CodeKey', 'CusCode', 'Rate', 'AmtSub', 'AmtDisc', 'AmtNet', 'PayDate', 'ReceiptNo', 'IntAmt', 'UserDes'])) {
    const type = str(r.DocType);
    const no = str(r.DocNo); if (!no) continue;
    if (type === 'CS') { cancelledNos.add(no); continue; } // cancel record for a sales bill
    if (!/^BS/.test(type)) continue; // sales bills only (BS, BSV); purchases are not migrated
    const prev = heads.get(no);
    const paid = (prev?.paid) || str(r.PayStt) === 'Y';
    const cancelled = (prev?.cancelled) || str(r.CancelStt) === '*';
    if (!prev || num(r.Id) >= prev.id) heads.set(no, { id: num(r.Id), r, paid, cancelled });
    else { prev.paid = paid; prev.cancelled = cancelled; }
  }

  // Bill lines
  const lines = new Map();
  for (const r of table(reader, 'Data', ['DocType', 'DocNo', 'ProdCode', 'Issue', 'Price', 'IssueAmt', 'DocDate'])) {
    if (!/^BS/.test(str(r.DocType))) continue;
    const no = str(r.DocNo);
    const code = prodCode(r.ProdCode);
    const p = prodByCode.get(code);
    (lines.get(no) || lines.set(no, []).get(no)).push({
      code, name: p?.name || code, unit: p?.unit || '', qty: num(r.Issue), price: num(r.Price), amount: num(r.IssueAmt),
      date: beToIso(r.DocDate),
    });
  }

  const bills = [];
  let skippedByYear = 0;
  for (const [no, h] of heads) {
    const r = h.r;
    const y = beYear(r.DocDate);
    if (cancelledNos.has(no)) h.cancelled = true;
    const credit = num(r.CodeKey) === 22 || str(r.CodeKey) === '22';
    const open = credit && !h.paid && !h.cancelled && num(r.AmtNet) > 0;
    const inRange = y >= fromYear && y <= toYear;
    if (!inRange && !(keepOpenBills && open)) { skippedByYear++; continue; }
    const date = beToIso(r.DocDate);
    const due = beToIso(r.DueDate);
    const graceDays = due && date && due > date ? Math.round((Date.parse(due) - Date.parse(date)) / 86400000) : 0;
    const total = num(r.AmtNet);
    bills.push({
      no, series: no.includes('BSV') ? 'BSV' : 'BS', date, type: credit ? 'credit' : 'cash',
      customerCode: cusCode(r.CusCode), rate: num(r.Rate), graceDays,
      subtotal: num(r.AmtSub), discount: num(r.AmtDisc), total,
      status: h.cancelled ? 'cancelled' : (open ? 'open' : 'paid'),
      principalLeft: open ? total : 0, accruedInterest: 0,
      paidDate: h.paid ? beToIso(r.PayDate) : null, receiptNo: str(r.ReceiptNo) || null,
      interestPaid: h.paid ? num(r.IntAmt) : 0,
      lines: lines.get(no) || [], by: str(r.UserDes), source: 'programkaset',
    });
  }
  bills.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.no < b.no ? -1 : 1));

  // Products with no price in the old file: use the last price they were sold at.
  // (looks at every bill in the file, not only the imported year range)
  const lastPrice = new Map();
  const allLines = [...lines.values()].flat().filter((l) => l.price > 0).sort((x, y) => ((x.date || '') < (y.date || '') ? -1 : 1));
  for (const l of allLines) lastPrice.set(l.code, l.price);
  for (const p of products) if (!p.price && lastPrice.has(p.code)) { p.price = lastPrice.get(p.code); p.priceFromHistory = true; }

  // Receipts (debt payments)
  const receipts = table(reader, 'RPRunning', ['DocNo', 'DocDate', 'CusCode', 'AmtNet']).map((r) => ({
    no: str(r.DocNo), date: beToIso(r.DocDate), customerCode: cusCode(r.CusCode), total: num(r.AmtNet), source: 'programkaset',
  })).filter((x) => { if (!x.no || !x.date) return false; const y = +x.date.slice(0, 4) + 543; return y >= fromYear && y <= toYear; });

  const known = new Set(customers.map((c) => c.code));
  const unknownCus = new Set(bills.filter((b) => b.customerCode && !known.has(b.customerCode)).map((b) => b.customerCode));
  if (unknownCus.size) warnings.push(`บิลอ้างถึงลูกค้าที่ไม่มีในรายชื่อ ${unknownCus.size} รหัส`);
  const noPrice = products.filter((p) => !p.price).length;
  if (noPrice) warnings.push(`สินค้า ${noPrice} รายการยังไม่มีราคาขาย (ไม่เคยขาย)`);

  const openBills = bills.filter((b) => b.status === 'open');
  const summary = {
    shopName: shop.name, customers: customers.length, products: products.length,
    stockPeriod: latest, bills: bills.length, skippedByYear,
    cashBills: bills.filter((b) => b.type === 'cash' && b.status !== 'cancelled').length,
    creditBills: bills.filter((b) => b.type === 'credit' && b.status !== 'cancelled').length,
    cancelledBills: bills.filter((b) => b.status === 'cancelled').length,
    openBills: openBills.length, openPrincipal: round2(openBills.reduce((s, b) => s + b.total, 0)),
    openCustomers: new Set(openBills.map((b) => b.customerCode)).size,
    receipts: receipts.length, warnings,
  };
  return { shop, customers, products, bills, receipts, summary };
}
