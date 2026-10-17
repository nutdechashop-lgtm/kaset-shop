// Local data store (IndexedDB). Will be swapped for the online database (Firebase) later;
// screens only talk to these functions.
const DB_NAME = 'shop-system';
const VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('shops')) db.createObjectStore('shops', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('log')) db.createObjectStore('log', { keyPath: 'at' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
  });
}

// Data on this computer. Which shop it is (name, address, bill prefix) lives in the 'settings' record.
export const LOCAL_ID = 'local';
export const SETTINGS_ID = 'settings';

export function getShop(id) { return tx('shops', 'readonly', (s) => s.get(id)); }
export function saveShop(record) { return tx('shops', 'readwrite', (s) => s.put(record)); }
export function addLog(entry) { return tx('log', 'readwrite', (s) => s.put({ at: new Date().toISOString(), ...entry })); }

export async function getData() {
  const d = await getShop(LOCAL_ID);
  return d || { id: LOCAL_ID, customers: [], products: [], bills: [], receipts: [] };
}
export function saveData(data) { return saveShop({ ...data, id: LOCAL_ID }); }

export async function getSettings(defaults) {
  const s = await getShop(SETTINGS_ID);
  return { ...defaults, ...(s || {}) };
}
export function saveSettings(s) { return saveShop({ ...s, id: SETTINGS_ID }); }
