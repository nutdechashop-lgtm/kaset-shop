// Main program: sign in, pick shop, sales, debtors & payments, bill search, customers, products,
// staff codes, import from the old program, shop settings.
// Data goes through a backend: Firebase (default) or this browser only (?local=1, for testing).
import { RATES, GRACE_MONTHS, todayIso, customerDebts, nextCustomerCode, nextProductCode, zones, daySummary, billLockReason, diffLines } from './shop.js';
import { round2, allocatePayment, billBalance, daysBetween, interestStart } from './interest.js';
import { getBackupDir, setBackupDir } from './store.js';

const backend = await import(new URLSearchParams(location.search).has('local') ? './backend-local.js' : './backend-cloud.js');

let user = null, shops = [], shopId = null, shop = null, data = null, settings = null;
const view = document.getElementById('view');
const dlg = document.getElementById('dlg');
const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n) => Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 });
const thDate = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${+d}/${+m}/${+y + 543}`; };
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, '');
const custBy = () => new Map(data.customers.map((c) => [c.code, c]));
const custLabel = (code, map = custBy()) => { const c = map.get(code); return c ? c.name : (code ? 'รหัส ' + code : 'ลูกค้าทั่วไป'); };
const APP_NAME = 'NUTDECHASHOP_KASET';
const ROLE = { admin: 'แอดมินใหญ่', owner: 'เจ้าของร้าน', staff: 'พนักงาน', secretary: 'พนักงาน' };
// The super-admin can preview the program as an owner / staff member sees it (to check before a shop goes live).
let viewAs = lsGetSafe('viewAs') || '';
if (viewAs === 'secretary') viewAs = 'staff';
function lsGetSafe(k) { try { return localStorage.getItem(k); } catch { return null; } }
const role = () => (user?.role === 'admin' && viewAs ? viewAs : user?.role);
const previewing = () => user?.role === 'admin' && !!viewAs;
const isManager = () => ['admin', 'owner'].includes(role());
// Shop settings belong to the shop owner; the super-admin only looks.
const canEditSettings = () => user?.role === 'owner' || backend.mode === 'local';
const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

// ---------------- header / routing ----------------
const NAV = [
  ['sale', 'ขาย'], ['debt', 'ลูกหนี้ / รับชำระ'], ['bills', 'ค้นหาบิล'], ['customers', 'ลูกค้า'], ['products', 'สินค้า / สต๊อก'],
  ['approve', 'รออนุมัติ', true], ['users', 'รหัสพนักงาน', true], ['import', 'นำเข้าข้อมูลเก่า', true], ['backup', 'สำรองข้อมูล', true], ['settings', 'ตั้งค่าร้าน', true],
];
function drawHeader() {
  const inShop = !!shop;
  const pending = inShop ? pendingRequests().length : 0;
  $('#nav').innerHTML = inShop ? NAV.filter(([, , mgr]) => !mgr || isManager()).map(([k, t]) => `<a href="#${k}">${t}${k === 'approve' && pending ? ` <span class="badge">${pending}</span>` : ''}</a>`).join('') : '';
  $('#shopName').textContent = inShop ? (settings.name || settings.label || APP_NAME) : APP_NAME;
  $('#who').innerHTML = user ? `<span>${esc(user.name)} · ${ROLE[user.role] || ''}</span>
    ${inShop && user.role === 'admin' ? `<label class="row" style="gap:6px">มุมมอง <select id="viewAs" class="hdr-select" aria-label="ดูโปรแกรมในมุมมองของ">${[['', 'แอดมินใหญ่'], ['owner', 'เจ้าของร้าน'], ['staff', 'พนักงาน']].map(([v, t]) => `<option value="${v}" ${v === viewAs ? 'selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
    ${inShop && (user.role === 'admin' || shops.length > 1) ? '<button class="btn small hdr" id="switchShop">เปลี่ยนร้าน</button>' : ''}
    ${backend.mode === 'cloud' ? '<button class="btn small hdr" id="logout">ออกจากระบบ</button>' : '<span class="pill">โหมดทดสอบในเครื่อง</span>'}` : '';
  $('#switchShop')?.addEventListener('click', () => { leaveShop(); viewShopPicker(); });
  $('#viewAs')?.addEventListener('change', (e) => { viewAs = e.target.value; lsSet('viewAs', viewAs); render(); });
  $('#previewBar')?.remove();
  if (inShop && previewing()) {
    const bar = document.createElement('div'); bar.id = 'previewBar'; bar.className = 'preview-bar';
    bar.innerHTML = `<div class="wrap app-wrap" style="padding-block:8px;flex-direction:row;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>กำลังดูหน้าจอแบบที่ <b>${ROLE[viewAs]}</b> เห็น · ถ้าบันทึกรายการ จะบันทึกจริงในชื่อของคุณ</span><button class="btn small" id="exitPreview">กลับมุมมองแอดมิน</button></div>`;
    $('header.topbar').after(bar);
    $('#exitPreview').onclick = () => { viewAs = ''; lsSet('viewAs', ''); render(); };
  }
  $('#logout')?.addEventListener('click', async () => { if (!confirm('ออกจากระบบ?')) return; leaveShop(); await backend.signOut(); user = null; start(); });
}
const routes = { backup: viewBackup, bill: viewBillEdit, approve: viewApprove, sale: viewSale, debt: viewDebt, bills: viewBills, customers: viewCustomers, products: viewProducts, users: viewUsers, import: viewImport, settings: viewSettings };
let current = 'sale';
function render() {
  if (!shop) return;
  let [name, arg] = (location.hash.slice(1) || 'sale').split('/');
  if (!routes[name] || (NAV.find((n) => n[0] === name)?.[2] && !isManager())) name = 'sale';
  current = name;
  drawHeader(); markNav();
  $('#today').textContent = 'วันที่ ' + thDate(todayIso());
  routes[name](arg ? decodeURIComponent(arg) : undefined);
}
function markNav() { $$('#nav a').forEach((a) => { if (a.getAttribute('href') === '#' + current) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }
window.addEventListener('hashchange', render);
const pendingRequests = () => (data?.requests || []).filter((r) => r.status === 'pending');

// Data changed on another device: refresh list screens (never while someone is typing or a dialog is open).
function onRemoteChange(kind) {
  if (kind === 'settings') { settings = shop.settings; drawHeader(); return; }
  if (current !== 'approve') drawHeader(), markNav();
  if (dlg.open || ['sale', 'import', 'settings', 'users'].includes(current)) return;
  const a = document.activeElement;
  if (a && view.contains(a) && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.value) return;
  render();
}

// ---------------- sign in & shop picker ----------------
async function start() {
  view.innerHTML = '<div class="card"><div class="row"><span class="spinner"></span> กำลังโหลด…</div></div>';
  user = await backend.init();
  drawHeader();
  if (!user) return viewLogin();
  viewShopPicker();
}

async function viewLogin() {
  drawHeader();
  const firstRun = await backend.bootstrapNeeded();
  view.innerHTML = `<section class="card" style="max-width:420px;margin:24px auto;width:100%">
    <div class="app-title">${APP_NAME}</div>
    ${firstRun ? `<h2>ตั้งค่าครั้งแรก: สร้างรหัสแอดมินใหญ่</h2>
      <div class="muted" style="font-size:14px">ทำครั้งเดียว รหัสนี้เห็นทุกร้าน และใช้สร้างรหัสให้เจ้าของร้านและพนักงาน</div>` : '<h2>เข้าสู่ระบบ</h2>'}
    <form id="lf" style="display:flex;flex-direction:column;gap:12px">
      <label class="field">รหัส<input type="text" name="code" autocomplete="username" required value="${esc(firstRun ? '' : lsGet('lastCode') || '')}" style="font-family:var(--mono);font-size:20px"></label>
      ${firstRun ? '<label class="field">ชื่อ<input type="text" name="name" required></label>' : ''}
      <label class="field">PIN 6 หลัก<input type="password" name="pin" inputmode="numeric" maxlength="6" autocomplete="current-password" required style="font-family:var(--mono);font-size:20px;letter-spacing:6px"></label>
      ${firstRun ? '<label class="field">PIN อีกครั้ง<input type="password" name="pin2" inputmode="numeric" maxlength="6" required style="font-family:var(--mono);font-size:20px;letter-spacing:6px"></label>' : ''}
      <div class="err hidden" id="lerr"></div>
      <button class="btn primary" style="justify-content:center">${firstRun ? 'สร้างรหัสแอดมิน' : 'เข้าสู่ระบบ'}</button>
    </form></section>`;
  const f = $('#lf');
  (f.code.value ? f.pin : f.code).focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button', f), err = $('#lerr'); err.classList.add('hidden'); btn.disabled = true;
    try {
      if (firstRun) {
        if (f.pin.value !== f.pin2.value) throw new Error('PIN สองช่องไม่ตรงกัน');
        user = await backend.setupAdmin({ code: f.code.value, name: f.name.value, pin: f.pin.value });
      } else user = await backend.signIn(f.code.value, f.pin.value);
      lsSet('lastCode', f.code.value.trim());
      viewShopPicker();
    } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); btn.disabled = false; }
  });
}

async function viewShopPicker() {
  drawHeader();
  view.innerHTML = '<div class="card"><div class="row"><span class="spinner"></span> กำลังโหลดร้าน…</div></div>';
  try { shops = await backend.listShops(); } catch (e) { view.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const last = lsGet('lastShop');
  if (shops.length === 1 && user.role !== 'admin') return enterShop(shops[0].id);
  if (!shops.length && user.role !== 'admin') { view.innerHTML = '<div class="note">รหัสนี้ยังไม่ได้ผูกกับร้านไหน ติดต่อแอดมิน</div>'; return; }
  view.innerHTML = `<section class="card" style="max-width:640px;margin:0 auto;width:100%">
    <h2>เลือกร้าน</h2>
    ${shops.length ? `<div style="display:flex;flex-direction:column;gap:8px">${shops.map((s) => `<button class="btn" data-shop="${esc(s.id)}" style="justify-content:space-between;min-height:60px">
      <span><b>${esc(s.label || s.name || s.id)}</b> <span class="muted">${esc(s.name && s.label ? s.name : '')}</span></span><span class="mono muted">${esc(s.prefix || '')}${s.id === last ? ' · ล่าสุด' : ''}</span></button>`).join('')}</div>`
      : '<div class="muted">ยังไม่มีร้าน เพิ่มร้านแรกด้านล่าง</div>'}
    ${user.role === 'admin' ? `<form id="nf" class="row" style="margin-top:8px"><input type="text" name="label" placeholder="ชื่อเรียกร้าน เช่น ร้านปุ๋ย" required style="flex:1;min-width:200px"><button class="btn primary">+ เพิ่มร้าน</button></form>
      <div class="muted" style="font-size:13px">เพิ่มร้านแล้วสร้างรหัสเจ้าของร้าน · เจ้าของร้านเป็นคนตั้งชื่อร้าน ที่อยู่ และหัวบิลเอง</div>` : ''}
    <div class="err hidden" id="perr"></div>
  </section>`;
  $$('[data-shop]').forEach((b) => b.addEventListener('click', () => enterShop(b.dataset.shop)));
  $('#nf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { const id = await backend.createShop({ label: e.target.label.value }); shops = await backend.listShops(); location.hash = 'users'; enterShop(id); toast('เพิ่มร้านแล้ว ต่อไปสร้างรหัสเจ้าของร้าน'); }
    catch (ex) { $('#perr').textContent = ex.message; $('#perr').classList.remove('hidden'); }
  });
}

async function enterShop(id) {
  view.innerHTML = '<div class="card"><div class="row"><span class="spinner"></span> กำลังโหลดข้อมูลร้าน…</div></div>';
  try {
    shop = await backend.openShop(id, onRemoteChange);
  } catch (e) { view.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  shopId = id; data = shop.data; settings = shop.settings;
  lsSet('lastShop', id);
  resetCart();
  if (!settings.name && canEditSettings() && !location.hash) location.hash = 'settings';
  render();
}
function leaveShop() { backend.closeShop(); shop = null; data = null; shopId = null; drawHeader(); }

// ---------------- printing ----------------
function shopHead() {
  return `<div><div class="shop">${esc(settings.name || '[ชื่อร้าน]')}</div><div>${esc(settings.address)}</div><div>${settings.phone ? 'โทร ' + esc(settings.phone) : ''}${settings.taxId ? ' · เลขผู้เสียภาษี ' + esc(settings.taxId) : ''}</div></div>`;
}
function doPrint(html, a4) {
  const area = $('#printArea');
  area.className = a4 ? 'a4' : '';
  area.innerHTML = html;
  setTimeout(() => window.print(), 50);
}
function printBill(bill) {
  const c = custBy().get(bill.customerCode);
  const title = bill.type === 'credit' ? 'บิลเงินเชื่อ' : 'บิลเงินสด';
  const html = `<div class="doc">
    <div class="head">${shopHead()}<div class="title">${title}${bill.edits ? `<div style="font-size:10pt;font-weight:500">แก้ไขครั้งที่ ${bill.edits}</div>` : ''}<div style="font-size:11pt;font-weight:500">เลขที่ ${esc(bill.no)}<br>วันที่ ${thDate(bill.date)}</div></div></div>
    <div style="margin-top:6px">ลูกค้า: <b>${esc(c ? c.name : 'ลูกค้าทั่วไป')}</b> ${c?.zone ? '(' + esc(c.zone) + ')' : ''} ${c?.code ? ' รหัส ' + esc(c.code) : ''}</div>
    <table><tr><th style="width:8mm">#</th><th>รายการ</th><th class="num">จำนวน</th><th>หน่วย</th><th class="num">ราคา</th><th class="num">จำนวนเงิน</th></tr>
    ${bill.lines.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}</td><td class="num">${qtyFmt(l.qty)}</td><td>${esc(l.unit)}</td><td class="num">${money(l.price)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}
    </table>
    <div class="sum"><div class="remark">หมายเหตุ :</div>
      <div class="totals"><div><span>รวม</span><span>${money(bill.subtotal)}</span></div>${bill.discount ? `<div><span>ส่วนลด</span><span>${money(bill.discount)}</span></div>` : ''}<div class="net"><span>รวมสุทธิ</span><span>${money(bill.total)}</span></div></div></div>
    <div class="sign"><div>ผู้รับสินค้า</div><div>ผู้ขาย ${esc(bill.by || '')}</div></div></div>`;
  doPrint(html, bill.lines.length > 12);
}
function printReceipt(r) {
  const c = custBy().get(r.customerCode);
  const html = `<div class="doc">
    <div class="head">${shopHead()}<div class="title">ใบเสร็จรับเงิน<div style="font-size:11pt;font-weight:500">เลขที่ ${esc(r.no)}<br>วันที่ ${thDate(r.date)}</div></div></div>
    <div style="margin-top:6px">ได้รับเงินจาก: <b>${esc(c ? c.name : r.customerCode)}</b> ${c?.zone ? '(' + esc(c.zone) + ')' : ''} รหัส ${esc(r.customerCode)}</div>
    <table><tr><th>#</th><th>เลขที่บิล</th><th>วันที่บิล</th><th class="num">เงินต้น</th><th class="num">ดอกเบี้ย</th><th class="num">รวม</th></tr>
    ${r.rows.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.no)}</td><td>${thDate(x.date)}</td><td class="num">${money(x.principal)}</td><td class="num">${money(x.interest)}</td><td class="num">${money(x.total)}</td></tr>`).join('')}
    </table>
    <div class="sum"><div class="remark">หมายเหตุ :</div>
      <div class="totals"><div><span>เงินต้น</span><span>${money(r.totalPrincipal)}</span></div><div><span>ดอกเบี้ย</span><span>${money(r.totalInterest)}</span></div><div class="net"><span>รวมรับชำระ</span><span>${money(r.total)}</span></div></div></div>
    <div class="sign"><div>ผู้ชำระเงิน</div><div>ผู้รับเงิน ${esc(r.by || '')}</div></div></div>`;
  doPrint(html, r.rows.length > 12);
}

function openDialog(html, onSubmit) {
  dlg.innerHTML = `<form method="dialog">${html}</form>`;
  const form = $('form', dlg);
  form.addEventListener('submit', async (e) => {
    const btn = e.submitter;
    if (!btn || btn.value === 'cancel') return;
    e.preventDefault();
    btn.disabled = true;
    try { if (await onSubmit?.(form, btn.value) !== false) dlg.close(); }
    catch (err) { const m = $('.dlg-err', dlg); if (m) { m.textContent = err.message; m.classList.remove('hidden'); } else alert(err.message); }
    finally { btn.disabled = false; }
  });
  dlg.showModal();
  return form;
}

// ---------------- sale ----------------
const cart = { lines: [], type: 'cash', customerCode: '', rate: 2, grace: false, graceMonths: 4, discount: 0 };
function resetCart() { Object.assign(cart, { lines: [], type: 'cash', customerCode: '', rate: settings?.defaultRate ?? 2, grace: false, graceMonths: settings?.defaultGraceMonths ?? 4, discount: 0 }); }

const liveProducts = () => data.products.filter((p) => !p.deleted);
function searchProducts(q) {
  const n = norm(q); if (!n) return [];
  return liveProducts().filter((p) => norm(p.name).includes(n) || p.code.startsWith(q.trim())).slice(0, 30);
}
function searchCustomers(q) {
  const n = norm(q); if (!n) return [];
  return data.customers.filter((c) => norm(c.name).includes(n) || norm(c.zone).includes(n) || c.code.startsWith(q.trim())).slice(0, 20);
}

function viewSale() {
  const today = daySummary(data, todayIso());
  view.innerHTML = `
  ${!liveProducts().length ? `<div class="note">ยังไม่มีสินค้าในร้านนี้ · ${isManager() ? '<a href="#import">นำเข้าข้อมูลจากโปรแกรมเก่า</a> หรือ' : ''} เพิ่มสินค้าที่เมนู <a href="#products">สินค้า</a></div>` : ''}
  <div class="grid-sale">
    <section class="card">
      <label class="field">ค้นหาสินค้า (พิมพ์ชื่อ แล้วกด Enter เพื่อเพิ่ม)
        <input type="search" id="pq" placeholder="เช่น ปุ๋ย, ยาฆ่าหญ้า" autocomplete="off">
      </label>
      <div class="results hidden" id="pres"></div>
      <div class="scroll"><table id="lines"></table></div>
    </section>
    <aside class="card" style="gap:14px">
      <div class="seg" role="group" aria-label="ประเภทการขาย">
        <button type="button" data-type="cash" aria-pressed="${cart.type === 'cash'}">เงินสด</button>
        <button type="button" data-type="credit" aria-pressed="${cart.type === 'credit'}">เงินเชื่อ</button>
      </div>
      <div>
        <label class="field">ลูกค้า ${cart.type === 'credit' ? '<span style="color:var(--red)">*</span>' : '<span class="muted" style="font-weight:400">(ไม่ใส่ก็ได้)</span>'}
          <input type="search" id="cq" placeholder="ชื่อ, หมู่บ้าน หรือรหัส" autocomplete="off">
        </label>
        <div class="results hidden" id="cres" style="margin-top:6px"></div>
        <div id="cust" style="margin-top:8px"></div>
      </div>
      <div id="creditOpts" class="${cart.type === 'credit' ? '' : 'hidden'}" style="display:flex;flex-direction:column;gap:10px">
        <label class="field">ดอกเบี้ย (% ต่อ 30 วัน คิดรายวัน)
          <select id="rate">${RATES.map((r) => `<option value="${r}" ${r === cart.rate ? 'selected' : ''}>${r}%</option>`).join('')}</select>
        </label>
        <div class="muted" id="interestHint" style="font-size:14px"></div>
      </div>
      <label class="field">ส่วนลด (บาท)<input type="number" id="disc" min="0" step="0.01" value="${cart.discount || ''}" placeholder="0"></label>
      <div>
        <div class="total-box"><span>รวม</span><span class="mono" id="sub"></span></div>
        <div class="total-box big"><span>สุทธิ</span><span class="mono" id="net"></span></div>
      </div>
      ${cart.type === 'credit' ? `<div class="grace-box">
        <label class="row" style="font-weight:600;min-height:44px;gap:8px"><input type="checkbox" id="grace" ${cart.grace ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--green)"> ปลอดดอก</label>
        <select id="graceMonths" aria-label="ปลอดดอกกี่เดือน" ${cart.grace ? '' : 'disabled'}>${GRACE_MONTHS.map((m) => `<option value="${m}" ${m === cart.graceMonths ? 'selected' : ''}>${m} เดือน</option>`).join('')}</select>
      </div>` : ''}
      <div class="err hidden" id="saleErr"></div>
      <button class="btn primary" id="save" style="justify-content:center">บันทึกการขาย</button>
      <button class="btn" id="clear" style="justify-content:center">ล้างรายการ</button>
    </aside>
  </div>
  <section class="card">
    <h2>วันนี้</h2>
    <div class="stats">
      <div class="stat"><div class="k">บิลขาย</div><div class="v">${today.bills}</div></div>
      <div class="stat"><div class="k">ขายเงินสด</div><div class="v">${money(today.cash)}</div></div>
      <div class="stat"><div class="k">ขายเงินเชื่อ</div><div class="v">${money(today.credit)}</div></div>
      <div class="stat"><div class="k">รับชำระหนี้</div><div class="v">${money(today.paid)}</div></div>
      <div class="stat"><div class="k">เงินเข้ารวม</div><div class="v">${money(today.moneyIn)}</div></div>
    </div>
  </section>`;

  const pq = $('#pq'), pres = $('#pres');
  let active = 0, found = [];
  const showResults = () => {
    found = searchProducts(pq.value); active = 0;
    pres.classList.toggle('hidden', !found.length && !pq.value);
    pres.innerHTML = found.length ? found.map((p, i) => `<button type="button" data-code="${esc(p.code)}" class="${i === 0 ? 'active' : ''}"><span>${esc(p.name)} <span class="muted">· ${esc(p.unit)}</span></span><span class="mono">${money(p.price)}${p.noStock ? '' : ` <span class="muted">คงเหลือ ${qtyFmt(p.stock)}</span>`}</span></button>`).join('')
      : (pq.value ? '<div class="empty">ไม่พบสินค้า</div>' : '');
  };
  const add = (code) => {
    const p = data.products.find((x) => x.code === code); if (!p) return;
    const ex = cart.lines.find((l) => l.code === code);
    if (ex) ex.qty = round2(ex.qty + 1); else cart.lines.push({ code, qty: 1, price: p.price });
    pq.value = ''; showResults(); drawLines(); pq.focus();
  };
  pq.addEventListener('input', showResults);
  pq.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!found.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      $$('button', pres).forEach((b, i) => b.classList.toggle('active', i === active));
    } else if (e.key === 'Enter') { e.preventDefault(); if (found[active]) add(found[active].code); }
  });
  pres.addEventListener('click', (e) => { const b = e.target.closest('[data-code]'); if (b) add(b.dataset.code); });

  function drawLines() {
    const pm = new Map(data.products.map((p) => [p.code, p]));
    $('#lines').innerHTML = cart.lines.length
      ? `<tr><th>สินค้า</th><th class="num">จำนวน</th><th class="num">ราคา/หน่วย</th><th class="num">รวม</th><th></th></tr>` + cart.lines.map((l, i) => {
        const p = pm.get(l.code);
        return `<tr><td>${esc(p?.name)} <span class="muted">· ${esc(p?.unit)}</span></td>
          <td class="num"><input class="qty" type="number" min="0" step="any" data-i="${i}" data-f="qty" value="${l.qty}" aria-label="จำนวน"></td>
          <td class="num"><input class="price${l.price > 0 ? '' : ' zero'}" type="number" min="0" step="0.01" data-i="${i}" data-f="price" value="${l.price}" aria-label="ราคา"></td>
          <td class="num">${money(l.qty * l.price)}</td>
          <td><button class="btn small" data-del="${i}" aria-label="ลบรายการ">ลบ</button></td></tr>`;
      }).join('')
      : '<tr><td class="empty">ยังไม่มีรายการ ค้นหาสินค้าด้านบนเพื่อเพิ่ม</td></tr>';
    drawTotals();
  }
  function drawTotals() {
    const sub = round2(cart.lines.reduce((s, l) => s + l.qty * l.price, 0));
    const net = round2(sub - (Number(cart.discount) || 0));
    $('#sub').textContent = money(sub); $('#net').textContent = money(net);
    if (cart.type === 'credit') {
      const perDay = round2(net * cart.rate / 100 / 30);
      $('#interestHint').textContent = cart.rate ? `ดอกเบี้ยวันละ ฿${money(perDay)} (30 วัน = ฿${money(net * cart.rate / 100)})${cart.grace ? ` · ปลอดดอก ${cart.graceMonths} เดือน เริ่มคิดหลัง ${cart.graceMonths * 30} วัน` : ''}` : 'ไม่คิดดอกเบี้ย';
    }
  }
  $('#lines').addEventListener('input', (e) => {
    const t = e.target; if (!t.dataset.f) return;
    cart.lines[+t.dataset.i][t.dataset.f] = Number(t.value) || 0;
    const row = t.closest('tr'); const l = cart.lines[+t.dataset.i];
    row.children[3].textContent = money(l.qty * l.price);
    if (t.dataset.f === 'price') t.classList.toggle('zero', !(l.price > 0));
    drawTotals();
  });
  $('#lines').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { cart.lines.splice(+b.dataset.del, 1); drawLines(); } });

  const cq = $('#cq'), cres = $('#cres');
  const debts = customerDebts(data, todayIso());
  function drawCust() {
    const c = data.customers.find((x) => x.code === cart.customerCode);
    const d = c && debts.get(c.code);
    $('#cust').innerHTML = c ? `<div class="stat" style="display:flex;justify-content:space-between;gap:8px;align-items:center"><div><b>${esc(c.name)}</b> <span class="muted">${esc(c.zone)} · ${esc(c.code)}</span>${d ? `<div class="k" style="color:var(--orange-ink)">ค้างอยู่ ${d.bills.length} บิล ฿${money(d.total)}</div>` : ''}</div><button class="btn small" id="uncust">เปลี่ยน</button></div>` : '';
    cq.parentElement.classList.toggle('hidden', !!c);
    if (c) $('#uncust').onclick = () => { cart.customerCode = ''; drawCust(); cq.focus(); };
  }
  cq.addEventListener('input', () => {
    const r = searchCustomers(cq.value);
    cres.classList.toggle('hidden', !cq.value);
    cres.innerHTML = r.length ? r.map((c) => `<button type="button" data-c="${esc(c.code)}"><span>${esc(c.name)}</span><span class="muted">${esc(c.zone)} · ${esc(c.code)}</span></button>`).join('') : '<div class="empty">ไม่พบลูกค้า · <a href="#customers">เพิ่มลูกค้าใหม่</a></div>';
  });
  cres.addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) { cart.customerCode = b.dataset.c; cq.value = ''; cres.classList.add('hidden'); drawCust(); } });
  drawCust();

  $$('[data-type]').forEach((b) => b.addEventListener('click', () => { cart.type = b.dataset.type; viewSale(); }));
  $('#rate')?.addEventListener('change', (e) => { cart.rate = Number(e.target.value); drawTotals(); });
  $('#grace')?.addEventListener('change', (e) => { cart.grace = e.target.checked; $('#graceMonths').disabled = !cart.grace; drawTotals(); });
  $('#graceMonths')?.addEventListener('change', (e) => { cart.graceMonths = Number(e.target.value); drawTotals(); });
  $('#disc').addEventListener('input', (e) => { cart.discount = Number(e.target.value) || 0; drawTotals(); });
  $('#clear').addEventListener('click', () => { resetCart(); viewSale(); });
  $('#save').addEventListener('click', async () => {
    const err = $('#saleErr'); err.classList.add('hidden');
    const btn = $('#save'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก…';
    let bill;
    try {
      bill = await backend.commitSale(shopId, settings, { type: cart.type, customerCode: cart.customerCode, lines: cart.lines, discount: cart.discount, rate: cart.rate, graceMonths: cart.type === 'credit' && cart.grace ? cart.graceMonths : 0, by: user.name });
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'บันทึกการขาย'; return; }
    resetCart(); viewSale();
    openDialog(`<h2>บันทึกการขายแล้ว</h2>
      <div>เลขที่ <b class="mono">${esc(bill.no)}</b> · ${bill.type === 'credit' ? 'เงินเชื่อ' : 'เงินสด'} · <b>฿${money(bill.total)}</b></div>
      <div class="muted">${esc(custLabel(bill.customerCode))}</div>
      <div class="row"><button class="btn primary" value="print">พิมพ์บิล</button><button class="btn" value="cancel">ขายต่อ</button></div>`, () => { printBill(bill); });
  });
  drawLines();
  pq.focus();
}

// ---------------- debtors ----------------
function viewDebt(code) {
  if (code) return viewDebtor(code);
  const asOf = todayIso();
  const debts = customerDebts(data, asOf);
  const cm = custBy();
  const rows = [...debts.entries()].map(([c, d]) => ({ code: c, cust: cm.get(c), ...d })).sort((a, b) => b.total - a.total);
  const tot = rows.reduce((s, r) => ({ p: s.p + r.principal, i: s.i + r.interest, t: s.t + r.total, n: s.n + r.bills.length }), { p: 0, i: 0, t: 0, n: 0 });
  view.innerHTML = `
  <section class="card">
    <h2>ลูกหนี้ทั้งหมด ณ วันที่ ${thDate(asOf)}</h2>
    <div class="stats">
      <div class="stat"><div class="k">ลูกค้าที่ค้าง</div><div class="v">${rows.length}</div></div>
      <div class="stat"><div class="k">บิลค้าง</div><div class="v">${tot.n}</div></div>
      <div class="stat"><div class="k">เงินต้นค้าง</div><div class="v">${money(tot.p)}</div></div>
      <div class="stat"><div class="k">ดอกเบี้ยถึงวันนี้</div><div class="v">${money(tot.i)}</div></div>
      <div class="stat"><div class="k">รวมทั้งหมด</div><div class="v">${money(tot.t)}</div></div>
    </div>
    <input type="search" id="dq" placeholder="ค้นหาชื่อ หมู่บ้าน หรือรหัสลูกค้า" autocomplete="off">
    <div class="scroll"><table id="dt"></table></div>
  </section>`;
  const draw = () => {
    const n = norm($('#dq').value);
    const list = rows.filter((r) => !n || norm(r.cust?.name).includes(n) || norm(r.cust?.zone).includes(n) || r.code.startsWith($('#dq').value.trim()));
    $('#dt').innerHTML = `<tr><th>รหัส</th><th>ลูกค้า</th><th>หมู่บ้าน</th><th class="num">บิล</th><th>บิลเก่าสุด</th><th class="num">เงินต้น</th><th class="num">ดอกเบี้ย</th><th class="num">รวม</th></tr>`
      + (list.length ? list.map((r) => `<tr class="clickable" data-c="${esc(r.code)}" tabindex="0"><td class="mono">${esc(r.code)}</td><td>${esc(r.cust?.name || '?')}</td><td>${esc(r.cust?.zone)}</td><td class="num">${r.bills.length}</td><td>${thDate(r.bills[0].date)}</td><td class="num">${money(r.principal)}</td><td class="num">${money(r.interest)}</td><td class="num"><b>${money(r.total)}</b></td></tr>`).join('')
        : `<tr><td colspan="8" class="empty">${rows.length ? 'ไม่พบ' : 'ยังไม่มีลูกหนี้'}</td></tr>`);
  };
  $('#dq').addEventListener('input', draw);
  const go = (e) => { const tr = e.target.closest('[data-c]'); if (tr) location.hash = 'debt/' + encodeURIComponent(tr.dataset.c); };
  $('#dt').addEventListener('click', go);
  $('#dt').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(e); });
  draw(); $('#dq').focus();
}

function viewDebtor(code) {
  const asOf = todayIso();
  const c = data.customers.find((x) => x.code === code);
  const d = customerDebts(data, asOf).get(code);
  let mode = 'amount';
  const selected = new Set();
  view.innerHTML = `
  <div><a href="#debt" class="btn small">← ลูกหนี้ทั้งหมด</a></div>
  <section class="card">
    <div class="row" style="justify-content:space-between">
      <div><h2>${esc(c?.name || 'รหัส ' + code)}</h2><div class="muted">${esc(c?.zone)} · รหัส ${esc(code)} ${c?.phone ? '· โทร ' + esc(c.phone) : ''}</div></div>
      ${d ? `<div style="text-align:right"><div class="muted" style="font-size:14px">รวมค้างถึงวันนี้</div><div class="mono" style="font-size:26px;font-weight:700">฿${money(d.total)}</div><div class="muted" style="font-size:14px">ต้น ${money(d.principal)} + ดอก ${money(d.interest)}</div></div>` : ''}
    </div>
    ${d ? `<div class="scroll"><table id="bt"></table></div>` : '<div class="ok">ไม่มียอดค้าง</div>'}
  </section>
  ${d ? `<section class="card">
    <h2>รับชำระ</h2>
    <div class="seg" role="group" aria-label="วิธีชำระ"><button type="button" data-m="amount" aria-pressed="true">ตามจำนวนเงิน</button><button type="button" data-m="bills" aria-pressed="false">ตามบิลที่เลือก</button></div>
    <label class="field" id="amtWrap">จำนวนเงินที่รับ (บาท)<input type="number" id="amt" min="0" step="0.01" placeholder="0.00" style="font-size:20px;font-family:var(--mono)"></label>
    <div class="muted" id="billHint" style="font-size:14px">ตัดดอกเบี้ยก่อน แล้วตัดเงินต้นจากบิลเก่าสุด</div>
    <div class="scroll"><table id="alloc"></table></div>
    <div class="err hidden" id="payErr"></div>
    <div class="row"><button class="btn primary" id="pay">บันทึกรับชำระ</button></div>
  </section>` : ''}
  <section class="card">
    <h2>ประวัติรับชำระ</h2>
    <div id="hist"><div class="row muted"><span class="spinner"></span> กำลังโหลด…</div></div>
  </section>`;

  backend.findReceipts(shopId, code).then((list) => {
    const seen = new Map([...data.receipts.filter((r) => r.customerCode === code), ...list].map((r) => [r.no, r]));
    const history = [...seen.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.no < b.no ? 1 : -1)).slice(0, 20);
    if (!$('#hist')) return;
    $('#hist').innerHTML = history.length ? `<div class="scroll"><table><tr><th>เลขที่</th><th>วันที่</th><th class="num">บิล</th><th class="num">เงินต้น</th><th class="num">ดอกเบี้ย</th><th class="num">รวม</th><th></th></tr>
      ${history.map((r) => `<tr><td class="mono">${esc(r.no)}</td><td>${thDate(r.date)}</td><td class="num">${r.rows ? r.rows.length : ''}</td><td class="num">${r.rows ? money(r.totalPrincipal) : ''}</td><td class="num">${r.rows ? money(r.totalInterest) : ''}</td><td class="num">${money(r.total)}</td><td>${r.rows ? `<button class="btn small" data-rp="${esc(r.no)}">พิมพ์</button>` : '<span class="muted" style="font-size:13px">จากโปรแกรมเก่า</span>'}</td></tr>`).join('')}</table></div>` : '<div class="empty">ยังไม่มี</div>';
    $$('[data-rp]').forEach((b) => b.addEventListener('click', () => printReceipt(seen.get(b.dataset.rp))));
  }).catch((e) => { if ($('#hist')) $('#hist').innerHTML = `<div class="err">${esc(e.message)}</div>`; });
  if (!d) return;

  $('#bt').innerHTML = `<tr><th></th><th>เลขที่บิล</th><th>วันที่</th><th class="num">ดอก %</th><th class="num">วัน</th><th class="num">เงินต้น</th><th class="num">ดอกเบี้ย</th><th class="num">รวม</th></tr>`
    + d.bills.map((b) => {
      const start = b.interestFrom || interestStart(b);
      const days = daysBetween(start, asOf);
      const graceLeft = !b.interestFrom && b.graceDays && start > asOf ? `ปลอดดอกถึง ${thDate(start)}` : '';
      return `<tr><td><input type="checkbox" data-b="${esc(b.no)}" aria-label="เลือกบิล ${esc(b.no)}" style="width:22px;height:22px;accent-color:var(--green)"></td>
        <td class="mono"><button class="btn link" data-view="${esc(b.no)}">${esc(b.no)}</button></td><td>${thDate(b.date)}</td><td class="num">${b.rate}</td>
        <td class="num">${graceLeft ? `<span class="pill">${graceLeft}</span>` : days}</td>
        <td class="num">${money(b.balance.principal)}</td><td class="num">${money(b.balance.interest)}</td><td class="num"><b>${money(b.balance.total)}</b></td></tr>`;
    }).join('');
  $$('[data-view]').forEach((x) => x.addEventListener('click', () => showBill(data.bills.find((b) => b.no === x.dataset.view))));

  const preview = () => {
    $('#payErr').classList.add('hidden');
    const open = data.bills.filter((b) => b.customerCode === code && b.type === 'credit' && b.status === 'open');
    let res = null;
    if (mode === 'amount') { const a = Number($('#amt').value); if (a > 0) res = allocatePayment(open, a, asOf); }
    else if (selected.size) {
      const chosen = open.filter((b) => selected.has(b.no));
      res = allocatePayment(chosen, round2(chosen.reduce((s, b) => s + billBalance(b, asOf).total, 0)), asOf);
    }
    const rows = res ? res.rows.filter((r) => r.payInterest || r.payPrincipal) : [];
    $('#alloc').innerHTML = rows.length ? `<tr><th>บิลที่ถูกตัด</th><th class="num">ตัดดอกเบี้ย</th><th class="num">ตัดเงินต้น</th><th class="num">เงินต้นคงเหลือ</th></tr>`
      + rows.map((r) => `<tr><td class="mono">${esc(r.no)}</td><td class="num">${money(r.payInterest)}</td><td class="num">${money(r.payPrincipal)}</td><td class="num">${r.principalLeft > 0 ? money(r.principalLeft) : '<span class="pill cash">ปิดบิล</span>'}</td></tr>`).join('')
      + `<tr><td><b>รวม</b></td><td class="num"><b>${money(res.totalInterest)}</b></td><td class="num"><b>${money(res.totalPrincipal)}</b></td><td class="num">${res.change > 0 ? `เงินทอน <b>${money(res.change)}</b>` : ''}</td></tr>` : '';
  };
  $$('[data-m]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.m;
    $$('[data-m]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#amtWrap').classList.toggle('hidden', mode !== 'amount');
    $('#billHint').textContent = mode === 'amount' ? 'ตัดดอกเบี้ยก่อน แล้วตัดเงินต้นจากบิลเก่าสุด' : 'ติ๊กเลือกบิลด้านบน ระบบจะคิดเงินต้นรวมดอกเบี้ยของบิลที่เลือก';
    preview();
  }));
  $('#amt').addEventListener('input', preview);
  $('#bt').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-b]'); if (!cb) return;
    cb.checked ? selected.add(cb.dataset.b) : selected.delete(cb.dataset.b);
    if (mode !== 'bills' && selected.size) $('[data-m="bills"]').click(); else preview();
  });
  $('#pay').addEventListener('click', async () => {
    const btn = $('#pay'); btn.disabled = true;
    let r;
    try { r = await backend.commitPayment(shopId, settings, { customerCode: code, date: asOf, mode, amount: $('#amt').value, billNos: [...selected], by: user.name }); }
    catch (e) { $('#payErr').textContent = e.message; $('#payErr').classList.remove('hidden'); btn.disabled = false; return; }
    viewDebtor(code);
    openDialog(`<h2>รับชำระแล้ว</h2>
      <div>ใบเสร็จ <b class="mono">${esc(r.no)}</b></div>
      <div>เงินต้น ${money(r.totalPrincipal)} + ดอกเบี้ย ${money(r.totalInterest)} = <b>฿${money(r.total)}</b></div>
      ${r.change > 0 ? `<div class="note">เงินทอน ฿${money(r.change)}</div>` : ''}
      <div class="row"><button class="btn primary" value="print">พิมพ์ใบเสร็จ</button><button class="btn" value="cancel">ปิด</button></div>`, () => { printReceipt(r); });
  });
}

// ---------------- bills ----------------
function showBill(b) {
  if (!b) return;
  const lock = billLockReason(b);
  const pend = pendingRequests().some((r) => r.billNo === b.no);
  const st = b.status === 'cancelled' ? '<span class="pill cancel">ยกเลิก</span>' : b.type === 'credit' ? (b.status === 'open' ? '<span class="pill credit">ค้างชำระ</span>' : '<span class="pill cash">ชำระแล้ว</span>') : '<span class="pill cash">เงินสด</span>';
  openDialog(`<h2 class="mono">${esc(b.no)}</h2>
    <div>${thDate(b.date)} · ${b.type === 'credit' ? 'เงินเชื่อ ' + b.rate + '%' : 'เงินสด'} ${st}${b.graceDays ? ` · ปลอดดอก ${b.graceDays / 30} เดือน` : ''}</div>
    <div>${esc(custLabel(b.customerCode))}${b.by ? ` <span class="muted">· ผู้ขาย ${esc(b.by)}</span>` : ''}</div>
    <div class="scroll"><table><tr><th>รายการ</th><th class="num">จำนวน</th><th class="num">ราคา</th><th class="num">รวม</th></tr>
    ${b.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${qtyFmt(l.qty)} ${esc(l.unit)}</td><td class="num">${money(l.price)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}</table></div>
    ${b.discount ? `<div class="total-box"><span>ส่วนลด</span><span class="mono">${money(b.discount)}</span></div>` : ''}
    <div class="total-box big"><span>สุทธิ</span><span class="mono">${money(b.total)}</span></div>
    ${b.receiptNo ? `<div class="muted">ชำระในใบเสร็จ ${esc(b.receiptNo)} ${b.paidDate ? 'วันที่ ' + thDate(b.paidDate) : ''}</div>` : ''}
    ${b.edits ? `<div class="muted" style="font-size:14px">แก้ไขแล้ว ${b.edits} ครั้ง · ล่าสุดโดย ${esc(b.editHistory?.at(-1)?.by || '')}${b.editHistory?.at(-1)?.reason ? ' (' + esc(b.editHistory.at(-1).reason) + ')' : ''}</div>` : ''}
    ${b.status === 'cancelled' ? `<div class="err">ยกเลิกโดย ${esc(b.cancelledBy || '')}${b.cancelReason ? ' · ' + esc(b.cancelReason) : ''}</div>` : ''}
    ${pend ? '<div class="note">มีคำขอแก้ไข/ยกเลิกบิลนี้รอเจ้าของอนุมัติอยู่</div>' : ''}
    ${lock && b.status !== 'cancelled' ? `<div class="muted" style="font-size:13px">${esc(lock)}</div>` : ''}
    <div class="row" style="justify-content:space-between">
      <span class="row"><button class="btn primary" value="print">พิมพ์บิล</button><button class="btn" value="cancel">ปิด</button></span>
      ${!lock && !pend ? `<span class="row">${isManager()
        ? '<button class="btn" value="edit">แก้ไขบิล</button><button class="btn" value="void" style="color:var(--red)">ยกเลิกบิล</button>'
        : '<button class="btn" value="edit">ขอแก้ไขบิล</button><button class="btn" value="void" style="color:var(--red)">ขอยกเลิกบิล</button>'}</span>` : ''}
    </div>`, (f, action) => {
    if (action === 'print') printBill(b);
    else if (action === 'edit') { billCache.set(b.no, b); location.hash = 'bill/' + encodeURIComponent(b.no); }
    else if (action === 'void') { setTimeout(() => voidBill(b), 0); }
  });
}
const billCache = new Map();
function voidBill(b) {
  const mgr = isManager();
  openDialog(`<h2>${mgr ? 'ยกเลิกบิล' : 'ขอยกเลิกบิล'} <span class="mono">${esc(b.no)}</span></h2>
    <div>${esc(custLabel(b.customerCode))} · ฿${money(b.total)}</div>
    <div class="muted" style="font-size:14px">สินค้าในบิลจะถูกคืนเข้าสต๊อก${b.type === 'credit' ? ' และยอดค้างของบิลนี้จะหายไป' : ''}</div>
    <label class="field">เหตุผล<input type="text" name="reason" ${mgr ? '' : 'required'} placeholder="เช่น ลูกค้าคืนของทั้งหมด, ออกบิลผิด"></label>
    <div class="err hidden dlg-err"></div>
    <div class="row"><button class="btn warn" value="ok">${mgr ? 'ยืนยันยกเลิกบิล' : 'ส่งคำขอ'}</button><button class="btn" value="cancel" formnovalidate>ไม่ยกเลิก</button></div>`, async (f) => {
    const reason = f.reason.value.trim();
    if (mgr) { await backend.commitBillChange(shopId, b.no, 'cancel', null, { by: user.name, reason }); toast('ยกเลิกบิลแล้ว'); }
    else { await backend.createRequest(shopId, { kind: 'cancel', billNo: b.no, customerCode: b.customerCode, before: { total: b.total, lines: b.lines }, reason, byName: user.name }); toast('ส่งคำขอยกเลิกแล้ว รอเจ้าของอนุมัติ'); }
    if (current !== 'sale') render();
  });
}

function viewBills() {
  view.innerHTML = `<section class="card">
    <h2>ค้นหาบิล</h2>
    <div class="row">
      <input type="search" id="bq" placeholder="เลขที่บิล หรือชื่อลูกค้า" style="flex:1;min-width:220px" autocomplete="off">
      <select id="bf"><option value="">ทุกบิล</option><option value="open">ค้างชำระ</option><option value="credit">เงินเชื่อ</option><option value="cash">เงินสด</option><option value="cancelled">ยกเลิก</option></select>
    </div>
    <div class="scroll"><table id="blt"></table></div>
    <div class="row" style="justify-content:space-between"><span class="muted" id="bcount" style="font-size:14px"></span>
      ${backend.mode === 'cloud' ? '<button class="btn small" id="older">ค้นหาในบิลเก่าทั้งหมด</button>' : ''}</div>
  </section>`;
  const cm = custBy();
  let extra = new Map();
  const all = () => [...new Map([...data.bills.map((b) => [b.no, b]), ...extra]).values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.no < b.no ? 1 : -1));
  const draw = () => {
    const q = $('#bq').value.trim(), n = norm(q), f = $('#bf').value;
    const list = all().filter((b) => (!f || (f === 'open' ? b.status === 'open' : f === 'cancelled' ? b.status === 'cancelled' : b.type === f))
      && (!n || norm(b.no).includes(n) || norm(cm.get(b.customerCode)?.name).includes(n)));
    $('#blt').innerHTML = `<tr><th>เลขที่</th><th>วันที่</th><th>ลูกค้า</th><th>ประเภท</th><th class="num">ยอด</th></tr>`
      + (list.length ? list.slice(0, 200).map((b) => `<tr class="clickable" data-no="${esc(b.no)}" tabindex="0"><td class="mono">${esc(b.no)}</td><td>${thDate(b.date)}</td><td>${esc(custLabel(b.customerCode, cm))}</td><td>${b.status === 'cancelled' ? '<span class="pill cancel">ยกเลิก</span>' : b.type === 'credit' ? `<span class="pill credit">เชื่อ${b.status === 'open' ? ' · ค้าง' : ''}</span>` : '<span class="pill cash">สด</span>'}</td><td class="num">${money(b.total)}</td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">ไม่พบบิล</td></tr>');
    $('#bcount').textContent = (list.length > 200 ? `แสดง 200 จาก ${list.length.toLocaleString()} บิล พิมพ์ค้นหาให้แคบลง` : `${list.length.toLocaleString()} บิล`)
      + (backend.mode === 'cloud' ? ' · ในเครื่องมีบิลค้างทั้งหมด + บิลย้อนหลัง 35 วัน' : '');
  };
  $('#bq').addEventListener('input', draw); $('#bf').addEventListener('change', draw);
  $('#older')?.addEventListener('click', async () => {
    const q = $('#bq').value.trim();
    if (!q) { toast('พิมพ์เลขที่บิล หรือชื่อลูกค้าก่อน'); return; }
    const btn = $('#older'); btn.disabled = true;
    try {
      let found = [];
      if (/\d{6,}/.test(q)) found = await backend.findBills(shopId, { no: q });
      if (!found.length) {
        const n = norm(q);
        const custs = data.customers.filter((c) => norm(c.name).includes(n) || c.code === q).slice(0, 5);
        for (const c of custs) found.push(...await backend.findBills(shopId, { customerCode: c.code }));
      }
      found.forEach((b) => extra.set(b.no, b));
      toast(found.length ? `พบ ${found.length} บิล` : 'ไม่พบบิลเก่า');
      draw();
    } catch (e) { toast(e.message); } finally { btn.disabled = false; }
  });
  const open = (e) => { const tr = e.target.closest('[data-no]'); if (tr) showBill(all().find((b) => b.no === tr.dataset.no)); };
  $('#blt').addEventListener('click', open);
  $('#blt').addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e); });
  draw(); $('#bq').focus();
}

// ---------------- edit a saved bill ----------------
async function viewBillEdit(no) {
  let bill = data.bills.find((b) => b.no === no) || billCache.get(no);
  if (!bill) { try { bill = (await backend.findBills(shopId, { no }))[0]; } catch { /* shown below */ } }
  const lock = billLockReason(bill);
  if (lock) { view.innerHTML = `<div><a href="#bills" class="btn small">← ค้นหาบิล</a></div><div class="err">${esc(lock)}</div>`; return; }
  const mgr = isManager();
  const st = { lines: bill.lines.map((l) => ({ ...l })), discount: bill.discount || 0, rate: bill.rate, grace: !!bill.graceDays, graceMonths: Math.round((bill.graceDays || 0) / 30) || settings.defaultGraceMonths };
  view.innerHTML = `
  <div><a href="#bills" class="btn small">← ค้นหาบิล</a></div>
  <section class="card">
    <h2>${mgr ? 'แก้ไขบิล' : 'ขอแก้ไขบิล'} <span class="mono">${esc(bill.no)}</span></h2>
    <div class="muted">${thDate(bill.date)} · ${bill.type === 'credit' ? 'เงินเชื่อ' : 'เงินสด'} · ${esc(custLabel(bill.customerCode))} · ยอดเดิม ฿${money(bill.total)}${bill.edits ? ` · แก้ไขแล้ว ${bill.edits} ครั้ง` : ''}</div>
    <label class="field">เพิ่มสินค้า<input type="search" id="eq" placeholder="พิมพ์ชื่อสินค้า แล้วกด Enter" autocomplete="off"></label>
    <div class="results hidden" id="eres"></div>
    <div class="scroll"><table id="elines"></table></div>
    <div class="form-grid">
      <label class="field">ส่วนลด (บาท)<input type="number" id="edisc" min="0" step="0.01" value="${st.discount || ''}"></label>
      ${bill.type === 'credit' ? `<label class="field">ดอกเบี้ย<select id="erate">${RATES.map((r) => `<option value="${r}" ${r === st.rate ? 'selected' : ''}>${r}%</option>`).join('')}</select></label>` : '<span></span>'}
    </div>
    ${bill.type === 'credit' ? `<div class="grace-box" style="max-width:360px"><label class="row" style="font-weight:600;min-height:44px;gap:8px"><input type="checkbox" id="egrace" ${st.grace ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--green)"> ปลอดดอก</label>
      <select id="emonths" ${st.grace ? '' : 'disabled'}>${GRACE_MONTHS.map((m) => `<option value="${m}" ${m === st.graceMonths ? 'selected' : ''}>${m} เดือน</option>`).join('')}</select></div>` : ''}
    <label class="field">เหตุผลที่แก้ ${mgr ? '<span class="muted" style="font-weight:400">(ไม่ใส่ก็ได้)</span>' : '<span style="color:var(--red)">*</span>'}<input type="text" id="ereason" placeholder="เช่น ลูกค้าคืน 2 กระสอบ, ใส่ราคาผิด"></label>
    <div class="total-box big"><span>ยอดใหม่</span><span class="mono" id="enet"></span></div>
    <div class="err hidden" id="eerr"></div>
    <div class="row"><button class="btn primary" id="esave">${mgr ? 'บันทึกการแก้ไข' : 'ส่งคำขอให้เจ้าของอนุมัติ'}</button><a class="btn" href="#bills">ยกเลิก</a></div>
  </section>`;
  const pm = () => new Map(data.products.map((p) => [p.code, p]));
  const draw = () => {
    const m = pm();
    $('#elines').innerHTML = `<tr><th>สินค้า</th><th class="num">จำนวน</th><th class="num">ราคา/หน่วย</th><th class="num">รวม</th><th></th></tr>` + st.lines.map((l, i) => `<tr>
      <td>${esc(l.name || m.get(l.code)?.name)} <span class="muted">· ${esc(l.unit || m.get(l.code)?.unit)}</span></td>
      <td class="num"><input class="qty" type="number" min="0" step="any" data-i="${i}" data-f="qty" value="${l.qty}" aria-label="จำนวน"></td>
      <td class="num"><input class="price" type="number" min="0" step="0.01" data-i="${i}" data-f="price" value="${l.price}" aria-label="ราคา"></td>
      <td class="num">${money(l.qty * l.price)}</td><td><button class="btn small" data-del="${i}">ลบ</button></td></tr>`).join('');
    total();
  };
  const total = () => { $('#enet').textContent = money(st.lines.reduce((s2, l) => s2 + l.qty * l.price, 0) - (Number(st.discount) || 0)); };
  $('#elines').addEventListener('input', (e) => { const t = e.target; if (!t.dataset.f) return; st.lines[+t.dataset.i][t.dataset.f] = Number(t.value) || 0; t.closest('tr').children[3].textContent = money(st.lines[+t.dataset.i].qty * st.lines[+t.dataset.i].price); total(); });
  $('#elines').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { st.lines.splice(+b.dataset.del, 1); draw(); } });
  const eq = $('#eq'), eres = $('#eres'); let found = [];
  const add = (code) => { const p = pm().get(code); const ex = st.lines.find((l) => l.code === code); if (ex) ex.qty += 1; else st.lines.push({ code, name: p.name, unit: p.unit, qty: 1, price: p.price }); eq.value = ''; eres.classList.add('hidden'); draw(); };
  eq.addEventListener('input', () => { found = searchProducts(eq.value); eres.classList.toggle('hidden', !eq.value); eres.innerHTML = found.map((p) => `<button type="button" data-code="${esc(p.code)}"><span>${esc(p.name)}</span><span class="mono">${money(p.price)}</span></button>`).join('') || '<div class="empty">ไม่พบสินค้า</div>'; });
  eq.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (found[0]) add(found[0].code); } });
  eres.addEventListener('click', (e) => { const b = e.target.closest('[data-code]'); if (b) add(b.dataset.code); });
  $('#edisc').addEventListener('input', (e) => { st.discount = Number(e.target.value) || 0; total(); });
  $('#erate')?.addEventListener('change', (e) => { st.rate = Number(e.target.value); });
  $('#egrace')?.addEventListener('change', (e) => { st.grace = e.target.checked; $('#emonths').disabled = !st.grace; });
  $('#emonths')?.addEventListener('change', (e) => { st.graceMonths = Number(e.target.value); });
  $('#esave').addEventListener('click', async () => {
    const err = $('#eerr'); err.classList.add('hidden');
    const reason = $('#ereason').value.trim();
    const changes = { lines: st.lines.map(({ code, qty, price, name, unit }) => ({ code, qty, price, name, unit })), discount: st.discount, rate: st.rate, graceMonths: bill.type === 'credit' ? (st.grace ? st.graceMonths : 0) : 0 };
    const btn = $('#esave'); btn.disabled = true;
    try {
      if (!mgr && !reason) throw new Error('ใส่เหตุผลที่ขอแก้');
      // check the change is valid before saving / sending
      const { editBill } = await import('./shop.js');
      const preview = editBill(data.products, bill, changes, { by: user.name, reason });
      if (mgr) {
        const nb = await backend.commitBillChange(shopId, bill.no, 'edit', changes, { by: user.name, reason });
        toast('บันทึกการแก้ไขแล้ว'); location.hash = 'bills'; setTimeout(() => showBill(nb), 50);
      } else {
        await backend.createRequest(shopId, { kind: 'edit', billNo: bill.no, customerCode: bill.customerCode, changes, before: { total: bill.total, lines: bill.lines }, after: { total: preview.bill.total, lines: preview.bill.lines }, reason, byName: user.name });
        toast('ส่งคำขอแล้ว รอเจ้าของอนุมัติ'); location.hash = 'bills';
      }
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false; }
  });
  draw();
}

// ---------------- approvals (owner) ----------------
function viewApprove() {
  const list = pendingRequests().sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
  view.innerHTML = `<section class="card"><h2>รออนุมัติ (${list.length})</h2>
    ${list.length ? '' : '<div class="empty">ไม่มีคำขอค้างอยู่</div>'}
    ${list.map((r) => {
      const d = r.kind === 'edit' ? diffLines(r.before?.lines || [], r.after?.lines || []) : [];
      return `<div class="stat" style="display:flex;flex-direction:column;gap:6px;padding:14px">
        <div class="row" style="justify-content:space-between"><b>${r.kind === 'cancel' ? 'ขอยกเลิกบิล' : 'ขอแก้ไขบิล'} <span class="mono">${esc(r.billNo)}</span></b><span class="muted" style="font-size:13px">${esc(r.byName)} · ${new Date(r.createdAt).toLocaleString('th-TH')}</span></div>
        <div>${esc(custLabel(r.customerCode))} · ยอด ฿${money(r.before?.total)}${r.kind === 'edit' ? ` → <b>฿${money(r.after?.total)}</b>` : ' → ยกเลิกทั้งบิล'}</div>
        ${d.length ? `<ul style="margin:0;padding-left:20px">${d.map((x) => `<li>${x.kind === 'add' ? `เพิ่ม ${esc(x.name)} ${x.qty} × ${money(x.price)}` : x.kind === 'remove' ? `ลบ ${esc(x.name)} (${x.qty})` : `${esc(x.name)}: ${esc(x.from)} → ${esc(x.to)}`}</li>`).join('')}</ul>` : ''}
        ${r.reason ? `<div class="muted">เหตุผล: ${esc(r.reason)}</div>` : ''}
        <div class="row"><button class="btn primary small" data-ok="${esc(r.id)}">อนุมัติ</button><button class="btn small" data-no="${esc(r.id)}">ไม่อนุมัติ</button></div>
      </div>`;
    }).join('')}</section>`;
  const act = async (id, ok, btn) => {
    btn.disabled = true;
    try { await backend.resolveRequest(shopId, id, ok, { by: user.name }); toast(ok ? 'อนุมัติแล้ว' : 'ไม่อนุมัติ'); viewApprove(); drawHeader(); markNav(); }
    catch (e) { toast(e.message); btn.disabled = false; }
  };
  $$('[data-ok]').forEach((b) => b.addEventListener('click', () => act(b.dataset.ok, true, b)));
  $$('[data-no]').forEach((b) => b.addEventListener('click', () => act(b.dataset.no, false, b)));
}

// ---------------- customers ----------------
function customerForm(c) {
  const isNew = !c;
  c = c || { code: nextCustomerCode(data.customers), name: '', phone: '', zone: '' };
  openDialog(`<h2>${isNew ? 'เพิ่มลูกค้า' : 'แก้ไขลูกค้า'}</h2>
    <div class="form-grid">
      <label class="field">รหัส<input type="text" name="code" value="${esc(c.code)}" ${isNew ? '' : 'readonly'} required></label>
      <label class="field">เบอร์โทร<input type="tel" name="phone" value="${esc(c.phone)}"></label>
    </div>
    <label class="field">ชื่อ<input type="text" name="name" value="${esc(c.name)}" required></label>
    <label class="field">ที่อยู่ย่อ / หมู่บ้าน<input type="text" name="zone" value="${esc(c.zone)}" list="zoneList" autocomplete="off"></label>
    <datalist id="zoneList">${zones(data.customers).map((z) => `<option value="${esc(z)}">`).join('')}</datalist>
    <div class="err hidden dlg-err"></div>
    <div class="row"><button class="btn primary" value="save">บันทึก</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></div>`, async (f) => {
    const v = Object.fromEntries(new FormData(f));
    const rec = { code: v.code.trim(), name: v.name.trim(), phone: v.phone.trim(), zone: v.zone.trim() };
    if (!rec.name) throw new Error('ใส่ชื่อลูกค้า');
    if (!/^[^/]+$/.test(rec.code)) throw new Error('รหัสห้ามมีเครื่องหมาย /');
    if (isNew && data.customers.some((x) => x.code === rec.code)) throw new Error('รหัสนี้มีแล้ว');
    if (isNew) rec.rate = 0;
    await backend.saveCustomer(shopId, rec);
    toast('บันทึกลูกค้าแล้ว'); viewCustomers();
  });
}
function viewCustomers() {
  const debts = customerDebts(data, todayIso());
  view.innerHTML = `<section class="card">
    <div class="row" style="justify-content:space-between"><h2>ลูกค้า (${data.customers.length})</h2><button class="btn primary" id="addc">+ เพิ่มลูกค้า</button></div>
    <input type="search" id="cq2" placeholder="ค้นหาชื่อ หมู่บ้าน หรือรหัส" autocomplete="off">
    <div class="scroll"><table id="ct"></table></div>
  </section>`;
  const draw = () => {
    const q = $('#cq2').value.trim(), n = norm(q);
    const list = data.customers.filter((c) => !n || norm(c.name).includes(n) || norm(c.zone).includes(n) || c.code.startsWith(q)).sort((a, b) => (a.code < b.code ? -1 : 1));
    $('#ct').innerHTML = `<tr><th>รหัส</th><th>ชื่อ</th><th>หมู่บ้าน</th><th>โทร</th><th class="num">ยอดค้าง</th><th></th></tr>`
      + (list.length ? list.slice(0, 300).map((c) => { const d = debts.get(c.code); return `<tr><td class="mono">${esc(c.code)}</td><td>${esc(c.name)}</td><td>${esc(c.zone)}</td><td>${esc(c.phone)}</td><td class="num">${d ? `<a href="#debt/${encodeURIComponent(c.code)}">${money(d.total)}</a>` : '-'}</td><td><button class="btn small" data-e="${esc(c.code)}">แก้ไข</button></td></tr>`; }).join('')
        : '<tr><td colspan="6" class="empty">ไม่พบลูกค้า</td></tr>');
  };
  $('#cq2').addEventListener('input', draw);
  $('#ct').addEventListener('click', (e) => { const b = e.target.closest('[data-e]'); if (b) customerForm(data.customers.find((c) => c.code === b.dataset.e)); });
  $('#addc').addEventListener('click', () => customerForm());
  draw(); $('#cq2').focus();
}

// ---------------- products ----------------
function productForm(p) {
  const isNew = !p;
  p = p || { code: nextProductCode(data.products), name: '', unit: '', price: 0, stock: 0, noStock: false };
  openDialog(`<h2>${isNew ? 'เพิ่มสินค้า' : 'แก้ไขสินค้า'}</h2>
    <div class="form-grid">
      <label class="field">รหัส<input type="text" name="code" value="${esc(p.code)}" ${isNew ? '' : 'readonly'} required></label>
      <label class="field">หน่วย<input type="text" name="unit" value="${esc(p.unit)}" placeholder="กระสอบ, ขวด, ไร่"></label>
    </div>
    <label class="field">ชื่อสินค้า<input type="text" name="name" value="${esc(p.name)}" required></label>
    <div class="form-grid">
      <label class="field">ราคาขาย (บาท)<input type="number" name="price" min="0" step="0.01" value="${p.price || ''}"></label>
      <label class="field">สต๊อกคงเหลือ<input type="number" name="stock" step="any" value="${p.stock ?? 0}"></label>
    </div>
    <label class="row" style="font-weight:600;min-height:44px"><input type="checkbox" name="noStock" ${p.noStock ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--green)"> ไม่มีสต๊อก (งานบริการ เช่น ไถแปร โดรนพ่นยา)</label>
    ${isManager() ? `<label class="field">ราคาทุน (บาท) <span class="muted" style="font-weight:400">· พนักงานมองไม่เห็นช่องนี้</span><input type="number" name="cost" min="0" step="0.01" value="${p.cost || ''}"></label>`
      : '<div class="muted" style="font-size:13px">ราคาทุน: ต้องขอรหัส PIN จากแอดมินก่อนดูหรือแก้</div>'}
    <div class="err hidden dlg-err"></div>
    <div class="row" style="justify-content:space-between"><span class="row"><button class="btn primary" value="save">บันทึก</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></span>
      ${isNew ? '' : '<button class="btn" value="delete" formnovalidate style="color:var(--red)">ลบสินค้า</button>'}</div>`, async (f, action) => {
    if (action === 'delete') {
      if (!confirm(`ลบ "${p.name}" ออกจากรายการสินค้า?\nบิลเก่าที่เคยขายสินค้านี้ยังอยู่ครบ`)) return false;
      await backend.saveProduct(shopId, { code: p.code, deleted: true, deletedBy: user.name, deletedAt: new Date().toISOString() });
      toast('ลบสินค้าแล้ว'); viewProducts(); return;
    }
    const v = Object.fromEntries(new FormData(f));
    if (!v.name.trim()) throw new Error('ใส่ชื่อสินค้า');
    const code = v.code.trim();
    if (!/^[^/]+$/.test(code)) throw new Error('รหัสห้ามมีเครื่องหมาย /');
    if (isNew && liveProducts().some((x) => x.code === code)) throw new Error('รหัสนี้มีแล้ว');
    const rec = { code, name: v.name.trim(), unit: v.unit.trim() || 'หน่วย', price: round2(Number(v.price) || 0), stock: Number(v.stock) || 0, noStock: !!v.noStock, priceFromHistory: false, deleted: false, updatedBy: user.name };
    if (isManager()) rec.cost = round2(Number(v.cost) || 0);
    else if (isNew) rec.cost = 0;
    if (isNew) rec.group = '';
    await backend.saveProduct(shopId, rec);
    toast('บันทึกสินค้าแล้ว'); viewProducts();
  });
}
function viewProducts() {
  view.innerHTML = `<section class="card">
    <div class="row" style="justify-content:space-between"><h2>สินค้า (${liveProducts().length})</h2><button class="btn primary" id="addp">+ เพิ่มสินค้า</button></div>
    <div class="row"><input type="search" id="pq2" placeholder="ค้นหาชื่อสินค้า" style="flex:1;min-width:220px" autocomplete="off">
      <select id="pf"><option value="">ทั้งหมด</option><option value="neg">สต๊อกติดลบ</option><option value="noprice">ยังไม่มีราคา</option><option value="service">ไม่มีสต๊อก (บริการ)</option></select></div>
    <div class="scroll"><table id="ptab"></table></div>
  </section>`;
  const draw = () => {
    const n = norm($('#pq2').value), f = $('#pf').value;
    const list = liveProducts().filter((p) => (!n || norm(p.name).includes(n) || p.code.startsWith($('#pq2').value.trim()))
      && (!f || (f === 'neg' ? !p.noStock && p.stock < 0 : f === 'noprice' ? !p.price : p.noStock))).sort((a, b) => a.name.localeCompare(b.name, 'th'));
    $('#ptab').innerHTML = `<tr><th>รหัส</th><th>ชื่อ</th><th>หน่วย</th><th class="num">ราคาขาย</th><th class="num">คงเหลือ</th><th></th></tr>`
      + (list.length ? list.slice(0, 300).map((p) => `<tr><td class="mono">${esc(p.code)}</td><td>${esc(p.name)}</td><td>${esc(p.unit)}</td><td class="num">${p.price ? money(p.price) : '<span class="pill credit">ไม่มีราคา</span>'}</td><td class="num">${p.noStock ? '<span class="muted">ไม่มีสต๊อก</span>' : `<span style="${p.stock < 0 ? 'color:var(--red);font-weight:600' : ''}">${qtyFmt(p.stock)}</span>`}</td><td><button class="btn small" data-e="${esc(p.code)}">แก้ไข</button></td></tr>`).join('')
        : '<tr><td colspan="6" class="empty">ไม่พบสินค้า</td></tr>');
  };
  $('#pq2').addEventListener('input', draw); $('#pf').addEventListener('change', draw);
  $('#ptab').addEventListener('click', (e) => { const b = e.target.closest('[data-e]'); if (b) productForm(liveProducts().find((p) => p.code === b.dataset.e)); });
  $('#addp').addEventListener('click', () => productForm());
  draw(); $('#pq2').focus();
}

// ---------------- staff codes ----------------
async function viewUsers() {
  view.innerHTML = '<div class="card"><div class="row"><span class="spinner"></span> กำลังโหลด…</div></div>';
  let users;
  try { users = await backend.listUsers(); } catch (e) { view.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const shopLabel = (id) => shops.find((s) => s.id === id)?.label || id;
  const asAdmin = role() === 'admin';
  const myShops = asAdmin ? shops : shops.filter((s) => s.id === shopId || user.shops?.includes(s.id));
  const roles = asAdmin ? ['owner', 'staff', 'admin'] : ['staff'];
  if (!asAdmin) users = users.filter((u) => u.uid === user.uid || (u.shops || []).includes(shopId));
  view.innerHTML = `<section class="card">
    <div class="row" style="justify-content:space-between"><h2>รหัสเข้าระบบ</h2><button class="btn primary" id="addu">+ เพิ่มรหัส</button></div>
    <div class="scroll"><table><tr><th>รหัส</th><th>ชื่อ</th><th>หน้าที่</th><th>ร้าน</th><th>สถานะ</th><th></th></tr>
    ${users.sort((a, b) => (a.code < b.code ? -1 : 1)).map((u) => `<tr><td class="mono">${esc(u.code)}</td><td>${esc(u.name)}</td><td>${ROLE[u.role] || esc(u.role)}</td>
      <td>${u.role === 'admin' ? 'ทุกร้าน' : (u.shops || []).map((s) => esc(shopLabel(s))).join(', ')}</td>
      <td>${u.active ? '<span class="pill cash">ใช้งาน</span>' : '<span class="pill cancel">ปิด</span>'}</td>
      <td>${u.uid !== user.uid && (asAdmin || ['staff', 'secretary'].includes(u.role)) ? `<button class="btn small" data-toggle="${esc(u.uid)}" data-active="${u.active ? 1 : 0}">${u.active ? 'ปิดรหัส' : 'เปิดรหัส'}</button>` : ''}</td></tr>`).join('')}
    </table></div>
    <div class="muted" style="font-size:13px">ลืม PIN: ปิดรหัสเดิมแล้วสร้างรหัสใหม่ · เปลี่ยน PIN ของตัวเองได้ด้านล่าง</div>
  </section>
  ${backend.mode === 'cloud' ? `<section class="card" style="max-width:480px">
    <h2>เปลี่ยน PIN ของฉัน</h2>
    <form id="pinf" style="display:flex;flex-direction:column;gap:10px">
      <label class="field">PIN เดิม<input type="password" name="old" inputmode="numeric" maxlength="6" required></label>
      <label class="field">PIN ใหม่ 6 หลัก<input type="password" name="pin" inputmode="numeric" maxlength="6" required></label>
      <div class="err hidden" id="pinerr"></div>
      <div class="row"><button class="btn">เปลี่ยน PIN</button></div>
    </form></section>` : ''}`;
  $$('[data-toggle]').forEach((b) => b.addEventListener('click', async () => {
    const on = b.dataset.active !== '1';
    if (!confirm(on ? 'เปิดใช้รหัสนี้?' : 'ปิดรหัสนี้? คนที่ใช้รหัสนี้จะเข้าระบบไม่ได้')) return;
    try { await backend.setUserActive(b.dataset.toggle, on); viewUsers(); } catch (e) { toast(e.message); }
  }));
  $('#addu')?.addEventListener('click', () => openDialog(`<h2>เพิ่มรหัสเข้าระบบ</h2>
    <div class="form-grid">
      <label class="field">รหัส (อังกฤษ/ตัวเลข)<input type="text" name="code" required autocomplete="off" style="font-family:var(--mono)"></label>
      <label class="field">PIN 6 หลัก<input type="text" name="pin" inputmode="numeric" maxlength="6" required autocomplete="off" style="font-family:var(--mono)"></label>
    </div>
    <label class="field">ชื่อ<input type="text" name="name" required></label>
    <label class="field">หน้าที่<select name="role">${roles.map((r) => `<option value="${r}">${ROLE[r]}</option>`).join('')}</select></label>
    <fieldset style="border:1px solid var(--line);border-radius:10px;padding:10px 12px"><legend style="font-size:14px;font-weight:600">ร้าน</legend>
      ${myShops.map((s) => `<label class="row" style="min-height:40px"><input type="checkbox" name="shops" value="${esc(s.id)}" ${s.id === shopId ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--green)"> ${esc(s.label || s.name || s.id)}</label>`).join('')}
    </fieldset>
    <div class="err hidden dlg-err"></div>
    <div class="row"><button class="btn primary" value="save">สร้างรหัส</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></div>`, async (f) => {
    const fd = new FormData(f);
    await backend.createUser({ code: fd.get('code'), name: fd.get('name'), pin: fd.get('pin'), role: fd.get('role'), shops: fd.getAll('shops') });
    toast('สร้างรหัสแล้ว'); viewUsers();
  }));
  $('#pinf')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await backend.changeMyPin(f.old.value, f.pin.value); f.reset(); toast('เปลี่ยน PIN แล้ว'); }
    catch (ex) { $('#pinerr').textContent = ex.message; $('#pinerr').classList.remove('hidden'); }
  });
}

// ---------------- import from the old program ----------------
const MAIN_DB_NAME = /^chemi2003new\.mdb$/i;
function runImport(bytes, opts) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker('./js/import-worker.js', { type: 'module' }); }
    catch { import('./importer.bundle.js').then((m) => resolve(m.importDatabase(bytes, opts))).catch(reject); return; }
    w.onmessage = (e) => { w.terminate(); e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error)); };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message || 'worker error')); };
    w.postMessage({ bytes, opts });
  });
}
async function viewImport() {
  const info = await backend.shopInfo(shopId).catch(() => ({}));
  view.innerHTML = `
  <div class="note">ก่อนเริ่ม: <b>ปิดโปรแกรมเก่า</b>ก่อน ไม่งั้นข้อมูลล่าสุดอาจยังไม่ถูกบันทึกลงไฟล์ · ระบบอ่านไฟล์อย่างเดียว ไม่แก้ไฟล์เดิม</div>
  <section class="card"><div class="step"><span class="n">1</span><div style="flex:1;display:flex;flex-direction:column;gap:10px">
    <h2>เลือกโฟลเดอร์โปรแกรมเก่า</h2>
    <div class="muted" style="font-size:14px">เลือกโฟลเดอร์ <span class="mono">ChemiNew</span> ระบบจะหาไฟล์ <span class="mono">Chemi2003NEW.MDB</span> ให้เอง</div>
    <div class="row">
      <label class="btn primary" for="pickFolder">เลือกโฟลเดอร์…</label><input id="pickFolder" type="file" webkitdirectory directory multiple class="hidden">
      <label class="btn" for="pickFile">หรือเลือกไฟล์ .MDB โดยตรง</label><input id="pickFile" type="file" accept=".mdb,.MDB" class="hidden">
    </div>
    <div id="fileInfo" class="hidden"></div>
  </div></div></section>
  <section class="card"><div class="step off" id="s2"><span class="n">2</span><div style="flex:1;display:flex;flex-direction:column;gap:12px">
    <h2>เลือกช่วงปีที่ต้องการนำเข้า</h2>
    <div class="row"><label class="field">ตั้งแต่ปี <select id="fromYear"></select></label><label class="field">ถึงปี <select id="toYear"></select></label></div>
    <div class="years" id="yearList"></div>
    <label class="row" style="font-weight:600;min-height:44px"><input type="checkbox" id="keepOpen" checked style="width:22px;height:22px;accent-color:var(--green)"> นำบิลเงินเชื่อที่ยังค้างชำระมาด้วยทุกปี (แนะนำ)</label>
    <div class="muted" style="font-size:14px">ลูกค้า สินค้า และสต๊อกล่าสุด นำเข้าทั้งหมดเสมอ · ช่วงปีมีผลกับประวัติบิลและใบเสร็จ</div>
    <div class="row"><button class="btn primary" id="btnPreview">ดูสรุปก่อนนำเข้า</button></div>
  </div></div></section>
  <section class="card hidden" id="s3"><div class="step"><span class="n">3</span><div style="flex:1;display:flex;flex-direction:column;gap:12px;min-width:0">
    <h2>สรุปข้อมูลที่จะนำเข้า → ${esc(settings.label || settings.name || shopId)}</h2>
    <div class="stats" id="stats"></div><div id="warnings"></div>
    <h3 style="margin:6px 0 0;font-size:16px">ลูกค้าที่ค้างชำระมากสุด (เทียบกับโปรแกรมเก่าได้)</h3>
    <div class="scroll"><table id="topDebt"></table></div>
    <div class="note">${info.importedAt ? `ร้านนี้เคยนำเข้าแล้วเมื่อ ${new Date(info.importedAt).toLocaleString('th-TH')} · ` : ''}การนำเข้าจะ<b>ลบข้อมูลลูกค้า สินค้า บิล และใบเสร็จเดิมของร้านนี้ทั้งหมด</b>แล้วใส่ข้อมูลจากไฟล์แทน (การตั้งค่าร้านและรหัสพนักงานยังอยู่)</div>
    <div class="row"><button class="btn warn" id="btnImport">นำเข้าข้อมูล</button><span id="importState" class="muted"></span></div>
  </div></div></section>
  <div id="msg"></div>`;
  let bytes = null, result = null;
  const message = (html, cls = 'err') => { $('#msg').innerHTML = html ? `<div class="${cls}">${html}</div>` : ''; };
  const loadFile = async (file, all) => {
    message('');
    const lock = all?.find((f) => /\.ldb$/i.test(f.name));
    bytes = new Uint8Array(await file.arrayBuffer());
    let meta;
    try { const m = await import('./importer.bundle.js'); meta = m.inspect(bytes); } catch (e) { bytes = null; message(esc(e.message)); return; }
    $('#fileInfo').className = 'ok';
    $('#fileInfo').innerHTML = `พบไฟล์ <span class="mono">${esc(file.webkitRelativePath || file.name)}</span> · แก้ไขล่าสุด ${new Date(file.lastModified).toLocaleString('th-TH')}<br>ลูกค้า ${meta.customers} · สินค้า ${meta.products}`
      + (lock ? '<div class="note" style="margin-top:8px">พบไฟล์ล็อก (.ldb) แปลว่าโปรแกรมเก่าอาจยังเปิดอยู่ ปิดโปรแกรมแล้วเลือกใหม่จะได้ข้อมูลล่าสุด</div>' : '');
    const years = Object.keys(meta.years).map(Number);
    const opts = years.map((y) => `<option value="${y}">${y}</option>`).join('');
    $('#fromYear').innerHTML = opts; $('#toYear').innerHTML = opts;
    $('#fromYear').value = years[0]; $('#toYear').value = years[years.length - 1];
    $('#yearList').innerHTML = years.map((y) => `<span class="stat" style="padding:6px 10px"><span class="k">ปี ${y}</span> <b class="mono">${meta.years[y].toLocaleString()}</b> <span class="k">บิล</span></span>`).join('');
    $('#s2').classList.remove('off'); $('#s3').classList.add('hidden');
  };
  $('#pickFolder').addEventListener('change', (e) => {
    const files = [...e.target.files];
    const main = files.find((f) => MAIN_DB_NAME.test(f.name) && !/datae?mt|copy|report/i.test(f.webkitRelativePath)) || files.find((f) => MAIN_DB_NAME.test(f.name));
    if (!main) { message('ไม่พบไฟล์ Chemi2003NEW.MDB ในโฟลเดอร์ที่เลือก ลองเลือกโฟลเดอร์ ChemiNew หรือ ChemiNew\\Data'); return; }
    loadFile(main, files);
  });
  $('#pickFile').addEventListener('change', (e) => { if (e.target.files[0]) loadFile(e.target.files[0]); });
  $('#btnPreview').addEventListener('click', async () => {
    const fromYear = +$('#fromYear').value, toYear = +$('#toYear').value;
    if (fromYear > toYear) { message('ปีเริ่มต้องไม่มากกว่าปีสิ้นสุด'); return; }
    const btn = $('#btnPreview'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังอ่านไฟล์… (ประมาณ 10–30 วินาที)';
    try { result = await runImport(bytes, { fromYear, toYear, keepOpenBills: $('#keepOpen').checked }); }
    catch (e) { message('อ่านไฟล์ไม่สำเร็จ: ' + esc(e.message)); return; }
    finally { btn.disabled = false; btn.textContent = 'ดูสรุปก่อนนำเข้า'; }
    const s = result.summary;
    const stat = (k, v) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    $('#stats').innerHTML = stat('ลูกค้า', s.customers) + stat('สินค้า', s.products) + stat('บิลขาย', s.bills.toLocaleString()) + stat('บิลค้างชำระ', s.openBills)
      + stat('เงินต้นค้างรวม', '฿' + money(s.openPrincipal)) + stat('ลูกค้าที่ค้าง', s.openCustomers) + stat('ใบเสร็จรับชำระ', s.receipts) + stat('สต๊อก ณ งวด', s.stockPeriod);
    $('#warnings').innerHTML = s.warnings.map((w) => `<div class="note">${esc(w)}</div>`).join('');
    const names = new Map(result.customers.map((c) => [c.code, c]));
    const by = new Map();
    for (const b of result.bills) if (b.status === 'open') { const x = by.get(b.customerCode) || { n: 0, sum: 0 }; x.n++; x.sum += b.total; by.set(b.customerCode, x); }
    const top = [...by.entries()].sort((a, b) => b[1].sum - a[1].sum).slice(0, 10);
    $('#topDebt').innerHTML = '<tr><th>รหัส</th><th>ลูกค้า</th><th>หมู่บ้าน</th><th class="num">บิล</th><th class="num">เงินต้นค้าง</th></tr>'
      + top.map(([code, x]) => `<tr><td class="mono">${esc(code)}</td><td>${esc(names.get(code)?.name || '?')}</td><td>${esc(names.get(code)?.zone || '')}</td><td class="num">${x.n}</td><td class="num">${money(x.sum)}</td></tr>`).join('');
    $('#s3').classList.remove('hidden'); $('#s3').scrollIntoView({ behavior: 'smooth' });
  });
  $('#btnImport').addEventListener('click', async () => {
    if (!result || !confirm(`ยืนยันนำเข้าเป็นข้อมูลของ "${settings.label || settings.name || shopId}"?\nข้อมูลเดิมของร้านนี้จะถูกแทนที่ทั้งหมด`)) return;
    const btn = $('#btnImport'); btn.disabled = true;
    try {
      await backend.replaceShopData(shopId, result, (p) => { $('#importState').textContent = `กำลังบันทึก… ${Math.round(p * 100)}%`; });
      $('#importState').textContent = '';
      message(`นำเข้าเรียบร้อย · ลูกค้า ${result.summary.customers} · สินค้า ${result.summary.products} · บิล ${result.summary.bills.toLocaleString()} · ค้าง ฿${money(result.summary.openPrincipal)}`, 'ok');
      if (backend.mode === 'local') { shop = await backend.openShop(shopId, onRemoteChange); data = shop.data; }
    } catch (e) { message('บันทึกไม่สำเร็จ: ' + esc(e.message)); }
    finally { btn.disabled = false; }
  });
}

// ---------------- backup / restore / delete shop ----------------
const safeName = (x) => String(x || '').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'ร้าน';
function stamp() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear() + 543}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; }
const canPickFolder = () => typeof window.showDirectoryPicker === 'function';
async function folderReady(dir, ask) {
  if (!dir) return false;
  try {
    if ((await dir.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    return ask && (await dir.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch { return false; }
}
// Writes into <chosen folder>/<prefix>_<shop name>/ when a folder was chosen, otherwise downloads the file.
async function saveBackupFile(backup, meta) {
  const label = meta.label || meta.name || meta.id;
  const fileName = `${APP_NAME}_${safeName(label)}_${stamp()}.json`;
  const text = JSON.stringify(backup);
  const dir = await getBackupDir().catch(() => null);
  if (await folderReady(dir, true)) {
    const subName = `${safeName(meta.prefix || '00')}_${safeName(label)}`;
    const subDir = await dir.getDirectoryHandle(subName, { create: true });
    const fh = await subDir.getFileHandle(fileName, { create: true });
    const w = await fh.createWritable(); await w.write(text); await w.close();
    return `โฟลเดอร์ ${dir.name} › ${subName} › ${fileName}`;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  return `ดาวน์โหลดไฟล์ ${fileName} (อยู่ในโฟลเดอร์ Downloads)`;
}
async function backupOne(meta, onStatus) {
  onStatus?.(`กำลังอ่านข้อมูล ${meta.label || meta.name || meta.id}…`);
  const backup = await backend.exportShop(meta.id);
  const where = await saveBackupFile(backup, { ...backup.settings, ...meta });
  await backend.markBackup(meta.id);
  const n = (k) => backup.collections[k]?.length || 0;
  return { where, counts: `ลูกค้า ${n('customers')} · สินค้า ${n('products')} · บิล ${n('bills').toLocaleString()} · ใบเสร็จ ${n('receipts').toLocaleString()}` };
}

async function viewBackup() {
  const dir = await getBackupDir().catch(() => null);
  const isAdmin = user.role === 'admin' && !previewing();
  const meta = { ...settings, id: shopId };
  view.innerHTML = `
  <section class="card">
    <h2>สำรองข้อมูลลงเครื่อง</h2>
    <div class="muted" style="font-size:14px">สำรองล่าสุด: ${settings.lastBackupAt ? `${new Date(settings.lastBackupAt).toLocaleString('th-TH')} โดย ${esc(settings.lastBackupBy || '')}` : '<b style="color:var(--orange-ink)">ยังไม่เคยสำรอง</b>'}</div>
    ${canPickFolder() ? `<div class="stat" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
        <div><div class="k">โฟลเดอร์เก็บไฟล์สำรอง</div><b id="dirName">${dir ? esc(dir.name) : 'ยังไม่ได้เลือก (จะดาวน์โหลดลงโฟลเดอร์ Downloads)'}</b></div>
        <button class="btn small" id="pickDir">${dir ? 'เปลี่ยนโฟลเดอร์' : 'เลือกโฟลเดอร์'}</button></div>
      <div class="muted" style="font-size:13px">แนะนำให้สร้างโฟลเดอร์ เช่น <span class="mono">D:\\สำรองข้อมูลร้าน</span> แล้วเลือกไว้ ระบบจะแยกโฟลเดอร์ย่อยให้ทีละร้าน (เช่น 01_ร้านปุ๋ย)</div>`
      : '<div class="note">เครื่องนี้เลือกโฟลเดอร์ไม่ได้ ไฟล์สำรองจะถูกดาวน์โหลดลงโฟลเดอร์ Downloads</div>'}
    <div class="row">
      <button class="btn primary" id="bkOne">สำรองร้านนี้ตอนนี้</button>
      ${isAdmin && shops.length > 1 ? `<button class="btn" id="bkAll">สำรองทุกร้าน (${shops.length} ร้าน)</button>` : ''}
    </div>
    <div id="bkMsg"></div>
  </section>
  <section class="card">
    <h2>กู้คืนจากไฟล์สำรอง</h2>
    <div class="note">กู้คืนแล้ว <b>ข้อมูลปัจจุบันของร้านนี้จะถูกแทนที่ด้วยข้อมูลในไฟล์ทั้งหมด</b> รายการที่ทำหลังจากวันที่สำรองจะหายไป ระบบจะสำรองข้อมูลปัจจุบันให้อัตโนมัติก่อนกู้คืน</div>
    <div class="row"><label class="btn" for="rsFile">เลือกไฟล์สำรอง (.json)…</label><input type="file" id="rsFile" accept=".json,application/json" class="hidden"></div>
    <div id="rsInfo"></div>
  </section>
  ${isAdmin ? `<section class="card" style="border-color:var(--err-line)">
    <h2 style="color:var(--red)">ลบร้านนี้ถาวร</h2>
    <div class="muted" style="font-size:14px">ลบลูกค้า สินค้า บิล ใบเสร็จ ลูกหนี้ และการตั้งค่าของ <b>${esc(settings.label || settings.name || shopId)}</b> ทั้งหมด กู้คืนจากระบบไม่ได้ · ร้านอื่นไม่โดนผลกระทบ · รหัสพนักงานที่ผูกกับร้านนี้ร้านเดียวจะถูกปิด</div>
    <div class="row"><button class="btn" id="delShop" style="color:var(--red);border-color:var(--err-line)">ลบร้านนี้ถาวร…</button></div>
  </section>` : ''}`;

  const msg = (html, cls = 'ok') => { $('#bkMsg').innerHTML = html ? `<div class="${cls}" style="margin-top:4px">${html}</div>` : ''; };
  $('#pickDir')?.addEventListener('click', async () => {
    try { const h = await window.showDirectoryPicker({ id: 'kaset-backup', mode: 'readwrite' }); await setBackupDir(h); viewBackup(); toast('เลือกโฟลเดอร์แล้ว'); }
    catch (e) { if (e.name !== 'AbortError') toast(e.message); }
  });
  $('#bkOne').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true;
    try { const r = await backupOne(meta, (t) => msg(`<span class="spinner"></span> ${esc(t)}`, 'muted')); settings.lastBackupAt = new Date().toISOString(); settings.lastBackupBy = user.name; msg(`สำรองแล้ว · ${esc(r.counts)}<br>${esc(r.where)}`); }
    catch (ex) { msg('สำรองไม่สำเร็จ: ' + esc(ex.message), 'err'); } finally { btn.disabled = false; }
  });
  $('#bkAll')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.disabled = true; const done = [];
    try { for (const s of shops) { const r = await backupOne(s, (t) => msg(`<span class="spinner"></span> ${esc(t)} (${done.length + 1}/${shops.length})`, 'muted')); done.push(`${esc(s.label || s.name || s.id)}: ${esc(r.counts)}`); } msg('สำรองครบทุกร้าน<br>' + done.join('<br>')); }
    catch (ex) { msg(`สำรองได้ ${done.length} ร้าน แล้วติดปัญหา: ${esc(ex.message)}`, 'err'); } finally { btn.disabled = false; }
  });

  $('#rsFile').addEventListener('change', async (e) => {
    const file = e.target.files[0]; if (!file) return;
    let bk;
    try { bk = JSON.parse(await file.text()); if (bk.format !== 'nutdechashop-kaset-backup') throw new Error(); }
    catch { $('#rsInfo').innerHTML = '<div class="err">ไฟล์นี้ไม่ใช่ไฟล์สำรองของโปรแกรมนี้</div>'; return; }
    const n = (k) => bk.collections?.[k]?.length || 0;
    const other = bk.shopId !== shopId && backend.mode === 'cloud';
    $('#rsInfo').innerHTML = `<div class="stat" style="display:flex;flex-direction:column;gap:4px">
      <div>ไฟล์: <b>${esc(file.name)}</b></div>
      <div>ร้านในไฟล์: <b>${esc(bk.settings?.label || bk.settings?.name || bk.shopId)}</b> · สำรองเมื่อ ${new Date(bk.exportedAt).toLocaleString('th-TH')} โดย ${esc(bk.exportedBy || '')}</div>
      <div>ลูกค้า ${n('customers')} · สินค้า ${n('products')} · บิล ${n('bills').toLocaleString()} · ใบเสร็จ ${n('receipts').toLocaleString()}</div></div>
      ${other ? '<div class="err">ไฟล์นี้เป็นของอีกร้าน ถ้ากู้คืน ข้อมูลร้านนั้นจะมาแทนที่ร้านที่เปิดอยู่</div>' : ''}
      <div class="row"><button class="btn warn" id="rsGo">กู้คืนเข้าร้าน "${esc(settings.label || settings.name || shopId)}"</button><span class="muted" id="rsState"></span></div>`;
    $('#rsGo').addEventListener('click', async () => {
      if (!confirm(`ยืนยันกู้คืน?\nข้อมูลปัจจุบันของ "${settings.label || settings.name || shopId}" จะถูกแทนที่ด้วยข้อมูลจากไฟล์`)) return;
      const btn = $('#rsGo'); btn.disabled = true;
      try {
        $('#rsState').textContent = 'กำลังสำรองข้อมูลปัจจุบันไว้ก่อน…';
        await backupOne(meta);
        await backend.restoreShop(shopId, bk, (p) => { $('#rsState').textContent = `กำลังกู้คืน… ${Math.round(p * 100)}%`; });
        toast('กู้คืนเรียบร้อย'); location.hash = 'sale'; await enterShop(shopId);
      } catch (ex) { $('#rsState').textContent = ''; $('#rsInfo').insertAdjacentHTML('beforeend', `<div class="err">กู้คืนไม่สำเร็จ: ${esc(ex.message)}</div>`); btn.disabled = false; }
    });
  });

  $('#delShop')?.addEventListener('click', () => {
    const name = settings.label || settings.name || shopId;
    openDialog(`<h2 style="color:var(--red)">ลบร้าน "${esc(name)}" ถาวร</h2>
      <ol style="margin:0;padding-left:20px;line-height:1.7"><li>ระบบจะสำรองข้อมูลร้านนี้ลงเครื่องก่อน</li><li>แล้วลบข้อมูลทั้งหมดของร้านนี้ออกจากระบบ กู้จากระบบไม่ได้ (กู้ได้จากไฟล์สำรองเท่านั้น)</li></ol>
      <label class="field">พิมพ์ชื่อร้าน <span class="mono">${esc(name)}</span> เพื่อยืนยัน<input type="text" name="confirm" autocomplete="off" required></label>
      <div class="muted" id="delState" style="font-size:14px"></div>
      <div class="err hidden dlg-err"></div>
      <div class="row"><button class="btn warn" value="ok">สำรองแล้วลบถาวร</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></div>`, async (f) => {
      if (f.confirm.value.trim() !== name) throw new Error('ชื่อร้านไม่ตรง');
      $('#delState').textContent = 'กำลังสำรองข้อมูล…';
      const r = await backupOne(meta);
      $('#delState').textContent = `สำรองแล้ว (${r.where}) · กำลังลบ…`;
      await backend.deleteShop(shopId, (p) => { $('#delState').textContent = `สำรองแล้ว · กำลังลบ… ${Math.round(p * 100)}%`; });
      toast(`ลบร้าน ${name} แล้ว · ไฟล์สำรอง: ${r.where}`);
      if (backend.mode === 'cloud') { leaveShop(); location.hash = ''; viewShopPicker(); } else { location.hash = 'sale'; await enterShop(shopId); }
    });
  });
}

// ---------------- settings ----------------
function viewSettings() {
  const editable = canEditSettings();
  view.innerHTML = `<section class="card">
    <h2>ตั้งค่าร้าน</h2>
    ${editable ? '' : `<div class="note">${user.role === 'admin' ? (settings.name ? 'เจ้าของร้านเป็นคนตั้งค่าหน้านี้ แอดมินใหญ่ดูได้อย่างเดียว' : 'ร้านนี้ยังไม่ได้ตั้งค่า · สร้างรหัสเจ้าของร้านที่เมนู "รหัสพนักงาน" แล้วให้เจ้าของร้านเข้ามาตั้งเอง') : 'เฉพาะเจ้าของร้านแก้ได้'}</div>`}
    <form id="sf" style="display:flex;flex-direction:column;gap:12px">
      <label class="field">ชื่อเรียกร้าน (ใช้ในระบบ เช่น ร้านปุ๋ย)<input type="text" name="label" value="${esc(settings.label)}"></label>
      <label class="field">ชื่อร้าน (หัวบิล)<input type="text" name="name" value="${esc(settings.name)}" required></label>
      <label class="field">ที่อยู่<textarea name="address">${esc(settings.address)}</textarea></label>
      <div class="form-grid">
        <label class="field">เบอร์โทร<input type="tel" name="phone" value="${esc(settings.phone)}"></label>
        <label class="field">เลขผู้เสียภาษี (ไม่ใส่ก็ได้)<input type="text" name="taxId" value="${esc(settings.taxId)}"></label>
      </div>
      <div class="form-grid">
        <label class="field">รหัสหน้าเลขที่บิล<input type="text" name="prefix" value="${esc(settings.prefix)}" maxlength="4" placeholder="01"></label>
        <label class="field">ดอกเบี้ยเริ่มต้น<select name="defaultRate">${RATES.map((r) => `<option value="${r}" ${r === settings.defaultRate ? 'selected' : ''}>${r}%</option>`).join('')}</select></label>
      </div>
      <label class="field">ปลอดดอกเริ่มต้น (บิลงานขาย)<select name="defaultGraceMonths">${GRACE_MONTHS.map((m) => `<option value="${m}" ${m === settings.defaultGraceMonths ? 'selected' : ''}>${m} เดือน</option>`).join('')}</select></label>
      <div class="muted" style="font-size:14px">ตัวอย่างเลขที่บิล: <span class="mono" id="pfx"></span></div>
      ${editable ? '<div class="row"><button class="btn primary">บันทึก</button></div>' : ''}
    </form>
  </section>
  <section class="card">
    <h2>ข้อมูลร้านนี้</h2>
    <div class="stats">
      <div class="stat"><div class="k">ลูกค้า</div><div class="v">${data.customers.length}</div></div>
      <div class="stat"><div class="k">สินค้า</div><div class="v">${liveProducts().length}</div></div>
      <div class="stat"><div class="k">บิลค้าง</div><div class="v">${data.bills.filter((b) => b.status === 'open').length}</div></div>
    </div>
    ${backend.mode === 'local' ? '<div class="note">โหมดทดสอบ: ข้อมูลเก็บในเบราว์เซอร์ของเครื่องนี้เท่านั้น</div>' : ''}
  </section>`;
  const f = $('#sf');
  if (!editable) $$('input, textarea, select', f).forEach((el) => { el.disabled = true; });
  const ex = () => { const t = todayIso(); $('#pfx').textContent = (f.prefix.value.trim() ? f.prefix.value.trim() + '-' : '') + 'BS' + String(+t.slice(0, 4) + 543).slice(2) + t.slice(5, 7) + t.slice(8) + '0001'; };
  f.prefix.addEventListener('input', ex); ex();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!canEditSettings()) return;
    const v = Object.fromEntries(new FormData(f));
    const next = { ...settings, label: v.label.trim(), name: v.name.trim(), address: v.address.trim(), phone: v.phone.trim(), taxId: v.taxId.trim(), prefix: v.prefix.trim(), defaultRate: Number(v.defaultRate), defaultGraceMonths: Number(v.defaultGraceMonths) };
    try { await backend.saveSettings(shopId, next); } catch (ex2) { toast(ex2.message); return; }
    settings = next; resetCart(); toast('บันทึกการตั้งค่าแล้ว'); render();
  });
}

start();
