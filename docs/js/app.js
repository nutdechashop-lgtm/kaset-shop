// Main program: sign in, pick shop, sales, debtors & payments, bill search, customers, products,
// staff codes, import from the old program, shop settings.
// Data goes through a backend: Firebase (default) or this browser only (?local=1, for testing).
import { overdueBills, bankList, shopSnapshot, bahtText, RATES, GRACE_MONTHS, todayIso, customerDebts, nextCustomerCode, nextProductCode, zones, daySummary, billLockReason, diffLines, receiptLockReason, isLow, lowStock, MIN_PRESETS, stalePayers, closeSummary, salesReport } from './shop.js';
import { round2, allocatePayment, billBalance, daysBetween, interestStart, addDays } from './interest.js';
import { getBackupDir, setBackupDir } from './store.js';

const backend = withAudit(await import(new URLSearchParams(location.search).has('local') ? './backend-local.js' : './backend-cloud.js'));

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
const APP_NAME = 'DREAMSHOP_KASET';
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
  ['home', 'หน้าแรก', true], ['sale', 'ขาย'], ['debt', 'ลูกหนี้ / รับชำระ'], ['bills', 'ค้นหาบิล'], ['customers', 'ลูกค้า'], ['products', 'สินค้า'], ['stock', 'สต๊อก / โอน'], ['close', 'ปิดร้าน'],
  ['report', 'รายงาน', true], ['approve', 'รออนุมัติ', true], ['bank', 'ลูกหนี้ส่งธนาคาร', true], ['users', 'รหัสพนักงาน', true], ['backup', 'นำเข้า / สำรองข้อมูล', true], ['settings', 'ตั้งค่าร้าน', true],
];
// Sub-pages that light up a main menu item.
// Line icons (24px) used by the phone tab bar and big buttons.
const ICON = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1Z"/>',
  sale: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l2.7 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6"/>',
  debt: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M17 11h5M19.5 8.5v5"/>',
  stock: '<path d="M21 8 12 3 3 8v8l9 5 9-5Z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  close: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/>',
  pay: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="2.5"/><path d="M6 12.5h.01M18 12.5h.01"/>',
  bills: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
  more: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 8v8M11 8v8M15 8v8M18 8v8"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/>',
};
const icon = (k, size = 24) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || ''}</svg>`;
// Phone: a tab bar at the bottom with the 4 most used pages; everything else is under "เมนู".
function phoneTabs() { return isManager() ? [['home', 'หน้าแรก'], ['sale', 'ขาย'], ['debt', 'ลูกหนี้'], ['stock', 'สต๊อก']] : [['sale', 'ขาย'], ['debt', 'ลูกหนี้'], ['stock', 'สต๊อก'], ['close', 'ปิดร้าน']]; }
function drawTabbar() {
  const bar = $('#tabbar'); if (!bar) return;
  if (!shop || !isPhone()) { bar.innerHTML = ''; document.body.classList.remove('has-tabbar'); return; }
  document.body.classList.add('has-tabbar');
  const top = NAV_PARENT[current] || current;
  const pending = pendingRequests().length;
  bar.innerHTML = phoneTabs().map(([k, t]) => `<a href="#${k}" ${top === k ? 'aria-current="page"' : ''}>${icon(k === 'close' ? 'close' : k)}<span>${t}</span></a>`).join('')
    + `<button type="button" id="moreBtn" ${phoneTabs().some(([k]) => k === top) ? '' : 'aria-current="page"'}>${icon('more')}<span>เมนู</span>${pending && isManager() ? `<i class="dot">${pending}</i>` : ''}</button>`;
  $('#moreBtn').onclick = openMenuSheet;
}
function openMenuSheet() {
  const tabs = new Set(phoneTabs().map(([k]) => k));
  const pending = pendingRequests().length;
  const items = [['search', 'ค้นหา'], ...NAV.filter(([k, , mgr]) => (!mgr || isManager()) && !tabs.has(k))];
  const f = openDialog(`<div class="sheet-head"><div><b>${esc(user.name)}</b> <span class="muted">· ${ROLE[user.role] || ''}</span></div><div class="muted" style="font-size:13px">${esc(settings.name || settings.label || '')}</div></div>
    ${user.role === 'admin' ? `<label class="field">ดูโปรแกรมในมุมมองของ<select id="sheetViewAs">${[['', 'แอดมินใหญ่'], ['owner', 'เจ้าของร้าน'], ['staff', 'พนักงาน']].map(([v, t]) => `<option value="${v}" ${v === viewAs ? 'selected' : ''}>${t}</option>`).join('')}</select></label>` : ''}
    <div class="sheet-list">${items.map(([k, t]) => `<a href="#${k}" data-go>${t}${k === 'approve' && pending ? ` <span class="badge">${pending}</span>` : ''}<span class="chev">${icon('chev', 20)}</span></a>`).join('')}</div>
    <div class="row">${user.role === 'admin' || shops.length > 1 ? '<button type="button" class="btn" id="sheetShop">เปลี่ยนร้าน</button>' : ''}${backend.mode === 'cloud' ? '<button type="button" class="btn" id="sheetOut">ออกจากระบบ</button>' : ''}<button class="btn" value="cancel">ปิด</button></div>`);
  $$('[data-go]', f).forEach((a) => a.addEventListener('click', () => dlg.close()));
  $('#sheetViewAs', f)?.addEventListener('change', (e) => { viewAs = e.target.value; lsSet('viewAs', viewAs); dlg.close(); render(); });
  $('#sheetShop', f)?.addEventListener('click', () => { dlg.close(); leaveShop(); viewShopPicker(); });
  $('#sheetOut', f)?.addEventListener('click', async () => { if (!confirm('ออกจากระบบ?')) return; dlg.close(); leaveShop(); await backend.signOut(); user = null; start(); });
  dlg.classList.add('sheet'); dlg.addEventListener('close', () => dlg.classList.remove('sheet'), { once: true });
}

const NAV_PARENT = { paid: 'debt', overdue: 'debt', stale: 'debt', bill: 'bills', import: 'backup', prices: 'products', search: 'search' };
const isPhone = () => window.matchMedia('(max-width: 700px)').matches;
// Where each person lands: owners/admin → home, staff on a phone → stock, staff on a computer → sale.
const defaultPage = () => (isManager() ? 'home' : isPhone() ? 'stock' : 'sale');
function drawHeader() {
  const inShop = !!shop;
  const pending = inShop ? pendingRequests().length : 0;
  $('#nav').innerHTML = inShop ? NAV.filter(([, , mgr]) => !mgr || isManager()).map(([k, t]) => `<a href="#${k}">${t}${k === 'approve' && pending ? ` <span class="badge">${pending}</span>` : ''}</a>`).join('') : '';
  $('#shopName').textContent = inShop ? (settings.name || settings.label || APP_NAME) : APP_NAME;
  const nAlert = alertsOn() ? currentAlerts().count : 0;
  $('#bell')?.remove(); $('#netPill')?.remove(); $('#hdrSearch')?.remove();
  if (inShop && isPhone()) $('#shopName').insertAdjacentHTML('afterend', `<a id="hdrSearch" class="bell" href="#search" aria-label="ค้นหา">${icon('search', 22)}</a>`);
  if (inShop) {
    const pend = backend.pendingCount?.(shopId) || 0, off = navigator.onLine === false;
    if (off || pend) $('#shopName').insertAdjacentHTML('afterend', `<span id="netPill" class="pill" style="background:${off ? 'var(--red)' : 'var(--orange)'};color:#fff;margin-left:6px" title="บิลที่ขายตอนไม่มีเน็ตเก็บไว้ในเครื่องนี้ จะส่งขึ้นระบบเองเมื่อเน็ตกลับ">${off ? 'ไม่มีอินเทอร์เน็ต · ขายได้ตามปกติ' : ''}${off && pend ? ' · ' : ''}${pend ? `รอส่งขึ้นระบบ ${pend} บิล` : ''}</span>`);
  }
  if (typeof drawImportBadge === 'function') setTimeout(drawImportBadge, 0);
  if (alertsOn()) $('#shopName').insertAdjacentHTML('afterend', `<a id="bell" class="bell" href="#home" aria-label="แจ้งเตือน ${nAlert} รายการ"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6zm0 19a3 3 0 0 0 3-3H9a3 3 0 0 0 3 3z" fill="currentColor"/></svg>${nAlert ? `<span class="badge">${nAlert}</span>` : ''}</a>`);
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
const routes = { home: viewHome, stock: viewStock, bank: viewBank, paid: viewPaid, overdue: viewOverdue, stale: viewStale, close: viewClose, report: viewReport, prices: viewPrices, search: viewSearch, backup: viewBackup, bill: viewBillEdit, approve: viewApprove, sale: viewSale, debt: viewDebt, bills: viewBills, customers: viewCustomers, products: viewProducts, users: viewUsers, import: viewImport, settings: viewSettings };
let current = 'sale';
function render() {
  if (!shop) return;
  let [name, arg] = (location.hash.slice(1) || defaultPage()).split('/');
  if (!routes[name] || (NAV.find((n) => n[0] === (NAV_PARENT[name] || name))?.[2] && !isManager())) name = defaultPage();
  current = name;
  drawHeader(); markNav();
  $('#today').textContent = 'วันที่ ' + thDate(todayIso());
  routes[name](arg ? decodeURIComponent(arg) : undefined);
}
function markNav() { drawTabbar(); const top = NAV_PARENT[current] || current; $$('#nav a').forEach((a) => { if (a.getAttribute('href') === '#' + top) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }); }
window.addEventListener('hashchange', render);
const pendingRequests = () => (data?.requests || []).filter((r) => r.status === 'pending' && (r.kind !== 'costPin' || (user?.role === 'admin' && !previewing())));

// Data changed on another device: refresh list screens (never while someone is typing or a dialog is open).
function onRemoteChange(kind) {
  if (kind === 'settings') { settings = shop.settings; drawHeader(); return; }
  checkAlerts().catch(() => {});
  if (current !== 'approve') drawHeader(), markNav();
  if (dlg.open || ['sale', 'import', 'settings', 'users', 'bank', 'backup', 'report', 'close'].includes(current)) return;
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
    <img src="icons/logo.png" alt="${APP_NAME}" class="login-logo" width="132" height="132"><div class="app-title">${APP_NAME}</div>
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
    ${shops.length ? `<div style="display:flex;flex-direction:column;gap:8px">${shops.map((s) => `<button class="btn shop-btn" data-shop="${esc(s.id)}">
      <span class="row" style="justify-content:space-between;width:100%"><span><b>${esc(s.label || s.name || s.id)}</b> <span class="muted">${esc(s.name && s.label ? s.name : '')}</span></span><span class="mono muted">${esc(s.prefix || '')}${s.id === last ? ' · ล่าสุด' : ''}</span></span>
      ${user.role === 'admin' ? `<span class="ov" data-ov="${esc(s.id)}"><span class="spinner"></span></span>` : ''}</button>`).join('')}</div>
      ${user.role === 'admin' && shops.length > 1 ? '<div class="stat ov-total" id="ovTotal"></div>' : ''}`
      : '<div class="muted">ยังไม่มีร้าน เพิ่มร้านแรกด้านล่าง</div>'}
    ${user.role === 'admin' ? `<form id="nf" class="row" style="margin-top:8px"><input type="text" name="label" placeholder="ชื่อเรียกร้าน เช่น ร้านปุ๋ย" required style="flex:1;min-width:200px"><button class="btn primary">+ เพิ่มร้าน</button></form>
      <div class="muted" style="font-size:13px">เพิ่มร้านแล้วสร้างรหัสเจ้าของร้าน · เจ้าของร้านเป็นคนตั้งชื่อร้าน ที่อยู่ และหัวบิลเอง</div>` : ''}
    <div class="err hidden" id="perr"></div>
  </section>`;
  $$('[data-shop]').forEach((b) => b.addEventListener('click', () => enterShop(b.dataset.shop)));
  // Super-admin: today and debts of every shop at a glance.
  if (user.role === 'admin' && shops.length) {
    const tot = { sales: 0, paid: 0, debt: 0, pending: 0 };
    let done = 0;
    for (const sh of shops) {
      backend.shopOverview(sh.id).then((o) => {
        const sales = o.today.cash + o.today.credit;
        Object.assign(tot, { sales: tot.sales + sales, paid: tot.paid + o.today.paid, debt: tot.debt + o.debt, pending: tot.pending + o.pending });
        const el = $(`[data-ov="${sh.id}"]`);
        if (el) el.innerHTML = `<span>ขายวันนี้ <b>${money(sales)}</b></span><span>รับชำระ <b>${money(o.today.paid)}</b></span><span>ลูกหนี้ <b>${money(o.debt)}</b> (${o.debtors} คน)</span>${o.overdue ? `<span>ค้างเกิน 6 เดือน <b>${o.overdue}</b> บิล</span>` : ''}${o.pending ? `<span class="badge">${o.pending} รออนุมัติ</span>` : ''}`;
      }).catch((e) => { const el = $(`[data-ov="${sh.id}"]`); if (el) el.textContent = 'โหลดสรุปไม่ได้: ' + e.message; })
        .finally(() => { if (++done === shops.length && $('#ovTotal')) $('#ovTotal').innerHTML = `<b>รวมทุกร้าน</b><span>ขายวันนี้ <b>${money(tot.sales)}</b></span><span>รับชำระ <b>${money(tot.paid)}</b></span><span>ลูกหนี้รวม <b>${money(tot.debt)}</b></span>${tot.pending ? `<span>รออนุมัติ <b>${tot.pending}</b></span>` : ''}`; });
    }
  }
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
  checkAlerts().catch(() => {});
  backend.flushPending?.(shopId).catch(() => {});
}
function leaveShop() { backend.closeShop(); shop = null; data = null; shopId = null; drawHeader(); drawTabbar(); }

// ---------------- printing (same layout as the old program's bills: A5 landscape, A4 when long) ----------------
// Always an A4 portrait page (no printer settings to change). A bill that fits goes in the top half
// (prints on half an A4 or an A5 put in sideways); a bill too long for that uses the whole A4.
function doPrint(html, forceA4) {
  const area = $('#printArea');
  area.className = ''; area.innerHTML = html;
  // The bill font loads only when first used; printing before it arrives gives blank text.
  const fontsReady = Promise.all(['15px Sarabun', 'bold 15px Sarabun'].map((f) => document.fonts?.load(f, 'ใบเสร็จ ABC 0123456789').catch(() => null)))
    .then(() => document.fonts?.ready);
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 2500))]).then(() => {
    area.className = forceA4 || !fitsHalf(area) ? 'a4' : '';
    setTimeout(() => window.print(), 80);
  });
}
// Lay the bill out off-screen at its natural height and check it fits in the top half of the page.
function fitsHalf(area) {
  const paper = $('.paper', area); if (!paper) return true;
  const keep = area.style.cssText;
  area.style.cssText = 'display:block;position:absolute;left:-10000px;top:0;visibility:hidden';
  paper.style.height = 'auto';
  const mm = paper.getBoundingClientRect().height * 25.4 / 96;
  paper.style.height = ''; area.style.cssText = keep;
  return mm <= 135;
}
const dt = (iso) => { if (!iso) return ''; const d = new Date(iso); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear() + 543} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const dd = (iso) => { if (!iso) return ''; const [y, m, d] = iso.split('-'); return `${d}/${m}/${+y + 543}`; };
function paperHead(title, right) {
  const addr = [settings.address, settings.phone ? 'โทร ' + settings.phone : ''].filter(Boolean).join(' · ');
  return `<div class="p-head"><div><div class="p-shop">${esc(settings.name || '[ชื่อร้าน]')}</div><div>${esc(addr)}</div>${settings.taxId ? `<div>เลขประจำตัวผู้เสียภาษี ${esc(settings.taxId)}</div>` : ''}</div>
    <div class="p-right"><div class="p-title">${title}</div>${right}</div></div>`;
}
function custBox(code, rightHtml) {
  const c = custBy().get(code);
  const left = c ? `<div><b>รหัสลูกค้า</b> (${esc(c.code)}) ${esc(c.name)}</div><div><b>ที่อยู่</b> ${esc(c.zone || '-')}${c.phone ? ` · <b>โทร</b> ${esc(c.phone)}` : ''}</div>`
    : '<div><b>ลูกค้า</b> ลูกค้าทั่วไป</div>';
  return `<div class="p-box"><div class="p-cell">${left}</div><div class="p-cell p-side">${rightHtml}</div></div>`;
}
function printBill(bill) {
  const qtyTotal = round2(bill.lines.reduce((s, l) => s + l.qty, 0));
  const lastEdit = bill.editHistory?.at(-1);
  const html = `<div class="paper">
    ${paperHead('ใบส่งสินค้า / ใบแจ้งหนี้',
      `${bill.edits ? `<div class="p-edit">แก้ไขครั้งที่ ${bill.edits}${lastEdit?.at ? ' · ' + dt(lastEdit.at).slice(0, 16) : ''}</div>` : ''}
       <div>${bill.edits ? 'วันที่ออกบิล' : 'วันที่'} ${bill.createdAt && bill.createdAt.slice(0, 10) <= bill.date ? dt(bill.createdAt) : dd(bill.date)}</div>`)}
    ${custBox(bill.customerCode, `<div class="p-split"><span><b>เลขที่</b> ${esc(bill.no)}</span><b>${bill.type === 'credit' ? 'เงินเชื่อ' : 'เงินสด'}</b></div>
       <div><b>พนักงานขาย</b> ${esc(bill.by || '-')}</div>`)}
    <table class="p-table"><thead><tr><th class="c" style="width:9mm">ลำดับ</th><th>รายการ</th><th style="width:22mm">จำนวน</th><th class="r" style="width:20mm">ราคา</th><th class="r" style="width:16mm">ส่วนลด</th><th class="r" style="width:24mm">จำนวนเงิน</th></tr></thead>
    <tbody>${bill.lines.map((l, i) => `<tr><td class="c">${i + 1}.</td><td>${esc(l.name)}</td><td>${qtyFmt(l.qty)} ${esc(l.unit)}</td><td class="r">${money(l.price)}</td><td class="r"></td><td class="r">${money(l.amount)}</td></tr>`).join('')}</tbody></table>
    <div class="p-box p-sum">
      <div class="p-notes"><div class="p-remark">หมายเหตุ :</div><div class="p-words">(${bahtText(bill.total)})</div></div>
      <div class="p-cell p-count"><div>รวมสินค้า</div><b>${qtyFmt(qtyTotal)}</b></div>
      <div class="p-cell p-totals"><div class="p-split"><span>จำนวนเงิน</span><span>${money(bill.subtotal)}</span></div>
        ${bill.discount ? `<div class="p-split"><span>หัก ส่วนลด</span><span>${money(bill.discount)}</span></div>` : ''}
        <div class="p-split p-grand"><span>รวมทั้งสิ้น</span><span>${money(bill.total)}</span></div></div>
    </div>
    <div class="p-sign four"><div>ผู้รับสินค้า</div><div>ผู้ส่งสินค้า</div><div>ผู้อนุมัติ</div><div>ผู้ออกบิล</div></div>
  </div>`;
  doPrint(html);
}
function printReceipt(r) {
  // Receipts made before the program stored the owed amounts fall back to the paid amounts.
  const rows = r.owed || r.rows;
  const sum = (k) => round2(rows.reduce((s, x) => s + (x[k] || 0), 0));
  const owedTotal = r.owedTotal ?? sum('total');
  const html = `<div class="paper">
    ${paperHead('ใบเสร็จรับเงิน', `<div>วันที่ ${r.createdAt ? dt(r.createdAt) : dd(r.date)}</div>`)}
    ${custBox(r.customerCode, `<div><b>เลขที่</b> ${esc(r.no)}</div><div><b>คิดดอกเบี้ยถึงวันที่</b> ${dd(r.date)}</div><div><b>รับเงินโดย</b> ${esc(r.by || '-')}</div>`)}
    <table class="p-table"><thead><tr><th class="c" style="width:9mm">ลำดับ</th><th>บิลอ้างอิง</th><th style="width:28mm">วันที่บิล</th><th class="r" style="width:26mm">เงินต้น</th><th class="r" style="width:24mm">ดอกเบี้ย</th><th class="r" style="width:26mm">รวม</th></tr></thead>
    <tbody>${rows.map((x, i) => `<tr><td class="c">${i + 1}.</td><td>${esc(x.no)}</td><td>${dd(x.date)}</td><td class="r">${money(x.principal)}</td><td class="r">${money(x.interest)}</td><td class="r"><b>${money(x.total)}</b></td></tr>${(() => { const it = x.items || billItems(data.bills.find((b) => b.no === x.no)); return it.length ? `<tr class="p-items"><td></td><td colspan="5">${it.map((l) => `${esc(l.name)} ${qtyFmt(l.qty)} ${esc(l.unit)} = ${money(l.amount)}`).join(' · ')}</td></tr>` : ''; })()}`).join('')}
      <tr class="p-foot"><td colspan="3" class="r">${r.owed ? 'รวมยอดค้าง' : 'รวม'}</td><td class="r">${money(sum('principal'))}</td><td class="r">${money(sum('interest'))}</td><td class="r">${money(owedTotal)}</td></tr></tbody></table>
    <div class="p-box p-sum">
      <div class="p-notes"><div class="p-remark">หมายเหตุ :</div><div class="p-words">(${bahtText(r.total)})</div></div>
      <div class="p-cell p-totals" style="width:62mm">
        ${r.owed ? `<div class="p-split"><span>ยอดค้างรวม</span><span>${money(owedTotal)}</span></div>` : ''}
        <div class="p-split p-grand"><span>รับชำระครั้งนี้</span><span>${money(r.total)}</span></div>
        ${r.owed ? `<div class="p-split p-rest"><span>ยอดคงค้าง</span><span>${money(r.remaining)}</span></div>` : ''}
      </div>
    </div>
    <div class="p-sign two"><div>ผู้จ่ายเงิน</div><div>ผู้รับเงิน</div></div>
  </div>`;
  doPrint(html);
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
const cart = { lines: [], type: 'cash', customerCode: '', rate: 2, grace: false, graceMonths: 4, discount: 0, received: 0, date: '' };
function resetCart() { Object.assign(cart, { lines: [], type: 'cash', customerCode: '', rate: settings?.defaultRate ?? 2, grace: false, graceMonths: settings?.defaultGraceMonths ?? 4, discount: 0, received: 0, date: '' }); }

const liveProducts = () => data.products.filter((p) => !p.deleted);
function searchProducts(q) {
  const n = norm(q); if (!n) return [];
  return liveProducts().filter((p) => norm(p.name).includes(n) || p.code.startsWith(q.trim()) || (p.barcode && p.barcode === q.trim())).slice(0, 30);
}
function searchCustomers(q) {
  const n = norm(q); if (!n) return [];
  return data.customers.filter((c) => norm(c.name).includes(n) || norm(c.zone).includes(n) || c.code.startsWith(q.trim())).slice(0, 20);
}

// Products this shop sells most (last 35 days), for one-tap adding.
function favHtml() {
  const qty = new Map();
  for (const b of data.bills) if (b.status !== 'cancelled' && b.source !== 'programkaset') for (const l of b.lines || []) qty.set(l.code, (qty.get(l.code) || 0) + 1);
  const live = new Map(liveProducts().map((p) => [p.code, p]));
  let top = [...qty.entries()].filter(([c]) => live.has(c)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([c]) => live.get(c));
  if (top.length < 3) return '';
  return `<div class="fav"><div class="fav-h">ขายบ่อย · แตะเพื่อเพิ่ม</div><div class="fav-grid">${top.map((p) => `<button type="button" data-fav="${esc(p.code)}"><span>${esc(p.name)}</span><b class="mono">${p.price ? money(p.price) : '-'}</b></button>`).join('')}</div></div>`;
}
// Camera barcode scanning (Chrome on Android). Calls done(code) once.
async function scanBarcode(done) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); } catch { toast('เปิดกล้องไม่ได้ · อนุญาตการใช้กล้องในเบราว์เซอร์ก่อน'); return; }
  const det = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
  const f = openDialog(`<h2>สแกนบาร์โค้ด</h2><video id="scanVid" playsinline muted style="width:100%;border-radius:14px;background:#000;max-height:50vh;object-fit:cover"></video>
    <div class="muted" style="font-size:14px">เล็งกล้องไปที่บาร์โค้ดบนสินค้า</div><div class="row"><button class="btn" value="cancel">ปิด</button></div>`);
  const v = $('#scanVid', f); v.srcObject = stream; await v.play().catch(() => {});
  let live = true;
  const stop = () => { live = false; stream.getTracks().forEach((t) => t.stop()); };
  dlg.addEventListener('close', stop, { once: true });
  const tick = async () => {
    if (!live) return;
    try { const r = await det.detect(v); if (r[0]?.rawValue) { stop(); dlg.close(); done(r[0].rawValue); return; } } catch { /* keep trying */ }
    setTimeout(tick, 250);
  };
  tick();
}
function viewSale() {
  backend.reserveNumbers?.(shopId, settings).catch(() => {}); // so this computer can keep selling if the internet drops
  const today = daySummary(data, todayIso());
  view.innerHTML = `
  ${!liveProducts().length ? `<div class="note">ยังไม่มีสินค้าในร้านนี้ · ${isManager() ? '<a href="#import">นำเข้าข้อมูลจากโปรแกรมเก่า</a> หรือ' : ''} เพิ่มสินค้าที่เมนู <a href="#products">สินค้า</a></div>` : ''}
  <div class="grid-sale">
    <section class="card">
      <label class="field">ค้นหาสินค้า (พิมพ์ชื่อหรือยิงบาร์โค้ด แล้วกด Enter)
        <span class="row" style="gap:8px;flex-wrap:nowrap"><input type="search" id="pq" placeholder="เช่น ปุ๋ย, ยาฆ่าหญ้า" autocomplete="off" style="flex:1;min-width:0">
        ${'BarcodeDetector' in window ? `<button type="button" class="icon-btn scan-btn" id="scanBtn" aria-label="สแกนบาร์โค้ดด้วยกล้อง">${icon('scan', 24)}</button>` : ''}</span>
      </label>
      <div class="results hidden" id="pres"></div>
      ${favHtml()}
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
      <label class="field">วันที่ขาย <span class="muted" style="font-weight:400">(ลงย้อนหลังได้${isManager() ? '' : ' ไม่เกิน 7 วัน'})</span>
        <input type="date" id="sdate" value="${cart.date || todayIso()}" max="${todayIso()}" ${isManager() ? '' : `min="${addDays(todayIso(), -7)}"`}></label>
      <div id="backHint"></div>
      <label class="field">ส่วนลด (บาท)<input type="number" id="disc" min="0" step="0.01" value="${cart.discount || ''}" placeholder="0"></label>
      <div>
        <div class="total-box"><span>รวม</span><span class="mono" id="sub"></span></div>
        <div class="total-box big"><span>สุทธิ</span><span class="mono" id="net"></span></div>
      </div>
      ${cart.type === 'cash' ? `<div class="cash-box">
        <label class="field">รับเงินมา (บาท)<input type="number" id="recv" min="0" step="0.01" inputmode="decimal" value="${cart.received || ''}" placeholder="ใส่เงินที่ลูกค้าให้" autocomplete="off"></label>
        <div class="quick" id="quick"></div>
        <div class="change" id="change"></div>
      </div>` : ''}
      ${cart.type === 'credit' ? `<div class="grace-box">
        <label class="row" style="font-weight:600;min-height:44px;gap:8px"><input type="checkbox" id="grace" ${cart.grace ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--green)"> ปลอดดอก</label>
        <select id="graceMonths" aria-label="ปลอดดอกกี่เดือน" ${cart.grace ? '' : 'disabled'}>${GRACE_MONTHS.map((m) => `<option value="${m}" ${m === cart.graceMonths ? 'selected' : ''}>${m} เดือน</option>`).join('')}</select>
      </div>` : ''}
      <div class="err hidden" id="saleErr"></div>
      <button class="btn primary" id="save" style="justify-content:center">บันทึกการขาย</button>
      <button class="btn" id="clear" style="justify-content:center">ล้างรายการ</button>
    </aside>
  </div>
  <div class="sale-bar"><div><small>รวมทั้งสิ้น</small><b class="mono" id="barNet">0.00</b></div><button type="button" class="btn primary" id="barSave">บันทึกการขาย</button></div>
  <section class="card sale-today">
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
    pq.value = ''; showResults(); drawLines(); if (!isPhone()) pq.focus(); // on a phone, don't pop the keyboard up after each tap
  };
  pq.addEventListener('input', showResults);
  pq.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!found.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + found.length) % found.length;
      $$('button', pres).forEach((b, i) => b.classList.toggle('active', i === active));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const bc = pq.value.trim(), hit = bc && liveProducts().find((p) => p.barcode && p.barcode === bc);
      if (hit) add(hit.code); else if (found[active]) add(found[active].code);
    }
  });
  $$('[data-fav]').forEach((b) => b.addEventListener('click', () => add(b.dataset.fav)));
  $('#scanBtn')?.addEventListener('click', () => scanBarcode((code) => {
    const hit = liveProducts().find((p) => p.barcode === code);
    if (hit) { add(hit.code); toast('เพิ่ม ' + hit.name); } else { pq.value = code; showResults(); toast('ไม่พบสินค้าที่มีบาร์โค้ด ' + code + ' · ใส่บาร์โค้ดได้ที่หน้าแก้ไขสินค้า'); }
  }));
  $('#barSave').addEventListener('click', () => $('#save').click());
  pres.addEventListener('click', (e) => { const b = e.target.closest('[data-code]'); if (b) add(b.dataset.code); });

  function drawLines() {
    const pm = new Map(data.products.map((p) => [p.code, p]));
    if (isPhone()) {
      $('#lines').innerHTML = cart.lines.length ? `<tr><th colspan="2">ในบิล ${cart.lines.length} รายการ</th></tr>` + cart.lines.map((l, i) => {
        const p = pm.get(l.code);
        return `<tr class="mline${l.price > 0 ? '' : ' noprice'}"><td><b>${esc(p?.name)}</b>
            <span class="mline-price">ราคา <input class="price${l.price > 0 ? '' : ' zero'}" type="number" min="0" step="0.01" inputmode="decimal" data-i="${i}" data-f="price" value="${l.price || ''}" placeholder="ใส่ราคา" aria-label="ราคาต่อหน่วย"> / ${esc(p?.unit)}</span></td>
          <td><div class="stepper"><button type="button" data-step="${i}" data-d="-1" aria-label="ลดจำนวน">−</button><input class="qty" type="number" min="0" step="any" inputmode="decimal" data-i="${i}" data-f="qty" value="${l.qty}" aria-label="จำนวน"><button type="button" data-step="${i}" data-d="1" aria-label="เพิ่มจำนวน">+</button></div>
            <b class="mono mline-total" data-total="${i}">${money(l.qty * l.price)}</b></td></tr>`;
      }).join('') : '<tr><td class="empty">ยังไม่มีรายการ · ค้นหา หรือแตะสินค้าขายบ่อยด้านบน</td></tr>';
      drawTotals(); return;
    }
    $('#lines').innerHTML = cart.lines.length
      ? `<tr><th>สินค้า</th><th class="num">จำนวน</th><th class="num">ราคา/หน่วย</th><th class="num">รวม</th><th></th></tr>` + cart.lines.map((l, i) => {
        const p = pm.get(l.code);
        return `<tr><td>${esc(p?.name)} <span class="muted">· ${esc(p?.unit)}</span></td>
          <td class="num"><input class="qty" type="number" min="0" step="any" data-i="${i}" data-f="qty" value="${l.qty}" aria-label="จำนวน"></td>
          <td class="num"><input class="price${l.price > 0 ? '' : ' zero'}" type="number" min="0" step="0.01" data-i="${i}" data-f="price" value="${l.price}" aria-label="ราคา"></td>
          <td class="num" data-total="${i}">${money(l.qty * l.price)}</td>
          <td><button class="btn small" data-del="${i}" aria-label="ลบรายการ">ลบ</button></td></tr>`;
      }).join('')
      : '<tr><td class="empty">ยังไม่มีรายการ ค้นหาสินค้าด้านบนเพื่อเพิ่ม</td></tr>';
    drawTotals();
  }
  function drawTotals() {
    const sub = round2(cart.lines.reduce((s, l) => s + l.qty * l.price, 0));
    const net = round2(sub - (Number(cart.discount) || 0));
    $('#sub').textContent = money(sub); $('#net').textContent = money(net);
    if ($('#barNet')) $('#barNet').textContent = money(net);
    if (cart.type === 'cash') drawCash(net);
    if (cart.type === 'credit') {
      const perDay = round2(net * cart.rate / 100 / 30);
      $('#interestHint').textContent = cart.rate ? `ดอกเบี้ยวันละ ฿${money(perDay)} (30 วัน = ฿${money(net * cart.rate / 100)})${cart.grace ? ` · ปลอดดอก ${cart.graceMonths} เดือน เริ่มคิดหลัง ${cart.graceMonths * 30} วัน` : ''}` : 'ไม่คิดดอกเบี้ย';
    }
  }
  // Cash: money the customer hands over → change. Quick buttons for exact / common round-ups.
  function drawCash(net) {
    const ups = [...new Set([20, 50, 100, 500, 1000].map((m) => Math.ceil(net / m) * m))].filter((v) => v > net).slice(0, 3);
    if (net >= 500 && !ups.includes(1000) && net < 1000) ups.push(1000);
    $('#quick').innerHTML = net > 0 ? [['พอดี', net], ...ups.map((v) => [v.toLocaleString(), v])].map(([t, v]) => `<button type="button" class="btn small" data-recv="${v}" aria-pressed="${cart.received === v}">${t}</button>`).join('') : '';
    const r = Number(cart.received) || 0, ch = $('#change');
    if (!r || !(net > 0)) { ch.className = 'change'; ch.innerHTML = ''; return; }
    if (r < net) { ch.className = 'change short'; ch.innerHTML = `<span>ยังขาด</span><b class="mono">${money(net - r)}</b>`; }
    else { ch.className = 'change ok'; ch.innerHTML = `<span>เงินทอน</span><b class="mono">${money(r - net)}</b>`; }
  }
  $('#lines').addEventListener('input', (e) => {
    const t = e.target; if (!t.dataset.f) return;
    cart.lines[+t.dataset.i][t.dataset.f] = Number(t.value) || 0;
    const l = cart.lines[+t.dataset.i];
    const tot = $(`[data-total="${t.dataset.i}"]`, $('#lines')); if (tot) tot.textContent = money(l.qty * l.price);
    if (t.dataset.f === 'price') t.classList.toggle('zero', !(l.price > 0));
    drawTotals();
  });
  $('#lines').addEventListener('click', (e) => {
    const b = e.target.closest('[data-del]'); if (b) { cart.lines.splice(+b.dataset.del, 1); drawLines(); return; }
    const st = e.target.closest('[data-step]'); if (!st) return;
    const i = +st.dataset.step, l = cart.lines[i];
    l.qty = round2((Number(l.qty) || 0) + Number(st.dataset.d));
    if (l.qty <= 0) cart.lines.splice(i, 1); // minus at 1 removes the line
    drawLines();
  });

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
  const drawBack = () => { const d = cart.date; $('#backHint').innerHTML = d && d !== todayIso() ? `<div class="note" style="font-size:13px">ลงบิลย้อนหลังเป็นวันที่ <b>${thDate(d)}</b>${cart.type === 'credit' ? ' · ดอกเบี้ยเริ่มนับจากวันนั้น' : ''}</div>` : ''; };
  $('#sdate').addEventListener('change', (e) => { const v = e.target.value; const min = e.target.min;
    if (!v || v > todayIso() || (min && v < min)) { e.target.value = cart.date || todayIso(); toast(min && v < min ? 'พนักงานลงย้อนหลังได้ไม่เกิน 7 วัน' : 'ลงวันที่ล่วงหน้าไม่ได้'); return; }
    cart.date = v === todayIso() ? '' : v; drawBack(); drawTotals(); });
  drawBack();
  $('#recv')?.addEventListener('input', (e) => { cart.received = Number(e.target.value) || 0; $('#saleErr').classList.add('hidden'); drawTotals(); });
  $('#recv')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#save').click(); } });
  $('#quick')?.addEventListener('click', (e) => { const b = e.target.closest('[data-recv]'); if (!b) return; cart.received = Number(b.dataset.recv); $('#recv').value = cart.received; $('#saleErr').classList.add('hidden'); drawTotals(); });
  $('#clear').addEventListener('click', () => { resetCart(); viewSale(); });
  $('#save').addEventListener('click', async () => {
    const err = $('#saleErr'); err.classList.add('hidden');
    const netNow = round2(cart.lines.reduce((s2, l) => s2 + l.qty * l.price, 0) - (Number(cart.discount) || 0));
    if (cart.type === 'cash' && cart.received && cart.received < netNow) { err.textContent = `รับเงินมายังไม่พอ ขาดอีก ฿${money(netNow - cart.received)}`; err.classList.remove('hidden'); $('#recv').focus(); return; }
    const recv = cart.type === 'cash' && cart.received ? cart.received : 0;
    const btn = $('#save'); btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> กำลังบันทึก…';
    let bill;
    try {
      bill = await backend.commitSale(shopId, settings, { date: cart.date || todayIso(), type: cart.type, customerCode: cart.customerCode, lines: cart.lines, discount: cart.discount, rate: cart.rate, graceMonths: cart.type === 'credit' && cart.grace ? cart.graceMonths : 0, by: user.name });
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false; btn.textContent = 'บันทึกการขาย'; return; }
    resetCart(); viewSale();
    openDialog(`<h2>บันทึกการขายแล้ว</h2>
      <div>เลขที่ <b class="mono">${esc(bill.no)}</b> · ${bill.type === 'credit' ? 'เงินเชื่อ' : 'เงินสด'} · <b>฿${money(bill.total)}</b></div>
      <div class="muted">${esc(custLabel(bill.customerCode))}</div>
      ${bill.pending ? '<div class="note" style="font-size:14px">ตอนนี้ไม่มีอินเทอร์เน็ต · บิลนี้<b>เก็บไว้ในเครื่องนี้แล้ว</b> พิมพ์ให้ลูกค้าได้เลย ระบบจะส่งขึ้นเองเมื่อเน็ตกลับ <b>อย่าล้างข้อมูลเบราว์เซอร์</b></div>' : ''}
      ${recv ? `<div class="change ok big"><span>รับ ${money(recv)} · ทอน</span><b class="mono">${money(recv - bill.total)}</b></div>` : ''}
      <div class="row"><button class="btn primary" value="print">พิมพ์บิล</button><button class="btn" value="cancel">ขายต่อ</button></div>`, () => { printBill(bill); });
  });
  drawLines();
  if (!isPhone()) pq.focus();
}

// ---------------- debtors ----------------
function viewDebt(code) {
  if (code) return viewDebtor(code);
  const asOf = todayIso();
  const debts = customerDebts(data, asOf);
  const cm = custBy();
  const rows = [...debts.entries()].map(([c, d]) => ({ code: c, cust: cm.get(c), ...d })).sort((a, b) => b.total - a.total);
  const tot = rows.reduce((s, r) => ({ p: s.p + r.principal, i: s.i + r.interest, t: s.t + r.total, n: s.n + r.bills.length }), { p: 0, i: 0, t: 0, n: 0 });
  view.innerHTML = `${debtTabs('debt')}
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

// What was bought on a bill, for showing beside debts and receipts.
const billItems = (b) => (b?.lines || b?.items || []).map((l) => ({ name: l.name || data.products.find((p) => p.code === l.code)?.name || l.code, qty: l.qty, unit: l.unit || '', amount: l.amount }));
const itemsHtml = (items) => (items.length ? `<div class="bill-items">${items.map((l) => `<span><b>${esc(l.name)}</b> ${qtyFmt(l.qty)} ${esc(l.unit)} <i class="mono">${money(l.amount)}</i></span>`).join('')}</div>` : '');
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
      <div style="display:flex;gap:10px;align-items:flex-start"><div><h2>${esc(c?.name || 'รหัส ' + code)}</h2><div class="muted">${esc(c?.zone)} · รหัส ${esc(code)} ${c?.phone ? '· โทร ' + esc(c.phone) : ''}</div></div>
        ${c?.phone ? `<a class="icon-btn call-btn" href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}" aria-label="โทรหา ${esc(c.name)}">${icon('phone', 22)}</a>` : ''}</div>
      ${d ? `<div style="text-align:right"><div class="muted" style="font-size:14px">รวมค้างถึงวันนี้</div><div class="mono" style="font-size:26px;font-weight:700">฿${money(d.total)}</div><div class="muted" style="font-size:14px">ต้น ${money(d.principal)} + ดอก ${money(d.interest)}</div></div>` : ''}
    </div>
    ${d ? `<div class="scroll"><table id="bt"></table></div>` : '<div class="ok">ไม่มียอดค้าง</div>'}
  </section>
  ${d ? `<section class="card">
    <h2>รับชำระ</h2>
    <div class="seg" role="group" aria-label="วิธีชำระ"><button type="button" data-m="amount" aria-pressed="true">ตามจำนวนเงิน</button><button type="button" data-m="bills" aria-pressed="false">ตามบิลที่เลือก</button></div>
    <label class="field" id="amtWrap">จำนวนเงินที่รับ (บาท)<input type="number" id="amt" min="0" step="0.01" inputmode="decimal" placeholder="0.00" class="amt-big"></label>
    <div class="quick-amt" id="qamt">${[['ทั้งหมด', round2(d.total)], ...[5000, 1000, 500].filter((v) => v < d.total).map((v) => [v.toLocaleString(), v])].map(([t, v]) => `<button type="button" class="btn small" data-amt="${v}">${t}</button>`).join('')}</div>
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
      ${history.map((r) => `<tr${voidCls(r)}><td class="mono">${esc(r.no)}</td><td>${thDate(r.date)}</td><td class="num">${r.rows ? r.rows.length : ''}</td><td class="num">${r.rows ? money(r.totalPrincipal) : ''}</td><td class="num">${r.rows ? money(r.totalInterest) : ''}</td><td class="num">${money(r.total)}</td><td>${receiptCell(r)}</td></tr>`).join('')}</table></div>` : '<div class="empty">ยังไม่มี</div>';
    $$('#hist [data-rp]').forEach((b) => b.addEventListener('click', () => printReceipt(seen.get(b.dataset.rp))));
    $$('#hist [data-vr]').forEach((b) => b.addEventListener('click', () => voidReceiptDialog(seen.get(b.dataset.vr), () => viewDebtor(code))));
  }).catch((e) => { if ($('#hist')) $('#hist').innerHTML = `<div class="err">${esc(e.message)}</div>`; });
  if (!d) return;

  $('#bt').innerHTML = `<tr><th></th><th>เลขที่บิล</th><th>วันที่</th><th class="num">ดอก %</th><th class="num">วัน</th><th class="num">เงินต้น</th><th class="num">ดอกเบี้ย</th><th class="num">รวม</th><th></th></tr>`
    + d.bills.map((b) => {
      const start = b.interestFrom || interestStart(b);
      const days = daysBetween(start, asOf);
      const graceLeft = !b.interestFrom && b.graceDays && start > asOf ? `ปลอดดอกถึง ${thDate(start)}` : '';
      return `<tr><td><input type="checkbox" data-b="${esc(b.no)}" aria-label="เลือกบิล ${esc(b.no)}" style="width:22px;height:22px;accent-color:var(--green)"></td>
        <td class="mono"><button class="btn link" data-view="${esc(b.no)}">${esc(b.no)}</button></td><td>${thDate(b.date)}</td><td class="num">${b.rate}</td>
        <td class="num">${graceLeft ? `<span class="pill">${graceLeft}</span>` : days}</td>
        <td class="num">${money(b.balance.principal)}</td><td class="num">${money(b.balance.interest)}</td><td class="num"><b>${money(b.balance.total)}</b></td>
        <td>${pendingRequests().some((r) => r.billNo === b.no && r.kind === 'rate') ? '<span class="pill">รออนุมัติ</span>' : `<button class="btn small" data-rate="${esc(b.no)}" title="เปลี่ยนอัตราดอก">เปลี่ยน %</button>`}</td></tr>
        <tr class="items-row"><td></td><td colspan="8">${itemsHtml(billItems(b))}</td></tr>`;
    }).join('');
  $$('[data-view]').forEach((x) => x.addEventListener('click', () => showBill(data.bills.find((b) => b.no === x.dataset.view))));
  $$('[data-rate]').forEach((x) => x.addEventListener('click', () => rateDialog(data.bills.find((b) => b.no === x.dataset.rate), () => viewDebtor(code))));

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
      + rows.map((r) => `<tr><td><span class="mono">${esc(r.no)}</span>${itemsHtml(billItems(open.find((b) => b.no === r.no)))}</td><td class="num">${money(r.payInterest)}</td><td class="num">${money(r.payPrincipal)}</td><td class="num">${r.principalLeft > 0 ? money(r.principalLeft) : '<span class="pill cash">ปิดบิล</span>'}</td></tr>`).join('')
      + `<tr><td><b>รวม</b></td><td class="num"><b>${money(res.totalInterest)}</b></td><td class="num"><b>${money(res.totalPrincipal)}</b></td><td class="num">${res.change > 0 ? `เงินทอน <b>${money(res.change)}</b>` : ''}</td></tr>` : '';
  };
  $$('[data-m]').forEach((b) => b.addEventListener('click', () => {
    mode = b.dataset.m;
    $$('[data-m]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    $('#amtWrap').classList.toggle('hidden', mode !== 'amount'); $('#qamt')?.classList.toggle('hidden', mode !== 'amount');
    $('#billHint').textContent = mode === 'amount' ? 'ตัดดอกเบี้ยก่อน แล้วตัดเงินต้นจากบิลเก่าสุด' : 'ติ๊กเลือกบิลด้านบน ระบบจะคิดเงินต้นรวมดอกเบี้ยของบิลที่เลือก';
    preview();
  }));
  $('#amt').addEventListener('input', preview);
  $$('#qamt [data-amt]').forEach((b) => b.addEventListener('click', () => { $('#amt').value = b.dataset.amt; $$('#qamt [data-amt]').forEach((x) => x.setAttribute('aria-pressed', x === b)); preview(); }));
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
      if (r.kind === 'costPin') return `<div class="stat" style="display:flex;flex-direction:column;gap:6px;padding:14px">
        <div class="row" style="justify-content:space-between"><b>ขอดูราคาทุน</b><span class="muted" style="font-size:13px">${esc(r.byName)} · ${new Date(r.createdAt).toLocaleString('th-TH')}</span></div>
        ${r.productName ? `<div>สินค้า: ${esc(r.productName)}</div>` : ''}${r.reason ? `<div class="muted">เหตุผล: ${esc(r.reason)}</div>` : ''}
        <div class="row"><button class="btn primary small" data-pin="${esc(r.id)}" data-who="${esc(r.byName)}">ออก PIN</button><button class="btn small" data-no="${esc(r.id)}">ไม่ให้</button></div></div>`;
      if (r.kind === 'voidReceipt') return `<div class="stat" style="display:flex;flex-direction:column;gap:6px;padding:14px">
        <div class="row" style="justify-content:space-between"><b>ขอยกเลิกใบเสร็จ <span class="mono">${esc(r.receiptNo)}</span></b><span class="muted" style="font-size:13px">${esc(r.byName)} · ${new Date(r.createdAt).toLocaleString('th-TH')}</span></div>
        <div>${esc(custLabel(r.customerCode))} · รับชำระ ${r.before?.date ? thDate(r.before.date) : ''} <b>฿${money(r.before?.total)}</b> (ต้น ${money(r.before?.principal)} + ดอก ${money(r.before?.interest)})</div>
        <div class="muted" style="font-size:13px">อนุมัติแล้ว ยอดหนี้ของบิล ${esc((r.before?.bills || []).join(', '))} จะกลับไปเหมือนก่อนรับชำระ</div>
        ${r.reason ? `<div class="muted">เหตุผล: ${esc(r.reason)}</div>` : ''}
        <div class="row"><button class="btn primary small" data-ok="${esc(r.id)}">อนุมัติ</button><button class="btn small" data-no="${esc(r.id)}">ไม่อนุมัติ</button></div></div>`;
      if (r.kind === 'rate') return `<div class="stat" style="display:flex;flex-direction:column;gap:6px;padding:14px">
        <div class="row" style="justify-content:space-between"><b>ขอเปลี่ยนอัตราดอก <span class="mono">${esc(r.billNo)}</span></b><span class="muted" style="font-size:13px">${esc(r.byName)} · ${new Date(r.createdAt).toLocaleString('th-TH')}</span></div>
        <div>${esc(custLabel(r.customerCode))} · ดอก <b>${r.before?.rate}%</b> → <b>${r.changes?.rate}%</b> · เงินต้น ฿${money(r.before?.principal)}</div>
        ${r.reason ? `<div class="muted">เหตุผล: ${esc(r.reason)}</div>` : ''}
        <div class="row"><button class="btn primary small" data-ok="${esc(r.id)}">อนุมัติ</button><button class="btn small" data-no="${esc(r.id)}">ไม่อนุมัติ</button></div></div>`;
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
  $$('[data-pin]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const pin = await backend.issueCostPin(shopId, b.dataset.pin);
      openDialog(`<h2>PIN ดูราคาทุน</h2><div>แจ้ง PIN นี้ให้ <b>${esc(b.dataset.who)}</b> (ใช้ได้ครั้งเดียว ภายใน 24 ชั่วโมง)</div>
        <div class="pin-big mono">${pin}</div><div class="muted" style="font-size:13px">ปิดหน้าต่างนี้แล้วจะดู PIN อีกไม่ได้</div>
        <div class="row"><button class="btn primary" value="cancel">ปิด</button></div>`);
      dlg.addEventListener('close', () => { viewApprove(); drawHeader(); markNav(); }, { once: true });
    } catch (e) { toast(e.message); b.disabled = false; }
  }));
}

// ---------------- cancel a wrong receipt ----------------
const pendingVoid = (no) => (data?.requests || []).some((q) => q.status === 'pending' && q.kind === 'voidReceipt' && q.receiptNo === no);
// The buttons at the end of a receipt row (print / cancel / status).
function receiptCell(r) {
  if (r.status === 'void') return `<span class="badge-void" title="${esc(r.voidReason || '')}">ยกเลิกแล้ว</span>`;
  if (!r.rows) return '<span class="muted" style="font-size:13px">จากโปรแกรมเก่า</span>';
  const v = !r.before ? '' : pendingVoid(r.no) ? '<span class="badge-wait">รอยกเลิก</span>' : `<button class="btn small" data-vr="${esc(r.no)}">${isManager() ? 'ยกเลิก' : 'ขอยกเลิก'}</button>`;
  return `<div class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn small" data-rp="${esc(r.no)}">พิมพ์</button>${v}</div>`;
}
const voidCls = (r) => (r.status === 'void' ? ' class="void-row"' : '');
function voidReceiptDialog(r, done) {
  if (!r) return;
  const mgr = isManager();
  const nos = new Set(r.rows.map((x) => x.no));
  const known = data.bills.filter((b) => nos.has(b.no));
  const lock = known.length === nos.size ? receiptLockReason(r, known) : null;
  openDialog(`<h2>${mgr ? 'ยกเลิกใบเสร็จ' : 'ขอยกเลิกใบเสร็จ'} <span class="mono">${esc(r.no)}</span></h2>
    <div>${esc(custLabel(r.customerCode))} · วันที่ ${thDate(r.date)} · รับ <b>฿${money(r.total)}</b> (ต้น ${money(r.totalPrincipal)} + ดอก ${money(r.totalInterest)})</div>
    <div class="muted" style="font-size:13px">บิลที่ถูกตัด: ${r.rows.map((x) => esc(x.no)).join(', ')}</div>
    ${lock ? `<div class="err">${esc(lock)}</div><div class="row"><button class="btn" value="cancel">ปิด</button></div>` : `
    <div class="note">ยกเลิกแล้ว <b>ยอดหนี้ของบิลเหล่านี้จะกลับไปเหมือนก่อนรับชำระ</b> (ดอกเบี้ยคิดต่อจากเดิม) แล้วค่อยรับชำระใหม่ให้ถูกต้อง · ใบเสร็จเดิมยังเก็บไว้ในประวัติ ขึ้นว่า "ยกเลิกแล้ว"</div>
    <label class="field">เหตุผล <span style="color:var(--red)">*</span><input type="text" name="reason" required placeholder="เช่น ใส่ยอดผิด 5,000 ที่จริงรับ 500"></label>
    <div class="err hidden dlg-err"></div>
    <div class="row"><button class="btn primary" value="ok" style="${mgr ? 'background:var(--red);border-color:var(--red)' : ''}">${mgr ? 'ยกเลิกใบเสร็จนี้' : 'ส่งคำขอให้เจ้าของอนุมัติ'}</button><button class="btn" value="cancel" formnovalidate>ไม่ยกเลิก</button></div>`}`, async (f) => {
    const reason = f.reason.value.trim();
    if (mgr) { await backend.commitReceiptVoid(shopId, r.no, { by: user.name, reason }); toast('ยกเลิกใบเสร็จแล้ว รับชำระใหม่ได้เลย'); }
    else {
      if (pendingVoid(r.no)) throw new Error('ส่งคำขอยกเลิกใบเสร็จนี้ไปแล้ว รอเจ้าของอนุมัติ');
      await backend.createRequest(shopId, { kind: 'voidReceipt', receiptNo: r.no, customerCode: r.customerCode, before: { total: r.total, principal: r.totalPrincipal, interest: r.totalInterest, date: r.date, bills: r.rows.map((x) => x.no) }, reason, byName: user.name });
      toast('ส่งคำขอแล้ว รอเจ้าของอนุมัติ');
    }
    setTimeout(done, 0);
  });
}

// ---------------- rate change ----------------
function rateDialog(b, done) {
  if (!b) return;
  const mgr = isManager();
  openDialog(`<h2>${mgr ? 'เปลี่ยนอัตราดอก' : 'ขอเปลี่ยนอัตราดอก'} <span class="mono">${esc(b.no)}</span></h2>
    <div>${esc(custLabel(b.customerCode))} · เงินต้น ฿${money(b.principalLeft ?? b.total)} · ตอนนี้ <b>${b.rate}%</b></div>
    <label class="field">อัตราใหม่ (% ต่อ 30 วัน)<select name="rate">${RATES.filter((r) => r !== b.rate).map((r) => `<option value="${r}">${r}%</option>`).join('')}</select></label>
    <div class="muted" style="font-size:13px">อัตราใหม่ใช้กับช่วงที่ยังไม่ได้ชำระของบิลนี้ ยอดดอกจะคำนวณใหม่ทันที</div>
    <label class="field">เหตุผล ${mgr ? '<span class="muted" style="font-weight:400">(ไม่ใส่ก็ได้)</span>' : '<span style="color:var(--red)">*</span>'}<input type="text" name="reason" ${mgr ? '' : 'required'} placeholder="เช่น ลูกค้าประจำ ตกลงลดดอก"></label>
    <div class="err hidden dlg-err"></div>
    <div class="row"><button class="btn primary" value="ok">${mgr ? 'เปลี่ยนอัตรา' : 'ส่งคำขอให้เจ้าของอนุมัติ'}</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></div>`, async (f) => {
    const rate = Number(f.rate.value), reason = f.reason.value.trim();
    if (mgr) { await backend.commitBillChange(shopId, b.no, 'rate', { rate }, { by: user.name, reason }); toast(`เปลี่ยนเป็น ${rate}% แล้ว`); }
    else { await backend.createRequest(shopId, { kind: 'rate', billNo: b.no, customerCode: b.customerCode, changes: { rate }, before: { rate: b.rate, principal: b.principalLeft ?? b.total }, reason, byName: user.name }); toast('ส่งคำขอแล้ว รอเจ้าของอนุมัติ'); }
    setTimeout(done, 0);
  });
}

// ---------------- home (owner) ----------------
function viewHome() {
  if (isPhone()) return viewHomePhone();
  const today = todayIso();
  const s = shopSnapshot(data, today);
  const tile = (k, v, href, warn) => `<a class="stat tile${warn ? ' warn' : ''}" href="${href}"><div class="k">${k}</div><div class="v">${v}</div></a>`;
  view.innerHTML = `${alertsCard()}
  <section class="card">
    <h2>วันนี้ ${thDate(today)}</h2>
    <div class="stats">
      ${tile('ขายเงินสด', money(s.today.cash), '#bills')}${tile('ขายเงินเชื่อ', money(s.today.credit), '#bills')}
      ${tile('รับชำระหนี้', money(s.today.paid), '#paid')}${tile('เงินเข้ารวม', money(s.today.moneyIn), '#paid')}
    </div>
  </section>
  <section class="card">
    <h2>ลูกหนี้</h2>
    <div class="stats">
      ${tile('ยอดค้างรวม (ต้น+ดอก)', money(s.debt), '#debt')}${tile('ลูกค้าที่ค้าง', s.debtors + ' คน', '#debt')}
      ${tile('ค้างเกิน 6 เดือน', s.overdue + ' บิล', '#overdue', s.overdue > 0)}${tile('ดอกเบี้ยถึงวันนี้', money(s.interest), '#debt')}
    </div>
  </section>
  <section class="card">
    <h2>ต้องจัดการ</h2>
    <div class="stats">
      ${tile('รออนุมัติ', pendingRequests().length + ' รายการ', '#approve', pendingRequests().length > 0)}
      ${tile('สินค้าใกล้หมด', s.lowStock + ' รายการ', '#stock/low', s.lowStock > 0)}
      ${tile('สต๊อกติดลบ', s.negativeStock + ' รายการ', '#stock', s.negativeStock > 0)}
      ${tile('สินค้ายังไม่มีราคา', s.noPrice + ' รายการ', '#products', s.noPrice > 0)}
      ${tile('สำรองล่าสุด', settings.lastBackupAt ? new Date(settings.lastBackupAt).toLocaleDateString('th-TH') : 'ยังไม่เคย', '#backup', !settings.lastBackupAt)}
    </div>
  </section>
  <div class="big-actions">
    <a class="btn primary" href="#sale">ขาย</a><a class="btn" href="#debt">รับชำระ</a><a class="btn" href="#stock">สต๊อก</a><a class="btn" href="#bank">ส่งธนาคาร</a>
  </div>`;
}

// ---------------- owner alerts on the phone: requests + low stock ----------------
const alertsOn = () => !!shop && isManager() && isPhone();
const notifySupported = () => 'Notification' in window && 'serviceWorker' in navigator;
function currentAlerts() {
  const req = pendingRequests().map((r) => ({ key: 'r:' + r.id, title: 'คำขอรออนุมัติ', body: `${r.byName || ''} ${({ edit: 'ขอแก้ไขบิล', cancel: 'ขอยกเลิกบิล', rate: 'ขอเปลี่ยนอัตราดอก', voidReceipt: 'ขอยกเลิกใบเสร็จ', costPin: 'ขอดูราคาทุน' })[r.kind] || 'ส่งคำขอ'} ${r.billNo || r.receiptNo || r.productName || ''}`.trim(), url: '#approve' }));
  const low = lowStock(data?.products).map((p) => ({ key: 'l:' + p.code, title: 'สินค้าใกล้หมด', body: `${p.name} เหลือ ${qtyFmt(p.stock)} ${p.unit} (เตือนเมื่อไม่ถึง ${qtyFmt(p.minStock)})`, url: '#stock/low' }));
  return { req, low, count: req.length + low.length };
}
// Shows a phone notification for anything new since last time (remembered per shop on this phone).
async function checkAlerts() {
  if (!alertsOn() || !notifySupported() || Notification.permission !== 'granted') return;
  const key = 'seenAlerts:' + shopId;
  let seen; try { seen = JSON.parse(localStorage.getItem(key) || 'null'); } catch { seen = null; }
  const { req, low } = currentAlerts(); const all = [...req, ...low];
  const fresh = seen ? all.filter((a) => !seen.includes(a.key)) : all;
  try { localStorage.setItem(key, JSON.stringify(all.map((a) => a.key))); } catch { /* ignore */ }
  if (!fresh.length) return;
  const reg = await navigator.serviceWorker.ready;
  const shopName = settings.name || settings.label || APP_NAME;
  const show = (title, body, tag, url) => reg.showNotification(title, { body, tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: location.pathname + location.search + url } });
  const fr = fresh.filter((a) => a.key[0] === 'r'), fl = fresh.filter((a) => a.key[0] === 'l');
  if (fr.length) await show(`${shopName} · ${fr.length === 1 ? fr[0].title : `คำขอรออนุมัติ ${fr.length} รายการ`}`, fr.map((a) => a.body).join('\n'), 'req-' + shopId, '#approve');
  if (fl.length) await show(`${shopName} · ${fl.length === 1 ? fl[0].title : `สินค้าใกล้หมด ${fl.length} รายการ`}`, fl.map((a) => a.body).join('\n'), 'low-' + shopId, '#stock/low');
}
function alertsCard() {
  if (!isPhone()) return '';
  const { req, low } = currentAlerts();
  const perm = notifySupported() ? Notification.permission : 'unsupported';
  return `<section class="card" id="alertsCard">
    <h2>แจ้งเตือน</h2>
    ${perm === 'granted' ? '<div class="ok" style="font-size:14px">เปิดแจ้งเตือนบนมือถือเครื่องนี้แล้ว</div>'
      : perm === 'denied' ? '<div class="note" style="font-size:14px">มือถือเครื่องนี้ปิดการแจ้งเตือนของโปรแกรมไว้ เปิดได้ที่ ตั้งค่าเบราว์เซอร์ → การแจ้งเตือน</div>'
      : perm === 'unsupported' ? '<div class="note" style="font-size:14px">เบราว์เซอร์นี้แจ้งเตือนไม่ได้ · iPhone ต้อง "เพิ่มไปยังหน้าจอโฮม" แล้วเปิดจากไอคอนก่อน</div>'
      : '<button class="btn primary" id="enableNotify" style="justify-content:center">เปิดแจ้งเตือนบนมือถือ</button><div class="muted" style="font-size:13px">แจ้งเมื่อมีคำขอรออนุมัติ และเมื่อสินค้าเหลือต่ำกว่าจุดที่ตั้งไว้</div>'}
    ${req.length || low.length ? `<div class="alert-feed">${[...req, ...low].slice(0, 8).map((a) => `<a href="${a.url}" class="${a.key[0] === 'l' ? 'low' : 'req'}"><b>${a.title}</b><span>${esc(a.body)}</span></a>`).join('')}${req.length + low.length > 8 ? `<div class="muted" style="font-size:13px">และอีก ${req.length + low.length - 8} รายการ</div>` : ''}</div>` : '<div class="muted">ไม่มีเรื่องที่ต้องดูตอนนี้</div>'}
  </section>`;
}
// Internet goes / comes back: update the header and send bills that were sold offline.
let rsTimer; let wasPhone = window.matchMedia('(max-width: 700px)').matches;
window.addEventListener('resize', () => { clearTimeout(rsTimer); rsTimer = setTimeout(() => { const ph = isPhone(); if (ph !== wasPhone && shop) { wasPhone = ph; drawHeader(); render(); } }, 200); });
window.addEventListener('offline', () => { if (shop) drawHeader(), markNav(); });
window.addEventListener('online', () => {
  if (!shop) return;
  drawHeader(); markNav();
  backend.flushPending?.(shopId).then(() => { drawHeader(); markNav(); if (!backend.pendingCount?.(shopId)) toast('ส่งบิลที่ขายตอนไม่มีเน็ตขึ้นระบบแล้ว'); }).catch(() => {});
  backend.reserveNumbers?.(shopId, settings).catch(() => {});
});
window.addEventListener('salefail', (e) => alert(`บิล ${e.detail.no} บันทึกไม่สำเร็จ: ${e.detail.msg}\nกรุณาขายบิลนี้ใหม่`));
window.addEventListener('pendingchange', () => { if (shop) drawHeader(), markNav(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkAlerts().catch(() => {}); });
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#enableNotify')) return;
  const r = await Notification.requestPermission();
  if (r === 'granted') { try { localStorage.removeItem('seenAlerts:' + shopId); } catch { /* ignore */ } toast('เปิดแจ้งเตือนแล้ว'); await checkAlerts(); }
  if (current === 'home') render();
});

// ---------------- audit log: record who changed what ----------------
// Wraps the data functions: after a change succeeds, a line goes into the shop's log.
function withAudit(raw) {
  const api = { ...raw };
  const log = (entry) => { try { if (shopId) raw.addLog?.(shopId, entry); } catch { /* never block the work */ } };
  const prod = (code) => data?.products.find((p) => p.code === code);
  const wrap = (name, before, after) => {
    if (!raw[name]) return;
    api[name] = async (...args) => { const ctx = before ? before(...args) : null; const res = await raw[name](...args); try { const e = after(ctx, res, ...args); if (e) log(e); } catch { /* ignore */ } return res; };
  };
  const diffs = (a, b, fields) => fields.filter(([k]) => (a?.[k] ?? '') !== (b?.[k] ?? '') && b?.[k] !== undefined).map(([k, t, fmt]) => `${t} ${fmt ? fmt(a?.[k]) : a?.[k] ?? '-'} → ${fmt ? fmt(b[k]) : b[k]}`);
  wrap('saveProduct', (sid, p) => (prod(p.code) ? { ...prod(p.code) } : null), (old, r, sid, p) => {
    if (!old) return { action: 'เพิ่มสินค้า', target: `${p.code} ${p.name || ''}`, detail: `ราคา ${money(p.price || 0)} · สต๊อก ${p.stock ?? 0}` };
    if (p.deleted) return { action: 'ลบสินค้า', target: `${p.code} ${old.name}` };
    const d = diffs(old, p, [['name', 'ชื่อ'], ['price', 'ราคา', money], ['cost', 'ราคาทุน', money], ['stock', 'สต๊อก'], ['unit', 'หน่วย']]);
    return d.length ? { action: d.some((x) => x.startsWith('ราคา ')) ? 'แก้ราคาสินค้า' : d.some((x) => x.startsWith('สต๊อก')) ? 'แก้สต๊อก' : 'แก้ไขสินค้า', target: `${p.code} ${old.name}`, detail: d.join(' · ') } : null;
  });
  wrap('setPrices', null, (c, r, sid, changes, note) => ({ action: 'ปรับราคาหลายรายการ', target: `${changes.length} รายการ`, detail: (note ? note + ' · ' : '') + changes.slice(0, 30).map((x) => `${x.name || x.code} ${money(x.old)}→${money(x.price)}`).join(', ') + (changes.length > 30 ? ' …' : '') }));
  wrap('adjustStock', (sid, code) => ({ ...prod(code) }), (old, r, sid, code, counted, reason) => ({ action: 'ปรับสต๊อก', target: `${code} ${old?.name || ''}`, detail: `${qtyFmt(old?.stock)} → ${qtyFmt(counted)}${reason ? ' · ' + reason : ''}` }));
  wrap('saveCustomer', (sid, c) => { const o = data?.customers.find((x) => x.code === c.code); return o ? { ...o } : null; }, (old, r, sid, c) => {
    if (!old) return { action: 'เพิ่มลูกค้า', target: `${c.code} ${c.name || ''}` };
    if (c.deleted) return { action: 'ลบลูกค้า', target: `${c.code} ${old.name}` };
    const d = diffs(old, c, [['name', 'ชื่อ'], ['zone', 'หมู่บ้าน'], ['phone', 'โทร']]);
    return d.length ? { action: 'แก้ไขลูกค้า', target: `${c.code} ${old.name}`, detail: d.join(' · ') } : null;
  });
  wrap('commitSale', null, (c, bill) => (bill.date !== todayIso() ? { action: 'ลงบิลย้อนหลัง', target: bill.no, detail: `วันที่ ${thDate(bill.date)} · ${bill.type === 'credit' ? 'เงินเชื่อ' : 'เงินสด'} ฿${money(bill.total)}` } : null));
  wrap('commitBillChange', null, (c, bill, sid, no, kind, changes, meta) => ({ action: kind === 'cancel' ? 'ยกเลิกบิล' : kind === 'rate' ? 'เปลี่ยนอัตราดอก' : 'แก้ไขบิล', target: no, detail: [kind === 'rate' ? `เป็น ${changes.rate}%` : kind === 'edit' ? `ยอดใหม่ ฿${money(bill?.total)}` : '', meta?.reason ? 'เหตุผล: ' + meta.reason : ''].filter(Boolean).join(' · ') }));
  wrap('resolveRequest', (sid, id) => data?.requests.find((r) => r.id === id), (req, r, sid, id, ok) => ({ action: ok ? 'อนุมัติคำขอ' : 'ไม่อนุมัติคำขอ', target: req?.billNo || req?.receiptNo || req?.productName || '', detail: `${({ edit: 'แก้ไขบิล', cancel: 'ยกเลิกบิล', rate: 'เปลี่ยนอัตราดอก', voidReceipt: 'ยกเลิกใบเสร็จ', costPin: 'ดูราคาทุน' })[req?.kind] || req?.kind || ''} · ขอโดย ${req?.byName || '-'}${req?.reason ? ' · ' + req.reason : ''}` }));
  wrap('commitReceiptVoid', null, (c, r, sid, no, meta) => ({ action: 'ยกเลิกใบเสร็จ', target: no, detail: `฿${money(r?.total)}${meta?.reason ? ' · เหตุผล: ' + meta.reason : ''}` }));
  wrap('changeTransfer', null, (c, t, sid, no, kind) => ({ action: kind === 'cancel' ? 'ยกเลิกการโอน' : 'แก้ไขการโอน', target: no, detail: t?.to ? 'ไป ' + t.to : '' }));
  wrap('saveSettings', () => ({ ...settings }), (old, r, sid, sNew) => { const d = diffs(old, sNew, [['name', 'ชื่อร้าน'], ['address', 'ที่อยู่'], ['phone', 'โทร'], ['prefix', 'รหัสหน้าเลขบิล'], ['defaultRate', 'ดอกเริ่มต้น']]); return d.length ? { action: 'แก้ตั้งค่าร้าน', detail: d.join(' · ') } : null; });
  wrap('createUser', null, (c, r, u) => ({ action: 'เพิ่มรหัสเข้าระบบ', target: u.code, detail: `${u.name} · ${ROLE[u.role] || u.role}` }));
  wrap('setUserActive', null, (c, r, uid, on) => ({ action: on ? 'เปิดรหัส' : 'ปิดรหัส', target: uid }));
  wrap('deleteUser', null, (c, r, uid) => ({ action: 'ลบรหัสเข้าระบบ', target: uid }));
  wrap('replaceShopData', null, (c, r, sid, result) => ({ action: 'นำเข้าข้อมูลเก่า', detail: `ลูกค้า ${result.customers.length} · สินค้า ${result.products.length} · บิล ${result.bills.length}` }));
  wrap('restoreShop', null, (c, r, sid, bk) => ({ action: 'กู้คืนข้อมูล', detail: `จากไฟล์สำรองวันที่ ${bk.exportedAt ? new Date(bk.exportedAt).toLocaleString('th-TH') : '-'}` }));
  wrap('saveClose', null, (c, rec) => ({ action: 'ปิดร้าน', target: thDate(rec.date), detail: `ควรมี ${money(rec.expected)} · นับได้ ${money(rec.counted)} · ${rec.diff === 0 ? 'ตรง' : rec.diff < 0 ? 'ขาด ' + money(-rec.diff) : 'เกิน ' + money(rec.diff)}` }));
  wrap('issueCostPin', (sid, id) => data?.requests.find((r) => r.id === id), (req) => ({ action: 'ออก PIN ดูราคาทุน', target: req?.productName || '', detail: 'ให้ ' + (req?.byName || '-') }));
  wrap('useCostPin', null, (c, ok) => (ok ? { action: 'ใช้ PIN ดูราคาทุน' } : null));
  return api;
}

// Phone home: search, today's money, four big buttons, things to deal with.
function viewHomePhone() {
  const today = todayIso();
  const s = shopSnapshot(data, today);
  const nStale = stalePayers(data, today).length, nPend = pendingRequests().length;
  const backupOld = !settings.lastBackupAt || daysBetween(settings.lastBackupAt.slice(0, 10), today) > 7;
  const todo = [
    [nPend, 'คำขอรออนุมัติ', '#approve', 'ok'], [s.lowStock, 'สินค้าใกล้หมด', '#stock/low', 'warn'], [s.negativeStock, 'สต๊อกติดลบ', '#stock', 'warn'],
    [nStale, 'ลูกหนี้ไม่ชำระเกิน 6 เดือน', '#stale', 'bad'], [s.noPrice, 'สินค้ายังไม่มีราคา', '#products', 'warn'],
  ].filter(([n]) => n > 0);
  view.innerHTML = `
  <a class="search-box home-search" href="#search">${icon('search', 22)}<span>ค้นหาลูกค้า สินค้า เลขบิล</span></a>
  <section class="card today-card">
    <div class="row" style="justify-content:space-between;align-items:baseline"><span class="muted" style="font-weight:600;font-size:15px">เงินเข้าวันนี้</span><a href="#close" style="font-weight:600;font-size:15px">ปิดร้าน ›</a></div>
    <div class="mono today-big">฿${money(s.today.moneyIn)}</div>
    <div class="today-3"><div><small>ขายสด</small><b class="mono">${money(s.today.cash)}</b></div><div><small>รับชำระ</small><b class="mono">${money(s.today.paid)}</b></div><div class="cr"><small>ขายเชื่อ</small><b class="mono">${money(s.today.credit)}</b></div></div>
  </section>
  <div class="home-acts">
    <a href="#sale" class="primary">${icon('sale', 28)}<span>ขาย</span></a>
    <a href="#debt">${icon('pay', 28)}<span>รับชำระหนี้</span></a>
    <a href="#stock">${icon('stock', 28)}<span>นับสต๊อก</span></a>
    <a href="#bills">${icon('bills', 28)}<span>ค้นหาบิล</span></a>
  </div>
  <section class="card" style="padding:0;overflow:hidden;gap:0">
    <div style="padding:14px 16px 6px;font-weight:700">ต้องจัดการ</div>
    ${todo.length ? todo.map(([n, t, h, c]) => `<a class="todo-row" href="${h}"><span class="todo-n ${c}">${n}</span><span style="flex:1">${t}</span>${icon('chev', 20)}</a>`).join('') : '<div class="muted" style="padding:6px 16px 14px">ไม่มีเรื่องค้าง</div>'}
    ${backupOld ? `<a class="todo-row" href="#backup"><span class="todo-n warn">!</span><span style="flex:1">${settings.lastBackupAt ? 'ไม่ได้สำรองข้อมูลเกิน 7 วัน' : 'ยังไม่เคยสำรองข้อมูล'}</span>${icon('chev', 20)}</a>` : ''}
  </section>
  ${alertsCard()}`;
}

// ---------------- debtor sub-tabs ----------------
function dataTabs(active) {
  return `<div class="tabs" role="tablist">${[['backup', 'สำรอง / กู้คืนข้อมูล'], ['import', 'นำเข้าข้อมูลจากโปรแกรมเก่า']].map(([k, t]) => `<a href="#${k}" role="tab" aria-selected="${k === active}">${t}</a>`).join('')}</div>`;
}
function debtTabs(active) {
  return `<div class="tabs" role="tablist">${[['debt', 'ลูกหนี้ทั้งหมด'], ['paid', 'ลูกค้าชำระแล้ว'], ['overdue', 'ค้างนานเกิน 6 เดือน'], ['stale', 'ไม่ชำระนานเกิน 6 เดือน']].map(([k, t]) => `<a href="#${k}" role="tab" aria-selected="${k === active}">${t}</a>`).join('')}</div>`;
}
function viewPaid() {
  const cm = custBy();
  const list = [...data.receipts].sort((a, b) => ((a.createdAt || a.date) < (b.createdAt || b.date) ? 1 : -1));
  view.innerHTML = `${debtTabs('paid')}
  <section class="card">
    <div class="row"><input type="search" id="rq" placeholder="ค้นหาชื่อลูกค้า หรือเลขที่ใบเสร็จ" style="flex:1;min-width:200px" autocomplete="off">
      <select id="rr"><option value="0">วันนี้</option><option value="7" selected>7 วันล่าสุด</option><option value="35">35 วันล่าสุด</option></select></div>
    <div class="stats" id="rs"></div>
    <div class="scroll"><table id="rt"></table></div>
    <div class="muted" style="font-size:13px">ใบเสร็จเก่ากว่านี้ ดูได้ในหน้าลูกหนี้ของลูกค้าคนนั้น (ประวัติรับชำระ)</div>
  </section>`;
  const draw = () => {
    const n = norm($('#rq').value), days = +$('#rr').value;
    const from = new Date(Date.now() - days * 86400000); const fromIso = todayIso(from);
    const rows = list.filter((r) => r.date >= fromIso && (!n || norm(r.no).includes(n) || norm(cm.get(r.customerCode)?.name).includes(n)));
    const good = rows.filter((r) => r.status !== 'void');
    const sum = (k) => round2(good.reduce((s2, r) => s2 + (r[k] || 0), 0));
    $('#rs').innerHTML = `<div class="stat"><div class="k">ใบเสร็จ</div><div class="v">${good.length}</div></div><div class="stat"><div class="k">เงินต้น</div><div class="v">${money(sum('totalPrincipal'))}</div></div><div class="stat"><div class="k">ดอกเบี้ย</div><div class="v">${money(sum('totalInterest'))}</div></div><div class="stat"><div class="k">รับรวม</div><div class="v">${money(sum('total'))}</div></div>`;
    $('#rt').innerHTML = `<tr><th>วันที่</th><th>เลขที่</th><th>ลูกค้า</th><th class="num">บิล</th><th class="num">เงินต้น</th><th class="num">ดอกเบี้ย</th><th class="num">รวม</th><th></th></tr>`
      + (rows.length ? rows.map((r) => `<tr${voidCls(r)}><td>${thDate(r.date)}</td><td class="mono">${esc(r.no)}</td><td><a href="#debt/${encodeURIComponent(r.customerCode)}">${esc(custLabel(r.customerCode, cm))}</a></td><td class="num">${r.rows?.length ?? ''}</td><td class="num">${r.rows ? money(r.totalPrincipal) : ''}</td><td class="num">${r.rows ? money(r.totalInterest) : ''}</td><td class="num"><b>${money(r.total)}</b></td><td>${receiptCell(r)}</td></tr>`).join('')
        : '<tr><td colspan="8" class="empty">ไม่มีใบเสร็จในช่วงนี้</td></tr>');
    $$('#rt [data-rp]').forEach((b) => b.addEventListener('click', () => printReceipt(list.find((r) => r.no === b.dataset.rp))));
    $$('#rt [data-vr]').forEach((b) => b.addEventListener('click', () => voidReceiptDialog(list.find((r) => r.no === b.dataset.vr), viewPaid)));
  };
  $('#rq').addEventListener('input', draw); $('#rr').addEventListener('change', draw); draw();
}
function viewOverdue() {
  const cm = custBy();
  const bills = overdueBills(data, todayIso());
  const by = new Map();
  for (const b of bills) { const x = by.get(b.customerCode) || { code: b.customerCode, bills: [], total: 0 }; x.bills.push(b); x.total = round2(x.total + b.balance.total); by.set(b.customerCode, x); }
  const rows = [...by.values()].sort((a, b) => b.total - a.total);
  view.innerHTML = `${debtTabs('overdue')}
  <section class="card">
    <div class="stats"><div class="stat"><div class="k">ลูกค้า</div><div class="v">${rows.length}</div></div><div class="stat"><div class="k">บิลค้างเกิน 6 เดือน</div><div class="v">${bills.length}</div></div><div class="stat"><div class="k">ยอดรวม (ต้น+ดอก)</div><div class="v">${money(rows.reduce((s2, r) => s2 + r.total, 0))}</div></div></div>
    <div class="scroll"><table><tr><th>รหัส</th><th>ลูกค้า</th><th>หมู่บ้าน</th><th>โทร</th><th class="num">บิล</th><th>บิลเก่าสุด</th><th class="num">ค้างมา (วัน)</th><th class="num">ยอดรวม</th></tr>
    ${rows.length ? rows.map((r) => { const c = cm.get(r.code); return `<tr class="clickable" onclick="location.hash='debt/${encodeURIComponent(r.code)}'"><td class="mono">${esc(r.code)}</td><td>${esc(c?.name || '?')}</td><td>${esc(c?.zone)}</td><td>${esc(c?.phone)}</td><td class="num">${r.bills.length}</td><td>${thDate(r.bills[0].date)}</td><td class="num">${r.bills[0].age}</td><td class="num"><b>${money(r.total)}</b></td></tr>`; }).join('')
      : '<tr><td colspan="8" class="empty">ไม่มีบิลค้างเกิน 6 เดือน</td></tr>'}</table></div>
  </section>`;
}

// Debtors whose last payment (or, if they never paid, their oldest open bill) is more than 6 months ago.
let lastPaidChecked = null;
function viewStale() {
  const cm = custBy();
  const today = todayIso();
  const rows = stalePayers(data, today, 180);
  const never = rows.filter((r) => !r.lastPaid).length;
  view.innerHTML = `${debtTabs('stale')}
  <section class="card">
    <div class="muted" style="font-size:14px">ลูกหนี้ที่<b>ไม่ได้ชำระเงินเลย</b>มาเกิน 6 เดือน (นับจากวันชำระครั้งล่าสุด ถ้าไม่เคยชำระ นับจากบิลค้างใบเก่าสุด) · กดที่ชื่อเพื่อรับชำระ</div>
    <div class="stats"><div class="stat"><div class="k">ลูกค้า</div><div class="v">${rows.length}</div></div><div class="stat"><div class="k">ไม่เคยชำระเลย</div><div class="v">${never}</div></div><div class="stat"><div class="k">เงินต้นรวม</div><div class="v">${money(rows.reduce((a, r) => a + r.principal, 0))}</div></div><div class="stat"><div class="k">ยอดรวม (ต้น+ดอก)</div><div class="v">${money(rows.reduce((a, r) => a + r.total, 0))}</div></div></div>
    <input type="search" id="stq" placeholder="ค้นหาชื่อ หมู่บ้าน หรือรหัส" autocomplete="off">
    <div class="scroll"><table id="stt"></table></div>
    <div id="stNote" class="muted" style="font-size:13px"></div>
  </section>`;
  const draw = () => {
    const n = norm($('#stq').value);
    const list = rows.filter((r) => { const c = cm.get(r.code); return !n || norm(c?.name).includes(n) || norm(c?.zone).includes(n) || r.code.startsWith($('#stq').value.trim()); });
    $('#stt').innerHTML = `<tr><th>รหัส</th><th>ลูกค้า</th><th>หมู่บ้าน</th><th>โทร</th><th>ชำระล่าสุด</th><th class="num">ไม่ชำระมา (วัน)</th><th class="num">บิลค้าง</th><th class="num">ยอดรวม</th></tr>`
      + (list.length ? list.map((r) => { const c = cm.get(r.code); return `<tr class="clickable" onclick="location.hash='debt/${encodeURIComponent(r.code)}'"><td class="mono">${esc(r.code)}</td><td>${esc(c?.name || '?')}</td><td>${esc(c?.zone)}</td><td>${esc(c?.phone)}</td><td>${r.lastPaid ? thDate(r.lastPaid) : `<span class="pill cancel">ไม่เคยชำระ</span> <span class="muted" style="font-size:12px">บิลแรก ${thDate(r.oldestBill)}</span>`}</td><td class="num"><b>${r.days.toLocaleString()}</b></td><td class="num">${r.bills}</td><td class="num"><b>${money(r.total)}</b></td></tr>`; }).join('')
        : '<tr><td colspan="8" class="empty">ไม่มีลูกหนี้ที่ไม่ชำระนานเกิน 6 เดือน</td></tr>');
  };
  $('#stq').addEventListener('input', draw); draw();
  // Shops imported before the program kept last-payment dates: fill them once from the saved receipts.
  if (backend.mode === 'cloud' && lastPaidChecked !== shopId) {
    lastPaidChecked = shopId;
    $('#stNote').textContent = 'กำลังตรวจวันชำระล่าสุดจากใบเสร็จเก่า…';
    backend.backfillLastPaid(shopId).then((did) => { if (current !== 'stale') return; if (did) viewStale(); else if ($('#stNote')) $('#stNote').textContent = ''; })
      .catch(() => { if ($('#stNote')) $('#stNote').textContent = ''; });
  }
}

// ---------------- reports (owner): sales, profit, interest, all shops, change log ----------------
const repCache = new Map();
let repPeriod = 'month', repFrom = '', repTo = '';
function periodRange(p) {
  const t = todayIso(), [y, m] = t.split('-').map(Number);
  const first = (yy, mm) => `${yy}-${String(mm).padStart(2, '0')}-01`;
  if (p === 'today') return [t, t];
  if (p === '7') return [addDays(t, -6), t];
  if (p === 'month') return [first(y, m), t];
  if (p === 'last') { const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1; return [first(py, pm), addDays(first(y, m), -1)]; }
  if (p === 'year') return [`${y}-01-01`, t];
  return [repFrom || first(y, m), repTo || t];
}
async function loadRange(id, from, to) {
  const k = `${id}|${from}|${to}`;
  const hit = repCache.get(k);
  if (!hit || Date.now() - hit.at > 3 * 60000) { // re-read after 3 minutes so today's numbers stay fresh
    const [r, products] = await Promise.all([backend.findRange(id, from, to), backend.shopProducts(id)]);
    repCache.set(k, { at: Date.now(), rep: salesReport(r.bills, r.receipts, products, from, to) });
  }
  return repCache.get(k).rep;
}
const pct = (a, b) => (b ? (a / b * 100).toFixed(1) + '%' : '-');
const monthTh = (ym) => { const [y, m] = ym.split('-'); return `${['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'][+m - 1]} ${+y + 543}`; };
async function exportXlsx(fileName, sheets) {
  const X = await import('./xlsx.bundle.js');
  const wb = X.utils.book_new();
  for (const [name, rows] of sheets) { const ws = X.utils.aoa_to_sheet(rows); ws['!cols'] = rows[0]?.map((_, i) => ({ wch: Math.min(40, Math.max(10, ...rows.map((r) => String(r[i] ?? '').length + 2))) })); X.utils.book_append_sheet(wb, ws, name.slice(0, 31)); }
  X.writeFile(wb, fileName);
}
function viewReport(arg) {
  const tab = arg === 'shops' ? 'shops' : arg === 'logs' ? 'logs' : 'sales';
  view.innerHTML = `<div class="tabs" role="tablist">${[['report', 'sales', 'ยอดขาย / กำไร'], ['report/shops', 'shops', 'เทียบทุกร้าน'], ['report/logs', 'logs', 'ประวัติการแก้ไข']].map(([h, k, t]) => `<a href="#${h}" role="tab" aria-selected="${k === tab}">${t}</a>`).join('')}</div><div id="repBody"></div>`;
  if (tab === 'logs') return reportLogs();
  const periods = [['today', 'วันนี้'], ['7', '7 วัน'], ['month', 'เดือนนี้'], ['last', 'เดือนก่อน'], ['year', 'ปีนี้'], ['custom', 'กำหนดเอง']];
  $('#repBody').innerHTML = `<section class="card">
    <div class="row">${periods.map(([k, t]) => `<button class="chip" data-p="${k}" aria-pressed="${k === repPeriod}">${t}</button>`).join('')}</div>
    <div class="row ${repPeriod === 'custom' ? '' : 'hidden'}" id="repCustom"><label class="field">ตั้งแต่<input type="date" id="rf" value="${periodRange('custom')[0]}" max="${todayIso()}"></label><label class="field">ถึง<input type="date" id="rt2" value="${periodRange('custom')[1]}" max="${todayIso()}"></label></div>
    <div id="repOut"><div class="row muted"><span class="spinner"></span> กำลังคำนวณ…</div></div></section>`;
  $$('#repBody [data-p]').forEach((b) => b.addEventListener('click', () => { repPeriod = b.dataset.p; viewReport(arg); }));
  ['#rf', '#rt2'].forEach((id) => $(id)?.addEventListener('change', () => { repFrom = $('#rf').value; repTo = $('#rt2').value; if (repFrom > repTo) [repFrom, repTo] = [repTo, repFrom]; viewReport(arg); }));
  const [from, to] = periodRange(repPeriod);
  return tab === 'shops' ? reportShops(from, to) : reportSales(from, to);
}
async function reportSales(from, to) {
  let r; try { r = await loadRange(shopId, from, to); } catch (e) { if ($('#repOut')) $('#repOut').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  if (!$('#repOut')) return;
  const t = r.totals, pd = r.paid, byMonth = daysBetween(from, to) > 62;
  const rows = byMonth ? r.monthly : r.daily;
  const max = Math.max(1, ...rows.map((x) => x.cash + x.credit));
  const stat = (k, v, sub) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div>${sub ? `<div class="k">${sub}</div>` : ''}</div>`;
  let sortBy = 'amount';
  const itemsHtml = () => `<tr><th>#</th><th>สินค้า</th><th class="num">จำนวน</th><th class="num">ยอดขาย</th><th class="num">กำไร</th></tr>` + [...r.items].sort((a, b) => b[sortBy] - a[sortBy]).slice(0, 30).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.name)}</td><td class="num">${qtyFmt(x.qty)} ${esc(x.unit)}</td><td class="num">${money(x.amount)}</td><td class="num">${x.noCost ? '<span class="muted" title="ยังไม่มีราคาทุน">-</span>' : money(x.profit)}</td></tr>`).join('');
  $('#repOut').innerHTML = `
    <div class="muted" style="font-size:14px">${thDate(from)} – ${thDate(to)}</div>
    <div class="stats">${stat('ยอดขายรวม', money(t.sales), `${t.bills.toLocaleString()} บิล`)}${stat('ขายเงินสด', money(t.cash))}${stat('ขายเงินเชื่อ', money(t.credit))}${stat('กำไรขั้นต้น', money(t.profit), `${pct(t.profit, t.costedSales)} ของยอดที่มีราคาทุน`)}${stat('รับชำระหนี้', money(pd.total), `${pd.receipts} ใบ`)}${stat('ดอกเบี้ยที่เก็บได้', money(pd.interest))}</div>
    ${t.noCostLines ? `<div class="note" style="font-size:13px">มีรายการขาย ${t.noCostLines.toLocaleString()} บรรทัดที่สินค้ายังไม่มีราคาทุน ไม่ได้นับในกำไร · ใส่ราคาทุนได้ที่เมนูสินค้า (กำไรคิดจากราคาทุนปัจจุบัน)</div>` : ''}
    ${pd.noSplit ? `<div class="note" style="font-size:13px">ใบเสร็จจากโปรแกรมเก่า ${pd.noSplit} ใบไม่ได้แยกเงินต้นกับดอกเบี้ย จึงไม่ได้นับในดอกเบี้ยที่เก็บได้</div>` : ''}
    <div class="row"><button class="btn" id="repXlsx">ส่งออก Excel</button></div>
    <h3 style="margin:8px 0 0">${byMonth ? 'รายเดือน' : 'รายวัน'}</h3>
    <div class="scroll"><table><tr><th>${byMonth ? 'เดือน' : 'วันที่'}</th><th class="num">บิล</th><th class="num">ขายสด</th><th class="num">ขายเชื่อ</th><th style="width:22%"></th><th class="num">กำไร</th><th class="num">รับชำระ</th><th class="num">ดอกเบี้ย</th></tr>
    ${rows.map((x) => `<tr><td>${byMonth ? monthTh(x.month) : thDate(x.date)}</td><td class="num">${x.bills}</td><td class="num">${money(x.cash)}</td><td class="num">${money(x.credit)}</td><td><div class="bar"><span style="width:${(x.cash / max * 100).toFixed(1)}%"></span><span class="cr" style="width:${(x.credit / max * 100).toFixed(1)}%"></span></div></td><td class="num">${money(x.profit)}</td><td class="num">${money(x.paid)}</td><td class="num">${money(x.interest)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">ไม่มีรายการในช่วงนี้</td></tr>'}</table></div>
    <div class="row" style="justify-content:space-between;margin-top:8px"><h3 style="margin:0">สินค้าขายดี</h3><select id="repSort"><option value="amount">เรียงตามยอดขาย</option><option value="qty">เรียงตามจำนวน</option><option value="profit">เรียงตามกำไร</option></select></div>
    <div class="scroll"><table id="repItems">${itemsHtml()}</table></div>`;
  $('#repSort').addEventListener('change', (e) => { sortBy = e.target.value; $('#repItems').innerHTML = itemsHtml(); });
  $('#repXlsx').addEventListener('click', () => exportXlsx(`รายงาน_${safeName(settings.name || settings.label)}_${from}_${to}.xlsx`, [
    ['สรุป', [['รายการ', 'ยอด'], ['ช่วงวันที่', `${thDate(from)} - ${thDate(to)}`], ['จำนวนบิล', t.bills], ['ยอดขายรวม', t.sales], ['ขายเงินสด', t.cash], ['ขายเงินเชื่อ', t.credit], ['ส่วนลด', t.discount], ['กำไรขั้นต้น', t.profit], ['รับชำระหนี้', pd.total], ['เงินต้นที่รับ', pd.principal], ['ดอกเบี้ยที่เก็บได้', pd.interest]]],
    [byMonth ? 'รายเดือน' : 'รายวัน', [[byMonth ? 'เดือน' : 'วันที่', 'บิล', 'ขายสด', 'ขายเชื่อ', 'กำไร', 'รับชำระ', 'ดอกเบี้ย'], ...rows.map((x) => [byMonth ? monthTh(x.month) : thDate(x.date), x.bills, x.cash, x.credit, x.profit, x.paid, x.interest])]],
    ['สินค้าขายดี', [['รหัส', 'สินค้า', 'หน่วย', 'จำนวน', 'ยอดขาย', 'กำไร'], ...r.items.map((x) => [x.code, x.name, x.unit, x.qty, x.amount, x.noCost ? '' : x.profit])]],
  ]));
}
async function reportShops(from, to) {
  const list = shops.length ? shops : [{ id: shopId, ...settings }];
  if ($('#repOut')) $('#repOut').innerHTML = `<div class="row muted"><span class="spinner"></span> กำลังอ่านข้อมูล ${list.length} ร้าน…</div>`;
  const res = [];
  for (const sh of list) { try { res.push({ sh, r: await loadRange(sh.id, from, to) }); } catch (e) { res.push({ sh, err: e.message }); } }
  if (!$('#repOut')) return;
  const ok = res.filter((x) => x.r);
  const sum = (f) => round2(ok.reduce((a, x) => a + f(x.r), 0));
  const cols = [['บิล', (r) => r.totals.bills], ['ยอดขายรวม', (r) => r.totals.sales], ['ขายสด', (r) => r.totals.cash], ['ขายเชื่อ', (r) => r.totals.credit], ['กำไร', (r) => r.totals.profit], ['รับชำระ', (r) => r.paid.total], ['ดอกเบี้ย', (r) => r.paid.interest]];
  const fmt = (i, v) => (i === 0 ? v.toLocaleString() : money(v));
  $('#repOut').innerHTML = `<div class="muted" style="font-size:14px">${thDate(from)} – ${thDate(to)}</div>
    <div class="scroll"><table><tr><th>ร้าน</th>${cols.map(([t]) => `<th class="num">${t}</th>`).join('')}</tr>
    ${res.map(({ sh, r, err }) => `<tr><td><b>${esc(sh.label || sh.name || sh.id)}</b></td>${r ? cols.map(([, f], i) => `<td class="num">${fmt(i, f(r))}</td>`).join('') : `<td colspan="${cols.length}" class="err">${esc(err)}</td>`}</tr>`).join('')}
    <tr class="p-foot"><td><b>รวมทุกร้าน</b></td>${cols.map(([, f], i) => `<td class="num"><b>${fmt(i, sum(f))}</b></td>`).join('')}</tr></table></div>
    <div class="row"><button class="btn" id="shopXlsx">ส่งออก Excel</button></div>`;
  $('#shopXlsx').addEventListener('click', () => exportXlsx(`เทียบทุกร้าน_${from}_${to}.xlsx`, [['เทียบทุกร้าน', [['ร้าน', ...cols.map(([t]) => t)], ...ok.map(({ sh, r }) => [sh.label || sh.name || sh.id, ...cols.map(([, f]) => f(r))]), ['รวม', ...cols.map(([, f]) => sum(f))]]]]));
}
async function reportLogs() {
  $('#repBody').innerHTML = '<section class="card"><div class="row muted"><span class="spinner"></span> กำลังโหลด…</div></section>';
  let logs; try { logs = await backend.listLogs(shopId, 500); } catch (e) { $('#repBody').innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  if (!$('#repBody')) return;
  const actions = [...new Set(logs.map((l) => l.action))].sort(), people = [...new Set(logs.map((l) => l.by))].sort();
  $('#repBody').innerHTML = `<section class="card">
    <div class="muted" style="font-size:14px">บันทึกอัตโนมัติทุกครั้งที่มีการแก้ราคา แก้หรือปรับสต๊อก แก้/ยกเลิกบิล ยกเลิกใบเสร็จ อนุมัติคำขอ ปิดร้าน และอื่น ๆ (แสดง 500 รายการล่าสุด)</div>
    <div class="row"><input type="search" id="lq" placeholder="ค้นหา เช่น ชื่อสินค้า เลขบิล" style="flex:1;min-width:180px">
      <select id="la"><option value="">ทุกการกระทำ</option>${actions.map((a) => `<option>${esc(a)}</option>`).join('')}</select>
      <select id="lp"><option value="">ทุกคน</option>${people.map((a) => `<option>${esc(a)}</option>`).join('')}</select>
      <button class="btn" id="logXlsx">ส่งออก Excel</button></div>
    <div class="scroll"><table id="lt"></table></div></section>`;
  const shown = () => { const q = norm($('#lq').value), a = $('#la').value, p = $('#lp').value; return logs.filter((l) => (!a || l.action === a) && (!p || l.by === p) && (!q || norm(`${l.target} ${l.detail} ${l.action}`).includes(q))); };
  const draw = () => { const l = shown(); $('#lt').innerHTML = '<tr><th>เวลา</th><th>ใคร</th><th>ทำอะไร</th><th>รายการ</th><th>รายละเอียด</th></tr>' + (l.length ? l.map((x) => `<tr><td style="white-space:nowrap">${new Date(x.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${esc(x.by)}</td><td><b>${esc(x.action)}</b></td><td>${esc(x.target || '')}</td><td style="font-size:13px">${esc(x.detail || '')}</td></tr>`).join('') : '<tr><td colspan="5" class="empty">ยังไม่มีบันทึก</td></tr>'); };
  ['#lq', '#la', '#lp'].forEach((id) => $(id).addEventListener('input', draw)); draw();
  $('#logXlsx').addEventListener('click', () => exportXlsx(`ประวัติการแก้ไข_${safeName(settings.name || settings.label)}.xlsx`, [['ประวัติ', [['เวลา', 'ใคร', 'ทำอะไร', 'รายการ', 'รายละเอียด'], ...shown().map((x) => [new Date(x.at).toLocaleString('th-TH'), x.by, x.action, x.target || '', x.detail || ''])]]]));
}

// ---------------- end-of-day close: count the cash drawer ----------------
async function viewClose(arg) {
  const today = todayIso();
  const date = arg && /^\d{4}-\d{2}-\d{2}$/.test(arg) ? arg : today;
  const s = closeSummary(data, date);
  const saved = await backend.getClose(shopId, date).catch(() => null);
  if (current !== 'close') return;
  const floatKey = 'closeFloat:' + shopId;
  const float0 = saved?.float ?? Number(lsGet(floatKey) || 0);
  const row = (k, v, cls = '') => `<div class="p-split ${cls}"><span>${k}</span><b class="mono">${money(v)}</b></div>`;
  view.innerHTML = `<section class="card">
    <div class="row" style="justify-content:space-between;align-items:flex-end">
      <h2>ปิดร้านประจำวัน</h2>
      <label class="field" style="max-width:200px">วันที่<input type="date" id="cdate" value="${date}" max="${today}" min="${addDays(today, isManager() ? -34 : -1)}"></label>
    </div>
    ${saved ? `<div class="ok" style="font-size:14px">ปิดร้านวันนี้แล้ว โดย <b>${esc(saved.by)}</b> เมื่อ ${new Date(saved.at).toLocaleString('th-TH')} · นับได้ ${money(saved.counted)} · ${saved.diff === 0 ? 'ตรง' : saved.diff < 0 ? 'ขาด ' + money(-saved.diff) : 'เกิน ' + money(saved.diff)} (บันทึกใหม่ทับได้ ระบบเก็บประวัติไว้)</div>` : ''}
    <div class="close-grid">
      <div class="close-box">
        <h3>เงินเข้าลิ้นชัก</h3>
        ${row(`ขายเงินสด (${s.cashBills.length} บิล)`, s.cash)}
        ${row(`รับชำระหนี้ (${s.receipts.length} ใบ)`, s.paid)}
        <div class="muted" style="font-size:13px;margin:-2px 0 4px">เงินต้น ${money(s.paidPrincipal)} · ดอกเบี้ย ${money(s.paidInterest)}</div>
        <label class="field">เงินทอนตั้งต้นในลิ้นชัก (ตอนเปิดร้าน)<input type="number" id="cfloat" min="0" step="0.01" value="${float0 || ''}" placeholder="0" inputmode="decimal"></label>
        <div class="p-split close-expect"><span>ควรมีเงินในลิ้นชัก</span><b class="mono" id="cexp"></b></div>
        <label class="field">นับเงินได้จริง<input type="number" id="ccount" min="0" step="0.01" value="${saved?.counted ?? ''}" placeholder="นับเงินในลิ้นชักแล้วใส่ตรงนี้" inputmode="decimal" style="font-size:22px;font-weight:600;text-align:right;font-family:var(--mono)"></label>
        <div class="change" id="cdiff"></div>
        <label class="field">หมายเหตุ<input type="text" id="cnote" value="${esc(saved?.note || '')}" placeholder="เช่น ลูกค้าโอนเข้าบัญชี 500 บาท"></label>
        <div class="err hidden" id="cerr"></div>
        <div class="row"><button class="btn primary" id="csave">บันทึกปิดร้าน</button><button class="btn" id="cprint">พิมพ์ใบสรุป</button></div>
      </div>
      <div class="close-box">
        <h3>ไม่เข้าลิ้นชัก</h3>
        ${row(`ขายเงินเชื่อ (${s.creditBills.length} บิล)`, s.credit)}
        <h3 style="margin-top:10px">แยกตามพนักงาน</h3>
        <div class="scroll"><table><tr><th>ชื่อ</th><th class="num">ขายสด</th><th class="num">รับชำระ</th><th class="num">ขายเชื่อ</th></tr>
        ${s.people.length ? s.people.map((p) => `<tr><td>${esc(p.name)}</td><td class="num">${money(p.cash)}</td><td class="num">${money(p.paid)}</td><td class="num">${money(p.credit)}</td></tr>`).join('') : '<tr><td colspan="4" class="empty">ยังไม่มีรายการ</td></tr>'}</table></div>
      </div>
    </div>
  </section>
  <section class="card"><h2>รายการวันนี้</h2>
    <div class="scroll"><table><tr><th>เลขที่</th><th>ประเภท</th><th>ลูกค้า</th><th>โดย</th><th class="num">ยอด</th></tr>
    ${[...s.cashBills.map((b) => [b.no, 'ขายเงินสด', b]), ...s.receipts.map((r) => [r.no, 'รับชำระ', r]), ...s.creditBills.map((b) => [b.no, 'ขายเงินเชื่อ', b])].map(([no, t, x]) => `<tr><td class="mono">${esc(no)}</td><td>${t}</td><td>${esc(custLabel(x.customerCode))}</td><td>${esc(x.by || '')}</td><td class="num">${money(x.total)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">ยังไม่มีรายการ</td></tr>'}</table></div>
  </section>`;
  const nums = () => { const f = Number($('#cfloat').value) || 0, c = $('#ccount').value === '' ? null : Number($('#ccount').value); const exp = round2(f + s.cashIn); return { f, c, exp, diff: c === null ? null : round2(c - exp) }; };
  const draw = () => {
    const { exp, diff } = nums();
    $('#cexp').textContent = money(exp);
    const d = $('#cdiff');
    if (diff === null) { d.className = 'change'; d.innerHTML = ''; return; }
    d.className = 'change ' + (diff === 0 ? 'ok' : diff < 0 ? 'short' : 'over');
    d.innerHTML = diff === 0 ? '<span>เงินตรง</span><b class="mono">0.00</b>' : diff < 0 ? `<span>เงินขาด</span><b class="mono">${money(-diff)}</b>` : `<span>เงินเกิน</span><b class="mono">${money(diff)}</b>`;
  };
  ['#cfloat', '#ccount'].forEach((id) => $(id).addEventListener('input', draw)); draw();
  $('#cdate').addEventListener('change', (e) => { location.hash = 'close/' + e.target.value; });
  const printClose = (rec) => {
    const html = `<div class="paper">
      ${paperHead('สรุปปิดร้านประจำวัน', `<div>วันที่ ${dd(date)}</div>`)}
      <div class="p-box"><div class="p-cell" style="flex:1">
        ${row('ขายเงินสด (' + s.cashBills.length + ' บิล)', s.cash)}${row('รับชำระหนี้ (' + s.receipts.length + ' ใบ)', s.paid)}${row('เงินทอนตั้งต้น', rec.float)}
        ${row('ควรมีเงินในลิ้นชัก', rec.expected, 'p-grand')}${row('นับได้จริง', rec.counted ?? 0)}
        <div class="p-split p-grand"><span>${rec.diff === 0 ? 'เงินตรง' : rec.diff < 0 ? 'เงินขาด' : 'เงินเกิน'}</span><span>${money(Math.abs(rec.diff || 0))}</span></div>
      </div><div class="p-cell p-side">
        ${row('ขายเงินเชื่อ (' + s.creditBills.length + ' บิล)', s.credit)}
        ${s.people.map((p) => `<div class="p-split"><span>${esc(p.name)}</span><span>สด ${money(p.cash)} · รับ ${money(p.paid)}</span></div>`).join('')}
        ${rec.note ? `<div><b>หมายเหตุ</b> ${esc(rec.note)}</div>` : ''}
      </div></div>
      <div class="p-sign two"><div>ผู้ปิดร้าน (${esc(user.name)})</div><div>เจ้าของร้าน</div></div>
    </div>`;
    doPrint(html);
  };
  const record = () => { const { f, c, exp, diff } = nums(); return { date, float: f, cash: s.cash, paid: s.paid, credit: s.credit, expected: exp, counted: c, diff, note: $('#cnote').value.trim(), bills: s.cashBills.length + s.creditBills.length, receipts: s.receipts.length }; };
  $('#csave').addEventListener('click', async () => {
    const rec = record();
    if (rec.counted === null) { $('#cerr').textContent = 'นับเงินในลิ้นชักแล้วใส่ "นับเงินได้จริง" ก่อน'; $('#cerr').classList.remove('hidden'); return; }
    const btn = $('#csave'); btn.disabled = true;
    try { await backend.saveClose(shopId, rec); lsSet(floatKey, String(rec.float)); toast('บันทึกปิดร้านแล้ว'); printClose(rec); viewClose(date); }
    catch (e) { $('#cerr').textContent = e.message; $('#cerr').classList.remove('hidden'); btn.disabled = false; }
  });
  $('#cprint').addEventListener('click', () => printClose(record()));
}

// ---------------- stock: count / adjust and transfer to other shops ----------------
let stockQ = '', stockF = '';
function viewStock(arg) {
  const tab = arg === 'transfer' ? 'transfer' : arg === 'alert' ? 'alert' : 'count';
  if (arg === 'low') stockF = 'low';
  const nLow = lowStock(data.products).length;
  view.innerHTML = `<div class="tabs" role="tablist"><a href="#stock" role="tab" aria-selected="${tab === 'count'}">นับ / ปรับสต๊อก</a><a href="#stock/alert" role="tab" aria-selected="${tab === 'alert'}">ตั้งเตือนใกล้หมด${nLow ? ` <span class="badge">${nLow}</span>` : ''}</a><a href="#stock/transfer" role="tab" aria-selected="${tab === 'transfer'}">โอนสต๊อกไปร้านอื่น</a></div><div id="stockBody"></div>`;
  return tab === 'transfer' ? stockTransfers() : tab === 'alert' ? stockAlerts() : stockCount();
}
const minTag = (p) => (Number(p.minStock) > 0 ? `<span class="min-tag${isLow(p) ? ' low' : ''}">${isLow(p) ? 'ใกล้หมด · ' : ''}เตือน &lt; ${qtyFmt(p.minStock)}</span>` : '');
const stockMatch = (p, q) => !q || norm(p.name).includes(norm(q)) || p.code.startsWith(q.trim());
function stockCount() {
  const nLow = lowStock(data.products).length;
  $('#stockBody').innerHTML = `<section class="card">
    <input type="search" id="sq" placeholder="ค้นหาสินค้า" autocomplete="off" style="font-size:18px;min-height:52px" value="${esc(stockQ)}">
    <div class="row"><button class="chip" data-f="">ทั้งหมด</button><button class="chip" data-f="low">ใกล้หมด (${nLow})</button><button class="chip" data-f="neg">ติดลบ</button></div>
    <div id="sl" class="stock-list"></div></section>`;
  const draw = () => {
    $$('#stockBody [data-f]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.f === stockF));
    const list = liveProducts().filter((p) => !p.noStock && stockMatch(p, stockQ) && (!stockF || (stockF === 'neg' ? p.stock < 0 : isLow(p))))
      .sort((a, b) => a.name.localeCompare(b.name, 'th')).slice(0, 80);
    $('#sl').innerHTML = list.length ? list.map((p) => `<button class="stock-item" data-c="${esc(p.code)}"><span><b>${esc(p.name)}</b><span class="muted"> · ${esc(p.unit)}</span> ${minTag(p)}</span><span class="stock-n${p.stock < 0 ? ' neg' : isLow(p) ? ' low' : ''}">${qtyFmt(p.stock)}</span></button>`).join('')
      : `<div class="empty">${stockF === 'low' ? 'ไม่มีสินค้าใกล้หมด · ตั้งจุดเตือนได้ที่แท็บ "ตั้งเตือนใกล้หมด"' : 'ไม่พบสินค้า'}</div>`;
  };
  $('#sq').addEventListener('input', (e) => { stockQ = e.target.value; draw(); });
  $$('#stockBody [data-f]').forEach((b) => b.addEventListener('click', () => { stockF = b.dataset.f; draw(); }));
  $('#sl').addEventListener('click', (e) => { const b = e.target.closest('[data-c]'); if (b) adjustDialog(liveProducts().find((p) => p.code === b.dataset.c)); });
  draw();
}
// One tap per product: set the "alert below" level from preset buttons.
let alertF = '';
function minButtons(cur, attr) {
  const c = Number(cur) || 0, custom = c > 0 && !MIN_PRESETS.includes(c);
  return `<button type="button" class="chip" ${attr}="0" aria-pressed="${!c}">ไม่เตือน</button>${MIN_PRESETS.map((v) => `<button type="button" class="chip" ${attr}="${v}" aria-pressed="${c === v}">${v}</button>`).join('')}<button type="button" class="chip" ${attr}="other" aria-pressed="${custom}">${custom ? qtyFmt(c) : 'อื่น ๆ'}</button>`;
}
function askNumber(title, cur, done) {
  openDialog(`<h2>${title}</h2><label class="field">เตือนเมื่อเหลือไม่ถึง<input type="number" name="n" min="0" step="any" value="${cur || ''}" style="font-size:24px;text-align:center" autofocus></label>
    <div class="row"><button class="btn primary" value="ok">ตั้ง</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></div>`, async (f) => { await done(Math.max(0, Number(f.n.value) || 0)); });
}
function stockAlerts() {
  $('#stockBody').innerHTML = `<section class="card">
    <div class="muted" style="font-size:14px">แตะตัวเลขเพื่อตั้ง <b>เตือนเมื่อเหลือไม่ถึง…</b> บันทึกทันที · เจ้าของร้านจะได้รับแจ้งเตือนบนมือถือเมื่อสินค้าเหลือต่ำกว่าที่ตั้งไว้</div>
    <input type="search" id="aq" placeholder="ค้นหาสินค้า เช่น ปุ๋ย" autocomplete="off" style="font-size:18px;min-height:52px" value="${esc(stockQ)}">
    <div class="row"><button class="chip" data-af="">ทั้งหมด</button><button class="chip" data-af="none">ยังไม่ตั้ง</button><button class="chip" data-af="set">ตั้งแล้ว</button><button class="chip" data-af="low">ใกล้หมด</button></div>
    <div class="bulk" id="bulk"></div>
    <div id="al" class="alert-list"></div></section>`;
  let shown = [];
  const draw = () => {
    $$('#stockBody [data-af]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.af === alertF));
    const all = liveProducts().filter((p) => !p.noStock && stockMatch(p, stockQ) && (!alertF || (alertF === 'none' ? !(p.minStock > 0) : alertF === 'set' ? p.minStock > 0 : isLow(p))))
      .sort((a, b) => a.name.localeCompare(b.name, 'th'));
    shown = all.slice(0, 80);
    $('#bulk').innerHTML = all.length > 1 ? `<span>ตั้งทั้ง <b>${all.length}</b> รายการที่แสดงอยู่เป็น</span><div class="row" style="gap:6px">${minButtons(-1, 'data-bulk')}</div>` : '';
    $$('#bulk [aria-pressed]').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    $('#al').innerHTML = shown.length ? shown.map((p) => `<div class="alert-item"><div class="ai-name"><b>${esc(p.name)}</b><span class="muted"> · เหลือ <b class="mono${isLow(p) ? ' low-txt' : ''}">${qtyFmt(p.stock)}</b> ${esc(p.unit)}</span></div>
      <div class="ai-btns" data-code="${esc(p.code)}">${minButtons(p.minStock, 'data-min')}</div></div>`).join('') + (all.length > shown.length ? `<div class="muted" style="font-size:13px">แสดง 80 จาก ${all.length} รายการ · พิมพ์ค้นหาเพื่อให้แคบลง</div>` : '')
      : '<div class="empty">ไม่พบสินค้า</div>';
    $('#bulk').dataset.codes = all.map((p) => p.code).join('|');
  };
  const apply = async (codes, v, label) => {
    await backend.setMinStock(shopId, codes, v);
    toast(v ? `${label}: เตือนเมื่อเหลือไม่ถึง ${qtyFmt(v)}` : `${label}: ไม่เตือน`);
    if (backend.mode === 'local') draw();
  };
  $('#aq').addEventListener('input', (e) => { stockQ = e.target.value; draw(); });
  $$('#stockBody [data-af]').forEach((b) => b.addEventListener('click', () => { alertF = b.dataset.af; draw(); }));
  $('#al').addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]'); if (!b) return;
    const code = b.parentElement.dataset.code, p = liveProducts().find((x) => x.code === code);
    const run = (v) => { b.parentElement.innerHTML = minButtons(v, 'data-min'); return apply([code], v, p.name); };
    if (b.dataset.min === 'other') askNumber(esc(p.name), p.minStock, run); else run(Number(b.dataset.min)).catch((er) => toast(er.message));
  });
  $('#bulk').addEventListener('click', (e) => {
    const b = e.target.closest('[data-bulk]'); if (!b) return;
    const codes = $('#bulk').dataset.codes.split('|').filter(Boolean);
    const go = (v) => openDialog(`<h2>ตั้งเตือน ${codes.length} รายการ</h2><div>${v ? `เตือนเมื่อเหลือไม่ถึง <b>${qtyFmt(v)}</b>` : '<b>ไม่เตือน</b>'} สำหรับสินค้าทั้ง ${codes.length} รายการที่แสดงอยู่${stockQ ? ` (ค้นหา "${esc(stockQ)}")` : ''}</div>
      <div class="row"><button class="btn primary" value="ok">ตั้งเลย</button><button class="btn" value="cancel">ยกเลิก</button></div>`, async () => { await apply(codes, v, `${codes.length} รายการ`); setTimeout(draw, 0); });
    if (b.dataset.bulk === 'other') askNumber(`ตั้งเตือน ${codes.length} รายการ`, '', async (v) => { setTimeout(() => go(v), 0); }); else go(Number(b.dataset.bulk));
  });
  draw();
}
async function adjustDialog(p) {
  let newMin = Number(p.minStock) || 0;
  const reasons = ['นับสต๊อกจริง', 'รับของเข้า', 'ของเสีย / หมดอายุ', 'คืนผู้ขาย', 'อื่น ๆ'];
  const f = openDialog(`<h2>${esc(p.name)}</h2>
    <div class="muted">ในระบบตอนนี้ <b>${qtyFmt(p.stock)}</b> ${esc(p.unit)}</div>
    <div class="field">นับได้จริง (${esc(p.unit)})
      <div class="big-step"><button type="button" data-step="-1" aria-label="ลด 1">−</button>
      <input type="number" name="counted" step="any" inputmode="decimal" value="${p.stock}" aria-label="จำนวนที่นับได้">
      <button type="button" data-step="1" aria-label="เพิ่ม 1">+</button></div></div>
    <div class="quick-amt">${[5, 10, 20, 50].map((n) => `<button type="button" class="btn small" data-step="${n}">+${n}</button>`).join('')}</div>
    <div class="field">เหตุผล<input type="hidden" name="reason" value="นับสต๊อกจริง"><div class="row" style="gap:8px" id="adjReason">${reasons.map((r, i) => `<button type="button" class="chip" data-reason="${r}" aria-pressed="${i === 0}">${r}</button>`).join('')}</div></div>
    <div class="field">เตือนเมื่อเหลือไม่ถึง<div class="row" style="gap:6px" id="adjMin">${minButtons(p.minStock, 'data-min')}</div></div>
    <div id="logs" class="muted" style="font-size:13px"></div>
    <div class="err hidden dlg-err"></div>
    <div class="row"><button class="btn primary" value="ok" id="adjSave" style="flex:1;justify-content:center;min-height:56px;font-size:18px">บันทึก</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></div>`, async (form) => {
    const n = Number(form.counted.value);
    if (!Number.isFinite(n)) throw new Error('ใส่จำนวน');
    if (newMin !== (Number(p.minStock) || 0)) await backend.setMinStock(shopId, [p.code], newMin);
    if (n === p.stock && newMin !== (Number(p.minStock) || 0)) { toast(`ตั้งเตือน ${p.name} แล้ว`); setTimeout(() => current === 'stock' && viewStock(), 0); return; }
    await backend.adjustStock(shopId, p.code, n, form.reason.value);
    toast(`บันทึก ${p.name} = ${qtyFmt(n)}`); setTimeout(() => current === 'stock' && viewStock(), 0);
  });
  const label = () => { const n = Number(f.counted.value); $('#adjSave', f).textContent = Number.isFinite(n) && n !== p.stock ? `บันทึก ${qtyFmt(p.stock)} → ${qtyFmt(n)}` : 'บันทึก'; };
  $$('[data-step]', f).forEach((b) => b.addEventListener('click', () => { f.counted.value = round2((Number(f.counted.value) || 0) + Number(b.dataset.step)); label(); }));
  f.counted.addEventListener('input', label);
  $('#adjReason', f).addEventListener('click', (e) => { const b = e.target.closest('[data-reason]'); if (!b) return; f.reason.value = b.dataset.reason; $$('[data-reason]', f).forEach((x) => x.setAttribute('aria-pressed', x === b)); });
  $('#adjMin', f).addEventListener('click', (e) => {
    const b = e.target.closest('[data-min]'); if (!b) return;
    const set = (v) => { newMin = v; $('#adjMin', f).innerHTML = minButtons(v, 'data-min'); };
    if (b.dataset.min === 'other') { const v = prompt('เตือนเมื่อเหลือไม่ถึงกี่ ' + p.unit, newMin || ''); if (v !== null) set(Math.max(0, Number(v) || 0)); } else set(Number(b.dataset.min));
  });
  try {
    const logs = (await backend.stockLogs(shopId, p.code)).slice(0, 5);
    if (logs.length && $('#logs', f)) $('#logs', f).innerHTML = 'ปรับล่าสุด: ' + logs.map((l) => `${new Date(l.at).toLocaleDateString('th-TH')} ${esc(l.by)} ${qtyFmt(l.from)}→${qtyFmt(l.to)} (${esc(l.reason)})`).join(' · ');
  } catch { /* history is optional */ }
}
function stockTransfers() {
  const list = [...(data.transfers || [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  $('#stockBody').innerHTML = `<section class="card">
    <div class="row" style="justify-content:space-between"><h2>โอนสต๊อก (90 วันล่าสุด)</h2><button class="btn primary" id="newTr">+ โอนสต๊อก</button></div>
    <div class="muted" style="font-size:13px">โอนแล้วสต๊อกร้านนี้ลดลง ร้านปลายทางไม่เพิ่มให้อัตโนมัติ (ปลายทางนับรับของเอง)</div>
    <div class="scroll"><table><tr><th>เลขที่</th><th>วันที่</th><th>ไปร้าน</th><th>รายการ</th><th>โดย</th><th></th></tr>
    ${list.length ? list.map((t) => `<tr class="clickable" data-t="${esc(t.no)}"><td class="mono">${esc(t.no)}</td><td>${thDate(t.date)}</td><td>${esc(t.to)}</td><td>${t.lines.map((l) => `${esc(l.name)} ${qtyFmt(l.qty)}`).join(', ')}</td><td>${esc(t.by)}</td><td>${t.status === 'cancelled' ? '<span class="pill cancel">ยกเลิก</span>' : t.edits ? `<span class="pill">แก้ไข ${t.edits}</span>` : ''}</td></tr>`).join('')
      : '<tr><td colspan="6" class="empty">ยังไม่มีรายการโอน</td></tr>'}</table></div></section>`;
  $('#newTr').addEventListener('click', () => transferEditor());
  $$('#stockBody [data-t]').forEach((r) => r.addEventListener('click', () => transferView(list.find((t) => t.no === r.dataset.t))));
}
function transferView(t) {
  openDialog(`<h2 class="mono">${esc(t.no)}</h2>
    <div>${thDate(t.date)} · ไป <b>${esc(t.to)}</b> · โดย ${esc(t.by)}${t.status === 'cancelled' ? ` <span class="pill cancel">ยกเลิก</span>` : ''}</div>
    <table><tr><th>สินค้า</th><th class="num">จำนวน</th></tr>${t.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${qtyFmt(l.qty)} ${esc(l.unit)}</td></tr>`).join('')}</table>
    ${t.note ? `<div class="muted">หมายเหตุ: ${esc(t.note)}</div>` : ''}
    <div class="row" style="justify-content:space-between"><button class="btn" value="cancel">ปิด</button>
      ${t.status !== 'cancelled' ? '<span class="row"><button class="btn" value="edit">แก้ไข</button><button class="btn" value="void" style="color:var(--red)">ยกเลิกการโอน</button></span>' : ''}</div>`, async (f, action) => {
    if (action === 'edit') setTimeout(() => transferEditor(t), 0);
    if (action === 'void') {
      if (!confirm('ยกเลิกการโอนนี้? สต๊อกจะกลับเข้าร้านนี้')) return false;
      await backend.changeTransfer(shopId, t.no, 'cancel', null, { by: user.name }); toast('ยกเลิกการโอนแล้ว'); setTimeout(() => viewStock('transfer'), 0);
    }
  });
}
function transferEditor(t) {
  const st = { to: t?.to || '', lines: (t?.lines || []).map((l) => ({ ...l })), note: t?.note || '' };
  const dests = [...new Set([...(data.transfers || []).map((x) => x.to), ...shops.filter((x) => x.id !== shopId).map((x) => x.label || x.name)].filter(Boolean))];
  $('#stockBody').innerHTML = `<section class="card">
    <h2>${t ? 'แก้ไขการโอน ' + esc(t.no) : 'โอนสต๊อกไปร้านอื่น'}</h2>
    <label class="field">ไปร้าน<input type="text" id="tto" list="dests" value="${esc(st.to)}" placeholder="เช่น สาขาโป่งแค" autocomplete="off"></label>
    <datalist id="dests">${dests.map((d) => `<option value="${esc(d)}">`).join('')}</datalist>
    <label class="field">เพิ่มสินค้า<input type="search" id="tq" placeholder="พิมพ์ชื่อสินค้า แล้วกด Enter" autocomplete="off"></label>
    <div class="results hidden" id="tres"></div>
    <div class="scroll"><table id="tlines"></table></div>
    <label class="field">หมายเหตุ<input type="text" id="tnote" value="${esc(st.note)}"></label>
    <div class="err hidden" id="terr"></div>
    <div class="row"><button class="btn primary" id="tsave">${t ? 'บันทึกการแก้ไข' : 'บันทึกการโอน'}</button><a class="btn" href="#stock/transfer">ยกเลิก</a></div>
  </section>`;
  const draw = () => {
    $('#tlines').innerHTML = st.lines.length ? `<tr><th>สินค้า</th><th class="num">คงเหลือ</th><th class="num">โอน</th><th></th></tr>` + st.lines.map((l, i) => { const p = data.products.find((x) => x.code === l.code); return `<tr><td>${esc(l.name)} <span class="muted">· ${esc(l.unit)}</span></td><td class="num">${qtyFmt(p?.stock)}</td><td class="num"><input class="qty" type="number" min="0" step="any" data-i="${i}" value="${l.qty}"></td><td><button class="btn small" data-del="${i}">ลบ</button></td></tr>`; }).join('') : '<tr><td class="empty">ยังไม่มีรายการ</td></tr>';
  };
  $('#tlines').addEventListener('input', (e) => { if (e.target.dataset.i != null) st.lines[+e.target.dataset.i].qty = Number(e.target.value) || 0; });
  $('#tlines').addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { st.lines.splice(+b.dataset.del, 1); draw(); } });
  const tq = $('#tq'), tres = $('#tres'); let found = [];
  const add = (code) => { const p = liveProducts().find((x) => x.code === code); const ex = st.lines.find((l) => l.code === code); if (ex) ex.qty += 1; else st.lines.push({ code, name: p.name, unit: p.unit, qty: 1 }); tq.value = ''; tres.classList.add('hidden'); draw(); tq.focus(); };
  tq.addEventListener('input', () => { found = searchProducts(tq.value).filter((p) => !p.noStock); tres.classList.toggle('hidden', !tq.value); tres.innerHTML = found.map((p) => `<button type="button" data-code="${esc(p.code)}"><span>${esc(p.name)}</span><span class="muted">คงเหลือ ${qtyFmt(p.stock)}</span></button>`).join('') || '<div class="empty">ไม่พบสินค้า</div>'; });
  tq.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (found[0]) add(found[0].code); } });
  tres.addEventListener('click', (e) => { const b = e.target.closest('[data-code]'); if (b) add(b.dataset.code); });
  $('#tsave').addEventListener('click', async () => {
    const err = $('#terr'); err.classList.add('hidden'); const btn = $('#tsave'); btn.disabled = true;
    const input = { to: $('#tto').value, lines: st.lines, note: $('#tnote').value.trim(), by: user.name };
    try {
      const r = t ? await backend.changeTransfer(shopId, t.no, 'edit', input, { by: user.name }) : await backend.commitTransfer(shopId, settings, input);
      toast(t ? 'แก้ไขการโอนแล้ว' : `บันทึกการโอน ${r.no} แล้ว`); location.hash = 'stock/transfer'; viewStock('transfer');
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); btn.disabled = false; }
  });
  draw();
}

// ---------------- debtor list for the bank (black & white, totals only) ----------------
function viewBank() {
  const asOf = todayIso();
  const all = bankList(data, asOf);
  const zones = all.groups.map((g) => g.zone);
  const people = all.groups.flatMap((g) => g.rows.map((r) => ({ ...r, zone: g.zone })));
  let mode = 'zone';
  const pickedZones = new Set(zones), pickedCodes = new Set();
  view.innerHTML = `<section class="card">
    <h2>รายชื่อลูกหนี้ส่งธนาคาร</h2>
    <div class="seg" role="group"><button type="button" data-m="zone" aria-pressed="true">ตามหมู่บ้าน</button><button type="button" data-m="person" aria-pressed="false">เลือกรายคน</button></div>
    <div id="pick"></div>
    <label class="row" style="min-height:40px"><input type="checkbox" id="withInt" checked style="width:20px;height:20px;accent-color:var(--green)"> รวมดอกเบี้ยถึงวันนี้ (ไม่ติ๊ก = เงินต้นอย่างเดียว)</label>
    <div class="stats" id="bsum"></div>
    <div class="row"><button class="btn primary" id="bprint">พิมพ์ / บันทึกเป็น PDF</button><span class="muted" style="font-size:13px">ในหน้าต่างพิมพ์ เลือกเครื่องพิมพ์ "บันทึกเป็น PDF" (Save as PDF)</span></div>
  </section>
  <section class="card"><h2>ตัวอย่าง</h2><div class="scroll" id="bprev"></div></section>`;
  const opts = () => (mode === 'zone' ? { zones: [...pickedZones] } : { codes: pickedCodes.size ? [...pickedCodes] : ['-'] });
  const amount = (r) => ($('#withInt').checked ? r.total : r.principal);
  const result = () => { const r = bankList(data, asOf, opts()); for (const g of r.groups) g.sum = round2(g.rows.reduce((s2, x) => s2 + amount(x), 0)); r.sum = round2(r.groups.reduce((s2, g) => s2 + g.sum, 0)); return r; };
  const drawPick = () => {
    $('#pick').innerHTML = mode === 'zone'
      ? `<div class="row"><button class="btn small" id="za">เลือกทั้งหมด</button><button class="btn small" id="zn">ไม่เลือก</button></div><div class="zone-grid">${zones.map((z) => `<label class="row"><input type="checkbox" data-z="${esc(z)}" ${pickedZones.has(z) ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--green)"> ${esc(z)}</label>`).join('')}</div>`
      : `<input type="search" id="pq3" placeholder="ค้นหาชื่อลูกค้า" autocomplete="off"><div class="zone-grid" id="plist"></div>`;
    if (mode === 'zone') {
      $$('[data-z]').forEach((c) => c.addEventListener('change', () => { c.checked ? pickedZones.add(c.dataset.z) : pickedZones.delete(c.dataset.z); drawPrev(); }));
      $('#za').onclick = () => { zones.forEach((z) => pickedZones.add(z)); drawPick(); drawPrev(); };
      $('#zn').onclick = () => { pickedZones.clear(); drawPick(); drawPrev(); };
    } else {
      const drawPeople = () => { const n = norm($('#pq3').value); $('#plist').innerHTML = people.filter((x) => !n || norm(x.name).includes(n) || norm(x.zone).includes(n)).slice(0, 120).map((x) => `<label class="row"><input type="checkbox" data-p="${esc(x.code)}" ${pickedCodes.has(x.code) ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--green)"> ${esc(x.name)} <span class="muted">${esc(x.zone)}</span></label>`).join(''); $$('[data-p]').forEach((c) => c.addEventListener('change', () => { c.checked ? pickedCodes.add(c.dataset.p) : pickedCodes.delete(c.dataset.p); drawPrev(); })); };
      $('#pq3').addEventListener('input', drawPeople); drawPeople();
    }
  };
  const bankHtml = (r) => `<div class="bank">
      <div class="p-head"><div><div class="p-shop">${esc(settings.name || '')}</div><div>${esc([settings.address, settings.phone ? 'โทร ' + settings.phone : ''].filter(Boolean).join(' · '))}</div></div>
        <div class="p-right"><div class="p-title">รายชื่อลูกหนี้</div><div>ณ วันที่ ${dd(asOf)}</div>${$('#withInt').checked ? '' : '<div>เฉพาะเงินต้น</div>'}</div></div>
      ${r.groups.map((g) => `<table class="p-table bank-t"><thead><tr><th colspan="3">หมู่บ้าน ${esc(g.zone)}</th></tr><tr><th class="c" style="width:12mm">ลำดับ</th><th>ชื่อลูกค้า</th><th class="r" style="width:40mm">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>${g.rows.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.name)}</td><td class="r">${money(amount(x))}</td></tr>`).join('')}
        <tr class="p-foot"><td colspan="2" class="r">รวมหมู่บ้าน ${esc(g.zone)} (${g.rows.length} ราย)</td><td class="r">${money(g.sum)}</td></tr></tbody></table>`).join('')}
      <table class="p-table bank-t"><tbody><tr class="p-foot"><td class="r">รวมทั้งหมด ${r.people} ราย ${r.groups.length} หมู่บ้าน</td><td class="r" style="width:40mm">${money(r.sum)}</td></tr></tbody></table>
    </div>`;
  const drawPrev = () => {
    const r = result();
    $('#bsum').innerHTML = `<div class="stat"><div class="k">หมู่บ้าน</div><div class="v">${r.groups.length}</div></div><div class="stat"><div class="k">ลูกค้า</div><div class="v">${r.people}</div></div><div class="stat"><div class="k">ยอดรวม</div><div class="v">${money(r.sum)}</div></div>`;
    $('#bprev').innerHTML = r.people ? `<div class="paper-preview">${bankHtml(r)}</div>` : '<div class="empty">ยังไม่ได้เลือก</div>';
  };
  $$('[data-m]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; $$('[data-m]').forEach((x) => x.setAttribute('aria-pressed', x === b)); drawPick(); drawPrev(); }));
  $('#withInt').addEventListener('change', drawPrev);
  $('#bprint').addEventListener('click', () => { const r = result(); if (!r.people) { toast('ยังไม่ได้เลือกลูกหนี้'); return; } doPrint(bankHtml(r), true); });
  drawPick(); drawPrev();
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
let costUnlockedUntil = 0;
const canSeeCost = () => isManager() || Date.now() < costUnlockedUntil;
const pendingCostPin = () => (data.requests || []).some((r) => r.kind === 'costPin' && r.status === 'pending' && (r.byUid ? r.byUid === user.uid : r.byName === user.name));
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
    <label class="field">บาร์โค้ด <span class="muted" style="font-weight:400">(ไม่ใส่ก็ได้ · ยิงเครื่องสแกนใส่ช่องนี้ได้)</span><input type="text" name="barcode" value="${esc(p.barcode || '')}" inputmode="numeric" autocomplete="off" style="font-family:var(--mono)"></label>
    <label class="field">เตือนเมื่อเหลือไม่ถึง <span class="muted" style="font-weight:400">(ว่าง / 0 = ไม่เตือน)</span><input type="number" name="minStock" min="0" step="any" value="${p.minStock || ''}" placeholder="เช่น 10"></label>
    <label class="row" style="font-weight:600;min-height:44px"><input type="checkbox" name="noStock" ${p.noStock ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--green)"> ไม่มีสต๊อก (งานบริการ เช่น ไถแปร โดรนพ่นยา)</label>
    ${canSeeCost() ? `<label class="field">ราคาทุน (บาท) <span class="muted" style="font-weight:400">· ${isManager() ? 'พนักงานมองไม่เห็นช่องนี้' : 'ปลดล็อกด้วย PIN ถึง ' + new Date(costUnlockedUntil).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span><input type="number" name="cost" min="0" step="0.01" value="${p.cost || ''}"></label>`
      : `<div class="stat" style="display:flex;flex-direction:column;gap:6px"><div class="k">ราคาทุน: ต้องใช้ PIN จากแอดมิน</div>
          <div class="row"><input type="text" name="pin" inputmode="numeric" maxlength="4" placeholder="ใส่ PIN 4 หลัก" style="width:150px;font-family:var(--mono)"><button class="btn small" value="usepin" formnovalidate>ใช้ PIN</button>
          <button class="btn small" value="askpin" formnovalidate>${pendingCostPin() ? 'ขอแล้ว รอแอดมิน' : 'ขอ PIN จากแอดมิน'}</button></div></div>`}
    <div class="err hidden dlg-err"></div>
    <div class="row" style="justify-content:space-between"><span class="row"><button class="btn primary" value="save">บันทึก</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></span>
      ${isNew ? '' : '<button class="btn" value="delete" formnovalidate style="color:var(--red)">ลบสินค้า</button>'}</div>`, async (f, action) => {
    if (action === 'askpin') {
      if (pendingCostPin()) throw new Error('ส่งคำขอไปแล้ว รอแอดมินออก PIN แล้วใส่ในช่อง');
      await backend.createRequest(shopId, { kind: 'costPin', productCode: p.code, productName: p.name, byName: user.name });
      throw new Error('ส่งคำขอแล้ว ให้แอดมินดูเมนู "รออนุมัติ" แล้วแจ้ง PIN มา');
    }
    if (action === 'usepin') {
      const ok = await backend.useCostPin(shopId, f.pin.value);
      if (!ok) throw new Error('PIN ไม่ถูกต้อง หรือหมดอายุแล้ว');
      costUnlockedUntil = Date.now() + 30 * 60000; toast('ปลดล็อกราคาทุน 30 นาที');
      setTimeout(() => productForm(liveProducts().find((x) => x.code === p.code) || p), 0); return;
    }
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
    const rec = { code, name: v.name.trim(), unit: v.unit.trim() || 'หน่วย', price: round2(Number(v.price) || 0), stock: Number(v.stock) || 0, minStock: Math.max(0, Number(v.minStock) || 0), barcode: (v.barcode || '').trim(), noStock: !!v.noStock, priceFromHistory: false, deleted: false, updatedBy: user.name };
    if (canSeeCost() && v.cost !== undefined) rec.cost = round2(Number(v.cost) || 0);
    else if (isNew) rec.cost = 0;
    if (isNew) rec.group = '';
    await backend.saveProduct(shopId, rec);
    toast('บันทึกสินค้าแล้ว'); viewProducts();
  });
}
function viewProducts() {
  view.innerHTML = `<section class="card">
    <div class="row" style="justify-content:space-between"><h2>สินค้า (${liveProducts().length})</h2><span class="row">${isManager() ? '<a class="btn" href="#prices">ปรับราคาหลายรายการ</a>' : ''}<button class="btn primary" id="addp">+ เพิ่มสินค้า</button></span></div>
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

// ---------------- one search box for customers, products and bills ----------------
let searchQ = '', searchF = '';
const recentKey = () => 'recentSearch:' + shopId;
const recentList = () => { try { return JSON.parse(localStorage.getItem(recentKey()) || '[]'); } catch { return []; } };
function rememberSearch(q) { q = q.trim(); if (q.length < 2) return; try { localStorage.setItem(recentKey(), JSON.stringify([q, ...recentList().filter((x) => x !== q)].slice(0, 8))); } catch { /* ignore */ } }
// Wrap the first match of q in <mark> (text is escaped first).
function hl(text, q) {
  const t = String(text ?? ''); const i = q ? norm(t).indexOf(norm(q)) : -1;
  if (i < 0 || norm(t).length !== t.length) return esc(t);
  return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
}
function addToCart(code) {
  const p = data.products.find((x) => x.code === code); if (!p) return;
  const ex = cart.lines.find((l) => l.code === code);
  if (ex) ex.qty = round2(ex.qty + 1); else cart.lines.push({ code, qty: 1, price: p.price });
  toast(`เพิ่ม ${p.name} ลงบิลแล้ว`);
}
function viewSearch(arg) {
  if (arg) searchQ = decodeURIComponent(arg);
  const voice = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  view.innerHTML = `<section class="card search-card">
    <label class="search-box">${icon('search', 22)}<input type="search" id="gq" value="${esc(searchQ)}" placeholder="ค้นหาลูกค้า สินค้า หรือเลขบิล" autocomplete="off" aria-label="ค้นหา">
      ${voice ? `<button type="button" class="icon-btn" id="gmic" aria-label="ค้นหาด้วยเสียง">${icon('mic', 20)}</button>` : ''}</label>
    <div class="row" id="gchips" style="gap:8px"></div>
    <div id="gout"></div></section>`;
  const cm = custBy(), debts = customerDebts(data, todayIso()), stale = new Set(stalePayers(data, todayIso()).map((r) => r.code));
  const draw = () => {
    const q = $('#gq').value.trim(); searchQ = q;
    if (!q) {
      const rec = recentList();
      $('#gchips').innerHTML = '';
      $('#gout').innerHTML = rec.length ? `<div class="g-head">ค้นหาล่าสุด</div><div class="row" style="gap:8px">${rec.map((r) => `<button type="button" class="chip" data-recent="${esc(r)}">${esc(r)}</button>`).join('')}</div>` : '<div class="muted">พิมพ์ชื่อลูกค้า หมู่บ้าน เบอร์โทร ชื่อสินค้า บาร์โค้ด หรือเลขที่บิล</div>';
      return;
    }
    const n = norm(q);
    const custs = data.customers.filter((c) => !c.deleted && (norm(c.name).includes(n) || norm(c.zone).includes(n) || c.code.startsWith(q) || (c.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '@'))).slice(0, 30);
    const prods = liveProducts().filter((p) => norm(p.name).includes(n) || p.code.startsWith(q) || (p.barcode && p.barcode === q)).slice(0, 30);
    const codes = new Set(custs.map((c) => c.code));
    const docs = [...data.bills.map((b) => ({ ...b, kind: 'bill' })), ...data.receipts.map((r) => ({ ...r, kind: 'rcp' }))]
      .filter((d) => norm(d.no).includes(n) || codes.has(d.customerCode)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
    const tabs = [['', 'ทั้งหมด', custs.length + prods.length + docs.length], ['c', 'ลูกค้า', custs.length], ['p', 'สินค้า', prods.length], ['b', 'บิล', docs.length]];
    $('#gchips').innerHTML = tabs.map(([k, t, c]) => `<button type="button" class="chip" data-gf="${k}" aria-pressed="${searchF === k}">${t} ${c}</button>`).join('');
    const show = (k) => !searchF || searchF === k;
    const cRow = (c) => { const d = debts.get(c.code); return `<a class="g-row" href="#debt/${encodeURIComponent(c.code)}"><span class="g-av">${esc((c.name || '?').replace(/^(ลุง|ป้า|น้า|นาย|นาง|พี่|แม่)/, '').trim().charAt(0) || '?')}</span>
      <span class="g-main"><b>${hl(c.name, q)}</b><small>${hl(c.zone || '', q)} · ${hl(c.code, q)}${c.phone ? ' · ' + esc(c.phone) : ''}</small></span>
      <span class="g-end">${d ? `<b class="mono" style="color:var(--orange-ink)">${money(d.total)}</b><small${stale.has(c.code) ? ' style="color:var(--red)"' : ''}>${stale.has(c.code) ? 'ไม่ชำระเกิน 6 เดือน' : `ค้าง ${d.bills.length} บิล`}</small>` : '<small style="color:var(--green)">ไม่มีหนี้</small>'}</span></a>`; };
    const pRow = (p) => `<button type="button" class="g-row" data-addp="${esc(p.code)}"><span class="g-main"><b>${hl(p.name, q)}</b><small>${hl(p.code, q)} · คงเหลือ ${p.noStock ? 'บริการ' : qtyFmt(p.stock) + ' ' + esc(p.unit)}</small></span>
      <span class="g-end"><b class="mono">${p.price ? money(p.price) : '-'}</b><small style="color:var(--green)">+ ลงบิลขาย</small></span></button>`;
    const dRow = (d) => `<button type="button" class="g-row" data-doc="${esc(d.no)}" data-kind="${d.kind}"><span class="g-main"><b class="mono">${hl(d.no, q)}</b><small>${thDate(d.date)} · ${d.kind === 'rcp' ? 'ใบเสร็จ · ' : ''}${esc(custLabel(d.customerCode))}</small></span>
      <span class="g-end"><span class="g-tag ${d.kind === 'rcp' ? 'ok' : d.status === 'open' ? 'warn' : d.status === 'cancelled' || d.status === 'void' ? 'bad' : ''}">${d.kind === 'rcp' ? (d.status === 'void' ? 'ยกเลิก' : 'รับเงิน') : d.status === 'open' ? 'ค้าง' : d.status === 'cancelled' ? 'ยกเลิก' : d.type === 'credit' ? 'ชำระแล้ว' : 'เงินสด'}</span><b class="mono">${money(d.total)}</b></span></button>`;
    const looksNo = /^\d{2}-(BS|RP)\d{6,}/i.test(q) && !docs.some((d) => d.no === q.toUpperCase());
    $('#gout').innerHTML = [
      show('c') && custs.length ? `<div class="g-head">ลูกค้า</div><div class="g-list">${custs.map(cRow).join('')}</div>` : '',
      show('p') && prods.length ? `<div class="g-head">สินค้า</div><div class="g-list">${prods.map(pRow).join('')}</div>` : '',
      show('b') && docs.length ? `<div class="g-head">บิลและใบเสร็จ</div><div class="g-list">${docs.map(dRow).join('')}</div>` : '',
      looksNo ? `<button type="button" class="btn" id="gold">ค้นหาเลข ${esc(q.toUpperCase())} ในบิลเก่าทั้งหมด</button>` : '',
    ].join('') || '<div class="empty">ไม่พบ ลองพิมพ์สั้นลง เช่น 2–3 ตัวอักษร</div>';
    $$('#gchips [data-gf]').forEach((b) => b.addEventListener('click', () => { searchF = b.dataset.gf; draw(); }));
    $$('#gout [data-addp]').forEach((b) => b.addEventListener('click', () => { rememberSearch(q); addToCart(b.dataset.addp); location.hash = 'sale'; }));
    $$('#gout [data-doc]').forEach((b) => b.addEventListener('click', () => { rememberSearch(q); const d = docs.find((x) => x.no === b.dataset.doc); if (d.kind === 'bill') showBill(d); else location.hash = 'debt/' + encodeURIComponent(d.customerCode); }));
    $$('#gout a.g-row').forEach((a) => a.addEventListener('click', () => rememberSearch(q)));
    $('#gold')?.addEventListener('click', async () => { const r = await backend.findBills(shopId, { no: q.toUpperCase() }).catch(() => []); if (r[0]) showBill(r[0]); else toast('ไม่พบบิลเลขนี้'); });
  };
  $('#gq').addEventListener('input', draw);
  $('#gq').addEventListener('keydown', (e) => { if (e.key === 'Enter') rememberSearch(e.target.value); });
  $('#gout').addEventListener('click', (e) => { const b = e.target.closest('[data-recent]'); if (b) { $('#gq').value = b.dataset.recent; draw(); } });
  $('#gmic')?.addEventListener('click', () => {
    const R = window.SpeechRecognition || window.webkitSpeechRecognition; const r = new R(); r.lang = 'th-TH'; r.interimResults = false;
    $('#gmic').classList.add('on'); r.onresult = (e) => { $('#gq').value = e.results[0][0].transcript.trim(); draw(); rememberSearch($('#gq').value); };
    r.onend = () => $('#gmic')?.classList.remove('on'); r.onerror = () => toast('ฟังเสียงไม่ได้ ลองพิมพ์แทน'); r.start();
  });
  draw(); $('#gq').focus();
}

// ---------------- change many prices at once (owner) ----------------
let priceSel = new Set();
function viewPrices() {
  if (!isManager()) { location.hash = 'products'; return; }
  view.innerHTML = `<div><a href="#products" class="btn small">← สินค้า</a></div>
  <section class="card">
    <h2>ปรับราคาหลายรายการ</h2>
    <div class="price-rule">
      <label class="field">ปรับแบบ<select id="pmode"><option value="add">เพิ่มขึ้น (บาท)</option><option value="sub">ลดลง (บาท)</option><option value="pct">เพิ่มขึ้น (%)</option><option value="pctdown">ลดลง (%)</option><option value="set">ตั้งราคาเป็น (บาท)</option></select></label>
      <label class="field">จำนวน<input type="number" id="pval" min="0" step="0.01" inputmode="decimal" placeholder="เช่น 30" style="font-size:20px;font-family:var(--mono)"></label>
      <label class="field">ปัดเศษ<select id="pround"><option value="0">ไม่ปัด</option><option value="1">ปัดขึ้นเป็นบาท</option><option value="5">ปัดขึ้นทีละ 5 บาท</option><option value="10">ปัดขึ้นทีละ 10 บาท</option></select></label>
    </div>
    <div class="row"><input type="search" id="psq" placeholder="ค้นหาสินค้าที่จะปรับ เช่น ปุ๋ย" style="flex:1;min-width:200px" autocomplete="off">
      <button class="btn small" id="pall">เลือกทั้งหมดที่แสดง</button><button class="btn small" id="pnone">ไม่เลือกเลย</button></div>
    <div class="scroll"><table id="ptbl"></table></div>
    <div class="row" style="justify-content:space-between;position:sticky;bottom:0;background:var(--card);padding:10px 0"><b id="psum"></b><button class="btn primary" id="papply">ปรับราคา</button></div>
  </section>`;
  const rule = () => ({ mode: $('#pmode').value, v: Number($('#pval').value), step: Number($('#pround').value) });
  const calc = (price, r) => {
    if (!(r.v >= 0) || $('#pval').value === '') return null;
    let n = r.mode === 'add' ? price + r.v : r.mode === 'sub' ? price - r.v : r.mode === 'pct' ? price * (1 + r.v / 100) : r.mode === 'pctdown' ? price * (1 - r.v / 100) : r.v;
    if (r.step) n = Math.ceil(n / r.step - 1e-9) * r.step;
    return Math.max(0, round2(n));
  };
  const shown = () => { const q = norm($('#psq').value); return liveProducts().filter((p) => !q || norm(p.name).includes(q) || p.code.startsWith($('#psq').value.trim())).sort((a, b) => a.name.localeCompare(b.name, 'th')); };
  const draw = () => {
    const r = rule(), list = shown();
    $('#ptbl').innerHTML = `<tr><th style="width:36px"></th><th>สินค้า</th><th>หน่วย</th><th class="num">ราคาเดิม</th><th class="num">ราคาใหม่</th></tr>` + list.slice(0, 400).map((p) => {
      const on = priceSel.has(p.code), n = on && (p.price > 0 || r.mode === 'set') ? calc(p.price || 0, r) : null;
      return `<tr class="clickable" data-c="${esc(p.code)}"><td><input type="checkbox" ${on ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--green)" tabindex="-1"></td><td>${esc(p.name)}</td><td>${esc(p.unit)}</td><td class="num">${money(p.price || 0)}</td><td class="num">${n === null ? '' : `<b style="color:${n > (p.price || 0) ? 'var(--orange-ink)' : n < (p.price || 0) ? 'var(--green)' : 'inherit'}">${money(n)}</b>`}</td></tr>`;
    }).join('');
    $('#psum').textContent = `เลือกแล้ว ${priceSel.size} รายการ`;
  };
  $('#ptbl').addEventListener('click', (e) => { const tr = e.target.closest('[data-c]'); if (!tr) return; const c = tr.dataset.c; priceSel.has(c) ? priceSel.delete(c) : priceSel.add(c); draw(); });
  $('#pall').addEventListener('click', () => { shown().forEach((p) => priceSel.add(p.code)); draw(); });
  $('#pnone').addEventListener('click', () => { priceSel.clear(); draw(); });
  ['#pmode', '#pval', '#pround', '#psq'].forEach((id) => $(id).addEventListener('input', draw));
  $('#papply').addEventListener('click', () => {
    const r = rule();
    // products without a price are only changed by "ตั้งราคาเป็น" (adding to 0 makes no sense)
    const changes = liveProducts().filter((p) => priceSel.has(p.code) && (p.price > 0 || r.mode === 'set')).map((p) => ({ code: p.code, name: p.name, old: p.price || 0, price: calc(p.price || 0, r) })).filter((x) => x.price !== null && x.price !== x.old);
    if (!priceSel.size) { toast('ยังไม่ได้เลือกสินค้า'); return; }
    if ($('#pval').value === '') { toast('ใส่จำนวนที่จะปรับ'); $('#pval').focus(); return; }
    if (!changes.length) { toast('ราคาไม่เปลี่ยน'); return; }
    const desc = `${$('#pmode').selectedOptions[0].text} ${r.v}${r.step ? ' · ' + $('#pround').selectedOptions[0].text : ''}`;
    openDialog(`<h2>ยืนยันปรับราคา ${changes.length} รายการ</h2><div>${esc(desc)}</div>
      <div class="scroll" style="max-height:260px"><table>${changes.slice(0, 50).map((x) => `<tr><td>${esc(x.name)}</td><td class="num">${money(x.old)} → <b>${money(x.price)}</b></td></tr>`).join('')}${changes.length > 50 ? `<tr><td colspan="2" class="muted">และอีก ${changes.length - 50} รายการ</td></tr>` : ''}</table></div>
      <div class="muted" style="font-size:13px">บิลเก่าไม่เปลี่ยน ราคาใหม่ใช้กับบิลที่ขายหลังจากนี้ · บันทึกไว้ในประวัติการแก้ไข</div>
      <div class="err hidden dlg-err"></div>
      <div class="row"><button class="btn primary" value="ok">ปรับราคา</button><button class="btn" value="cancel">ยกเลิก</button></div>`, async () => {
      await backend.setPrices(shopId, changes, desc);
      toast(`ปรับราคาแล้ว ${changes.length} รายการ`); priceSel.clear(); setTimeout(viewPrices, 0);
    });
  });
  draw(); $('#psq').focus();
}

// ---------------- staff codes ----------------
async function viewUsers() {
  view.innerHTML = '<div class="card"><div class="row"><span class="spinner"></span> กำลังโหลด…</div></div>';
  let users;
  try { users = await backend.listUsers(); } catch (e) { view.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
  const shopLabel = (id) => shops.find((s) => s.id === id)?.label || id;
  const asAdmin = role() === 'admin';
  const canDelete = user.role === 'admin' && !previewing(); // only the real super-admin
  const myShops = asAdmin ? shops : shops.filter((s) => s.id === shopId || user.shops?.includes(s.id));
  const roles = asAdmin ? ['owner', 'staff', 'admin'] : ['staff'];
  if (!asAdmin) users = users.filter((u) => u.uid === user.uid || (u.shops || []).includes(shopId));
  view.innerHTML = `<section class="card">
    <div class="row" style="justify-content:space-between"><h2>รหัสเข้าระบบ</h2><button class="btn primary" id="addu">+ เพิ่มรหัส</button></div>
    <div class="scroll"><table><tr><th>รหัส</th><th>ชื่อ</th><th>หน้าที่</th><th>ร้าน</th><th>สถานะ</th><th></th></tr>
    ${users.sort((a, b) => (a.code < b.code ? -1 : 1)).map((u) => `<tr><td class="mono">${esc(u.code)}</td><td>${esc(u.name)}</td><td>${ROLE[u.role] || esc(u.role)}</td>
      <td>${u.role === 'admin' ? 'ทุกร้าน' : (u.shops || []).map((s) => esc(shopLabel(s))).join(', ')}</td>
      <td>${u.active ? '<span class="pill cash">ใช้งาน</span>' : '<span class="pill cancel">ปิด</span>'}</td>
      <td>${u.uid !== user.uid && (asAdmin || ['staff', 'secretary'].includes(u.role)) ? `<button class="btn small" data-toggle="${esc(u.uid)}" data-active="${u.active ? 1 : 0}">${u.active ? 'ปิดรหัส' : 'เปิดรหัส'}</button>` : ''}${canDelete && u.uid !== user.uid ? ` <button class="btn small" data-deluser="${esc(u.uid)}" data-code="${esc(u.code)}" data-name="${esc(u.name)}" style="color:var(--red)">ลบ</button>` : ''}</td></tr>`).join('')}
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
  $$('[data-deluser]').forEach((b) => b.addEventListener('click', () => {
    const { deluser: uid, code, name } = b.dataset;
    openDialog(`<h2 style="color:var(--red)">ลบรหัส <span class="mono">${esc(code)}</span></h2>
      <div>${esc(name)} · คนที่ใช้รหัสนี้จะเข้าระบบไม่ได้อีก และรหัสจะหายจากรายการ</div>
      <div class="note">บิลและใบเสร็จที่คนนี้เคยทำยังอยู่ครบ (ชื่อผู้ขายยังแสดงตามเดิม) · ถ้าแค่พักใช้ชั่วคราว ให้ใช้ "ปิดรหัส" แทน</div>
      <label class="field">พิมพ์รหัส <b class="mono">${esc(code)}</b> เพื่อยืนยัน<input type="text" name="confirm" autocomplete="off" required style="font-family:var(--mono)"></label>
      <div class="err hidden dlg-err"></div>
      <div class="row"><button class="btn primary" value="ok" style="background:var(--red);border-color:var(--red)">ลบรหัสนี้</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></div>`, async (f) => {
      if (f.confirm.value.trim() !== code) throw new Error('พิมพ์รหัสไม่ตรง');
      await backend.deleteUser(uid);
      toast(`ลบรหัส ${code} แล้ว`); setTimeout(viewUsers, 0);
    });
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
// An import keeps running if the person opens another page; the header shows its progress.
const importRun = { running: false, shopId: null, pct: 0 };
window.addEventListener('beforeunload', (e) => { if (importRun.running) { e.preventDefault(); e.returnValue = ''; } });
function drawImportBadge() {
  $('#importBadge')?.remove();
  if (!importRun.running) return;
  $('#shopName')?.insertAdjacentHTML('afterend', `<a id="importBadge" class="pill" href="#import" style="background:var(--orange);color:#fff">กำลังนำเข้า ${Math.round(importRun.pct * 100)}% · อย่าปิดโปรแกรม</a>`);
}
const QUOTA_DAY = 20000;
async function viewImport() {
  const info = await backend.shopInfo(shopId).catch(() => ({}));
  view.innerHTML = `${dataTabs('import')}
  ${importRun.running ? `<div class="ok" id="importLive">กำลังบันทึก… ${Math.round(importRun.pct * 100)}%</div>` : ''}
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
    const nWrites = result.customers.length + result.products.length + result.bills.length + (result.receipts || []).length;
    const job = backend.importJob(shopId, result);
    $('#warnings').innerHTML = s.warnings.map((w) => `<div class="note">${esc(w)}</div>`).join('')
      + (backend.mode === 'cloud' && nWrites > QUOTA_DAY * 0.85 ? `<div class="note">ข้อมูลชุดนี้ต้องบันทึก <b>${nWrites.toLocaleString()} รายการ</b> · Firebase แบบฟรีบันทึกได้วันละ ${QUOTA_DAY.toLocaleString()} รายการ อาจนำเข้าไม่จบในวันเดียว (ถ้าค้าง กด "นำเข้าต่อ" วันถัดไปหลัง 15:00 น. ได้ ข้อมูลไม่หาย) · หรือเลือก <b>ช่วงปีให้น้อยลง</b> บิลค้างชำระมาครบทุกปีอยู่แล้ว</div>` : '')
      + (job?.same ? `<div class="ok">มีการนำเข้าข้อมูลชุดนี้ค้างไว้ ${Math.round(job.pct * 100)}% · กด "นำเข้าต่อ" จะทำต่อจากเดิม ไม่ลบหรือบันทึกซ้ำ</div>` : '');
    $('#btnImport').textContent = job?.same ? `นำเข้าต่อ (ค้าง ${Math.round(job.pct * 100)}%)` : 'นำเข้าข้อมูล';
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
    if (importRun.running) { message('กำลังนำเข้าอยู่แล้ว รอให้เสร็จก่อน'); return; }
    const btn = $('#btnImport'); btn.disabled = true;
    const targetShop = shopId;
    Object.assign(importRun, { running: true, shopId: targetShop, pct: 0 }); drawImportBadge();
    const show = (t) => { for (const el of [$('#importState'), $('#importLive')]) if (el) el.textContent = t; };
    try {
      await backend.replaceShopData(targetShop, result, (p) => { importRun.pct = p; show(`กำลังบันทึก… ${Math.round(p * 100)}% · เปิดหน้าอื่นได้ แต่อย่าปิดโปรแกรม`); drawImportBadge(); });
      importRun.running = false; drawImportBadge();
      show('');
      toast('นำเข้าข้อมูลเรียบร้อย');
      if (backend.mode === 'local' && shopId === targetShop) { shop = await backend.openShop(shopId, onRemoteChange); data = shop.data; }
      if (!$('#msg')) return;
      message(`นำเข้าเรียบร้อย · ลูกค้า ${result.summary.customers} · สินค้า ${result.summary.products} · บิล ${result.summary.bills.toLocaleString()} · ค้าง ฿${money(result.summary.openPrincipal)}`, 'ok');
    } catch (e) {
      importRun.running = false; drawImportBadge(); show('');
      if ($('#msg')) message('นำเข้ายังไม่เสร็จ: ' + esc(e.message) + '<br>ข้อมูลที่บันทึกแล้วไม่หาย · เลือกไฟล์เดิม กด "ดูสรุปก่อนนำเข้า" แล้วกด <b>"นำเข้าต่อ"</b> เพื่อทำต่อจากที่ค้าง');
      else alert('นำเข้ายังไม่เสร็จ: ' + e.message);
    } finally { if (btn.isConnected) btn.disabled = false; }
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
  view.innerHTML = `${dataTabs('backup')}
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
    try { bk = JSON.parse(await file.text()); if (!['dreamshop-kaset-backup', 'nutdechashop-kaset-backup'].includes(bk.format)) throw new Error(); }
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
