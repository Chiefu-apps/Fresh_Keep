// Sharing the list between phones. Same format as the Android app's ListShare, so the two can swap lists:
//   FK1:<set>:<part>/<total>:<data>
// <data> is the list as compact JSON, zlib-compressed, then URL-safe base64. Photos aren't sent.
import { epochDay, fromEpochDay } from './dates.js';

const PREFIX = 'FK1';
const CHUNK = 700; // characters per QR code: easy for a phone camera to read off a screen

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
}

function fromBase64Url(s) {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '').padEnd(Math.ceil(s.replace(/=+$/, '').length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}

/** One item as it travels: [name, brand, barcode, date (epoch day), qty, best-before (epoch day or -1)]. */
export async function encode(items) {
  const rows = items.map((i) => [i.name, i.brand || '', i.barcode || '', epochDay(i.date), i.qty, i.quality ? epochDay(i.quality) : -1]);
  const raw = new TextEncoder().encode(JSON.stringify(rows));
  return toBase64Url(await pipe(raw, new CompressionStream('deflate')));
}

export async function decode(data) {
  try {
    const json = new TextDecoder().decode(await pipe(fromBase64Url(data), new DecompressionStream('deflate')));
    const rows = JSON.parse(json);
    return rows.map((r) => {
      const name = String(r[0] ?? '').trim();
      if (!name || typeof r[3] !== 'number') return null;
      return {
        name, brand: r[1] || null, barcode: r[2] || null,
        date: fromEpochDay(r[3]), qty: Math.max(1, Number(r[4]) || 1),
        quality: typeof r[5] === 'number' && r[5] >= 0 ? fromEpochDay(r[5]) : null,
      };
    }).filter(Boolean);
  } catch {
    return null;
  }
}

/** The QR texts for a list: one per chunk, all tagged with the same random set id. */
export async function parts(items) {
  const data = await encode(items);
  const set = (0x1000 + Math.floor(Math.random() * 0xefff)).toString(16);
  const chunks = data.match(new RegExp(`.{1,${CHUNK}}`, 'g')) || [''];
  return chunks.map((c, i) => `${PREFIX}:${set}:${i + 1}/${chunks.length}:${c}`);
}

/** The whole list as one line of text, for sending through a messaging app. */
export async function text(items) {
  return `${PREFIX}:0000:1/1:${await encode(items)}`;
}

export function parsePart(s) {
  const m = /FK1:([0-9a-f]{4}):(\d+)\/(\d+):([A-Za-z0-9_=-]*)/.exec(String(s).trim());
  if (!m) return null;
  const index = Number(m[2]), total = Number(m[3]);
  if (total < 1 || index < 1 || index > total) return null;
  return { set: m[1], index, total, data: m[4] };
}

/** Collects scanned codes until a whole list is in. A code from a different list starts over. */
export class Collector {
  constructor() { this.set = null; this.total = 0; this.got = new Map(); }
  add(p) {
    if (p.set !== this.set || p.total !== this.total) { this.set = p.set; this.total = p.total; this.got.clear(); }
    if (this.got.has(p.index)) return false;
    this.got.set(p.index, p.data);
    return true;
  }
  get count() { return this.got.size; }
  get complete() { return this.total > 0 && this.got.size === this.total; }
  async result() {
    if (!this.complete) return null;
    const data = [...this.got.keys()].sort((a, b) => a - b).map((k) => this.got.get(k)).join('');
    return decode(data);
  }
}

/** An SVG QR code for one part (qrcode-generator, low error correction to fit more). */
export function qrSvg(textValue) {
  const qr = window.qrcode(0, 'L');
  qr.addData(textValue, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (qr.isDark(y, x)) path += `M${x} ${y}h1v1h-1z`;
  return `<svg viewBox="-1 -1 ${n + 2} ${n + 2}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" role="img" aria-label="QR code of your list"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}
