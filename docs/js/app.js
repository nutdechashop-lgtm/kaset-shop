// Main program: sales, debtors & payments, bill search, customers, products, shop settings.
import { getData, saveData, getSettings, saveSettings } from './store.js';
import { RATES, GRACE_MONTHS, DEFAULT_SETTINGS, todayIso, createSale, customerDebts, receivePayment, nextCustomerCode, nextProductCode, zones, daySummary } from './shop.js';
import { round2, allocatePayment, billBalance, daysBetween, interestStart } from './interest.js';

let data, settings;
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

function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
async function persist() { await saveData(data); }

// ---------------- routing ----------------
const routes = { sale: viewSale, debt: viewDebt, bills: viewBills, customers: viewCustomers, products: viewProducts, settings: viewSettings };
function render() {
  const [name, arg] = (location.hash.slice(1) || 'sale').split('/');
  const fn = routes[name] || viewSale;
  $$('#nav a').forEach((a) => a.toggleAttribute('aria-current', a.getAttribute('href') === '#' + (routes[name] ? name : 'sale')));
  $$('#nav a').forEach((a) => { if (a.hasAttribute('aria-current')) a.setAttribute('aria-current', 'page'); });
  $('#shopName').textContent = settings.name || 'ระบบหน้าร้าน';
  $('#today').textContent = 'วันที่ ' + thDate(todayIso());
  fn(arg ? decodeURIComponent(arg) : undefined);
}
window.addEventListener('hashchange', render);

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
    try { if (await onSubmit?.(form, btn.value) !== false) dlg.close(); }
    catch (err) { const m = $('.dlg-err', dlg); if (m) { m.textContent = err.message; m.classList.remove('hidden'); } else alert(err.message); }
  });
  dlg.showModal();
  return form;
}

// ---------------- sale ----------------
const cart = { lines: [], type: 'cash', customerCode: '', rate: null, grace: false, graceMonths: null, discount: 0, note: '' };
function resetCart() { Object.assign(cart, { lines: [], type: 'cash', customerCode: '', rate: settings.defaultRate, grace: false, graceMonths: settings.defaultGraceMonths, discount: 0 }); }

function searchProducts(q) {
  const n = norm(q); if (!n) return [];
  return data.products.filter((p) => norm(p.name).includes(n) || p.code.startsWith(q.trim())).slice(0, 30);
}
function searchCustomers(q) {
  const n = norm(q); if (!n) return [];
  return data.customers.filter((c) => norm(c.name).includes(n) || norm(c.zone).includes(n) || c.code.startsWith(q.trim())).slice(0, 20);
}

function viewSale() {
  if (cart.rate == null) resetCart();
  const today = daySummary(data, todayIso());
  view.innerHTML = `
  ${!data.products.length ? `<div class="note">ยังไม่มีสินค้าในเครื่องนี้ · <a href="import.html">นำเข้าข้อมูลจากโปรแกรมเก่า</a> หรือเพิ่มสินค้าที่เมนู <a href="#products">สินค้า</a></div>` : ''}
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
        <label class="row" style="font-weight:600;min-height:44px"><input type="checkbox" id="grace" ${cart.grace ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--green)"> บิลงานขาย (ปลอดดอก)</label>
        <label class="field ${cart.grace ? '' : 'hidden'}" id="graceWrap">ปลอดดอกกี่เดือน (เดือนละ 30 วัน)
          <select id="graceMonths">${GRACE_MONTHS.map((m) => `<option value="${m}" ${m === cart.graceMonths ? 'selected' : ''}>${m} เดือน</option>`).join('')}</select>
        </label>
        <div class="muted" id="interestHint" style="font-size:14px"></div>
      </div>
      <label class="field">ส่วนลด (บาท)<input type="number" id="disc" min="0" step="0.01" value="${cart.discount || ''}" placeholder="0"></label>
      <div>
        <div class="total-box"><span>รวม</span><span class="mono" id="sub"></span></div>
        <div class="total-box big"><span>สุทธิ</span><span class="mono" id="net"></span></div>
      </div>
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
      $('#interestHint').textContent = cart.rate ? `ดอกเบี้ยวันละ ฿${money(perDay)} (30 วัน = ฿${money(net * cart.rate / 100)})${cart.grace ? ` · เริ่มคิดหลัง ${cart.graceMonths * 30} วัน` : ''}` : 'ไม่คิดดอกเบี้ย';
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

  // customer
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
  $('#grace')?.addEventListener('change', (e) => { cart.grace = e.target.checked; $('#graceWrap').classList.toggle('hidden', !cart.grace); drawTotals(); });
  $('#graceMonths')?.addEventListener('change', (e) => { cart.graceMonths = Number(e.target.value); drawTotals(); });
  $('#disc').addEventListener('input', (e) => { cart.discount = Number(e.target.value) || 0; drawTotals(); });
  $('#clear').addEventListener('click', () => { resetCart(); viewSale(); });
  $('#save').addEventListener('click', async () => {
    const err = $('#saleErr'); err.classList.add('hidden');
    let bill;
    try {
      bill = createSale(data, settings, { type: cart.type, customerCode: cart.customerCode, lines: cart.lines, discount: cart.discount, rate: cart.rate, graceMonths: cart.type === 'credit' && cart.grace ? cart.graceMonths : 0 });
      await persist();
    } catch (e) { err.textContent = e.message; err.classList.remove('hidden'); return; }
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
    <div class="row" style="justify-content:space-between"><h2>ลูกหนี้ทั้งหมด ณ วันที่ ${thDate(asOf)}</h2></div>
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
  const history = data.receipts.filter((r) => r.customerCode === code).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 10);
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
    ${history.length ? `<div class="scroll"><table><tr><th>เลขที่</th><th>วันที่</th><th class="num">บิล</th><th class="num">เงินต้น</th><th class="num">ดอกเบี้ย</th><th class="num">รวม</th><th></th></tr>
      ${history.map((r) => `<tr><td class="mono">${esc(r.no)}</td><td>${thDate(r.date)}</td><td class="num">${r.rows ? r.rows.length : ''}</td><td class="num">${r.rows ? money(r.totalPrincipal) : ''}</td><td class="num">${r.rows ? money(r.totalInterest) : ''}</td><td class="num">${money(r.total)}</td><td>${r.rows ? `<button class="btn small" data-rp="${esc(r.no)}">พิมพ์</button>` : '<span class="muted" style="font-size:13px">จากโปรแกรมเก่า</span>'}</td></tr>`).join('')}</table></div>` : '<div class="empty">ยังไม่มี</div>'}
  </section>`;
  $$('[data-rp]').forEach((b) => b.addEventListener('click', () => printReceipt(data.receipts.find((r) => r.no === b.dataset.rp))));
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
    let r;
    try {
      r = receivePayment(data, settings, { customerCode: code, date: asOf, mode, amount: $('#amt').value, billNos: [...selected] });
      await persist();
    } catch (e) { $('#payErr').textContent = e.message; $('#payErr').classList.remove('hidden'); return; }
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
  const st = b.status === 'cancelled' ? '<span class="pill cancel">ยกเลิก</span>' : b.type === 'credit' ? (b.status === 'open' ? '<span class="pill credit">ค้างชำระ</span>' : '<span class="pill cash">ชำระแล้ว</span>') : '<span class="pill cash">เงินสด</span>';
  openDialog(`<h2 class="mono">${esc(b.no)}</h2>
    <div>${thDate(b.date)} · ${b.type === 'credit' ? 'เงินเชื่อ ' + b.rate + '%' : 'เงินสด'} ${st}${b.graceDays ? ` · ปลอดดอก ${b.graceDays / 30} เดือน` : ''}</div>
    <div>${esc(custLabel(b.customerCode))}</div>
    <div class="scroll"><table><tr><th>รายการ</th><th class="num">จำนวน</th><th class="num">ราคา</th><th class="num">รวม</th></tr>
    ${b.lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="num">${qtyFmt(l.qty)} ${esc(l.unit)}</td><td class="num">${money(l.price)}</td><td class="num">${money(l.amount)}</td></tr>`).join('')}</table></div>
    ${b.discount ? `<div class="total-box"><span>ส่วนลด</span><span class="mono">${money(b.discount)}</span></div>` : ''}
    <div class="total-box big"><span>สุทธิ</span><span class="mono">${money(b.total)}</span></div>
    ${b.receiptNo ? `<div class="muted">ชำระในใบเสร็จ ${esc(b.receiptNo)} ${b.paidDate ? 'วันที่ ' + thDate(b.paidDate) : ''}</div>` : ''}
    <div class="row"><button class="btn primary" value="print">พิมพ์บิล</button><button class="btn" value="cancel">ปิด</button></div>`, () => { printBill(b); });
}

function viewBills() {
  view.innerHTML = `<section class="card">
    <h2>ค้นหาบิล</h2>
    <div class="row">
      <input type="search" id="bq" placeholder="เลขที่บิล หรือชื่อลูกค้า" style="flex:1;min-width:220px" autocomplete="off">
      <select id="bf"><option value="">ทุกบิล</option><option value="open">ค้างชำระ</option><option value="credit">เงินเชื่อ</option><option value="cash">เงินสด</option><option value="cancelled">ยกเลิก</option></select>
    </div>
    <div class="scroll"><table id="blt"></table></div>
    <div class="muted" id="bcount" style="font-size:14px"></div>
  </section>`;
  const cm = custBy();
  const sorted = [...data.bills].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.no < b.no ? 1 : -1));
  const draw = () => {
    const q = $('#bq').value.trim(), n = norm(q), f = $('#bf').value;
    const list = sorted.filter((b) => (!f || (f === 'open' ? b.status === 'open' : f === 'cancelled' ? b.status === 'cancelled' : b.type === f))
      && (!n || norm(b.no).includes(n) || norm(cm.get(b.customerCode)?.name).includes(n)));
    $('#blt').innerHTML = `<tr><th>เลขที่</th><th>วันที่</th><th>ลูกค้า</th><th>ประเภท</th><th class="num">ยอด</th></tr>`
      + (list.length ? list.slice(0, 200).map((b) => `<tr class="clickable" data-no="${esc(b.no)}" tabindex="0"><td class="mono">${esc(b.no)}</td><td>${thDate(b.date)}</td><td>${esc(custLabel(b.customerCode, cm))}</td><td>${b.status === 'cancelled' ? '<span class="pill cancel">ยกเลิก</span>' : b.type === 'credit' ? `<span class="pill credit">เชื่อ${b.status === 'open' ? ' · ค้าง' : ''}</span>` : '<span class="pill cash">สด</span>'}</td><td class="num">${money(b.total)}</td></tr>`).join('')
        : '<tr><td colspan="5" class="empty">ไม่พบบิล</td></tr>');
    $('#bcount').textContent = list.length > 200 ? `แสดง 200 จาก ${list.length.toLocaleString()} บิล พิมพ์ค้นหาให้แคบลง` : `${list.length.toLocaleString()} บิล`;
  };
  $('#bq').addEventListener('input', draw); $('#bf').addEventListener('change', draw);
  const open = (e) => { const tr = e.target.closest('[data-no]'); if (tr) showBill(data.bills.find((b) => b.no === tr.dataset.no)); };
  $('#blt').addEventListener('click', open);
  $('#blt').addEventListener('keydown', (e) => { if (e.key === 'Enter') open(e); });
  draw(); $('#bq').focus();
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
    v.code = v.code.trim(); v.name = v.name.trim(); v.zone = v.zone.trim();
    if (!v.name) throw new Error('ใส่ชื่อลูกค้า');
    if (isNew) {
      if (data.customers.some((x) => x.code === v.code)) throw new Error('รหัสนี้มีแล้ว');
      data.customers.push({ code: v.code, name: v.name, phone: v.phone.trim(), zone: v.zone, rate: 0 });
    } else Object.assign(data.customers.find((x) => x.code === c.code), { name: v.name, phone: v.phone.trim(), zone: v.zone });
    await persist(); toast('บันทึกลูกค้าแล้ว'); viewCustomers();
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
      <label class="field" id="stockWrap">สต๊อกคงเหลือ<input type="number" name="stock" step="any" value="${p.stock ?? 0}"></label>
    </div>
    <label class="row" style="font-weight:600;min-height:44px"><input type="checkbox" name="noStock" ${p.noStock ? 'checked' : ''} style="width:22px;height:22px;accent-color:var(--green)"> ไม่มีสต๊อก (งานบริการ เช่น ไถแปร โดรนพ่นยา)</label>
    <div class="muted" style="font-size:13px">ราคาทุน: ต้องขอรหัสจากแอดมิน (จะเปิดใช้เมื่อระบบออนไลน์พร้อม)</div>
    <div class="err hidden dlg-err"></div>
    <div class="row"><button class="btn primary" value="save">บันทึก</button><button class="btn" value="cancel" formnovalidate>ยกเลิก</button></div>`, async (f) => {
    const v = Object.fromEntries(new FormData(f));
    if (!v.name.trim()) throw new Error('ใส่ชื่อสินค้า');
    const rec = { name: v.name.trim(), unit: v.unit.trim() || 'หน่วย', price: round2(Number(v.price) || 0), stock: Number(v.stock) || 0, noStock: !!v.noStock };
    if (isNew) {
      if (data.products.some((x) => x.code === v.code.trim())) throw new Error('รหัสนี้มีแล้ว');
      data.products.push({ code: v.code.trim(), cost: 0, group: '', ...rec });
    } else Object.assign(data.products.find((x) => x.code === p.code), rec, { priceFromHistory: false });
    await persist(); toast('บันทึกสินค้าแล้ว'); viewProducts();
  });
}
function viewProducts() {
  view.innerHTML = `<section class="card">
    <div class="row" style="justify-content:space-between"><h2>สินค้า (${data.products.length})</h2><button class="btn primary" id="addp">+ เพิ่มสินค้า</button></div>
    <div class="row"><input type="search" id="pq2" placeholder="ค้นหาชื่อสินค้า" style="flex:1;min-width:220px" autocomplete="off">
      <select id="pf"><option value="">ทั้งหมด</option><option value="neg">สต๊อกติดลบ</option><option value="noprice">ยังไม่มีราคา</option><option value="service">ไม่มีสต๊อก (บริการ)</option></select></div>
    <div class="scroll"><table id="ptab"></table></div>
  </section>`;
  const draw = () => {
    const n = norm($('#pq2').value), f = $('#pf').value;
    const list = data.products.filter((p) => (!n || norm(p.name).includes(n) || p.code.startsWith($('#pq2').value.trim()))
      && (!f || (f === 'neg' ? !p.noStock && p.stock < 0 : f === 'noprice' ? !p.price : p.noStock))).sort((a, b) => a.name.localeCompare(b.name, 'th'));
    $('#ptab').innerHTML = `<tr><th>รหัส</th><th>ชื่อ</th><th>หน่วย</th><th class="num">ราคาขาย</th><th class="num">คงเหลือ</th><th></th></tr>`
      + (list.length ? list.slice(0, 300).map((p) => `<tr><td class="mono">${esc(p.code)}</td><td>${esc(p.name)}</td><td>${esc(p.unit)}</td><td class="num">${p.price ? money(p.price) : '<span class="pill credit">ไม่มีราคา</span>'}</td><td class="num">${p.noStock ? '<span class="muted">ไม่มีสต๊อก</span>' : `<span style="${p.stock < 0 ? 'color:var(--red);font-weight:600' : ''}">${qtyFmt(p.stock)}</span>`}</td><td><button class="btn small" data-e="${esc(p.code)}">แก้ไข</button></td></tr>`).join('')
        : '<tr><td colspan="6" class="empty">ไม่พบสินค้า</td></tr>');
  };
  $('#pq2').addEventListener('input', draw); $('#pf').addEventListener('change', draw);
  $('#ptab').addEventListener('click', (e) => { const b = e.target.closest('[data-e]'); if (b) productForm(data.products.find((p) => p.code === b.dataset.e)); });
  $('#addp').addEventListener('click', () => productForm());
  draw(); $('#pq2').focus();
}

// ---------------- settings ----------------
function viewSettings() {
  view.innerHTML = `<section class="card">
    <h2>ตั้งค่าร้าน</h2>
    <form id="sf" style="display:flex;flex-direction:column;gap:12px">
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
      <div class="row"><button class="btn primary">บันทึก</button></div>
    </form>
  </section>
  <section class="card">
    <h2>ข้อมูลในเครื่องนี้</h2>
    <div class="stats">
      <div class="stat"><div class="k">ลูกค้า</div><div class="v">${data.customers.length}</div></div>
      <div class="stat"><div class="k">สินค้า</div><div class="v">${data.products.length}</div></div>
      <div class="stat"><div class="k">บิล</div><div class="v">${data.bills.length.toLocaleString()}</div></div>
      <div class="stat"><div class="k">ใบเสร็จ</div><div class="v">${data.receipts.length.toLocaleString()}</div></div>
    </div>
    <div class="row"><a class="btn" href="import.html">นำเข้าข้อมูลจากโปรแกรมเก่า</a></div>
    <div class="note">ฉบับทดลอง: ข้อมูลเก็บในเบราว์เซอร์ของเครื่องนี้ ยังไม่ขึ้นระบบออนไลน์</div>
  </section>`;
  const f = $('#sf');
  const ex = () => { $('#pfx').textContent = (f.prefix.value.trim() ? f.prefix.value.trim() + '-' : '') + 'BS' + String(new Date().getFullYear() + 543).slice(2) + todayIso().slice(5, 7) + todayIso().slice(8) + '0001'; };
  f.prefix.addEventListener('input', ex); ex();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f));
    settings = { ...settings, name: v.name.trim(), address: v.address.trim(), phone: v.phone.trim(), taxId: v.taxId.trim(), prefix: v.prefix.trim(), defaultRate: Number(v.defaultRate), defaultGraceMonths: Number(v.defaultGraceMonths) };
    await saveSettings(settings);
    cart.rate = null; toast('บันทึกการตั้งค่าแล้ว'); render();
  });
}

// ---------------- start ----------------
(async () => {
  [data, settings] = await Promise.all([getData(), getSettings(DEFAULT_SETTINGS)]);
  data.receipts ||= [];
  if (!settings.name && !location.hash) location.hash = 'settings';
  render();
})();
