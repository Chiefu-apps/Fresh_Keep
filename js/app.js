import * as store from './store.js';
import { today, pretty, countdownTo, relative } from './dates.js';
import { openScanner } from './scanner.js';
import * as share from './share.js';
import { icon, esc, leaf } from './ui.js';
import { wheelsHtml, mountWheels } from './wheel.js';

const app = document.getElementById('app');
let draft = null;      // the item being added or edited (null = home screen)
let lastDate = null;   // for the "Same as last" chip when logging a big shop
let sheet = null;      // { el, onClose }
let snackTimer = null;

// ───────────────────────────── helpers ─────────────────────────────

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const HUES = ['#FFE1C2', '#D9F2E3', '#E3E8FF', '#FFE0E6', '#FFF3C4', '#E0F4F7'];
function hue(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return HUES[Math.abs(h) % HUES.length];
}

function thumb(name, image, size = 54, radius = 16) {
  const initial = (name.trim()[0] || '?').toUpperCase();
  return `<div class="thumb" style="width:${size}px;height:${size}px;border-radius:${radius}px;background:${hue(name)};font-size:${Math.round(size * 0.42)}px">
    <span>${esc(initial)}</span>${image ? `<img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}</div>`;
}

function dateLine(i) {
  if (i.quality) return `Use by ${pretty(i.date)} · Best before ${pretty(i.quality)}`;
  if (store.expired(i)) {
    const d = new Date(i.date + 'T12:00'); d.setDate(d.getDate() + 1);
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `Out of date since ${pretty(next)}`;
  }
  return `Good until ${pretty(i.date)}`;
}

function pill(label, value, kind) {
  return `<span class="pill ${kind}">${label ? `<small>${esc(label)}</small>` : ''}<b>${esc(value)}</b></span>`;
}

/** One countdown pill, or two (use-by and best-before) when the item has both dates. */
function pills(i) {
  const exp = store.expired(i);
  const main = exp ? 'expired' : 'good';
  if (!i.quality) return pill(null, countdownTo(i.date), main);
  // Best before is about quality only, so it never goes red: amber once passed, muted before that.
  const past = store.pastBest(i);
  return `<div class="pills">${pill('Use by', countdownTo(i.date), main)}${pill('Best before', past ? 'passed' : countdownTo(i.quality), past ? 'amber' : 'muted')}</div>`;
}

function stepper(qty, small, minusAction, plusAction, id = '', minusEnabled = true) {
  const done = qty <= 1 && small;
  return `<div class="stepper ${small ? 'small' : ''}">
    <button data-a="${minusAction}" data-id="${id}" ${minusEnabled ? '' : 'disabled'} aria-label="${done ? 'Used it' : 'One less'}">${icon(done ? 'check' : 'remove')}</button>
    <span>${qty}</span>
    <button data-a="${plusAction}" data-id="${id}" aria-label="One more">${icon('add')}</button></div>`;
}

function switchEl(on, action, label) {
  return `<button class="switch ${on ? 'on' : ''}" role="switch" aria-checked="${on}" aria-label="${esc(label)}" data-a="${action}"><span></span></button>`;
}

// ───────────────────────────── home ─────────────────────────────

function renderHome() {
  const s = store.get();
  const t = today();
  const sorted = [...s.items].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.name.localeCompare(b.name)));
  const groups = { expired: sorted.filter((i) => store.expired(i, t)), good: sorted.filter((i) => !store.expired(i, t)) };
  const n = groups.expired.length;
  const headline = !sorted.length ? "Know when food's out of date"
    : n === 1 ? '1 thing is out of date' : n > 1 ? `${n} things are out of date` : "Everything's in date";
  // The View switch sits on the "In date" header (or "Out of date" if nothing is in date).
  const switchOn = groups.good.length ? 'good' : 'expired';

  const section = (key, title, list) => {
    if (!list.length) return '';
    const view = key === switchOn ? `<div class="view-switch">
        <span class="muted">View:</span>
        <button data-a="view-small" class="${s.settings.small ? 'on' : ''}">Small</button>
        ${switchEl(!s.settings.small, 'view-toggle', 'Large view')}
        <button data-a="view-large" class="${s.settings.small ? '' : 'on'}">Large</button></div>` : '';
    const body = s.settings.small
      ? `<div class="grid">${list.map(tile).join('')}</div>`
      : list.map(row).join('');
    return `<div class="section-h"><span class="dot ${key}"></span><span class="t">${title}</span><span class="n">${list.length}</span>${view}</div>${body}`;
  };

  app.innerHTML = `
    <main class="home">
      <header class="top">
        <div><h1>Freshkeep</h1><p class="headline">${esc(headline)}</p></div>
        <button class="icon-btn" data-a="settings" aria-label="Settings">${icon('settings')}</button>
      </header>
      ${installHint()}
      <div class="card mode" data-a="advanced">
        <div class="grow"><div class="t">Advanced mode</div>
          <div class="muted small">${s.settings.advanced ? 'Use-by and best-before dates' : 'One date per item'}</div></div>
        ${switchEl(s.settings.advanced, 'advanced', 'Advanced mode')}
      </div>
      ${sorted.length ? `<div class="summary">
          ${[['expired', 'Out of date', n], ['good', 'In date', groups.good.length]].map(([k, l, c]) =>
            `<div class="sum ${c ? k : ''}"><b>${c}</b><span>${l}</span></div>`).join('')}
        </div>` : empty()}
      ${section('expired', 'Out of date', groups.expired)}
      ${section('good', 'In date', groups.good)}
    </main>
    <button class="fab" data-a="scan">${icon('scan')}<span>Scan food</span></button>`;

  // Out-of-date count on the home-screen icon (iPhone 16.4+ and Android, once installed).
  try { if (n) navigator.setAppBadge?.(n); else navigator.clearAppBadge?.(); } catch { /* not supported */ }
}

function row(i) {
  return `<div class="card row" data-a="open" data-id="${i.id}">
    ${thumb(i.name, i.image)}
    <div class="grow min0">
      <div class="t ellipsis">${esc(i.name)}</div>
      <div class="muted small">${esc(i.quality ? `Use by ${pretty(i.date)}` : dateLine(i))}</div>
    </div>
    <div class="side">${pills(i)}${stepper(i.qty, true, 'use-one', 'add-one', i.id)}</div>
  </div>`;
}

function tile(i) {
  const exp = store.expired(i);
  return `<button class="tile ${exp ? 'expired' : ''}" data-a="open" data-id="${i.id}">
    <div class="tile-img">${thumb(i.name, i.image, 64, 18)}${i.qty > 1 ? `<span class="badge">×${i.qty}</span>` : ''}</div>
    <span class="tile-name">${esc(i.name)}</span>
    <span class="tile-when">${esc(countdownTo(i.date))}</span>
  </button>`;
}

function empty() {
  return `<div class="empty">
    <div class="empty-icon">${leaf}</div>
    <h2>Nothing tracked yet</h2>
    <p class="muted">Scan the barcode on your food and add the date on the pack. Freshkeep shows you when anything goes out of date.</p>
    <button class="btn text" data-a="manual">Or add something by hand</button>
  </div>`;
}

// ───── install hint (iPhone: Share → Add to Home Screen) ─────

let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; if (!draft) renderHome(); });

const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function installHint() {
  if (standalone()) return '';
  try { if (localStorage.getItem('freshkeep.hideInstall')) return ''; } catch { /* ignore */ }
  if (installPrompt) {
    return `<div class="card hint"><div class="grow"><div class="t">Install Freshkeep</div>
      <div class="muted small">Add it to your home screen so it opens like an app.</div></div>
      <button class="btn primary" data-a="install">Install</button>
      <button class="icon-btn" data-a="hide-install" aria-label="Dismiss">${icon('close')}</button></div>`;
  }
  if (isIos()) {
    return `<div class="card hint"><div class="grow"><div class="t">Put Freshkeep on your home screen</div>
      <div class="muted small">In Safari, tap ${icon('ios_share', 'inline')} Share, then <b>Add to Home Screen</b>. It'll open like an app and keep your list safe.</div></div>
      <button class="icon-btn" data-a="hide-install" aria-label="Dismiss">${icon('close')}</button></div>`;
  }
  return '';
}

// ───────────────────────────── bottom sheets ─────────────────────────────

// A sheet closes by swiping it down, tapping ✕, tapping the dimmed area above it, or the phone's back button.

function openSheet(html, onClose) {
  closeSheet();
  const el = document.createElement('div');
  el.className = 'sheet-wrap';
  el.innerHTML = `<div class="sheet-bg" data-a="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true">
      <div class="sheet-handle"><div class="grip"></div>
        <button class="icon-btn sheet-x" data-a="close-sheet" aria-label="Close">${icon('close')}</button></div>
      ${html}
    </div>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  const s = el.querySelector('.sheet');
  dragToClose(s);
  sheet = { el, onClose };
  armBack();
  return s;
}

function closeSheet() {
  if (!sheet) return;
  const { el, onClose } = sheet;
  sheet = null;
  onClose?.();
  el.querySelector('.sheet').style.transform = '';
  el.classList.remove('open');
  setTimeout(() => el.remove(), 220);
}

/** Pull the sheet down to dismiss it, like a native bottom sheet. */
function dragToClose(s) {
  let startY = null, dy = 0, t0 = 0;
  s.addEventListener('touchstart', (e) => {
    // Only from the top of the sheet's content, so scrolling a long sheet still works.
    // (The handle bar at the top always works.)
    if ((s.scrollTop > 0 && !e.target.closest('.sheet-handle')) || e.target.closest('textarea, .wheels')) return;
    startY = e.touches[0].clientY; dy = 0; t0 = Date.now();
    s.style.transition = 'none';
  }, { passive: true });
  s.addEventListener('touchmove', (e) => {
    if (startY == null) return;
    dy = e.touches[0].clientY - startY;
    if (dy < 0) { startY = null; s.style.transition = ''; s.style.transform = ''; return; } // pushing up: just scroll
    e.preventDefault();
    s.style.transform = `translateY(${dy}px)`;
  }, { passive: false });
  const end = () => {
    if (startY == null) return;
    startY = null;
    s.style.transition = '';
    const fast = dy / Math.max(1, Date.now() - t0) > 0.6;
    if (dy > 110 || (fast && dy > 30)) closeSheet();
    else s.style.transform = '';
  };
  s.addEventListener('touchend', end);
  s.addEventListener('touchcancel', end);
}

// ───── phone back button / back swipe closes the top layer instead of leaving the app ─────

let backEntry = false;
function armBack() {
  if (!backEntry) { history.pushState({ freshkeep: 1 }, ''); backEntry = true; }
}
window.addEventListener('popstate', () => {
  backEntry = false;
  if (sheet) closeSheet();
  else if (draft) closeEdit();
  if (sheet || draft) armBack();
});

function foodSheet(id) {
  const i = store.get().items.find((x) => x.id === id);
  if (!i) return closeSheet();
  const label = i.qty > 1 ? `${i.name} ×${i.qty}` : i.name;
  openSheet(`<div class="center">
      ${thumb(i.name, i.image, 96, 28)}
      <h2>${esc(label)}</h2>
      ${i.brand ? `<div class="muted">${esc(i.brand)}</div>` : ''}
      <div class="sheet-pills">${pills(i)}</div>
      <div class="muted">${esc(dateLine(i))}</div>
    </div>
    <div class="two">
      <button class="btn primary big" data-a="used" data-id="${i.id}">${icon('check')} ${i.qty > 1 ? `Used all ${i.qty}` : 'Used it'}</button>
      <button class="btn outline big" data-a="binned" data-id="${i.id}">${icon('bin')} ${i.qty > 1 ? 'Binned all' : 'Binned it'}</button>
    </div>
    <div class="center row-gap">
      <button class="btn text" data-a="edit" data-id="${i.id}">${icon('edit')} Edit</button>
      <button class="btn text danger" data-a="delete" data-id="${i.id}">Delete</button>
    </div>`);
}

function settingsSheet() {
  const s = store.get();
  const { eaten, binned } = s.tally;
  const badge = 'setAppBadge' in navigator;
  openSheet(`
    <h2>Out-of-date reminders</h2>
    <p class="muted">Freshkeep checks every time you open it. Anything past its date goes to the top in red.</p>
    ${badge ? `<p class="muted">Once it's on your home screen, the Freshkeep icon shows a badge with how many things are out of date.</p>
      ${typeof Notification !== 'undefined' && Notification.permission === 'default' && standalone()
        ? `<button class="btn outline" data-a="badge-permission">Turn on the icon badge</button>` : ''}` : ''}
    ${eaten + binned > 0 ? `<div class="card tally">You've used ${eaten} and binned ${binned} so far${binned === 0 ? ' — nothing wasted! 🌱' : '.'}</div>` : ''}
    <h2 class="gap-top">Share the list</h2>
    <p class="muted">Copy your food list to another phone with Freshkeep, handy if you share a fridge. Works with the Android app too.</p>
    <button class="btn primary big full" data-a="share" ${s.items.length ? '' : 'disabled'}>${icon('qr')} Share my list</button>
    <button class="btn tonal big full" data-a="import">${icon('scan')} Import a list</button>
    <button class="btn text" data-a="paste">Got a list as a message? Paste it</button>
    <p class="muted tiny gap-top">Your list is stored only on this phone. Product names and photos come from Open Food Facts.</p>`);
}

async function shareSheet() {
  const items = [...store.get().items].sort((a, b) => (a.date < b.date ? -1 : 1));
  const parts = await share.parts(items);
  const count = items.reduce((s, i) => s + i.qty, 0);
  let page = 0, paused = false, timer = null;
  const el = openSheet(`<div class="center">
      <h2>Share my list</h2>
      <p class="muted">On the other phone: Settings, Import a list, then point it here.</p>
      <button class="qr" data-a="qr-pause" aria-label="Pause or carry on"></button>
      <div class="t qr-count"></div>
      <div class="muted small qr-hint"></div>
      <button class="btn outline" data-a="send-text">${icon('share')} Send as a message instead</button>
    </div>`, () => clearInterval(timer));
  const draw = () => {
    el.querySelector('.qr').innerHTML = share.qrSvg(parts[page]);
    el.querySelector('.qr-count').textContent = plural(count, 'item') + (parts.length > 1 ? ` · code ${page + 1} of ${parts.length}` : '');
    el.querySelector('.qr-hint').textContent = parts.length < 2 ? '' : paused ? 'Paused. Tap the code to carry on'
      : 'The codes change by themselves, just hold the other phone steady';
  };
  draw();
  if (parts.length > 1) timer = setInterval(() => { if (!paused) { page = (page + 1) % parts.length; draw(); } }, 1300);
  el.querySelector('[data-a=qr-pause]').onclick = () => { paused = !paused; draw(); };
}

let pending = null; // a list read from another phone, waiting for Add / Replace

function importSheet(list) {
  pending = list;
  const has = store.get().items.length > 0;
  const total = list.reduce((s, i) => s + i.qty, 0);
  const names = list.slice(0, 6).map((i) => i.name).join(', ') + (list.length > 6 ? ` and ${list.length - 6} more` : '');
  openSheet(`
    <h2>Found ${plural(total, 'item')}</h2>
    <p class="muted clamp3">${esc(names)}</p>
    <button class="btn primary big full" data-a="import-add">${has ? 'Add to my list' : 'Add them'}</button>
    ${has ? `<p class="muted small">Anything you already have with the same date isn't doubled up.</p>
      <button class="btn outline big full" data-a="import-replace">Replace my list with this one</button>` : ''}
    <button class="btn text" data-a="close-sheet">Cancel</button>`, () => { pending = null; });
}

function pasteSheet() {
  const el = openSheet(`
    <h2>Paste a shared list</h2>
    <p class="muted">Copy the whole message that starts with <b>FK1:</b>, then paste it here.</p>
    <textarea class="paste" rows="4" placeholder="FK1:0000:1/1:…" autocapitalize="off" autocomplete="off" spellcheck="false"></textarea>
    <p class="muted small paste-msg"></p>
    <button class="btn primary big full" data-a="paste-go">Import</button>`);
  const ta = el.querySelector('textarea');
  navigator.clipboard?.readText?.().then((t) => { if (t && t.includes('FK1:') && !ta.value) ta.value = t; }).catch(() => {});
}

async function applyImport(replace) {
  const list = pending;
  if (!list) return;
  pending = null;
  closeSheet();
  const [added, matched] = store.importItems(list, replace);
  snack(replace ? `Replaced your list with ${plural(added, 'item')}`
    : matched ? `Added ${plural(added, 'item')} · ${plural(matched, 'was', 'were')} already here` : `Added ${plural(added, 'item')}`);
  // Photos aren't shared: fetch them again from the barcodes.
  const codes = [...new Set(store.get().items.filter((i) => !i.image && i.barcode).map((i) => i.barcode))];
  for (const c of codes) {
    const p = await store.lookup(c);
    if (p?.image) store.setImage(c, p.image);
  }
}

// ───────────────────────────── snackbar ─────────────────────────────

function snack(message, undo) {
  document.querySelector('.snack')?.remove();
  clearTimeout(snackTimer);
  const el = document.createElement('div');
  el.className = 'snack';
  el.innerHTML = `<span>${esc(message)}</span>${undo ? '<button>Undo</button>' : ''}`;
  if (undo) el.querySelector('button').onclick = () => { undo(); el.remove(); };
  document.body.appendChild(el);
  snackTimer = setTimeout(() => el.remove(), 4500);
}

/** Use up / bin [count] of an item, with an Undo bar. */
function finish(id, eaten, count) {
  const i = store.get().items.find((x) => x.id === id);
  if (!i) return;
  const n = count ?? i.qty;
  const r = store.finish(id, eaten, n);
  const what = n > 1 ? `${n} × ${i.name}` : i.name;
  snack(`${eaten ? 'Used' : 'Binned'} ${what}`, () => store.restore(r));
}

// ───────────────────────────── add / edit ─────────────────────────────

function openEdit(d) {
  draft = { name: '', brand: null, barcode: null, image: null, date: today(), qty: 1, quality: null, ...d };
  armBack();
  renderEdit();
  window.scrollTo(0, 0);
}

function closeEdit() {
  if (!draft) return;
  draft = null;
  renderHome();
  window.scrollTo(0, 0);
}

function startScan() {
  openScanner('code', {
    onCode: async (code) => {
      openEdit({ barcode: code, lookingUp: true, fromCode: true });
      const p = await store.lookup(code);
      if (draft && draft.barcode === code) {
        draft.lookingUp = false;
        draft.name = draft.name || p?.name || '';
        draft.brand = draft.brand || p?.brand || null;
        draft.image = draft.image || p?.image || null;
        renderEdit();
      }
    },
    onManual: () => openEdit({}),
  });
}

function dateCard(title, field, date) {
  return `<div class="card datecard" data-card="${field}">
    <div class="muted small label">${title}</div>
    <div class="date-head">${dateHead(date)}</div>
    ${wheelsHtml(field)}
    <div class="chips">${chipsFor(field)}</div>
    <button class="btn tonal full" data-a="scan-date" data-field="${field}">${icon('camera')} Scan the printed date</button>
  </div>`;
}

function dateHead(date) {
  const t = today();
  return `<span class="date-big">${esc(pretty(date))}</span>
    <span class="date-rel ${date < t ? 'expired-text' : ''}">${esc(relative(date, t))}</span>`;
}

/** Shortcut chips under each date: "Same as last" and "Today", or "Same as use by" and "Remove". */
function chipsFor(field) {
  const d = draft;
  if (field === 'quality') {
    return (d.quality !== d.date ? `<button class="chip" data-a="best-same">Same as use by</button>` : '') +
      `<button class="chip" data-a="best-remove">${icon('close')} Remove</button>`;
  }
  return [
    lastDate && !d.id && lastDate !== d.date ? `<button class="chip" data-a="same-last">${icon('replay')} Same as last · ${esc(pretty(lastDate))}</button>` : '',
    d.date !== today() ? `<button class="chip" data-a="date-today">Today</button>` : '',
  ].join('');
}

/** After a wheel moves: update the heading and chips in place, so the other wheels aren't disturbed. */
function refreshDates() {
  for (const card of app.querySelectorAll('[data-card]')) {
    const field = card.dataset.card;
    card.querySelector('.date-head').innerHTML = dateHead(draft[field]);
    card.querySelector('.chips').innerHTML = chipsFor(field);
  }
}

function renderEdit() {
  const d = draft;
  const advanced = store.get().settings.advanced;
  const scroll = window.scrollY;
  let best = '';
  if (advanced || d.quality) {
    best = !d.quality
      ? `<button class="btn outline big full" data-a="add-best">${icon('add')} Add a best-before date</button>`
      : dateCard('Best before', 'quality', d.quality);
  }
  app.innerHTML = `
    <main class="edit">
      <div class="bar">
        <button class="icon-btn" data-a="back" aria-label="Back">${icon('back')}</button>
        <h3>${d.id ? 'Edit food' : 'Add food'}</h3>
      </div>
      <div class="card product">
        <div class="product-top">
          ${thumb(d.name || '?', d.image, 64, 18)}
          <div class="grow">
            ${d.lookingUp ? `<div class="muted"><span class="spinner"></span> Looking up product…</div>`
              : `<div class="muted small">${esc(d.brand || (d.barcode ? `Barcode ${d.barcode}` : 'What is it?'))}</div>
                 ${d.fromCode && !d.name ? `<div class="muted small">Not in the food database. Type a name</div>` : ''}`}
          </div>
        </div>
        <label class="field"><span>Name</span>
          <input type="text" class="name" value="${esc(d.name)}" placeholder="e.g. Semi-skimmed milk" autocomplete="off" enterkeyhint="done"></label>
      </div>
      <div class="card qty">
        <div class="grow"><div class="t">How many</div><div class="muted small">Same product, same date</div></div>
        ${stepper(d.qty, false, 'qty-minus', 'qty-plus', '', d.qty > 1)}
      </div>
      ${dateCard(advanced ? 'Use by' : 'Date on the pack', 'date', d.date)}
      ${best}
      <div class="save-space"></div>
    </main>
    <div class="save-bar"><button class="btn primary big full" data-a="save" ${d.name.trim() ? '' : 'disabled'}>${d.id ? 'Save changes' : 'Save'}</button></div>`;

  const name = app.querySelector('.name');
  name.addEventListener('input', () => {
    draft.name = name.value;
    app.querySelector('[data-a=save]').disabled = !name.value.trim();
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') name.blur(); });
  for (const w of app.querySelectorAll('.wheels')) {
    const field = w.dataset.field;
    mountWheels(w, d[field], (v) => { if (draft) { draft[field] = v; refreshDates(); } });
  }
  window.scrollTo(0, scroll);
}

function save() {
  const d = draft;
  if (!d || !d.name.trim()) return;
  const fields = { name: d.name.trim(), date: d.date, qty: d.qty, quality: d.quality || null };
  if (d.id) store.update(d.id, fields);
  else store.add({ ...fields, brand: d.brand, barcode: d.barcode, image: d.image });
  lastDate = d.date;
  closeEdit();
}

// ───────────────────────────── actions ─────────────────────────────

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-a]');
  if (!el) return;
  const a = el.dataset.a, id = el.dataset.id;
  const s = store.get();
  switch (a) {
    case 'settings': return settingsSheet();
    case 'advanced': return store.setSettings({ advanced: !s.settings.advanced });
    case 'view-small': return store.setSettings({ small: true });
    case 'view-large': return store.setSettings({ small: false });
    case 'view-toggle': return store.setSettings({ small: !s.settings.small });
    case 'scan': return startScan();
    case 'manual': return openEdit({});
    case 'open': return foodSheet(id);
    case 'use-one': return finish(id, true, 1);
    case 'add-one': return store.addOne(id);
    case 'used': closeSheet(); return finish(id, true);
    case 'binned': closeSheet(); return finish(id, false);
    case 'edit': {
      closeSheet();
      const i = s.items.find((x) => x.id === id);
      return i && openEdit({ ...i });
    }
    case 'delete': closeSheet(); return store.remove(id);
    case 'close-sheet': return closeSheet();
    case 'install': installPrompt?.prompt(); installPrompt = null; return renderHome();
    case 'hide-install': try { localStorage.setItem('freshkeep.hideInstall', '1'); } catch { /* ignore */ } return renderHome();
    case 'badge-permission': return Notification.requestPermission().then(() => { closeSheet(); renderHome(); });
    case 'share': closeSheet(); return shareSheet();
    case 'import':
      closeSheet();
      return openScanner('list', { onList: importSheet });
    case 'paste': closeSheet(); return pasteSheet();
    case 'paste-go': {
      const ta = document.querySelector('.sheet textarea');
      const p = share.parsePart(ta?.value || '');
      const msg = document.querySelector('.paste-msg');
      if (!p || p.total !== 1) { msg.textContent = "That doesn't look like a Freshkeep list. Copy the whole message and try again."; return; }
      return share.decode(p.data).then((list) => {
        if (!list?.length) { msg.textContent = "That list couldn't be read. Ask for it to be sent again."; return; }
        importSheet(list);
      });
    }
    case 'send-text': {
      const items = store.get().items;
      return share.text(items).then(async (t) => {
        try {
          if (navigator.share) await navigator.share({ text: t });
          else { await navigator.clipboard.writeText(t); snack('Copied. Paste it into a message'); }
        } catch { /* cancelled */ }
      });
    }
    case 'import-add': return applyImport(false);
    case 'import-replace': return applyImport(true);
    // edit screen
    case 'back': return closeEdit();
    case 'save': return save();
    case 'qty-minus': draft.qty = Math.max(1, draft.qty - 1); return renderEdit();
    case 'qty-plus': draft.qty += 1; return renderEdit();
    case 'same-last': draft.date = lastDate; return renderEdit();
    case 'date-today': draft.date = today(); return renderEdit();
    case 'add-best': draft.quality = draft.date; return renderEdit();
    case 'best-same': draft.quality = draft.date; return renderEdit();
    case 'best-remove': draft.quality = null; return renderEdit();
    case 'scan-date': {
      const field = el.dataset.field;
      return openScanner('date', { onDate: (d) => { if (draft) { draft[field] = d; renderEdit(); } } });
    }
  }
});

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

store.onChange(() => {
  if (!draft) renderHome();
  // Keep an open details sheet in step (e.g. after Undo), or close it if the item's gone.
});

// The date changes at midnight even if the app stays open.
document.addEventListener('visibilitychange', () => { if (!document.hidden && !draft) renderHome(); });

navigator.storage?.persist?.().catch(() => {});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

renderHome();
