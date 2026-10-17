// Runs the (slow) full import off the main thread so the page stays responsive.
import { importDatabase } from './importer.bundle.js';
self.onmessage = (e) => {
  try { self.postMessage({ ok: true, result: importDatabase(e.data.bytes, e.data.opts) }); }
  catch (err) { self.postMessage({ ok: false, error: String(err?.message || err) }); }
};
