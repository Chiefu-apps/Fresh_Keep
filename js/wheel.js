// Day / month / year scroll wheels, like the Android app's DateWheels. Flick a wheel; it snaps to the middle row.
import { today } from './dates.js';

const ROW = 46;      // px per row
const VISIBLE = 5;   // rows showing
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function wheelsHtml(field) {
  return `<div class="wheels" data-field="${field}" style="height:${ROW * VISIBLE}px">
    <div class="wheel-hl" style="height:${ROW}px"></div>
    <div class="wheel day" data-w="d"></div><div class="wheel month" data-w="m"></div><div class="wheel year" data-w="y"></div>
    <div class="wheel-fade top"></div><div class="wheel-fade bottom"></div>
  </div>`;
}

/** Fills a .wheels element for [date] ("YYYY-MM-DD"); calls onChange with the new date when a wheel comes to rest. */
export function mountWheels(root, date, onChange) {
  const thisYear = Number(today().slice(0, 4));
  let [y, m, d] = date.split('-').map(Number);
  const years = Array.from({ length: 12 }, (_, i) => thisYear - 1 + i);
  if (!years.includes(y)) { years.push(y); years.sort((a, b) => a - b); }

  const spec = {
    d: { labels: () => Array.from({ length: daysIn(y, m) }, (_, i) => String(i + 1)), index: () => d - 1 },
    m: { labels: () => MONTHS, index: () => m - 1 },
    y: { labels: () => years.map(String), index: () => years.indexOf(y) },
  };
  const cols = {};

  function build(key) {
    const el = root.querySelector(`[data-w=${key}]`);
    const labels = spec[key].labels();
    el.innerHTML = `<div style="height:${ROW * 2}px"></div>` +
      labels.map((l, i) => `<div class="wheel-row" data-i="${i}" style="height:${ROW}px">${l}</div>`).join('') +
      `<div style="height:${ROW * 2}px"></div>`;
    const col = cols[key] || (cols[key] = { el, timer: null });
    col.rows = [...el.querySelectorAll('.wheel-row')];
    col.last = spec[key].index();
    el.scrollTop = col.last * ROW;
    paint(key);
  }

  function paint(key) {
    const { el, rows } = cols[key];
    const c = el.scrollTop / ROW;
    rows.forEach((r, i) => {
      const dist = Math.abs(i - c);
      r.classList.toggle('sel', dist < 0.5);
      r.style.opacity = dist < 0.5 ? 1 : dist < 1.5 ? 0.55 : 0.25;
    });
  }

  function settle(key) {
    const col = cols[key];
    const i = Math.max(0, Math.min(col.rows.length - 1, Math.round(col.el.scrollTop / ROW)));
    if (Math.abs(col.el.scrollTop - i * ROW) > 1) col.el.scrollTo({ top: i * ROW, behavior: 'smooth' });
    if (i === col.last) return;
    col.last = i;
    const before = daysIn(y, m);
    if (key === 'd') d = i + 1;
    if (key === 'm') m = i + 1;
    if (key === 'y') y = years[i];
    d = Math.min(d, daysIn(y, m));
    if (key !== 'd' && daysIn(y, m) !== before) build('d'); // e.g. 31 days → 30 days
    onChange(iso(y, m, d));
  }

  for (const key of ['d', 'm', 'y']) {
    build(key);
    const col = cols[key];
    col.el.addEventListener('scroll', () => {
      requestAnimationFrame(() => paint(key));
      clearTimeout(col.timer);
      col.timer = setTimeout(() => settle(key), 140); // iPhone keeps firing scroll events through the momentum
    }, { passive: true });
    col.el.addEventListener('click', (e) => {
      const r = e.target.closest('.wheel-row');
      if (r) col.el.scrollTo({ top: Number(r.dataset.i) * ROW, behavior: 'smooth' });
    });
  }
}
