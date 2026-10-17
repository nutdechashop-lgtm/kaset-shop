// Browser entry: mdb-reader needs a Node-style Buffer, so wrap raw bytes before reading.
import { Buffer } from 'buffer';
import { inspect as _inspect, importDatabase as _import, MAIN_DB_NAME } from './importer.js';
const toBuf = (b) => (Buffer.isBuffer(b) ? b : Buffer.from(b.buffer ? new Uint8Array(b.buffer, b.byteOffset, b.byteLength) : b));
export const inspect = (bytes) => _inspect(toBuf(bytes));
export const importDatabase = (bytes, opts) => _import(toBuf(bytes), opts);
export { MAIN_DB_NAME };
export * from './interest.js';
