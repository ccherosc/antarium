# M0 — Foundations

Make the codebase safe for small models: a way to run and check the game automatically,
one place for mode rules, one place for settings, and saves that survive changes.
Do these in order.

---

## T0.1 [H] Rewrite `claude.md` — DONE

---

## T0.2 [H] Debug hook, URL params, `package.json`, local server, smoke test

**Why:** every later ticket ends with "run `npm test`". This ticket creates it.

**Files:** `src/main.js`, `package.json` (new), `tools/serve.mjs` (new),
`tests/smoke.mjs` (new), `.gitignore`, `netlify.toml` (new).

**Steps**
1. `src/main.js` — URL parameters, read once near the top:
   ```js
   const params = new URLSearchParams(location.search);
   const DEBUG = params.has('debug');
   ```
   In `pickMode()`, before wiring the buttons: if `params.get('mode')` is one of
   `['screensaver', 'survival']`, set `GameState.mode`, hide `#mode-select`, and resolve
   immediately — `resolve(false)` after `deleteSave(mode)` if `params.has('new')`,
   otherwise `resolve(hasSave(mode))`.
2. `src/main.js` — after `hud = new Hud(...)`:
   ```js
   if (DEBUG) window.__pa = { sim, gameLoop, camera, director, hud, GameState, CONFIG };
   ```
   (add `import { CONFIG } from './config.js';` at the top of `main.js`)
   and don't show the tutorial when `DEBUG` (wrap `new Tutorial().show(...)`).
3. `tools/serve.mjs` — zero-dependency static server:
   ```js
   // node tools/serve.mjs [port] — serves the repo root on 127.0.0.1
   import http from 'node:http';
   import fs from 'node:fs';
   import path from 'node:path';
   import { fileURLToPath } from 'node:url';

   const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
   const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
     '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
     '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2' };

   export function serve(port = 8080) {
     const server = http.createServer((req, res) => {
       let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
       if (p.endsWith('/')) p += 'index.html';
       const file = path.join(root, p);
       if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
       fs.readFile(file, (err, data) => {
         if (err) { res.writeHead(404); res.end('Not found'); return; }
         res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                              'Cache-Control': 'no-store' });
         res.end(data);
       });
     });
     return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
   }

   if (process.argv[1] === fileURLToPath(import.meta.url)) {
     const port = +(process.argv[2] || 8080);
     serve(port).then(() => console.log(`Pixel Ants: http://localhost:${port}/`));
   }
   ```
4. `package.json`:
   ```json
   {
     "name": "pixel-ants",
     "private": true,
     "type": "module",
     "scripts": {
       "serve": "node tools/serve.mjs",
       "test": "node tests/smoke.mjs",
       "soak": "node tests/soak.mjs"
     },
     "devDependencies": { "playwright": "1.60.0" }
   }
   ```
   If Chromium is missing, run `npx playwright install chromium` once.
5. `netlify.toml` — stops Netlify trying to "build" now that a `package.json` exists:
   ```toml
   [build]
     publish = "."
     command = "echo static site"
   [build.environment]
     PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1"
   ```
   After merging this ticket, check the Netlify deploy log once: it should install
   quickly and publish without a build step.
6. `tests/smoke.mjs`:
   - `const MODES = ['screensaver', 'survival'];` (add `'keeper'` when T4.1 lands).
   - Start `serve(8181)` from `tools/serve.mjs`; launch Chromium (viewport 1600×900).
   - For each mode: new page; collect `pageerror` and console `error` messages;
     `goto('http://127.0.0.1:8181/?debug&new&mode=' + mode)`;
     `waitForFunction(() => window.__pa)`; `evaluate(() => __pa.gameLoop.setSpeed(8))`;
     wait 15 s; then check:
     - no errors collected
     - `__pa.sim.world.tick > 3000`
     - `__pa.sim.antSystem.population > 0`
     - every ant has finite `x` and `y` (`__pa.sim.antSystem.ants.every(a => Number.isFinite(a.x) && Number.isFinite(a.y))`)
   - Screenshot to `tests/out/<mode>.png`.
   - Print one line per mode: `PASS screensaver  tick=… pop=…` or `FAIL … <reason>`.
   - Close everything; `process.exit(anyFailed ? 1 : 0)`.
7. `.gitignore` — add `tests/out/`, `dist/`, `desktop/node_modules/`, `desktop/out/`.

**Done when:** `npm test` prints PASS for both modes and writes two screenshots that show
a running farm. Normal play (no URL params) still shows the mode menu and tutorial.

---

## T0.3 [S] Mode rules table (`src/modes.js`)

**Why:** mode behaviour is scattered over 15 `GameState.mode` checks. Adding Keeper (T4.1)
and Survival features must become "add a row / read a field", not a hunt through 1,300-line files.

**Create `src/modes.js`:**
```js
import { GameState } from './gameState.js';

// Everything that differs between ways of playing. Read with rules().
export const MODES = {
  screensaver: {
    label: 'Zen', badge: 'ZEN',
    lifespanMult: 1.5,        // ants live longer
    noStarvation: true,       // ants never starve
    queenHealthFloor: 5,      // queen cannot die
    freeEggs: true,           // laying doesn't depend on food
    digSpeed: 1.5,            // world._digRate divisor (smaller = faster)
    floors: { food: 200, water: 250 },   // stores never drop below (null = no floor)
    stress: false,            // colony stress is always 0
    foodSpawnTicks: 420,      // null = CONFIG.FOOD_RESPAWN_INTERVAL * 2
    foodScalesWithColony: true,
    dewScalesWithColony: true,
    autoTour: true,           // director tour on by default
    gameOver: false,          // check for queen death / extinction
  },
  survival: {
    label: 'Survival', badge: 'SURVIVAL',
    lifespanMult: 1, noStarvation: false, queenHealthFloor: 0, freeEggs: false,
    digSpeed: 3, floors: null, stress: true, foodSpawnTicks: null,
    foodScalesWithColony: false, dewScalesWithColony: false, autoTour: false, gameOver: true,
  },
};

export const rules = () => MODES[GameState.mode] || MODES.screensaver;
```

**Replace every mode check** (grep `GameState.mode` and `screensaver` to confirm the list):

| Where | Today | Becomes |
|---|---|---|
| `ants.js` `randLifespan` | `=== 'screensaver' ? 1.5 : 1` | `rules().lifespanMult` |
| `ants.js` `update` (`this._screensaver`) and the starvation check | `!this._screensaver && …` | `!rules().noStarvation && …` (remove `_screensaver`, also its init in the constructor) |
| `queen.js` `update` | `floor = screensaver ? 5 : 0` | `rules().queenHealthFloor` |
| `queen.js` `update` | `meanLife … (screensaver ? 1.5 : 1)` | `rules().lifespanMult` |
| `queen.js` `update` | `if (!screensaver) rate *= …` and `fed = screensaver \|\| …` | `rules().freeEggs` |
| `sky.js` `_dawn` | `GameState.mode === 'screensaver' && antSystem` | `rules().dewScalesWithColony && antSystem` |
| `world.js` `update` | `CONFIG.DIG_TICKS * (screensaver ? 1.5 : 3)` | `CONFIG.DIG_TICKS * rules().digSpeed` |
| `world.js` `update` | `if (screensaver) { floors; stress = 0; return; }` | use `rules().floors` (if not null) and `rules().stress` |
| `world.js` `_tickFoodSpawn` | `screensaver ? 420 : …` and the colony-scaled cap | `rules().foodSpawnTicks ?? CONFIG.FOOD_RESPAWN_INTERVAL * 2`, `rules().foodScalesWithColony` |
| `hud.js` constructor | `mode === 'screensaver'` default for auto tour | `rules().autoTour` |
| `dashboard.js` | `survival ? 'SURVIVAL' : 'SCREENSAVER'` | `rules().badge`; keep the `survival` CSS class when `GameState.mode === 'survival'` → better: add `cls` field to MODES |
| `main.js` `showConfirm` | label ternary | `MODES[mode].label` |
| `main.js` `pickMode` | `['screensaver', 'survival']` | `Object.keys(MODES)` (buttons that don't exist in the HTML are skipped: guard with `?.`) |
| `main.js` render callback | `GameState.mode === 'survival' && …` | `rules().gameOver && …` |

Also update the comment in `src/gameState.js` and the smoke test's MODES list to read
`Object.keys(MODES)` if convenient.

**Done when:** `grep -rn "=== 'screensaver'\|=== 'survival'" src` finds nothing outside
`modes.js` (one CSS-class check is fine), `npm test` passes, and a 5-day soak (T0.6, or
manual at 8× speed) of each mode behaves as before: screensaver food never < 200, survival
can starve.

---

## T0.4 [H] Settings store (`src/settings.js`)

**Why:** settings menu (T1.4), sound, themes, clock and frame cap all need one persisted
place. Leave the existing HUD prefs (`PREFS_KEY` in `hud.js`) and tutorial flag alone.

**Create `src/settings.js`:**
```js
const KEY = 'pixelants_settings';
const DEFAULTS = {
  volume: 0.6,          // 0..1 master
  muted: false,
  fpsCap: 60,           // 30 | 60 | 0 (unlimited)
  quality: 'high',      // 'high' | 'low'
  theme: 'classic',
  showClock: false,
  clock24h: false,
  reducedMotion: false,
  textScale: 1,         // 1 | 1.25 | 1.5
};
let data = { ...DEFAULTS };
try { Object.assign(data, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { /* private window */ }
const subs = [];

export const settings = {
  get: k => data[k],
  set(k, v) {
    if (data[k] === v) return;
    data[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* full or private */ }
    for (const fn of subs) fn(k, v);
  },
  onChange: fn => { subs.push(fn); },
  defaults: DEFAULTS,
};
```
Also: if `window.matchMedia('(prefers-reduced-motion: reduce)').matches` and the user
never set `reducedMotion`, default it to `true`.

**Done when:** in the console, `settings.set('volume', 0.2)` survives a reload. `npm test`
passes.

---

## T0.5 [S] Save migrations + per-mode extra state

**Why:** today the storage key contains the version (`pixelants_v2_<mode>`), so bumping
VERSION silently orphans every player's colony. Paying customers must never lose a colony.

**File:** `src/saveLoad.js`.

1. Key no longer includes the version: `pixelants_<mode>`. `hasSave`/`getSaveInfo`/
   `loadGame` fall back to reading the legacy key `pixelants_v2_<mode>`; after a
   successful load, the next save writes the new key and removes the legacy one.
2. Migrations:
   ```js
   const VERSION = 3;
   // MIGRATIONS[n] turns a version-n save into a version-(n+1) save
   const MIGRATIONS = {
     2: d => ({ ...d, extra: {} }),
   };
   ```
   `loadGame`: `while (d.version < VERSION) { d = MIGRATIONS[d.version](d); d.version++; }`;
   refuse saves from the future (`d.version > VERSION`).
3. Extra state: `saveGame` writes `extra: {}` holding `sim[k].save()` for each
   `k` in `const EXTRAS = ['run', 'decor']` that exists on `sim` (Survival run state T5.1,
   decorations T4.2). `loadGame` calls `sim[k].load(d.extra[k])` when both exist.
4. `getSaveInfo` also returns `ts` and `name` (`d.name`, colony name from T4.6; may be
   undefined).
5. Write a comment block at the top of `saveLoad.js`: "Changing what a save holds? Bump
   VERSION and add a MIGRATIONS entry. Never delete a migration."

**Done when:** a colony saved before this change (key `pixelants_v2_screensaver`) still
resumes after it; `npm test` passes; save → reload → resume works in both modes.

---

## T0.6 [S] Soak test (`tests/soak.mjs`)

**Why:** the 8-hour stability bar can't be checked by eye.

`npm run soak -- --mode screensaver --days 30`

- Serve + launch like the smoke test with `?debug&new&mode=…`.
- In the page: `__pa.gameLoop.stop()`, then run whole in-game days synchronously:
  `for (let i = 0; i < __pa.CONFIG.DAY_TICKS; i++) __pa.gameLoop.onUpdate(16)`.
  Run one day per `evaluate` call so the page stays responsive.
- After each day record: day, population, capacity, eggs, foodStore, waterStore, queen
  health, ants with non-finite x/y, `performance.memory.usedJSHeapSize` (MB), ms per tick
  for that day, save size (`JSON.stringify` of what `saveGame` would write — export a
  `buildSave(sim)` helper from `saveLoad.js` for this).
- Write `tests/out/soak-<mode>.csv`; print a compact table.
- Fail (exit 1) on: any page error; any non-finite ant; Zen population hitting 0; heap at
  the last day > 1.5× heap at day 5; ms/tick at the last day > 2× day 5 at similar
  population; save size > 3 MB.

**Done when:** a 30-day Zen soak and a 10-day Survival soak finish and print the table.
(Expect ~20–60 s per in-game day once the colony is big.)

---

## T0.7 [H] Tiny event bus in `src/events.js`

**Why:** Survival threats, milestones, sounds and the director all want "tell me when X
happens" without reaching into `ants.js`.

1. Add to `src/events.js` (keep `logEvent`/`onEvent` as they are):
   ```js
   const handlers = {};
   // Typed game events: on('hatch', fn) / emit('hatch', { x, y })
   export function on(type, fn) {
     (handlers[type] ||= []).push(fn);
     return () => { handlers[type] = handlers[type].filter(f => f !== fn); };
   }
   export function emit(type, data) {
     const list = handlers[type];
     if (list) for (const fn of list) fn(data);
   }
   ```
2. Add **one line** `emit(...)` at each place below. Don't restructure the functions.

   | Event | Where | Data |
   |---|---|---|
   | `dawn` | `sky.js` `_dawn` (first line) | `{ day }` |
   | `dusk` | `sky.js` `update`, next to the dusk `logEvent` | `{ day }` |
   | `rainStart` / `rainEnd` | `sky.js` `_weather`, next to the matching `logEvent`s | `{}` |
   | `flight` | `sky.js` `_flight`, after `startNuptialFlight` | `{}` |
   | `hatch` | `ants.js` `_hatch` | `{ x: e.x, y: e.y }` |
   | `death` | `ants.js` `_kill` | `{ cause }` |
   | `projectDone` | `world.js` `_completeProject` | `{ kind: p.kind }` |

**Done when:** `on('dawn', d => console.log('dawn', d))` in a debug session logs each
dawn; `npm test` passes.
