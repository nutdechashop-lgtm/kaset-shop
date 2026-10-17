// Online backend: Firebase Auth (code + PIN) and Firestore (one area per shop).
//   users/{uid}                 { code, name, role: admin|owner|staff, shops: [shopId], active }
//   config/main                 { adminUid }  — first super-admin, created once
//   shops/{shopId}              shop settings (name, address, bill prefix, default rate, …)
//   shops/{shopId}/customers|products|bills|receipts|counters/{id}
import * as fb from './firebase.bundle.js';
import { firebaseConfig } from './firebase-config.js';
import { DEFAULT_SETTINGS, createSale, receivePayment, docHead, maxRunning, todayIso } from './shop.js';
import { addDays } from './interest.js';

export const mode = 'cloud';
const EMAIL_DOMAIN = 'kaset-shop.app';
const RECENT_DAYS = 35; // bills/receipts newer than this stay synced live; older ones are fetched on search

const app = fb.initializeApp(firebaseConfig);
const auth = fb.getAuth(app);
const db = fb.initializeFirestore(app, {
  localCache: fb.persistentLocalCache({ tabManager: fb.persistentMultipleTabManager() }),
  ignoreUndefinedProperties: true,
});

const codeToEmail = (code) => `${String(code).trim().toLowerCase()}@${EMAIL_DOMAIN}`;
const checkCode = (code) => { if (!/^[A-Za-z0-9_-]{2,20}$/.test(String(code).trim())) throw new Error('รหัสใช้ตัวอักษรอังกฤษหรือตัวเลข 2–20 ตัว'); };
const checkPin = (pin) => { if (!/^\d{6}$/.test(String(pin))) throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก'); };
const shopDoc = (shopId) => fb.doc(db, 'shops', shopId);
const sub = (shopId, coll, id) => (id == null ? fb.collection(db, 'shops', shopId, coll) : fb.doc(db, 'shops', shopId, coll, id));

function authMsg(e) {
  const c = e?.code || '';
  if (/invalid-credential|wrong-password|user-not-found|invalid-email/.test(c)) return 'รหัสหรือ PIN ไม่ถูกต้อง';
  if (/too-many-requests/.test(c)) return 'ใส่ผิดหลายครั้ง รอสักครู่แล้วลองใหม่';
  if (/network/.test(c)) return 'ต่ออินเทอร์เน็ตไม่ได้';
  if (/email-already-in-use/.test(c)) return 'รหัสนี้มีคนใช้แล้ว';
  if (/weak-password/.test(c)) return 'PIN ต้องมี 6 หลัก';
  if (/permission-denied/.test(c)) return 'ไม่มีสิทธิ์ทำรายการนี้';
  if (/unavailable|failed-precondition/.test(c)) return 'ต้องต่ออินเทอร์เน็ตเพื่อบันทึกรายการนี้';
  return e?.message || String(e);
}
const wrap = async (fn) => { try { return await fn(); } catch (e) { throw new Error(authMsg(e)); } };

// ---------- sign in ----------
let me = null;
async function loadProfile(u) {
  if (!u) return null;
  const s = await fb.getDoc(fb.doc(db, 'users', u.uid));
  return s.exists() ? { uid: u.uid, ...s.data() } : { uid: u.uid, code: u.email?.split('@')[0], missing: true };
}
export function init() {
  return new Promise((resolve) => {
    const off = fb.onAuthStateChanged(auth, async (u) => {
      off();
      try { me = await loadProfile(u); } catch { me = null; }
      if (me && (me.missing || !me.active)) { await fb.signOut(auth); me = null; }
      resolve(me);
    });
  });
}
export async function signIn(code, pin) {
  checkCode(code);
  const cred = await wrap(() => fb.signInWithEmailAndPassword(auth, codeToEmail(code), String(pin)));
  me = await wrap(() => loadProfile(cred.user));
  if (!me || me.missing || !me.active) { await fb.signOut(auth); me = null; throw new Error('รหัสนี้ถูกปิดใช้งาน หรือยังไม่ได้ตั้งสิทธิ์'); }
  return me;
}
export async function signOut() { closeShop(); await fb.signOut(auth); me = null; }

export async function bootstrapNeeded() {
  try { return !(await fb.getDoc(fb.doc(db, 'config', 'main'))).exists(); } catch { return false; }
}
// First run only: create the super-admin code.
export async function setupAdmin({ code, name, pin }) {
  checkCode(code); checkPin(pin);
  if (!name?.trim()) throw new Error('ใส่ชื่อ');
  const cred = await wrap(() => fb.createUserWithEmailAndPassword(auth, codeToEmail(code), String(pin)));
  await wrap(() => fb.setDoc(fb.doc(db, 'config', 'main'), { adminUid: cred.user.uid, createdAt: fb.serverTimestamp() }));
  await wrap(() => fb.setDoc(fb.doc(db, 'users', cred.user.uid), { code: code.trim(), name: name.trim(), role: 'admin', shops: [], active: true, createdAt: fb.serverTimestamp() }));
  me = await loadProfile(cred.user);
  return me;
}

// ---------- shops ----------
export async function listShops() {
  if (me.role === 'admin') {
    const s = await wrap(() => fb.getDocs(fb.collection(db, 'shops')));
    return s.docs.map((d) => ({ id: d.id, ...DEFAULT_SETTINGS, ...d.data() })).sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  const out = [];
  for (const id of me.shops || []) { const d = await wrap(() => fb.getDoc(shopDoc(id))); if (d.exists()) out.push({ id, ...DEFAULT_SETTINGS, ...d.data() }); }
  return out;
}
export async function createShop({ label }) {
  if (!label?.trim()) throw new Error('ใส่ชื่อเรียกร้าน');
  const shops = await listShops();
  let n = 1; while (shops.some((s) => s.id === 's' + String(n).padStart(2, '0'))) n++;
  const id = 's' + String(n).padStart(2, '0');
  await wrap(() => fb.setDoc(shopDoc(id), { ...DEFAULT_SETTINGS, label: label.trim(), prefix: String(n).padStart(2, '0'), createdAt: fb.serverTimestamp() }));
  return id;
}

// Live copy of one shop. Customers & products in full; bills that are still open plus recent ones.
let unsubs = [];
let data = null;
export function closeShop() { unsubs.forEach((u) => u()); unsubs = []; data = null; }
export async function openShop(shopId, onChange) {
  closeShop();
  data = { customers: [], products: [], bills: [], receipts: [] };
  const settingsBox = { value: { ...DEFAULT_SETTINGS } };
  const maps = { customers: new Map(), products: new Map(), billsOpen: new Map(), billsRecent: new Map(), receipts: new Map() };
  const rebuild = () => {
    data.customers = [...maps.customers.values()];
    data.products = [...maps.products.values()];
    data.bills = [...new Map([...maps.billsRecent, ...maps.billsOpen]).values()];
    data.receipts = [...maps.receipts.values()];
  };
  let timer = null, ready = false;
  const changed = () => { rebuild(); if (ready) { clearTimeout(timer); timer = setTimeout(() => onChange?.(), 250); } };
  const cutoff = addDays(todayIso(), -RECENT_DAYS);
  const listen = (q, key) => new Promise((resolve, reject) => {
    let first = true;
    unsubs.push(fb.onSnapshot(q, (snap) => {
      for (const ch of snap.docChanges()) { if (ch.type === 'removed') maps[key].delete(ch.doc.id); else maps[key].set(ch.doc.id, ch.doc.data()); }
      changed();
      if (first) { first = false; resolve(); }
    }, (err) => { if (first) reject(new Error(authMsg(err))); }));
  });
  const settingsReady = new Promise((resolve, reject) => {
    let first = true;
    unsubs.push(fb.onSnapshot(shopDoc(shopId), (d) => {
      settingsBox.value = { ...DEFAULT_SETTINGS, ...(d.data() || {}) };
      if (first) { first = false; resolve(); } else onChange?.('settings');
    }, (err) => { if (first) reject(new Error(authMsg(err))); }));
  });
  await Promise.all([
    settingsReady,
    listen(sub(shopId, 'customers'), 'customers'),
    listen(sub(shopId, 'products'), 'products'),
    listen(fb.query(sub(shopId, 'bills'), fb.where('status', '==', 'open')), 'billsOpen'),
    listen(fb.query(sub(shopId, 'bills'), fb.where('date', '>=', cutoff)), 'billsRecent'),
    listen(fb.query(sub(shopId, 'receipts'), fb.where('date', '>=', cutoff)), 'receipts'),
  ]);
  rebuild(); ready = true;
  return { data, get settings() { return settingsBox.value; } };
}

export async function saveSettings(shopId, s) {
  const { id, ...rest } = s;
  await wrap(() => fb.setDoc(shopDoc(shopId), rest, { merge: true }));
}

// Sale: bill number from a per-day counter, stock reduced with increments (safe with several devices).
export async function commitSale(shopId, settings, input) {
  const date = input.date || todayIso();
  const head = docHead(settings.prefix, 'BS', date);
  const localMax = maxRunning(head, data.bills.map((b) => b.no));
  return wrap(() => fb.runTransaction(db, async (tx) => {
    const cref = sub(shopId, 'counters', head);
    const cs = await tx.get(cref);
    const n = Math.max(cs.exists() ? cs.data().n : 0, localMax) + 1;
    const no = head + String(n).padStart(4, '0');
    const scratch = { customers: data.customers, products: data.products.map((p) => ({ ...p })), bills: [], receipts: [] };
    const bill = createSale(scratch, settings, { ...input, date, by: me.name }, { no });
    bill.byUid = me.uid;
    tx.set(cref, { n });
    tx.set(sub(shopId, 'bills', no), bill);
    const qty = new Map();
    for (const l of bill.lines) qty.set(l.code, (qty.get(l.code) || 0) + l.qty);
    for (const [code, q] of qty) {
      const p = data.products.find((x) => x.code === code);
      if (p && !p.noStock) tx.update(sub(shopId, 'products', code), { stock: fb.increment(-q) });
    }
    return bill;
  }));
}

// Debt payment: re-reads the customer's open bills inside the transaction so two devices can't double-apply.
export async function commitPayment(shopId, settings, input) {
  const date = input.date || todayIso();
  const head = docHead(settings.prefix, 'RP', date);
  const localMax = maxRunning(head, data.receipts.map((r) => r.no));
  const openNos = data.bills.filter((b) => b.customerCode === input.customerCode && b.type === 'credit' && b.status === 'open').map((b) => b.no);
  return wrap(() => fb.runTransaction(db, async (tx) => {
    const cref = sub(shopId, 'counters', head);
    const cs = await tx.get(cref);
    const snaps = await Promise.all(openNos.map((no) => tx.get(sub(shopId, 'bills', no))));
    const bills = snaps.filter((s) => s.exists()).map((s) => s.data()).filter((b) => b.status === 'open');
    const n = Math.max(cs.exists() ? cs.data().n : 0, localMax) + 1;
    const no = head + String(n).padStart(4, '0');
    const scratch = { customers: data.customers, products: [], bills, receipts: [] };
    const receipt = receivePayment(scratch, settings, { ...input, date, by: me.name }, { no });
    receipt.byUid = me.uid;
    tx.set(cref, { n });
    const touched = new Set(receipt.rows.map((r) => r.no));
    for (const b of scratch.bills) if (touched.has(b.no)) tx.set(sub(shopId, 'bills', b.no), b);
    tx.set(sub(shopId, 'receipts', no), receipt);
    return receipt;
  }));
}

export async function saveCustomer(shopId, c) { await wrap(() => fb.setDoc(sub(shopId, 'customers', c.code), c, { merge: true })); }
export async function saveProduct(shopId, p) { await wrap(() => fb.setDoc(sub(shopId, 'products', p.code), p, { merge: true })); }

// Older bills / receipts are not kept live; fetch them when searched.
export async function findBills(shopId, { no, customerCode }) {
  if (no) { const d = await wrap(() => fb.getDoc(sub(shopId, 'bills', no))); return d.exists() ? [d.data()] : []; }
  if (customerCode) { const s = await wrap(() => fb.getDocs(fb.query(sub(shopId, 'bills'), fb.where('customerCode', '==', customerCode)))); return s.docs.map((d) => d.data()); }
  return [];
}
export async function findReceipts(shopId, customerCode) {
  const s = await wrap(() => fb.getDocs(fb.query(sub(shopId, 'receipts'), fb.where('customerCode', '==', customerCode))));
  return s.docs.map((d) => d.data());
}

// Import from the old program: wipe the shop's records, then write everything in batches.
export async function replaceShopData(shopId, result, onProgress) {
  const colls = ['customers', 'products', 'bills', 'receipts', 'counters'];
  const existing = [];
  for (const c of colls) { const s = await wrap(() => fb.getDocs(sub(shopId, c))); existing.push(...s.docs.map((d) => d.ref)); }
  const writes = [
    ...result.customers.map((x) => [sub(shopId, 'customers', x.code), x]),
    ...result.products.map((x) => [sub(shopId, 'products', x.code), x]),
    ...result.bills.map((x) => [sub(shopId, 'bills', x.no), x]),
    ...(result.receipts || []).filter((x) => x.no && !x.no.includes('/')).map((x) => [sub(shopId, 'receipts', x.no), x]),
  ];
  const total = existing.length + writes.length;
  let done = 0;
  const BATCH = 400;
  for (let i = 0; i < existing.length; i += BATCH) {
    const b = fb.writeBatch(db);
    existing.slice(i, i + BATCH).forEach((r) => b.delete(r));
    await wrap(() => b.commit()); done += Math.min(BATCH, existing.length - i); onProgress?.(done / total);
  }
  for (let i = 0; i < writes.length; i += BATCH) {
    const b = fb.writeBatch(db);
    writes.slice(i, i + BATCH).forEach(([ref, x]) => b.set(ref, x));
    await wrap(() => b.commit()); done += Math.min(BATCH, writes.length - i); onProgress?.(done / total);
  }
  const { warnings, ...summary } = result.summary;
  await wrap(() => fb.setDoc(shopDoc(shopId), { importedAt: new Date().toISOString(), importSummary: summary }, { merge: true }));
}
export async function shopInfo(shopId) {
  const d = await wrap(() => fb.getDoc(shopDoc(shopId)));
  return { importedAt: d.data()?.importedAt, bills: d.data()?.importSummary?.bills };
}

// ---------- users (codes) ----------
export async function listUsers() {
  const s = await wrap(() => fb.getDocs(fb.collection(db, 'users')));
  const all = s.docs.map((d) => ({ uid: d.id, ...d.data() }));
  return me.role === 'admin' ? all : all.filter((u) => (u.shops || []).some((x) => me.shops.includes(x)));
}
// Create a login without signing the current user out (uses a temporary second Firebase app).
export async function createUser({ code, name, pin, role, shops }) {
  checkCode(code); checkPin(pin);
  if (!name?.trim()) throw new Error('ใส่ชื่อ');
  if (role !== 'admin' && !shops?.length) throw new Error('เลือกร้านอย่างน้อย 1 ร้าน');
  const second = fb.initializeApp(firebaseConfig, 'create-' + Date.now());
  try {
    const sa = fb.getAuth(second);
    const cred = await wrap(() => fb.createUserWithEmailAndPassword(sa, codeToEmail(code), String(pin)));
    await wrap(() => fb.setDoc(fb.doc(db, 'users', cred.user.uid), { code: code.trim(), name: name.trim(), role, shops: role === 'admin' ? [] : shops, active: true, createdBy: me.uid, createdAt: fb.serverTimestamp() }));
    await fb.signOut(sa);
  } finally { await fb.deleteApp(second); }
}
export async function setUserActive(uid, active) { await wrap(() => fb.updateDoc(fb.doc(db, 'users', uid), { active })); }
export async function changeMyPin(oldPin, newPin) {
  checkPin(newPin);
  const cred = fb.EmailAuthProvider.credential(auth.currentUser.email, String(oldPin));
  await wrap(() => fb.reauthenticateWithCredential(auth.currentUser, cred));
  await wrap(() => fb.updatePassword(auth.currentUser, String(newPin)));
}
