# Freshkeep — web app 🥛

**Scan your food, add the date on the pack, and see at a glance what's going out of date.**

Freshkeep runs in the browser and installs to your home screen like a normal app, on **iPhone** and **Android**.
No App Store, no account, no sign-up.

### 👉 [Open Freshkeep](https://chiefu-apps.github.io/Fresh_Keep/)

---

## Put it on your phone

**iPhone (Safari)**
1. Open the link above in **Safari**.
2. Tap the **Share** button (the square with an arrow).
3. Scroll down and tap **Add to Home Screen**, then **Add**.

**Android (Chrome)**
1. Open the link above in **Chrome**.
2. Tap **Install** on the banner, or **⋮ → Add to Home screen**.

Freshkeep then opens full-screen from its own icon and works offline.

## What it does

- **Scan to add.** Point the camera at the barcode and Freshkeep finds the product name and photo
  (from [Open Food Facts](https://world.openfoodfacts.org)).
- **Read the date off the pack.** Point the camera at the printed date ("USE BY 05/11/26", "12 NOV"…),
  or pick it with the date wheel.
- **See what's out of date.** Anything past its date goes to the top in red, and the rest is sorted
  soonest first. Once installed, the app icon shows a badge with how many things are out of date.
- **Basic or Advanced mode.** One date per item, or a use-by date plus a best-before date. A passed
  best-before date shows in amber but never marks food as out of date.
- **Two views.** Large cards with countdowns, or a compact icon grid.
- **Quantities.** Log six yoghurts in one go and tick them off one at a time.
- **Share your list.** Copy your list to another phone with a QR code (big lists cycle through a few
  codes), or send it as a message. It works with the Android app too.
- **Undo.** Used it or binned it by mistake? Tap Undo.

## Privacy

Your food list is stored **only on your phone**, in the browser's storage for this site. Nothing is uploaded.
The only things that leave the phone are:
- the barcode number, sent to Open Food Facts to look up the product name and photo, and
- the first time you scan a date, the text-reading files (a few MB) are downloaded from jsDelivr.

## Good to know

- **iPhone:** use Safari, and add it to the home screen. Safari can clear storage for websites you haven't
  visited in a while, but home-screen apps keep their data.
- Deleting the home-screen app, or clearing Safari/Chrome website data, deletes your list. Use
  **Settings → Share my list → Send as a message** to keep a copy.
- Web apps can't send a daily alert at a set time the way the Android app does. Freshkeep shows
  what's out of date whenever you open it, and keeps the badge on the icon up to date.
- Needs iOS 16.4 or later, or a recent Chrome on Android.

## How it's built

Plain HTML, CSS and JavaScript with no build step, so the files in this folder are exactly what's served.

| File | What it does |
| --- | --- |
| `index.html`, `style.css` | The page and its look (light and dark mode) |
| `js/app.js` | Screens: home, add/edit, details, settings, sharing |
| `js/store.js` | Saving the list on the phone, product lookups |
| `js/dates.js` | Countdowns and reading printed dates (same rules as the Android app) |
| `js/scanner.js` | Camera: barcodes, printed dates, shared-list QR codes |
| `js/share.js` | The list ↔ QR code format (shared with the Android app) |
| `sw.js` | Offline support |
| `vendor/` | [barcode-detector](https://github.com/Sec-ant/barcode-detector) + ZXing WebAssembly (MIT), [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) (MIT) |

Reading printed dates uses [Tesseract.js](https://github.com/naptha/tesseract.js) (Apache 2.0), loaded on first use.

### Run it locally

    python -m http.server 8000

Then open <http://localhost:8000>. The camera needs `localhost` or `https`.

### Publishing an update

1. Change the files.
2. Bump `VERSION` in `sw.js` (e.g. `freshkeep-v2`) so phones pick up the new version.
3. Commit and push. GitHub Pages updates in a minute or two.

---

Product data © Open Food Facts contributors, under the [Open Database License](https://opendatacommons.org/licenses/odbl/1-0/).
