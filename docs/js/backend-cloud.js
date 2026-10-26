// Online backend: Firebase Auth (code + PIN) and Firestore (one area per shop).
//   users/{uid}                 { code, name, role: admin|owner|manager|staff, shops: [shopId], active }
//   config/main                 { adminUid }  — first super-admin, created once
//   shops/{shopId}              shop settings (name, address, bill prefix, default rate, …)
//   shops/{shopId}/customers|products|bills|receipts|counters/{id}
import * as fb from './firebase.bundle.js';
import { firebaseConfig } from './firebase-config.js';
import { DEFAULT_SETTINGS, createSale, receivePayment, docHead, maxRunning, todayIso, editBill, cancelBill, voidReceipt, changeBillRate, makeTransfer, editTransfer, cancelTransfer, shopSnapshot, newPin, hashPin } from './shop.js';
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
  if (/network/.test(c)) return 'ต่ออินเทอร์เน็ตไม่ได้ · การเข้าระบบต้องมีอินเทอร์เน็ต (เข้าแล้วใช้งานต่อตอนไม่มีเน็ตได้)';
  if (/email-already-in-use/.test(c)) return 'รหัสนี้มีคนใช้แล้ว (หรือเคยถูกลบไป) ให้ตั้งรหัสอื่น เช่น เติมตัวเลขต่อท้าย';
  if (/weak-password/.test(c)) return 'PIN ต้องมี 6 หลัก';
  if (/permission-denied/.test(c)) return 'ไม่มีสิทธิ์ทำรายการนี้';
  if (/resource-exhausted/.test(c)) return QUOTA_MSG;
  if (/unavailable|failed-precondition/.test(c)) return 'ต้องต่ออินเทอร์เน็ตเพื่อบันทึกรายการนี้';
  return e?.message || String(e);
}
const QUOTA_MSG = 'Firebase ไม่รับข้อมูลเพิ่ม ส่วนใหญ่เกิดจากโควตาฟรีรายวันเต็ม (อ่าน 50,000 / บันทึก 20,000 / ลบ 20,000 รายการต่อวัน) โควตาจะเริ่มใหม่ทุกวันประมาณ 14:00–15:00 น. (เวลาไทย) ข้อมูลที่บันทึกไปแล้วไม่หาย';
// A Firestore call that never answers (quota used up, or very weak internet) would otherwise wait forever.
function withTimeout(p, ms, what) {
  let t; const timer = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`${what}: รอเกิน ${Math.round(ms / 1000)} วินาทีแล้วยังไม่สำเร็จ · ${QUOTA_MSG} · หรืออินเทอร์เน็ตช้ามาก`)), ms); });
  return Promise.race([p, timer]).finally(() => clearTimeout(t));
}
const wrap = async (fn) => { try { return await fn(); } catch (e) { throw new Error(authMsg(e)); } };
// Without internet Firestore keeps a write on this computer and sends it later, but its promise only
// settles when the server answers: don't make the person wait for that.
const save = (p) => { if (online()) return wrap(() => p); p.catch((e) => console.warn('saved later failed', e)); return Promise.resolve(); };

// ---------- sign in ----------
let me = null;
async function loadProfile(u) {
  if (!u) return null;
  const s = await fb.getDoc(fb.doc(db, 'users', u.uid));
  return s.exists() ? { uid: u.uid, ...s.data() } : { uid: u.uid, code: u.email?.split('@')[0], missing: true };
}
// Staff codes are remembered only until the program / browser window is closed; owners and admins stay signed in.
const STAFF_FLAG = 'kaset-staff-session';
const flag = { get: () => { try { return sessionStorage.getItem(STAFF_FLAG); } catch { return null; } }, set: (v) => { try { v ? sessionStorage.setItem(STAFF_FLAG, '1') : sessionStorage.removeItem(STAFF_FLAG); } catch { /* ignore */ } } };
async function applySessionRule(profile) {
  if (profile?.role === 'staff') { await fb.setPersistence(auth, fb.browserSessionPersistence).catch(() => {}); flag.set(true); }
  else { await fb.setPersistence(auth, fb.browserLocalPersistence).catch(() => {}); flag.set(false); }
}
export function init() {
  return new Promise((resolve) => {
    const off = fb.onAuthStateChanged(auth, async (u) => {
      off();
      try { me = await loadProfile(u); } catch { me = null; }
      if (me && (me.missing || !me.active)) { await fb.signOut(auth); me = null; }
      // A staff sign-in left over from an earlier window (e.g. saved before this rule existed): sign in again.
      if (me && me.role === 'staff' && !flag.get()) { await fb.signOut(auth); me = null; }
      resolve(me);
    });
  });
}
export async function signIn(code, pin) {
  checkCode(code);
  const cred = await wrap(() => fb.signInWithEmailAndPassword(auth, codeToEmail(code), String(pin)));
  me = await wrap(() => loadProfile(cred.user));
  if (!me || me.missing || !me.active) { await fb.signOut(auth); me = null; throw new Error('รหัสนี้ถูกปิดใช้งาน หรือยังไม่ได้ตั้งสิทธิ์'); }
  await applySessionRule(me);
  return me;
}
export async function signOut() { await Promise.race([heartbeat('', true), new Promise((r) => setTimeout(r, 1500))]); closeShop(); await fb.signOut(auth); me = null; flag.set(false); }

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
    return s.docs.map((d) => ({ ...DEFAULT_SETTINGS, ...d.data(), id: d.id })).sort((a, b) => (a.id < b.id ? -1 : 1));
  }
  const out = [];
  for (const id of me.shops || []) { const d = await wrap(() => fb.getDoc(shopDoc(id))); if (d.exists()) out.push({ ...DEFAULT_SETTINGS, ...d.data(), id }); }
  return out;
}
export async function renameShop(shopId, label) { if (!label) throw new Error('ใส่ชื่อเรียกร้าน'); await wrap(() => fb.updateDoc(shopDoc(shopId), { label })); }
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
let currentShop = null;
export async function openShop(shopId, onChange) {
  closeShop(); currentShop = shopId;
  data = { customers: [], products: [], bills: [], receipts: [], requests: [], transfers: [] };
  const settingsBox = { value: { ...DEFAULT_SETTINGS } };
  const maps = { customers: new Map(), products: new Map(), billsOpen: new Map(), billsRecent: new Map(), receipts: new Map(), requests: new Map(), transfers: new Map() };
  const rebuild = () => {
    data.customers = [...maps.customers.values()];
    data.products = [...maps.products.values()];
    data.bills = [...new Map([...maps.billsRecent, ...maps.billsOpen]).values()];
    data.receipts = [...maps.receipts.values()];
    data.requests = [...maps.requests.entries()].map(([id, r]) => ({ id, ...r }));
    data.transfers = [...maps.transfers.values()];
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
    listen(fb.query(sub(shopId, 'requests'), fb.where('status', '==', 'pending')), 'requests'),
    listen(fb.query(sub(shopId, 'transfers'), fb.where('date', '>=', addDays(todayIso(), -90))), 'transfers'),
  ]);
  rebuild(); ready = true;
  return { data, get settings() { return settingsBox.value; } };
}

// ---------- end-of-day close ----------
export async function saveClose(shopId, rec) {
  needOnline('บันทึกปิดร้าน');
  const ref = sub(shopId, 'closes', rec.date);
  const old = await wrap(() => fb.getDoc(ref));
  const prev = old.exists() ? old.data() : null;
  const out = { ...rec, by: me.name, at: new Date().toISOString(), history: [...(prev?.history || []), ...(prev ? [{ by: prev.by, at: prev.at, counted: prev.counted, diff: prev.diff }] : [])].slice(-10) };
  await wrap(() => fb.setDoc(ref, out));
  return out;
}
export async function getClose(shopId, date) { const d = await wrap(() => fb.getDoc(sub(shopId, 'closes', date))); return d.exists() ? d.data() : null; }

export async function saveSettings(shopId, s) {
  const { id, ...rest } = s;
  await save(fb.setDoc(shopDoc(shopId), rest, { merge: true }));
}

// Sale: bill number from a per-day counter, stock reduced with increments (safe with several devices).
// ---------- selling, also without internet ----------
// Each computer reserves a small block of today's bill numbers while online. Today's sales use those
// numbers and are written as a plain batch: with internet it is saved at once; without internet it is
// kept on this computer (and the bill can be printed) and sent automatically when the internet is back.
// Numbers never clash between computers. Backdated bills still need internet (they use the day counter).
// Every computer keeps at least OFFLINE_BILLS numbers in hand for today, plus a block for tomorrow
// (so a shop whose internet is down in the morning can still sell). Numbers are taken from the
// day counter one block at a time; a block is used up before the next, so there are no gaps
// except the unused end of a computer's last block of the day.
export const OFFLINE_BILLS = 30;
const resvKey = (shopId) => 'resv2:' + shopId;
const loadResv = (shopId) => { try { return JSON.parse(localStorage.getItem(resvKey(shopId)) || '{}') || {}; } catch { return {}; } };
const saveResv = (shopId, r) => { try { localStorage.setItem(resvKey(shopId), JSON.stringify(r)); } catch { /* ignore */ } window.dispatchEvent(new Event('pendingchange')); };
const online = () => navigator.onLine !== false;
const left = (blocks = []) => blocks.reduce((t, b) => t + Math.max(0, b.to - b.next + 1), 0);
// How many bills this computer can still save today without internet.
export function offlineLeft(shopId, settings) { return left(loadResv(shopId)[docHead(settings.prefix, 'BS', todayIso())]); }
async function reserveBlock(shopId, head) {
  const localMax = maxRunning(head, (data?.bills || []).map((b) => b.no));
  return wrap(() => withTimeout(fb.runTransaction(db, async (tx) => {
    const cref = sub(shopId, 'counters', head);
    const cs = await tx.get(cref);
    const n = Math.max(cs.exists() ? cs.data().n : 0, localMax);
    tx.set(cref, { n: n + OFFLINE_BILLS });
    return { next: n + 1, to: n + OFFLINE_BILLS };
  }), 15000, 'จองเลขบิล'));
}
let reserving = null;
export function reserveNumbers(shopId, settings) {
  if (!online()) return Promise.resolve();
  if (reserving) return reserving;
  reserving = (async () => {
    const today = docHead(settings.prefix, 'BS', todayIso()), tomorrow = docHead(settings.prefix, 'BS', addDays(todayIso(), 1));
    const r = loadResv(shopId);
    for (const k of Object.keys(r)) if (k !== today && k !== tomorrow) delete r[k]; // old days
    for (const head of [today, tomorrow]) {
      r[head] = (r[head] || []).filter((b) => b.next <= b.to);
      if (left(r[head]) < OFFLINE_BILLS) { r[head].push(await reserveBlock(shopId, head)); saveResv(shopId, r); }
    }
    saveResv(shopId, r);
  })().finally(() => { reserving = null; });
  return reserving;
}
function takeNumber(shopId, head) {
  const r = loadResv(shopId);
  const b = (r[head] || []).find((x) => x.next <= x.to);
  if (!b) return null;
  const no = head + String(b.next).padStart(4, '0');
  b.next++; r[head] = r[head].filter((x) => x.next <= x.to); saveResv(shopId, r);
  return no;
}
// Sales saved on this computer but not yet confirmed by the server.
const pendKey = (shopId) => 'pendingBills:' + shopId;
const pendList = (shopId) => { try { return JSON.parse(localStorage.getItem(pendKey(shopId)) || '[]'); } catch { return []; } };
const pendSave = (shopId, l) => { try { localStorage.setItem(pendKey(shopId), JSON.stringify(l)); } catch { /* ignore */ } window.dispatchEvent(new Event('pendingchange')); };
export const pendingCount = (shopId) => pendList(shopId).length;
// Called when the internet comes back / the shop opens: waits until everything is on the server.
export async function flushPending(shopId) {
  if (!pendList(shopId).length || !online()) return;
  await fb.waitForPendingWrites(db);
  pendSave(shopId, []);
}
export async function commitSale(shopId, settings, input) {
  const date = input.date || todayIso();
  const head = docHead(settings.prefix, 'BS', date);
  if (date === todayIso()) {
    let no = takeNumber(shopId, head);
    if (!no && online()) { await reserveNumbers(shopId, settings); no = takeNumber(shopId, head); }
    if (!no) throw new Error(`ไม่มีอินเทอร์เน็ต และเครื่องนี้ลงบิลตอนไม่มีเน็ตครบ ${OFFLINE_BILLS} บิลแล้ว · ต่ออินเทอร์เน็ตสักครู่ (ระบบจะส่งบิลที่ค้างและเตรียมเลขบิลใหม่ให้เอง) แล้วลองใหม่`);
    const scratch = { customers: data.customers, products: data.products.map((p) => ({ ...p })), bills: [], receipts: [] };
    const bill = createSale(scratch, settings, { ...input, date, by: me.name }, { no });
    bill.byUid = me.uid;
    const b = fb.writeBatch(db);
    b.set(sub(shopId, 'bills', no), bill);
    const qty = new Map();
    for (const l of bill.lines) qty.set(l.code, (qty.get(l.code) || 0) + l.qty);
    for (const [code, q] of qty) {
      const p = data.products.find((x) => x.code === code);
      if (p && !p.noStock) b.update(sub(shopId, 'products', code), { stock: fb.increment(-q) });
    }
    pendSave(shopId, [...pendList(shopId), no]);
    const sent = b.commit().then(() => { pendSave(shopId, pendList(shopId).filter((x) => x !== no)); return true; });
    sent.catch((e) => { // the server refused it (not just "no internet"): tell the person, it is not saved
      pendSave(shopId, pendList(shopId).filter((x) => x !== no));
      window.dispatchEvent(new CustomEvent('salefail', { detail: { no, msg: authMsg(e) } }));
    });
    const ok = await Promise.race([sent.catch(() => false), new Promise((r) => setTimeout(() => r(false), online() ? 6000 : 300))]);
    if (online()) reserveNumbers(shopId, settings).catch(() => {});
    return ok ? bill : { ...bill, pending: true };
  }
  needOnline('ลงบิลย้อนหลัง');
  const localMax = maxRunning(head, data.bills.map((b) => b.no));
  return wrap(() => fb.runTransaction(db, async (tx) => {
    const cref = sub(shopId, 'counters', head);
    const cs = await tx.get(cref);
    let n = Math.max(cs.exists() ? cs.data().n : 0, localMax) + 1;
    // A day may already have bills (e.g. imported from the old program, which left no counter): skip used numbers.
    for (let tries = 0; tries < 300 && (await tx.get(sub(shopId, 'bills', head + String(n).padStart(4, '0')))).exists(); tries++) n++;
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
function needOnline(what) { if (!online()) throw new Error(`${what}ต้องมีอินเทอร์เน็ต · ตอนนี้ไม่มีเน็ต ขายสินค้าได้ตามปกติ ส่วนรายการนี้รอเน็ตกลับมาก่อน`); }
export async function commitPayment(shopId, settings, input) {
  needOnline('รับชำระหนี้');
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
    tx.set(sub(shopId, 'customers', input.customerCode), { lastPaidAt: receipt.date }, { merge: true });
    return receipt;
  }));
}

export async function saveCustomer(shopId, c) { await save(fb.setDoc(sub(shopId, 'customers', c.code), c, { merge: true })); }
// Low-stock alert level for many products at once (0 = off).
export async function setCategory(shopId, codes, category) {
  for (let i = 0; i < codes.length; i += 400) {
    const b = fb.writeBatch(db);
    codes.slice(i, i + 400).forEach((code) => b.set(sub(shopId, 'products', code), { category: category || '', updatedBy: me.name }, { merge: true }));
    await save(b.commit());
  }
}
export async function setMinStock(shopId, codes, minStock) {
  for (let i = 0; i < codes.length; i += 400) {
    const b = fb.writeBatch(db);
    codes.slice(i, i + 400).forEach((code) => b.set(sub(shopId, 'products', code), { minStock: Number(minStock) || 0, minStockBy: me.name }, { merge: true }));
    await save(b.commit());
  }
}
// ---------- reports: everything dated within a range (any shop the person can open) ----------
export async function findRange(shopId, from, to) {
  const q = (c) => fb.getDocs(fb.query(sub(shopId, c), fb.where('date', '>=', from), fb.where('date', '<=', to)));
  const [b, r] = await wrap(() => withTimeout(Promise.all([q('bills'), q('receipts')]), 120000, 'อ่านข้อมูลรายงาน'));
  return { bills: b.docs.map((d) => d.data()), receipts: r.docs.map((d) => d.data()) };
}
export async function shopProducts(shopId) {
  if (shopId === currentShop && data) return data.products;
  const s = await wrap(() => fb.getDocs(sub(shopId, 'products')));
  return s.docs.map((d) => d.data());
}

// ---------- who did what (audit log) ----------
export function addLog(shopId, entry) {
  fb.setDoc(fb.doc(sub(shopId, 'logs')), { ...entry, by: me?.name || '', byUid: me?.uid || '', at: new Date().toISOString() }).catch((e) => console.warn('log failed', e));
}
export async function listLogs(shopId, max = 500) {
  const s = await wrap(() => fb.getDocs(fb.query(sub(shopId, 'logs'), fb.orderBy('at', 'desc'), fb.limit(max))));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
// Many prices at once (one batch per 400 products).
export async function setPrices(shopId, changes) {
  needOnline('ปรับราคา');
  await commitInBatches(changes.map(({ code, price }) => (b) => b.set(sub(shopId, 'products', code), { price, priceFromHistory: false, updatedBy: me.name }, { merge: true })));
}
export async function saveProduct(shopId, p) { await save(fb.setDoc(sub(shopId, 'products', p.code), p, { merge: true })); }

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
// Import = write every record, then remove old records that are not in the new data.
// Resumable: progress is remembered on this computer, so a stopped import continues where it left off
// (nothing is deleted or written twice), even on another day when the free daily quota ran out.
const jobKey = (shopId) => 'importJob:' + shopId;
const jobSig = (r) => [r.customers.length, r.products.length, r.bills.length, (r.receipts || []).length, r.bills[0]?.no, r.bills[r.bills.length - 1]?.no, r.summary?.openPrincipal].join('|');
const loadJob = (shopId) => { try { return JSON.parse(localStorage.getItem(jobKey(shopId)) || 'null'); } catch { return null; } };
const saveJob = (shopId, j) => { try { j ? localStorage.setItem(jobKey(shopId), JSON.stringify(j)) : localStorage.removeItem(jobKey(shopId)); } catch { /* ignore */ } };
export function importJob(shopId, result) {
  const j = loadJob(shopId); if (!j) return null;
  const total = j.writes + (j.leftovers?.length || 0);
  return { same: result ? j.sig === jobSig(result) : null, pct: total ? (j.written + (j.deleted || 0)) / total : 0, at: j.at };
}
export async function replaceShopData(shopId, result, onProgress) {
  const colls = ['customers', 'products', 'bills', 'receipts', 'counters'];
  const writes = [
    ...result.customers.map((x) => ['customers', x.code, x]),
    ...result.products.map((x) => ['products', x.code, x]),
    ...result.bills.map((x) => ['bills', x.no, x]),
    ...(result.receipts || []).filter((x) => x.no && !x.no.includes('/')).map((x) => ['receipts', x.no, x]),
  ];
  const sig = jobSig(result);
  let job = loadJob(shopId);
  if (!job || job.sig !== sig) {
    // Fresh start: note which old records will have to go once the new ones are in.
    const keep = new Set(writes.map(([c, id]) => c + '/' + id));
    const leftovers = [];
    for (const c of colls) {
      const snap = await wrap(() => withTimeout(fb.getDocs(sub(shopId, c)), 120000, 'อ่านข้อมูลเดิมของร้าน'));
      for (const d of snap.docs) if (!keep.has(c + '/' + d.id)) leftovers.push(c + '/' + d.id);
    }
    job = { sig, writes: writes.length, written: 0, leftovers, deleted: 0, at: new Date().toISOString() };
    saveJob(shopId, job);
  }
  const total = job.writes + job.leftovers.length || 1;
  const report = () => onProgress?.((job.written + job.deleted) / total);
  report();
  const BATCH = 400;
  while (job.written < writes.length) {
    const b = fb.writeBatch(db);
    const part = writes.slice(job.written, job.written + BATCH);
    part.forEach(([c, id, x]) => b.set(sub(shopId, c, id), x));
    await wrap(() => withTimeout(b.commit(), 90000, 'บันทึกข้อมูล'));
    job.written += part.length; saveJob(shopId, job); report();
  }
  while (job.deleted < job.leftovers.length) {
    const b = fb.writeBatch(db);
    const part = job.leftovers.slice(job.deleted, job.deleted + BATCH);
    part.forEach((path) => { const [c, id] = path.split('/'); b.delete(sub(shopId, c, id)); });
    await wrap(() => withTimeout(b.commit(), 90000, 'ลบข้อมูลเก่า'));
    job.deleted += part.length; saveJob(shopId, job); report();
  }
  const { warnings, ...summary } = result.summary;
  await wrap(() => withTimeout(fb.setDoc(shopDoc(shopId), { importedAt: new Date().toISOString(), importSummary: summary }, { merge: true }), 90000, 'บันทึกสรุปการนำเข้า'));
  saveJob(shopId, null);
}
export async function shopInfo(shopId) {
  const d = await wrap(() => fb.getDoc(shopDoc(shopId)));
  return { importedAt: d.data()?.importedAt, bills: d.data()?.importSummary?.bills };
}

// ---------- users (codes) ----------
// Who is using the program right now: each open copy stamps its own login every few minutes.
export function heartbeat(shopId, away = false) {
  if (!me?.uid) return Promise.resolve();
  const device = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) ? 'มือถือ' : 'คอมพิวเตอร์';
  return fb.updateDoc(fb.doc(db, 'users', me.uid), { lastSeen: fb.serverTimestamp(), seenShop: shopId || '', seenDevice: device, away }).catch(() => {});
}
export async function listUsers() {
  const s = await wrap(() => fb.getDocs(fb.collection(db, 'users')));
  const all = s.docs.map((d) => { const u = d.data(); return { uid: d.id, ...u, lastSeen: u.lastSeen?.toMillis?.() || null }; });
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
// Super-admin only: remove a login code. The profile goes (so the code can never sign in again);
// the sign-in account itself can only be removed in Firebase Console → Authentication.
export async function deleteUser(uid) {
  if (me?.role !== 'admin') throw new Error('ลบรหัสได้เฉพาะแอดมินใหญ่');
  if (uid === me.uid) throw new Error('ลบรหัสของตัวเองไม่ได้');
  const cfg = await wrap(() => fb.getDoc(fb.doc(db, 'config', 'main')));
  if (cfg.data()?.adminUid === uid) throw new Error('รหัสแอดมินใหญ่คนแรกลบไม่ได้');
  await wrap(() => fb.deleteDoc(fb.doc(db, 'users', uid)));
}
export async function setUserName(uid, name) { if (!name?.trim()) throw new Error('ใส่ชื่อ'); await wrap(() => fb.updateDoc(fb.doc(db, 'users', uid), { name: name.trim() })); if (me?.uid === uid) me.name = name.trim(); }
export async function setUserRole(uid, role, shops) { await wrap(() => fb.updateDoc(fb.doc(db, 'users', uid), { role, shops })); }
export async function setUserActive(uid, active) { await wrap(() => fb.updateDoc(fb.doc(db, 'users', uid), { active })); }
export async function changeMyPin(oldPin, newPin) {
  checkPin(newPin);
  const cred = fb.EmailAuthProvider.credential(auth.currentUser.email, String(oldPin));
  await wrap(() => fb.reauthenticateWithCredential(auth.currentUser, cred));
  await wrap(() => fb.updatePassword(auth.currentUser, String(newPin)));
}

// ---------- bill edits / cancels and requests ----------
// Re-reads the bill inside the transaction so an edit can't clash with a payment made on another device.
async function billChangeTx(tx, shopId, billNo, kind, changes, meta) {
  const ref = sub(shopId, 'bills', billNo);
  const snap = await tx.get(ref);
  if (!snap.exists()) throw new Error('ไม่พบบิล ' + billNo);
  const cur = snap.data();
  const res = kind === 'cancel' ? cancelBill(data.products, cur, meta) : kind === 'rate' ? { bill: changeBillRate(cur, changes.rate, meta), stock: new Map() } : editBill(data.products, cur, changes, meta);
  return () => {
    tx.set(ref, res.bill);
    for (const [code, d] of res.stock) tx.update(sub(shopId, 'products', code), { stock: fb.increment(d) });
    return res.bill;
  };
}
// Cancel a wrong receipt: bills go back exactly as they were before it.
async function receiptVoidTx(tx, shopId, receiptNo, meta) {
  const rref = sub(shopId, 'receipts', receiptNo);
  const rs = await tx.get(rref);
  if (!rs.exists()) throw new Error('ไม่พบใบเสร็จ ' + receiptNo);
  const receipt = rs.data();
  const snaps = await Promise.all((receipt.rows || []).map((r) => tx.get(sub(shopId, 'bills', r.no))));
  const res = voidReceipt(receipt, snaps.filter((x) => x.exists()).map((x) => x.data()), meta);
  return () => { tx.set(rref, res.receipt); for (const b of res.bills) tx.set(sub(shopId, 'bills', b.no), b); return res.receipt; };
}
export async function commitReceiptVoid(shopId, receiptNo, meta) {
  needOnline('ยกเลิกใบเสร็จ');
  const r = await wrap(() => fb.runTransaction(db, async (tx) => (await receiptVoidTx(tx, shopId, receiptNo, { ...meta, by: meta.by || me.name }))()));
  await refreshLastPaid(shopId, r.customerCode).catch(() => {});
  return r;
}
// The customer's last payment date after a receipt was cancelled.
async function refreshLastPaid(shopId, code) {
  const s = await wrap(() => fb.getDocs(fb.query(sub(shopId, 'receipts'), fb.where('customerCode', '==', code))));
  const last = s.docs.map((d) => d.data()).filter((x) => x.status !== 'void').reduce((m, x) => (x.date > m ? x.date : m), '');
  await wrap(() => fb.setDoc(sub(shopId, 'customers', code), { lastPaidAt: last || null }, { merge: true }));
}
// One-time fill of customers' last payment dates for shops imported before the program kept them.
export async function backfillLastPaid(shopId) {
  const sd = await wrap(() => fb.getDoc(shopDoc(shopId)));
  if (sd.data()?.lastPaidFilled) return false;
  const s = await wrap(() => withTimeout(fb.getDocs(sub(shopId, 'receipts')), 120000, 'อ่านใบเสร็จ'));
  const last = new Map();
  for (const d of s.docs) { const x = d.data(); if (x.status === 'void' || !x.customerCode || !x.date) continue; if (!(last.get(x.customerCode) >= x.date)) last.set(x.customerCode, x.date); }
  const ops = [];
  for (const c of data.customers) { const v = last.get(c.code); if (v && !(c.lastPaidAt >= v)) ops.push((b) => b.set(sub(shopId, 'customers', c.code), { lastPaidAt: v }, { merge: true })); }
  await commitInBatches(ops);
  await wrap(() => fb.setDoc(shopDoc(shopId), { lastPaidFilled: true }, { merge: true }));
  return true;
}
export async function commitBillChange(shopId, billNo, kind, changes, meta) {
  needOnline('แก้ไขบิล');
  return wrap(() => fb.runTransaction(db, async (tx) => (await billChangeTx(tx, shopId, billNo, kind, changes, { ...meta, by: meta.by || me.name }))()));
}
export async function createRequest(shopId, req) {
  const ref = fb.doc(sub(shopId, 'requests'));
  const r = { status: 'pending', createdAt: new Date().toISOString(), byUid: me.uid, ...req };
  await save(fb.setDoc(ref, r));
  return { id: ref.id, ...r };
}
export async function resolveRequest(shopId, id, approve, meta) {
  needOnline('อนุมัติคำขอ');
  return wrap(() => fb.runTransaction(db, async (tx) => {
    const ref = sub(shopId, 'requests', id);
    const s = await tx.get(ref);
    if (!s.exists() || s.data().status !== 'pending') throw new Error('คำขอนี้ถูกจัดการไปแล้ว');
    const r = s.data();
    const write = !approve ? null : r.kind === 'voidReceipt' ? await receiptVoidTx(tx, shopId, r.receiptNo, { by: r.byName, reason: r.reason }) : await billChangeTx(tx, shopId, r.billNo, r.kind, r.changes, { by: r.byName, reason: r.reason });
    write?.();
    tx.update(ref, { status: approve ? 'approved' : 'rejected', resolvedBy: meta.by || me.name, resolvedAt: new Date().toISOString() });
  }));
}

// ---------- backup / restore / delete a whole shop ----------
export const SHOP_COLLECTIONS = ['customers', 'products', 'bills', 'receipts', 'requests', 'counters', 'transfers', 'stockLogs', 'closes', 'logs'];
const BATCH_SIZE = 400;
async function commitInBatches(ops, onStep) {
  for (let i = 0; i < ops.length; i += BATCH_SIZE) {
    const b = fb.writeBatch(db);
    ops.slice(i, i + BATCH_SIZE).forEach((op) => op(b));
    await wrap(() => withTimeout(b.commit(), 90000, 'บันทึกข้อมูล'));
    onStep?.(Math.min(BATCH_SIZE, ops.length - i));
  }
}
// Every record of the shop (not only the recent ones kept live), as plain JSON.
export async function exportShop(shopId) {
  const s = await wrap(() => fb.getDoc(shopDoc(shopId)));
  if (!s.exists()) throw new Error('ไม่พบร้านนี้');
  const collections = {};
  for (const c of SHOP_COLLECTIONS) {
    const snap = await wrap(() => fb.getDocs(sub(shopId, c)));
    collections[c] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  }
  const { createdAt, ...settings } = s.data();
  return { format: 'dreamshop-kaset-backup', version: 1, exportedAt: new Date().toISOString(), exportedBy: me.name, shopId, settings, collections };
}
async function shopRefs(shopId) {
  const refs = [];
  for (const c of SHOP_COLLECTIONS) { const snap = await wrap(() => withTimeout(fb.getDocs(sub(shopId, c)), 120000, 'อ่านข้อมูลร้าน')); refs.push(...snap.docs.map((d) => d.ref)); }
  return refs;
}
export async function restoreShop(shopId, backup, onProgress) {
  const writes = [];
  for (const c of SHOP_COLLECTIONS) for (const { id, data: d } of backup.collections[c] || []) writes.push([sub(shopId, c, id), d]);
  // Overwrite what the backup has, then delete only what the backup doesn't have (each record read once).
  const keep = new Set(writes.map(([ref]) => ref.path));
  const old = (await shopRefs(shopId)).filter((r) => !keep.has(r.path));
  const total = old.length + writes.length || 1;
  let done = 0;
  const step = (n) => { done += n; onProgress?.(done / total); };
  await commitInBatches(writes.map(([ref, d]) => (b) => b.set(ref, d)), step);
  await commitInBatches(old.map((r) => (b) => b.delete(r)), step);
  const { lastBackupAt, ...settings } = backup.settings || {};
  await wrap(() => fb.setDoc(shopDoc(shopId), { ...settings, restoredAt: new Date().toISOString(), restoredFrom: backup.exportedAt }, { merge: true }));
}
// Super-admin only: remove every record, the shop itself, and the shop from people's access.
export async function deleteShop(shopId, onProgress) {
  const refs = await shopRefs(shopId);
  let done = 0;
  await commitInBatches(refs.map((r) => (b) => b.delete(r)), (n) => { done += n; onProgress?.(done / (refs.length || 1)); });
  const users = await wrap(() => fb.getDocs(fb.query(fb.collection(db, 'users'), fb.where('shops', 'array-contains', shopId))));
  for (const u of users.docs) {
    const left = (u.data().shops || []).filter((x) => x !== shopId);
    await wrap(() => fb.updateDoc(u.ref, left.length ? { shops: left } : { shops: left, active: false }));
  }
  await wrap(() => fb.deleteDoc(shopDoc(shopId)));
  saveJob(shopId, null);
}
export async function markBackup(shopId) {
  await wrap(() => fb.setDoc(shopDoc(shopId), { lastBackupAt: new Date().toISOString(), lastBackupBy: me.name }, { merge: true }));
}

// ---------- stock: transfers to other shops and counted adjustments ----------
export async function commitTransfer(shopId, settings, input) {
  needOnline('โอนสต๊อก');
  const date = input.date || todayIso();
  const head = docHead(settings.prefix, 'TR', date);
  const localMax = maxRunning(head, data.transfers.map((t) => t.no));
  return wrap(() => fb.runTransaction(db, async (tx) => {
    const cref = sub(shopId, 'counters', head);
    const cs = await tx.get(cref);
    const no = head + String(Math.max(cs.exists() ? cs.data().n : 0, localMax) + 1).padStart(4, '0');
    const { transfer, stock } = makeTransfer(data.products, { ...input, date, by: me.name }, no);
    tx.set(cref, { n: +no.slice(head.length) });
    tx.set(sub(shopId, 'transfers', no), transfer);
    for (const [code, d] of stock) tx.update(sub(shopId, 'products', code), { stock: fb.increment(d) });
    return transfer;
  }));
}
export async function changeTransfer(shopId, no, kind, changes, meta = {}) {
  needOnline('แก้ไขการโอน');
  return wrap(() => fb.runTransaction(db, async (tx) => {
    const ref = sub(shopId, 'transfers', no);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('ไม่พบรายการโอน ' + no);
    const m = { ...meta, by: meta.by || me.name };
    const res = kind === 'cancel' ? cancelTransfer(data.products, snap.data(), m) : editTransfer(data.products, snap.data(), changes, m);
    tx.set(ref, res.transfer);
    for (const [code, d] of res.stock) tx.update(sub(shopId, 'products', code), { stock: fb.increment(d) });
    return res.transfer;
  }));
}
export async function findTransfers(shopId) {
  const snap = await wrap(() => fb.getDocs(sub(shopId, 'transfers')));
  return snap.docs.map((d) => d.data());
}
// Set the counted stock and keep a log line of the change.
export async function adjustStock(shopId, code, counted, reason) {
  needOnline('ปรับสต๊อก');
  return wrap(() => fb.runTransaction(db, async (tx) => {
    const ref = sub(shopId, 'products', code);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error('ไม่พบสินค้า');
    const p = snap.data(); const to = Number(counted);
    tx.update(ref, { stock: to });
    tx.set(fb.doc(sub(shopId, 'stockLogs')), { code, name: p.name, from: p.stock || 0, to, reason: reason || '', by: me.name, at: new Date().toISOString() });
    return to;
  }));
}
export async function stockLogs(shopId, code) {
  const snap = await wrap(() => fb.getDocs(fb.query(sub(shopId, 'stockLogs'), fb.where('code', '==', code))));
  return snap.docs.map((d) => d.data()).sort((a, b) => (a.at < b.at ? 1 : -1));
}

// ---------- cost PIN ----------
// The super-admin issues a random 4-digit PIN for a staff request; only its hash is stored.
export async function issueCostPin(shopId, requestId) {
  const pin = newPin(), salt = newPin() + Date.now();
  const pinHash = await hashPin(pin, salt);
  await wrap(() => fb.updateDoc(sub(shopId, 'requests', requestId), { status: 'approved', pinHash, salt, issuedBy: me.name, issuedAt: new Date().toISOString(), resolvedBy: me.name, resolvedAt: new Date().toISOString() }));
  return pin;
}
export async function useCostPin(shopId, pin) {
  const snap = await wrap(() => fb.getDocs(fb.query(sub(shopId, 'requests'), fb.where('byUid', '==', me.uid))));
  const dayAgo = new Date(Date.now() - 86400000).toISOString();
  for (const d of snap.docs) {
    const r = d.data();
    if (r.kind !== 'costPin' || r.status !== 'approved' || !r.pinHash || (r.issuedAt || '') < dayAgo) continue;
    if (await hashPin(String(pin).trim(), r.salt) === r.pinHash) { await wrap(() => fb.updateDoc(d.ref, { status: 'used', usedAt: new Date().toISOString() })); return true; }
  }
  return false;
}

// ---------- overview of every shop (super-admin) ----------
// Everything needed for the printed summaries of one shop (customers, products, open bills).
export async function shopSummaryData(shopId) {
  const [c, p, b] = await wrap(() => withTimeout(Promise.all([fb.getDocs(sub(shopId, 'customers')), fb.getDocs(sub(shopId, 'products')), fb.getDocs(fb.query(sub(shopId, 'bills'), fb.where('status', '==', 'open')))]), 120000, 'อ่านข้อมูลสรุป'));
  return { customers: c.docs.map((d) => d.data()), products: p.docs.map((d) => d.data()), bills: b.docs.map((d) => d.data()), receipts: [] };
}
// Repair bills imported from the old program: replace their product lines (cancelled lines taken out).
// Only bills that came from the old program are touched. Returns how many were changed.
export async function fixBillLines(shopId, list, onProgress) {
  needOnline('แก้รายการในบิลเก่า');
  let changed = 0;
  for (let i = 0; i < list.length; i += 100) {
    const part = list.slice(i, i + 100);
    const snaps = await wrap(() => Promise.all(part.map((x) => fb.getDoc(sub(shopId, 'bills', x.no)))));
    const b = fb.writeBatch(db); let n = 0;
    snaps.forEach((s, k) => { if (s.exists() && s.data().source === 'programkaset' && JSON.stringify(s.data().lines) !== JSON.stringify(part[k].lines)) { b.update(s.ref, { lines: part[k].lines, linesFixedAt: new Date().toISOString() }); n++; } });
    if (n) await wrap(() => b.commit());
    changed += n; onProgress?.(Math.min(1, (i + part.length) / list.length));
  }
  return changed;
}
export async function shopOverview(shopId) {
  const today = todayIso();
  const [bt, rt, open, rq] = await Promise.all([
    fb.getDocs(fb.query(sub(shopId, 'bills'), fb.where('date', '==', today))),
    fb.getDocs(fb.query(sub(shopId, 'receipts'), fb.where('date', '==', today))),
    fb.getDocs(fb.query(sub(shopId, 'bills'), fb.where('status', '==', 'open'))),
    fb.getDocs(fb.query(sub(shopId, 'requests'), fb.where('status', '==', 'pending'))),
  ].map((q) => wrap(() => q)));
  const bills = new Map([...bt.docs, ...open.docs].map((d) => [d.id, d.data()]));
  return shopSnapshot({ customers: [], products: [], bills: [...bills.values()], receipts: rt.docs.map((d) => d.data()), requests: rq.docs.map((d) => d.data()) }, today);
}
