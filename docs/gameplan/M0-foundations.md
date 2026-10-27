# M0 — Foundations

Make the codebase safe for small models: a way to run and check the game automatically,
one place for mode rules, one place for settings, and saves that survive changes.
Do these in order.

---

## T0.1 [H] Rewrite `claude.md` — DONE

---

## T0.2 [H] Debug hook, URL params, `package.json`, local server, smoke test — DONE

As built (the code is the spec now — read it, don't re-derive it):
- `src/main.js`: `?debug` exposes `window.__pa = { sim, gameLoop, camera, director, hud,
  GameState, CONFIG }` and skips the tutorial. `?mode=<name>` skips the menu (and resumes
  that mode's save). `?new` wipes the save first **only together with `?debug`**, so a stray
  link can never delete a player's colony. Test URL: `/?debug&new&mode=screensaver`.
- `tools/serve.mjs` (`npm run serve [port]`): static server on 127.0.0.1. `serve(0)` picks a
  free port (the tests use it); from the command line a busy port moves on to the next one.
- `tests/smoke.mjs` (`npm test`, ~30 s): the normal menu → tutorial boot, then each mode at 8×
  until at least 3,000 ticks and 10 s have passed. Fails on any page error, console error or
  failed request, no ants alive, a non-finite ant position, or a blank canvas. Screenshots go
  to `tests/out/` — look at them. It runs every mode in `src/modes.js`, so Keeper (T4.1) is covered by adding its row.
- `package.json` (scripts `serve`, `test`, `soak`; devDependency Playwright 1.60.0) and
  `package-lock.json`. If Chromium is missing: `npx playwright install chromium`.
- `netlify.toml`: no build step, and `NPM_FLAGS = "--omit=dev"` so Netlify doesn't install
  Playwright. **After the first merge to `master`, check the Netlify deploy log**: install
  should be near-instant and the site should publish unchanged.
- `.gitignore`: `tests/out/`, `dist/`, `desktop/node_modules/`, `desktop/out/`.

---

## T0.3 [S] Mode rules table (`src/modes.js`) — DONE

As built:
- `src/modes.js` holds `MODES` (one row per mode) and `rules()`, which returns the row for
  `GameState.mode`. Mode behaviour is now a field read — `rules().noStarvation`, `.floors`,
  `.autoTour` — in `ants.js`, `queen.js`, `sky.js`, `world.js`, `hud.js`, `dashboard.js` and
  `main.js`. **Don't add `GameState.mode === '…'` checks; add a field.**
- Two fields beyond the plan: `cls` (the dashboard badge's CSS class) and `intro` (the Colony
  Log line `main.js` writes at start; only Survival has one).
- `label` and `badge` still say "Screensaver" / "SCREENSAVER": the rename to Zen is T1.6.
- `tests/smoke.mjs` runs every key of `MODES`, so a new mode is tested by adding its row.
- To check a rule really comes from the table: hold both stores at 0 with every ant at max
  hunger for 1,000 ticks. Survival loses every ant to starvation; Zen loses none; Zen with
  `floors: null` still loses none (`noStarvation` alone); flip that off too and they starve.
  Patch the live table from the page with `(await import('/src/modes.js')).MODES`.

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
