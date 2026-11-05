// All data lives on the phone in localStorage. Nothing is sent anywhere except barcode lookups to Open Food Facts.
import { today, daysBetween } from './dates.js';

const KEY = 'freshkeep.v1';

const blank = () => ({
  items: [],      // { id, name, brand, barcode, image, date, quality, qty, added }
  products: {},   // barcode → { name, brand, image }
  settings: { advanced: false, small: false },
  tally: { eaten: 0, binned: 0 },
});

let state = load();
const listeners = new Set();

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.items)) return { ...blank(), ...s, settings: { ...blank().settings, ...s.settings } };
  } catch { /* first run, or storage blocked */ }
  return blank();
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* full or blocked: keep going in memory */ }
  listeners.forEach((f) => f());
}

export const onChange = (f) => listeners.add(f);
export const get = () => state;

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// ───────── freshness ─────────

/** The date on the pack is the last good day; it's out of date from the day after. Best before never counts. */
export const daysLeft = (i, t = today()) => daysBetween(t, i.date);
export const expired = (i, t = today()) => daysLeft(i, t) < 0;
export const pastBest = (i, t = today()) => !!i.quality && i.quality < t;

// ───────── items ─────────

function sameItem(a, b) {
  return a.date === b.date && (a.quality || null) === (b.quality || null) &&
    (b.barcode ? a.barcode === b.barcode : !a.barcode && a.name.toLowerCase() === b.name.toLowerCase());
}

/** Adds an item, or tops up an existing one with the same product and date. */
export function add(item) {
  const same = state.items.find((i) => sameItem(i, item));
  if (same) same.qty += item.qty;
  else state.items.push({ id: uid(), added: Date.now(), brand: null, barcode: null, image: null, quality: null, qty: 1, ...item });
  remember(item);
  save();
}

export function update(id, changes) {
  const i = state.items.find((x) => x.id === id);
  if (!i) return;
  Object.assign(i, changes);
  remember(i);
  save();
}

export function remove(id) {
  state.items = state.items.filter((i) => i.id !== id);
  save();
}

/** Used up / binned [count] of an item. Returns a copy of it as it was, for Undo. */
export function finish(id, eaten, count) {
  const i = state.items.find((x) => x.id === id);
  if (!i) return null;
  const before = { ...i };
  const n = Math.min(Math.max(1, count ?? i.qty), i.qty);
  if (n >= i.qty) state.items = state.items.filter((x) => x.id !== id);
  else i.qty -= n;
  state.tally[eaten ? 'eaten' : 'binned'] += n;
  save();
  return { before, eaten, n };
}

/** Puts an item back exactly as it was (undo), reversing the tally. */
export function restore({ before, eaten, n }) {
  const idx = state.items.findIndex((x) => x.id === before.id);
  if (idx >= 0) state.items[idx] = before; else state.items.push(before);
  const k = eaten ? 'eaten' : 'binned';
  state.tally[k] = Math.max(0, state.tally[k] - n);
  save();
}

export function addOne(id) {
  const i = state.items.find((x) => x.id === id);
  if (i) { i.qty += 1; save(); }
}

export function setSettings(changes) {
  Object.assign(state.settings, changes);
  save();
}

// ───────── shared lists ─────────

/**
 * Brings in a list from another phone. Replace swaps the whole list; otherwise it's merged: the same
 * product with the same date(s) isn't doubled up (the bigger count wins). Returns [added, matched].
 */
export function importItems(list, replace) {
  if (replace) state.items = [];
  let added = 0, matched = 0;
  for (const s of list) {
    const same = state.items.find((i) => sameItem(i, s));
    if (same) { matched++; same.qty = Math.max(same.qty, s.qty); continue; }
    added++;
    const known = s.barcode ? state.products[s.barcode] : null;
    state.items.push({ id: uid(), added: Date.now(), name: s.name, brand: s.brand || known?.brand || null, barcode: s.barcode,
      image: known?.image || null, date: s.date, quality: s.quality, qty: s.qty });
  }
  save();
  return [added, matched];
}

/** Fills in a photo for every item with this barcode that hasn't got one (after an import). */
export function setImage(barcode, image) {
  state.items.forEach((i) => { if (i.barcode === barcode && !i.image) i.image = image; });
  save();
}

// ───────── products (Open Food Facts) ─────────

function remember(i) {
  if (i.barcode) state.products[i.barcode] = { name: i.name, brand: i.brand || null, image: i.image || null };
}

export async function lookup(barcode) {
  if (state.products[barcode]) return state.products[barcode];
  if (!/^\d{8,}$/.test(barcode)) return null;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json` +
      '?fields=product_name,product_name_en,brands,image_front_small_url,image_front_url');
    const j = await r.json();
    if (j.status !== 1) return null;
    const p = j.product;
    const name = (p.product_name_en || p.product_name || '').trim();
    if (!name) return null;
    const product = { name, brand: (p.brands || '').split(',')[0].trim() || null, image: p.image_front_small_url || p.image_front_url || null };
    state.products[barcode] = product;
    save();
    return product;
  } catch {
    return null;
  }
}
