// Offline test backend: one shop kept in this browser (IndexedDB). Open the program with ?local=1 to use it.
// Same functions as backend-cloud.js so the screens don't care which one is running.
import { getData, saveData, getSettings, saveSettings as storeSettings } from './store.js';
import { DEFAULT_SETTINGS, createSale, receivePayment, editBill, cancelBill } from './shop.js';

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
  const settings = await getSettings(DEFAULT_SETTINGS);
  return { data, settings, onChange };
}
export function closeShop() {}

export async function saveSettings(shopId, s) { await storeSettings(s); }

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
export async function shopInfo() { const d = await getData(); return { importedAt: d.importedAt, bills: d.bills.length }; }

export async function listUsers() { return data?.demoUsers || [USER]; }
export async function createUser() { throw new Error('โหมดทดสอบไม่มีระบบรหัสพนักงาน'); }
export async function setUserActive() {}
export async function changeMyPin() { throw new Error('โหมดทดสอบไม่มีระบบรหัสพนักงาน'); }

// ---------- bill edits / cancels and requests ----------
function applyStock(stock) {
  for (const [code, d] of stock) { const p = data.products.find((x) => x.code === code); if (p) p.stock = Math.round(((p.stock || 0) + d) * 100) / 100; }
}
export async function commitBillChange(shopId, billNo, kind, changes, meta) {
  const i = data.bills.findIndex((b) => b.no === billNo);
  const res = kind === 'cancel' ? cancelBill(data.products, data.bills[i], meta) : editBill(data.products, data.bills[i], changes, meta);
  data.bills[i] = res.bill; applyStock(res.stock);
  await saveData(data);
  return res.bill;
}
export async function createRequest(shopId, req) {
  const r = { id: 'r' + Date.now(), status: 'pending', createdAt: new Date().toISOString(), ...req };
  data.requests.push(r); await saveData(data); return r;
}
export async function resolveRequest(shopId, id, approve, meta) {
  const r = data.requests.find((x) => x.id === id);
  if (!r || r.status !== 'pending') throw new Error('คำขอนี้ถูกจัดการไปแล้ว');
  if (approve) await commitBillChange(shopId, r.billNo, r.kind, r.changes, { by: r.byName, reason: r.reason });
  Object.assign(r, { status: approve ? 'approved' : 'rejected', resolvedBy: meta.by, resolvedAt: new Date().toISOString() });
  await saveData(data);
}
