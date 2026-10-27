# M3 — Desktop & real screensaver

Package the same web files as a desktop app and a real Windows screensaver (`.scr`).
The game itself stays build-free: everything here lives in `desktop/` with its own
`package.json` and only **copies** the web files.

Needs T2.1 (`?zen`). Ask the user before buying anything (code-signing certificate,
Steam app fee).

---

## T3.1 [S] Electron wrapper (`desktop/`)

**Layout**
```
desktop/
  package.json      ← electron + electron-builder as devDependencies, "main": "main.js"
  main.js           ← Electron main process
  preload.js        ← tiny bridge (screensaver exit, see T3.2)
  build/icon.png    ← copy of /icon-512.png
```

1. **Serve the game through a custom protocol, not `file://`** (ES modules don't load
   reliably from `file://`). In `main.js`, before `app.whenReady()`:
   ```js
   protocol.registerSchemesAsPrivileged([{ scheme: 'app',
     privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
   ```
   then in `whenReady` use `protocol.handle('app', req => net.fetch(pathToFileURL(<game
   dir> + url.pathname)))`, where the game dir is `../` in development and
   `process.resourcesPath + '/game'` when packaged (electron-builder `extraResources`
   copies `index.html`, `manifest.json`, icons, `src/`, `styles/`, `assets/` into `game/`).
2. Normal launch: one window 1600×900, dark background `#0e0a06`, no menu bar, loads
   `app://pixelants/index.html`. F11 / the game's own F key toggles fullscreen.
3. `npm start` (in `desktop/`) runs it; `npm run dist` builds with electron-builder:
   Windows `portable` + `nsis` targets, macOS `dmg` target.
4. The desktop build is the **full** edition: the copy step rewrites `src/edition.js` to
   `export const EDITION = 'full';` (see T6.1) in the copied files only.

**Done when:** `cd desktop && npm install && npm start` opens the game with sound,
saves, and all modes working; a portable `.exe` is produced by `npm run dist`.

---

## T3.2 [S] Windows `.scr` behaviour and multi-monitor

A Windows screensaver is just an `.exe` renamed to `.scr` that understands these
arguments (case-insensitive, may be `/s` or `/S` or `/c:1234`):

| Arg | Meaning | Do |
|---|---|---|
| `/s` | run the screensaver | one fullscreen, frameless, always-on-top window **per display** (`screen.getAllDisplays()`), loading `index.html?zen&slot=<n>` (slot 1 = primary). Hide the cursor (CSS `cursor: none` injected via `webContents.insertCSS`). |
| `/c` | settings | a small window loading `index.html?settings=1` → the game opens only its settings dialog (add that param handling in `main.js`). |
| `/p <hwnd>` | preview inside the Control Panel's little monitor | embedding into another window isn't practical in Electron: exit immediately (the preview stays black — acceptable). |
| none | double-clicked | normal app (T3.1). |

**Exit on input** in `/s` mode: `preload.js` listens for `keydown`, `mousedown`,
`wheel`, and `mousemove` beyond 12 px from the first position, then calls
`ipcRenderer.send('quit')`; main process quits the app. Before quitting, the page saves
(`pagehide` → `doSave()` from T1.7 already handles this; give it 300 ms).

Each monitor runs its own colony (`slot`) — a nice touch: different farms on each screen.

**Done when:** the portable exe renamed to `PixelAnts.scr`, right-click → **Test**,
shows the farm full screen on every monitor and exits on mouse move; right-click →
**Configure** shows settings; right-click → **Install** sets it as the screensaver.

---

## T3.3 [H] Release script → `dist/`

**Create `tools/make-release.mjs`** (node built-ins only):
1. Read the version from `src/version.js`.
2. Copy `index.html`, `manifest.json`, `icon-*.png`, `og-image.png`, `src/`, `styles/`,
   `assets/` into `dist/pixel-ants-web-<version>/`, rewriting the copied
   `src/edition.js` to `'full'`.
3. Zip it with `tar -a -c -f dist/pixel-ants-web-<version>.zip -C dist pixel-ants-web-<version>`
   (Windows 10+ `tar` writes zip when the name ends in `.zip`).
4. Print the files produced and their sizes.

Add `"release": "node tools/make-release.mjs"` to the root `package.json`.

**Done when:** `npm run release` makes a zip that, unzipped and served with
`npm run serve`-style hosting, runs the full edition.

---

## T3.4 [S] Installer, "set as screensaver", macOS app

1. electron-builder NSIS installer for Windows: installs the app, and also copies the
   portable exe as `PixelAnts.scr` into `%LOCALAPPDATA%\PixelAnts\`. Final installer page
   offers a checkbox "Use Pixel Ants as my screensaver", which sets
   `HKCU\Control Panel\Desktop\SCRNSAVE.EXE` to that path and opens the Windows
   screensaver settings (`control desk.cpl,,@screensaver`) so the user can confirm.
2. Uninstaller removes the `.scr` and clears the registry value only if it still points at
   it.
3. macOS: `dmg` of the app. (A real macOS `.saver` is a stretch goal — the open-source
   WebViewScreenSaver can display a local HTML file; document it as an option rather than
   build it now.)
4. Unsigned Windows installers trigger a SmartScreen warning. Note it in the itch.io page
   ("More info → Run anyway"). Code signing (~$100–400/year) is a later decision for the
   user — don't buy anything.

**Done when:** installing on a clean Windows 11 machine (or VM) and ticking the box makes
Pixel Ants the active screensaver.
