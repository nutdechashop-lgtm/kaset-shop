// Offline test backend: one shop kept in this browser (IndexedDB). Open the program with ?local=1 to use it.
// Same functions as backend-cloud.js so the screens don't care which one is running.
import { getData, saveData, getSettings, saveSettings as storeSettings } from './store.js';
import { DEFAULT_SETTINGS, createSale, receivePayment, editBill, cancelBill, voidReceipt, changeBillRate, makeTransfer, editTransfer, cancelTransfer, shopSnapshot, docNo, newPin, hashPin, todayIso } from './shop.js';

export const mode = 'local';
let testName = null; try { testName = localStorage.getItem('localUserName'); } catch { /* ignore */ }
const USER = { uid: 'local', code: 'local', name: testName || 'ทดสอบ (เครื่องนี้)', role: 'admin', shops: ['local'], active: true };
let data = null;

export async function init() { return USER; }
export function onAuth(cb) { cb(USER); }
export async function signIn() { return USER; }
export async function signOut() {}
export async function bootstrapNeeded() { return false; }

export async function listShops() {
  const s = await getSettings(DEFAULT_SETTINGS);
  return [{ label: 'เครื่องนี้', ...s, id: 'local' }];
}
export async function createShop() { throw new Error('โหมดทดสอบมีร้านเดียว'); }

export async function openShop(shopId, onChange) {
  data = await getData();
  data.receipts ||= [];
  data.requests ||= [];
  data.transfers ||= [];
  data.stockLogs ||= [];
  const settings = await getSettings(DEFAULT_SETTINGS);
  return { data, settings, onChange };
}
export function closeShop() {}

export async function saveSettings(shopId, s) { await storeSettings(s); }
export async function renameShop(shopId, label) { const s = await getSettings(DEFAULT_SETTINGS); await storeSettings({ ...s, label }); }

export async function commitSale(shopId, settings, input) {
  const bill = createSale(data, settings, input);
  await saveData(data);
  return bill;
}
export async function commitPayment(shopId, settings, input) {
  const r = receivePayment(data, settings, input);
  await saveData(data);
  return r;
}
export async function saveCustomer(shopId, c) {
  const i = data.customers.findIndex((x) => x.code === c.code);
  if (i >= 0) data.customers[i] = { ...data.customers[i], ...c }; else data.customers.push(c);
  await saveData(data);
}
export async function saveProduct(shopId, p) {
  const i = data.products.findIndex((x) => x.code === p.code);
  if (i >= 0) data.products[i] = { ...data.products[i], ...p }; else data.products.push(p);
  await saveData(data);
}
export async function setMinStock(shopId, codes, minStock) {
  const set = new Set(codes);
  for (const p of data.products) if (set.has(p.code)) { p.minStock = Number(minStock) || 0; p.minStockBy = USER.name; }
  await saveData(data);
}
// Everything is already in memory locally.
export async function findBills(shopId, { no, customerCode }) {
  return data.bills.filter((b) => (no && b.no === no) || (customerCode && b.customerCode === customerCode));
}
export async function findReceipts(shopId, customerCode) {
  return data.receipts.filter((r) => r.customerCode === customerCode);
}
export async function replaceShopData(shopId, result, onProgress) {
  const { shop, summary, ...rest } = result;
  data = { customers: rest.customers, products: rest.products, bills: rest.bills, receipts: rest.receipts || [], importedAt: new Date().toISOString(), importSummary: summary };
  onProgress?.(1);
  await saveData(data);
}
export function importJob() { return null; }
export async function reserveNumbers() { return null; }
export async function findRange(shopId, from, to) { return { bills: data.bills.filter((b) => b.date >= from && b.date <= to), receipts: data.receipts.filter((r) => r.date >= from && r.date <= to) }; }
export async function shopProducts() { return data.products; }
export function addLog(shopId, entry) { data.logs ||= []; data.logs.push({ id: 'l' + Date.now() + Math.random().toString(36).slice(2, 6), ...entry, by: USER.name, at: new Date().toISOString() }); saveData(data); }
export async function listLogs() { return [...(data.logs || [])].sort((a, b) => (a.at < b.at ? 1 : -1)); }
export async function setPrices(shopId, changes) { for (const { code, price } of changes) { const p = data.products.find((x) => x.code === code); if (p) { p.price = price; p.priceFromHistory = false; } } await saveData(data); }
export async function saveClose(shopId, rec) {
  data.closes ||= [];
  const prev = data.closes.find((c) => c.date === rec.date);
  const out = { ...rec, by: USER.name, at: new Date().toISOString(), history: [...(prev?.history || []), ...(prev ? [{ by: prev.by, at: prev.at, counted: prev.counted, diff: prev.diff }] : [])].slice(-10) };
  data.closes = [...data.closes.filter((c) => c.date !== rec.date), out]; await saveData(data); return out;
}
export async function getClose(shopId, date) { return (data.closes || []).find((c) => c.date === date) || null; }
export const pendingCount = () => 0;
export async function flushPending() {}
export async function backfillLastPaid() { return false; }
export async function shopInfo() { const d = await getData(); return { importedAt: d.importedAt, bills: d.bills.length }; }

export async function listUsers() { return data?.demoUsers || [USER]; }
export async function createUser() { throw new Error('โหมดทดสอบไม่มีระบบรหัสพนักงาน'); }
export async function setUserActive() {}
export function heartbeat() { return Promise.resolve(); }
export async function setUserRole(uid, role, shops) { const u = data?.demoUsers?.find((x) => x.uid === uid); if (u) { Object.assign(u, { role, shops }); await saveData(data); } }
export async function deleteUser(uid) { if (data?.demoUsers) { data.demoUsers = data.demoUsers.filter((u) => u.uid !== uid); await saveData(data); } }
export async function changeMyPin() { throw new Error('โหมดทดสอบไม่มีระบบรหัสพนักงาน'); }

// ---------- bill edits / cancels and requests ----------
function applyStock(stock) {
  for (const [code, d] of stock) { const p = data.products.find((x) => x.code === code); if (p) p.stock = Math.round(((p.stock || 0) + d) * 100) / 100; }
}
export async function commitBillChange(shopId, billNo, kind, changes, meta) {
  const i = data.bills.findIndex((b) => b.no === billNo);
  const cur = data.bills[i];
  const res = kind === 'cancel' ? cancelBill(data.products, cur, meta) : kind === 'rate' ? { bill: changeBillRate(cur, changes.rate, meta), stock: new Map() } : editBill(data.products, cur, changes, meta);
  data.bills[i] = res.bill; applyStock(res.stock);
  await saveData(data);
  return res.bill;
}
export async function commitReceiptVoid(shopId, receiptNo, meta = {}) {
  const i = data.receipts.findIndex((r) => r.no === receiptNo);
  if (i < 0) throw new Error('ไม่พบใบเสร็จ ' + receiptNo);
  const nos = new Set((data.receipts[i].rows || []).map((r) => r.no));
  const res = voidReceipt(data.receipts[i], data.bills.filter((b) => nos.has(b.no)), { ...meta, by: meta.by || USER.name });
  data.receipts[i] = res.receipt;
  for (const b of res.bills) data.bills[data.bills.findIndex((x) => x.no === b.no)] = b;
  const c = data.customers.find((x) => x.code === res.receipt.customerCode);
  if (c) c.lastPaidAt = data.receipts.filter((x) => x.customerCode === c.code && x.status !== 'void').reduce((m, x) => (x.date > m ? x.date : m), '') || null;
  await saveData(data); return res.receipt;
}
export async function createRequest(shopId, req) {
  const r = { id: 'r' + Date.now(), status: 'pending', createdAt: new Date().toISOString(), ...req };
  data.requests.push(r); await saveData(data); return r;
}
export async function resolveRequest(shopId, id, approve, meta) {
  const r = data.requests.find((x) => x.id === id);
  if (!r || r.status !== 'pending') throw new Error('คำขอนี้ถูกจัดการไปแล้ว');
  if (approve && r.kind === 'voidReceipt') await commitReceiptVoid(shopId, r.receiptNo, { by: r.byName, reason: r.reason });
  else if (approve) await commitBillChange(shopId, r.billNo, r.kind, r.changes, { by: r.byName, reason: r.reason });
  Object.assign(r, { status: approve ? 'approved' : 'rejected', resolvedBy: meta.by, resolvedAt: new Date().toISOString() });
  await saveData(data);
}

// ---------- backup / restore / delete ----------
export async function exportShop() {
  const d = await getData();
  const settings = await getSettings(DEFAULT_SETTINGS);
  const { id, ...s } = settings;
  const asDocs = (arr, key) => (arr || []).map((x) => ({ id: x[key] ?? x.id, data: x }));
  return { format: 'dreamshop-kaset-backup', version: 1, exportedAt: new Date().toISOString(), exportedBy: USER.name, shopId: 'local', settings: s,
    collections: { customers: asDocs(d.customers, 'code'), products: asDocs(d.products, 'code'), bills: asDocs(d.bills, 'no'), receipts: asDocs(d.receipts, 'no'), requests: asDocs(d.requests, 'id'), counters: [], transfers: asDocs(d.transfers, 'no'), stockLogs: asDocs(d.stockLogs, 'at'), closes: asDocs(d.closes, 'date'), logs: asDocs(d.logs, 'id') } };
}
export async function restoreShop(shopId, backup, onProgress) {
  const c = backup.collections || {};
  const vals = (k) => (c[k] || []).map((x) => x.data);
  data = { customers: vals('customers'), products: vals('products'), bills: vals('bills'), receipts: vals('receipts'), requests: vals('requests'), transfers: vals('transfers'), stockLogs: vals('stockLogs'), closes: vals('closes'), logs: vals('logs') };
  await saveData(data);
  const { lastBackupAt, ...s } = backup.settings || {};
  await storeSettings({ ...(await getSettings(DEFAULT_SETTINGS)), ...s });
  onProgress?.(1);
}
export async function deleteShop(shopId, onProgress) {
  data = { customers: [], products: [], bills: [], receipts: [], requests: [], transfers: [], stockLogs: [] };
  await saveData(data); onProgress?.(1);
}
export async function markBackup() {
  await storeSettings({ ...(await getSettings(DEFAULT_SETTINGS)), lastBackupAt: new Date().toISOString(), lastBackupBy: USER.name });
}

// ---------- stock / PIN / overview ----------
export async function commitTransfer(shopId, settings, input) {
  const date = input.date || todayIso();
  const no = docNo(settings.prefix, 'TR', date, data.transfers.map((t) => t.no));
  const { transfer, stock } = makeTransfer(data.products, { ...input, date }, no);
  data.transfers.push(transfer); applyStock(stock); await saveData(data); return transfer;
}
export async function changeTransfer(shopId, no, kind, changes, meta = {}) {
  const i = data.transfers.findIndex((t) => t.no === no);
  const res = kind === 'cancel' ? cancelTransfer(data.products, data.transfers[i], meta) : editTransfer(data.products, data.transfers[i], changes, meta);
  data.transfers[i] = res.transfer; applyStock(res.stock); await saveData(data); return res.transfer;
}
export async function findTransfers() { return data.transfers; }
export async function adjustStock(shopId, code, counted, reason) {
  const p = data.products.find((x) => x.code === code);
  data.stockLogs.push({ code, name: p.name, from: p.stock || 0, to: Number(counted), reason: reason || '', by: USER.name, at: new Date().toISOString() });
  p.stock = Number(counted); await saveData(data); return p.stock;
}
export async function stockLogs(shopId, code) { return data.stockLogs.filter((l) => l.code === code).sort((a, b) => (a.at < b.at ? 1 : -1)); }
export async function issueCostPin(shopId, requestId) {
  const r = data.requests.find((x) => x.id === requestId);
  const pin = newPin(), salt = newPin() + Date.now();
  Object.assign(r, { status: 'approved', pinHash: await hashPin(pin, salt), salt, issuedBy: USER.name, issuedAt: new Date().toISOString() });
  await saveData(data); return pin;
}
export async function useCostPin(shopId, pin) {
  for (const r of data.requests) {
    if (r.kind !== 'costPin' || r.status !== 'approved') continue;
    if (await hashPin(String(pin).trim(), r.salt) === r.pinHash) { r.status = 'used'; await saveData(data); return true; }
  }
  return false;
}
export async function shopOverview() { return shopSnapshot(data || await getData(), todayIso()); }
