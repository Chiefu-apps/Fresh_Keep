// Full-screen camera. CODE: product barcodes (EAN/UPC). DATE: reads the printed date. LIST: shared-list QR codes.
import { findDate, validBarcode, normaliseBarcode, pretty } from './dates.js';
import { parsePart, Collector } from './share.js';
import { icon, esc } from './ui.js';

let detectorLib;
function loadScript(src) {
  return new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

/** BarcodeDetector backed by ZXing (WebAssembly), so it works on iPhone too. Loaded on first use. */
async function detector(formats) {
  if (!detectorLib) {
    await loadScript('vendor/barcode-detector.js');
    detectorLib = window.BarcodeDetectionAPI;
    const wasm = new URL('vendor/zxing_reader.wasm', location.href).href;
    detectorLib.setZXingModuleOverrides({ locateFile: (path, prefix) => (path.endsWith('.wasm') ? wasm : prefix + path) });
  }
  return new detectorLib.BarcodeDetector({ formats });
}

let ocrWorker;
/** Tesseract text reader, fetched from the internet the first time it's needed (a few MB). */
async function textReader(onStatus) {
  if (ocrWorker) return ocrWorker;
  onStatus('Getting the date reader ready…');
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  ocrWorker = await window.Tesseract.createWorker('eng');
  return ocrWorker;
}

const COPY = {
  code: ['Point at the barcode', "The striped one. It'll find the product for you", 'No barcode? Add it by hand'],
  date: ['Point at the date on the pack', 'e.g. "USE BY 05/11/26" or "12 NOV"', 'Pick the date myself'],
  list: ["Point at the shared list's QR code", 'On the other phone: Settings → Share my list. Hold steady while the codes change.', null],
};

export function openScanner(mode, { onCode, onDate, onList, onManual, onClose }) {
  const root = document.createElement('div');
  root.className = 'scanner';
  root.innerHTML = `
    <video playsinline muted autoplay></video>
    <div class="scan-frame ${mode}"></div>
    <div class="scan-top">
      <button class="round-btn" data-x="close" aria-label="Close">${icon('close')}</button>
      <button class="round-btn" data-x="torch" aria-label="Torch" hidden>${icon('torch')}</button>
    </div>
    <div class="scan-bottom">
      <div class="scan-title">${esc(COPY[mode][0])}</div>
      <div class="scan-sub">${esc(COPY[mode][1])}</div>
      <div class="scan-progress" hidden><div></div></div>
      <button class="btn primary big" data-x="use" hidden></button>
      ${COPY[mode][2] ? `<button class="btn text light" data-x="manual">${esc(COPY[mode][2])}</button>` : ''}
    </div>`;
  document.body.appendChild(root);

  const video = root.querySelector('video');
  const frame = root.querySelector('.scan-frame');
  const title = root.querySelector('.scan-title');
  const sub = root.querySelector('.scan-sub');
  const useBtn = root.querySelector('[data-x=use]');
  const bar = root.querySelector('.scan-progress');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream, track, closed = false, torch = false, found = null, lastCode = null;
  const collector = new Collector();

  function close() {
    if (closed) return;
    closed = true;
    stream?.getTracks().forEach((t) => t.stop());
    root.remove();
    document.removeEventListener('keydown', onKey);
  }
  const onKey = (e) => { if (e.key === 'Escape') { close(); onClose?.(); } };
  document.addEventListener('keydown', onKey);

  root.addEventListener('click', async (e) => {
    const x = e.target.closest('[data-x]')?.dataset.x;
    if (x === 'close') { close(); onClose?.(); }
    if (x === 'manual') { close(); onManual?.(); }
    if (x === 'use' && found) { const d = found; close(); onDate?.(d); }
    if (x === 'torch' && track) {
      torch = !torch;
      try { await track.applyConstraints({ advanced: [{ torch }] }); } catch { /* not supported */ }
    }
  });

  /** Copies the part of the picture inside the on-screen frame into the canvas (scaled for OCR if asked). */
  function grab(scale = 1) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return false;
    const r = frame.getBoundingClientRect(), box = video.getBoundingClientRect();
    const s = Math.max(box.width / vw, box.height / vh); // object-fit: cover
    const ox = (box.width - vw * s) / 2, oy = (box.height - vh * s) / 2;
    // A little extra round the frame helps, since people rarely line things up exactly.
    const pad = 0.12;
    let sx = (r.left - box.left - ox) / s, sy = (r.top - box.top - oy) / s, sw = r.width / s, sh = r.height / s;
    sx -= sw * pad; sy -= sh * pad; sw *= 1 + 2 * pad; sh *= 1 + 2 * pad;
    sx = Math.max(0, sx); sy = Math.max(0, sy); sw = Math.min(vw - sx, sw); sh = Math.min(vh - sy, sh);
    canvas.width = Math.round(sw * scale); canvas.height = Math.round(sh * scale);
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return true;
  }

  /** Grey and high-contrast: printed dates are often faint dot-matrix on shiny packs. */
  function sharpenForText() {
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const v = Math.max(0, Math.min(255, (g - 128) * 1.6 + 128));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(img, 0, 0);
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function loopCodes(formats, handle) {
    let det;
    try { det = await detector(formats); } catch { sub.textContent = 'The scanner could not load. Check your internet and try again.'; return; }
    while (!closed) {
      if (grab()) {
        try { const res = await det.detect(canvas); if (!closed) await handle(res); } catch { /* frame not ready */ }
      }
      await wait(90);
    }
  }

  async function loopDates() {
    let worker;
    try { worker = await textReader((t) => { sub.textContent = t; }); } catch {
      sub.textContent = 'The date reader needs the internet the first time. You can still pick the date yourself.';
      return;
    }
    if (closed) return;
    sub.textContent = COPY.date[1];
    while (!closed) {
      if (grab(2)) {
        sharpenForText();
        try {
          const { data } = await worker.recognize(canvas);
          const d = findDate(data.text || '');
          if (d && !closed) {
            found = d;
            useBtn.hidden = false;
            useBtn.textContent = `Use ${pretty(d)}`;
          }
        } catch { /* keep trying */ }
      }
      await wait(250);
    }
  }

  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      sub.textContent = 'This browser cannot use the camera. On iPhone, open the link in Safari.';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch {
      sub.textContent = 'Freshkeep needs the camera to scan. Allow it in your browser settings and try again.';
      return;
    }
    if (closed) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    track = stream.getVideoTracks()[0];
    try { await video.play(); } catch { /* autoplay attribute covers it */ }
    if (track.getCapabilities?.().torch) root.querySelector('[data-x=torch]').hidden = false;

    if (mode === 'code') {
      loopCodes(['ean_13', 'ean_8', 'upc_a', 'upc_e'], async (res) => {
        const code = res.map((b) => b.rawValue).find(validBarcode) || null;
        // The same valid code on two frames in a row before trusting it.
        if (code && code === lastCode) { close(); onCode?.(normaliseBarcode(code)); }
        lastCode = code;
      });
    } else if (mode === 'list') {
      loopCodes(['qr_code'], async (res) => {
        for (const b of res) {
          const p = parsePart(b.rawValue);
          if (!p || !collector.add(p)) continue;
          if (collector.total > 1) {
            title.textContent = `Scanned ${collector.count} of ${collector.total}`;
            bar.hidden = false;
            bar.firstElementChild.style.width = `${(collector.count / collector.total) * 100}%`;
          }
          if (collector.complete) {
            const list = await collector.result();
            if (list) { close(); onList?.(list); return; }
            sub.textContent = "That list couldn't be read. Try sharing it again.";
          }
        }
      });
    } else {
      loopDates();
    }
  })();

  return close;
}
