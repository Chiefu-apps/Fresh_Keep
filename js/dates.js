// Dates are plain "YYYY-MM-DD" strings in local time, the same as the Android app's LocalDate.

const DAY = 86400000;

export function epochDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY);
}

export function fromEpochDay(n) {
  const t = new Date(n * DAY);
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

function iso(y, m, d) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function today() {
  const t = new Date();
  return iso(t.getFullYear(), t.getMonth() + 1, t.getDate());
}

export const addDays = (s, n) => fromEpochDay(epochDay(s) + n);
export const daysBetween = (a, b) => epochDay(b) - epochDay(a);

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Thu 12 Nov", with the year added when it isn't this year. */
export function pretty(s) {
  const [y, m, d] = s.split('-').map(Number);
  const wd = WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const thisYear = Number(today().slice(0, 4));
  return `${wd} ${d} ${MO[m - 1]}${y === thisYear ? '' : ' ' + y}`;
}

/** "3 days ago", "Yesterday", "Last day", "Tomorrow", "5 days", "2 weeks", "3 months". */
export function countdownTo(date, t = today()) {
  const d = daysBetween(t, date);
  if (d < -1) return `${-d} days ago`;
  if (d === -1) return 'Yesterday';
  if (d === 0) return 'Last day';
  if (d === 1) return 'Tomorrow';
  if (d < 14) return `${d} days`;
  if (d < 60) return `${Math.floor(d / 7)} weeks`;
  return `${Math.floor(d / 30)} months`;
}

/** "today", "in 3 days", "2 days ago". */
export function relative(date, t = today()) {
  const d = daysBetween(t, date);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  return d > 0 ? `in ${d} days` : `${-d} days ago`;
}

// ───────── Reading the printed date (same rules as the Android DateReader) ─────────

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12 };
const MON = '(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEPT|SEP|OCT|NOV|DEC)[A-Z]*';
const KEYWORD = /\b(BEST\s*BEFORE|BB|BBE|B\/B|USE\s*BY|EXP|EXPIRY|EXPIRES|DISPLAY\s*UNTIL)\b/g;

const fullYear = (y) => (y == null || Number.isNaN(y) ? null : y < 100 ? 2000 + y : y);
const num = (s) => (s == null || s === '' ? null : Number(s));
const month = (s) => MONTHS[s.startsWith('SEPT') ? 'SEPT' : s.slice(0, 3)];

function valid(y, m, d) {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function makeDate(d, m, y) {
  if (d == null || m == null || d < 1 || d > 31 || m < 1 || m > 12) return null;
  let year = fullYear(y);
  if (year == null) {
    // No year printed: assume the next occurrence, allowing for things a little past their date.
    const t = today();
    const ty = Number(t.slice(0, 4));
    if (!valid(ty, m, d)) return null;
    const twoMonthsAgo = (() => { const x = new Date(); x.setMonth(x.getMonth() - 2); return iso(x.getFullYear(), x.getMonth() + 1, x.getDate()); })();
    year = iso(ty, m, d) < twoMonthsAgo ? ty + 1 : ty;
  }
  return valid(year, m, d) ? iso(year, m, d) : null;
}

const PATTERNS = [
  // 2026-11-12
  [/\b(20\d{2})[-./](\d{1,2})[-./](\d{1,2})\b/g, (m) => makeDate(num(m[3]), num(m[2]), num(m[1]))],
  // 12/11/2026, 12.11.26, 12-11-26, 12 11 26
  [/\b(\d{1,2})[-./ ](\d{1,2})[-./ ](\d{2}|20\d{2})\b/g, (m) => makeDate(num(m[1]), num(m[2]), num(m[3]))],
  // 12 NOV 2026, 12NOV26, 12 NOV
  [new RegExp(`\\b(\\d{1,2})\\s*${MON}\\.?\\s*(\\d{4}|\\d{2})?\\b`, 'g'), (m) => makeDate(num(m[1]), month(m[2]), num(m[3]))],
  // NOV 2026 / NOV 26 → end of that month ("best before end"). On UK packs "NOV 26" means November 2026.
  [new RegExp(`\\b${MON}\\.?\\s+(20\\d{2}|\\d{2})\\b(?!\\s*,?\\s*\\d{4})`, 'g'), (m) => {
    const y = fullYear(num(m[2])); const mo = month(m[1]);
    if (y == null || mo == null) return null;
    return iso(y, mo, new Date(Date.UTC(y, mo, 0)).getUTCDate());
  }],
  // NOV 12 2026 (US style, occasional)
  [new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, 'g'), (m) => makeDate(num(m[2]), month(m[1]), num(m[3]))],
  // 12/11 (no year)
  [/\b(\d{1,2})[./](\d{1,2})\b/g, (m) => makeDate(num(m[1]), num(m[2]), null)],
];

/** Finds the use-by / best-before date in text read off a pack, or null. */
export function findDate(text) {
  const t = text.toUpperCase()
    // OCR often reads 0 as O next to digits ("1O/11"), but not inside month names ("01OCT").
    .replace(/(?<=\d)O(?![A-Z])|(?<![A-Z])O(?=\d)/g, '0')
    .replace(/(?<=\d)[Il|](?=\d)/g, '1');
  const now = today();
  const min = addDays(now, -365), max = addDays(now, 365 * 6);
  const hits = [], taken = [];
  for (const [re, make] of PATTERNS) {
    re.lastIndex = 0;
    for (const m of t.matchAll(re)) {
      const start = m.index, end = m.index + m[0].length - 1;
      if (taken.some(([a, b]) => a <= end && start <= b)) continue;
      const d = make(m);
      if (!d || d < min || d > max) continue;
      hits.push({ date: d, pos: start }); taken.push([start, end]);
    }
  }
  if (!hits.length) return null;
  // Prefer a date that follows a "best before" / "use by" label; otherwise the earliest sensible one.
  const labels = [...t.matchAll(KEYWORD)].map((m) => m.index + m[0].length - 1);
  const near = hits.filter((h) => labels.some((l) => h.pos > l && h.pos - l < 40));
  return (near.length ? near : hits).sort((a, b) => (a.date < b.date ? -1 : 1))[0].date;
}

// ───────── Product barcodes ─────────

/** EAN-13, EAN-8, UPC-A: the last digit is a checksum, so a wrong one means a misread. */
export function validBarcode(code) {
  if (!/^\d+$/.test(code) || ![8, 12, 13].includes(code.length)) return false;
  const digits = [...code].map(Number);
  const body = digits.slice(0, -1).reverse();
  const sum = body.reduce((s, d, i) => s + (i % 2 === 0 ? d * 3 : d), 0);
  return (10 - (sum % 10)) % 10 === digits[digits.length - 1];
}

/** UPC-A (12 digits) is the same number as EAN-13 with a leading 0. */
export const normaliseBarcode = (c) => (c.length === 12 ? '0' + c : c);
