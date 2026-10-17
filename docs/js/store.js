// Local data store (IndexedDB). One record per shop. Will be swapped for the online database later;
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

// Data on this computer. Which shop it is (name, address, code) is set later in shop settings.
export const LOCAL_ID = 'local';

export const SHOPS = [
  { id: 'fert', code: '01', label: 'ร้านปุ๋ย' },
  { id: 'chem', code: '02', label: 'ร้านยา' },
  { id: 'bangpho', code: '03', label: 'สาขาบางโพธิ์' },
  { id: 'pongkae', code: '04', label: 'สาขาโป่งแค' },
];

export function getShop(id) {
  return tx('shops', 'readonly', (s) => s.get(id));
}

export function saveShop(record) {
  return tx('shops', 'readwrite', (s) => s.put(record));
}

export function listShops() {
  return tx('shops', 'readonly', (s) => s.getAll());
}

export function addLog(entry) {
  return tx('log', 'readwrite', (s) => s.put({ at: new Date().toISOString(), ...entry }));
}
