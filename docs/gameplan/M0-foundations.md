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

## T0.4 [H] Settings store (`src/settings.js`) — DONE

As built:
- `settings.get(key)`, `settings.set(key, value)`, `settings.onChange((key, value) => …)` and
  `settings.defaults`, saved under `pixelants_settings`. `?debug` exposes it as `__pa.settings`.
  Nothing reads it yet: T1.4 (menu), sound, themes, the clock and the frame cap are the consumers.
  `hud.js` prefs and the tutorial flag are untouched.
- Stricter than the sketch: a value is accepted only for a known key and the type of its
  default (finite, for numbers). Loading from storage and `set()` use the same rule, so
  hand-edited or corrupt storage can't leak in and `set()` can't take a value that the next
  load would drop.
- Only what the player chose is written back, so the reduced-motion default (true when the OS
  asks for less motion) is never frozen into storage by an unrelated change. Choosing the value
  the OS already implies counts as a choice and is kept; it fires no change event.
- `npm test` has a `settings` check (defaults, events, rejected input, reload, corrupt
  storage, the reduced-motion rules in a second browser context). Break `settings.js` and it
  fails; it was mutation-tested.

---

## T0.5 [S] Save migrations + per-mode extra state — DONE

As built (`src/saveLoad.js`; the comment at its top is the rule to follow):
- A colony lives under `pixelants_<mode>` with the version inside the save, so bumping `VERSION`
  (exported, now 3) no longer orphans it. `hasSave`, `getSaveInfo` and `loadGame` fall back to
  the old `pixelants_v2_<mode>`. Loading changes nothing in storage; the first `saveGame` writes
  the new key and only then removes the old one, so a full storage can't cost a player their
  colony. `deleteSave` removes both, or New Colony would bring the old copy back.
- `MIGRATIONS[n]` turns a version-n save into n+1 and `loadGame` walks the chain. A save from a
  newer build, or with no usable version, is refused with a `console.warn`, and `main.js` starts
  a fresh colony ("Save corrupted — starting fresh"). **Changing what a save holds: bump
  `VERSION`, add a migration, never delete one.**
- `EXTRAS = ['run', 'decor']`: each one that exists on `sim` is saved into `extra`, and
  `load(data)` is called only when the save has data for it. Neither system exists yet
  (Survival run state T5.1, decorations T4.2).
- `getSaveInfo` also returns `ts` and `name`. `buildSave(sim)` is exported: it is what
  `saveGame` writes, and T0.6 measures it.
- `tests/fixtures/save-v2-screensaver.json` is a real version-2 save from the old code (about
  6,000 ticks, 40 ants). The `saves` check in `npm test`: the menu offers it and New Colony
  deletes it; it resumes (world, sky clock, ants, eggs, queen, peak population) with storage
  untouched until the player saves; saving writes the current format and removes the old key;
  that save resumes too; a version-999 save is refused, the player is told, and it stays in
  storage; `extra` round-trips (with stand-in systems) and a save from before `extra` loads
  without touching them. Each mode's own check also saves, reloads and compares the colony
  (`tests/out/<mode>-resumed.png`).
- **Before the next `VERSION` bump**, save a real colony into `tests/fixtures/` and make `saves`
  resume it too: the v2 fixture alone can't prove the new migration.
- Mutation-tested: dropping the migration, either legacy-key removal, the legacy fallback, the
  future-version refusal, the extras save / load / "only if present" guard, `ts` and `name`, the
  restore of world, sky, colony, queen or peak population, or putting the version back in the
  key each fail `npm test`. One mutant survives on purpose: `stats.day` is recomputed from the
  sky every tick, so restoring it from the save changes nothing.
- Known gap: if `loadGame` fails (a corrupt save, a save from a newer build after a rollback, a
  broken future migration) `main.js` starts a fresh colony and the next save overwrites the
  unreadable one. Keeping a copy would double the storage a big colony needs, so it was left.

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
  for that day, save size (`JSON.stringify` of what `saveGame` would write — T0.5 already
  exports `buildSave(sim)` from `saveLoad.js`; in the page: `await import('/src/saveLoad.js')`).
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
