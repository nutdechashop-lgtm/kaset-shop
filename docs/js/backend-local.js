// Offline test backend: one shop kept in this browser (IndexedDB). Open the program with ?local=1 to use it.
// Same functions as backend-cloud.js so the screens don't care which one is running.
import { getData, saveData, getSettings, saveSettings as storeSettings } from './store.js';
import { DEFAULT_SETTINGS, createSale, receivePayment } from './shop.js';

export const mode = 'local';
const USER = { uid: 'local', code: 'local', name: 'ทดสอบ (เครื่องนี้)', role: 'admin', shops: ['local'], active: true };
let data = null;

export async function init() { return USER; }
export function onAuth(cb) { cb(USER); }
export async function signIn() { return USER; }
export async function signOut() {}
export async function bootstrapNeeded() { return false; }

export async function listShops() {
  const s = await getSettings(DEFAULT_SETTINGS);
  return [{ id: 'local', label: 'เครื่องนี้', ...s }];
}
export async function createShop() { throw new Error('โหมดทดสอบมีร้านเดียว'); }

export async function openShop(shopId, onChange) {
  data = await getData();
  data.receipts ||= [];
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

export async function listUsers() { return [USER]; }
export async function createUser() { throw new Error('โหมดทดสอบไม่มีระบบรหัสพนักงาน'); }
export async function setUserActive() {}
export async function changeMyPin() { throw new Error('โหมดทดสอบไม่มีระบบรหัสพนักงาน'); }
