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

## T0.6 [S] Soak test (`tests/soak.mjs`) — DONE

As built (`npm run soak -- --mode screensaver --days 30`; `--mode` is any key of `MODES`, `--days`
a whole number; anything else prints the usage and exits 2):
- It serves the game, opens `?debug&new&mode=<mode>`, stops the game loop and lives whole days
  back to back, calling `gameLoop.onUpdate` `CONFIG.DAY_TICKS` times per `evaluate` call. That is
  the simulation only: the renderer, director and HUD don't run, so a leak in them isn't caught.
  It takes about a second per in-game day, not the 20–60 s the plan guessed.
- Each day prints a row and rewrites `tests/out/soak-<mode>.csv`: `d` (days lived), `day` (the
  game's own counter, one ahead because a colony starts in the morning), population, capacity,
  eggs, food, water, queen health, ants with a non-finite position, heap (MB, after a forced
  `gc()`), ms per tick that day, and the size of the save `buildSave` would write.
- Fails (exit 1) on a page error, console error or failed request; an ant with a non-finite
  position; a save over 3 MB; a colony that has ended (the game's own test from `main.js`: queen
  dead, or no ants and no eggs) in a mode whose `gameOver` is false; and heap or ms/tick that has
  grown too much (next point). In a mode that can end (Survival) the colony ending stops the soak
  and passes. A non-finite ant, an ended colony or an oversize save stops the run at once, as
  more days can't undo it.
- **Deviation: heap and ms/tick are compared with the earliest day from day 5 on whose population
  is within 25% of the last day's, not with day 5.** A Zen colony is still growing until about day
  20 (100 ants on day 1, ~665 at capacity, ~16 KB of heap per ant), and "heap at the last day >
  1.5x heap at day 5" failed a healthy 30-day run at 1.6x. The limits are the plan's (1.5x heap,
  2x ms/tick); if no day qualifies the checks are skipped and the output says so. **Blind spot:**
  in a run too short for the colony to level off (under about 20 days in Zen) a leak and growth
  look the same, so there the table is the only evidence; use 30 days or more for a verdict.
- Results on the final script, all PASS: Zen 30 days (day 30 against day 14: heap 15.1 -> 17.1 MB,
  0.108 -> 0.070 ms/tick, population 516 -> 665), Survival 10 days (day 10 against day 6: heap
  10.5 -> 11.5 MB, 0.067 -> 0.060 ms/tick), Zen 100 days (day 100 against day 13: heap 14.8 ->
  18.0 MB, 0.097 -> 0.055 ms/tick). Zen levels off at about 665 ants, 17-18 MB, 0.06 ms/tick and a
  135 KB save, flat from day 20 to day 100.
- Mutation-tested by injecting each fault at the end of the sim step (or into `buildSave`): an
  exception, a `console.error`, a NaN ant, the queen dying in Zen, every ant and egg gone in Zen,
  a leak of about 1.5 MB a day and ticks that slow down from day 15 (both over `--days 30`), and a
  4 MB save all fail the soak with the right message; the queen dying or the colony emptying in
  Survival stops it cleanly and passes. The same leak and slowdown over 10-12 days are not caught
  (the blind spot above).
- Seen while soaking, not fixed: from about day 28 the Zen food store often sits at its floor of
  200 (`floors` in the Zen row, which tops the store up for free), so a full-size colony eats
  about as fast as its foragers bring food in. Worth a look if Zen is ever tuned.

---

## T0.7 [H] Tiny event bus in `src/events.js` — DONE

As built: `on(type, fn)` and `emit(type, data)` sit below `logEvent`/`onEvent` in `src/events.js`
(those two are unchanged), plus the eight one-line emits below. The sketch was tightened in four
ways, so that a careless listener can't hurt the simulation or the other listeners:
- Handlers are kept in a `Map`, not `{}`: with `{}` a type called `constructor` or `toString`
  finds `Object`'s own property and breaks `on`/`emit`.
- `on` returns a function that removes just that registration (the sketch's `filter(f => f !== fn)`
  removed every registration of the same function). Calling it twice is harmless, and once it has
  been called the handler is not called again, not even by an emit already under way.
- The list for a type is replaced on every `on` and unsubscribe, never edited, so an emit walks the
  list it started with: a handler added during an emit first hears the next one.
- `emit` catches what a handler throws, reports it (`console.error("Handler for 'dawn' threw:",
  e)`) and carries on with the other handlers; the sketch let it escape into the sim step. A broken
  listener can't hide, though: `npm test` fails on any `console.error` from the page.

The emits (the dusk `else if` got braces to hold its two lines):
- `dawn { day }`: first line of `_dawn`, before its bad-weather early return. `day` is `sky.day`, so
  the first dawn of a new colony is day 2 (it starts in the morning of day 1). `dusk { day }` is
  next to the dusk `logEvent`.
- `rainStart {}` and `rainEnd {}` next to their `logEvent`s; `flight {}` after `startNuptialFlight`.
- `hatch { x, y }`: last line of `_hatch`, where the egg was (the same as `antSystem.lastHatch`).
- `death { cause }`: last line of `_kill`; `'age'`, `'fight'` or `'starved'`. An alate leaving in the
  nuptial flight is not a death.
- `projectDone { kind }`: last line of `_completeProject`; `'gallery'`, `'link'` or `'prospect'`.

Nothing in the game listens yet. To watch from a `?debug` session:
`(await import('/src/events.js')).on('dawn', d => console.log('dawn', d))` (that is the module the
game itself uses; `window.__pa` was not widened for it). Done that way over four days: dawns for
days 2-5, dusks for days 1-4, one rain, one flight, 278 hatches, 29 deaths and 19 finished projects.

Test: a new `events` check in `tests/smoke.mjs` (about 3 s):
- The bus on its own: delivery in order, to the right type, as the very object emitted;
  unsubscribing one of a function's two registrations, and twice; handlers removed and added during
  an emit; a throwing handler (reported with the event's name, the others and the emitter carry on);
  type names `Object` has; `logEvent` still reaching `onEvent`.
- A real colony, with the game loop stopped and the check as the clock, played a day at a time until
  every event has fired (2-3 days; it gives up after 10). A death is made, not waited for: one ant
  with no health, one at its lifespan. Then each event must carry what it should: `dawn`/`dusk`
  `{ day }` equal to `sky.day` and taking turns day after day; rain starting and ending in turn;
  `rainStart`/`rainEnd`/`flight` carrying `{}`; `hatch` `{ x, y }` equal to `lastHatch`; `death` a
  cause; `projectDone` the kind of the project that finished. And exactly one `hatch` for each
  `_hatchCount`, one `death` for each of `antSystem.deaths` and one `projectDone` for each call of
  `world._completeProject` (the check wraps that method to count the calls and read the kind).
- `npm test -- <names>` runs just those checks (`boot`, `settings`, `saves`, `events`,
  `screensaver`, `survival`), e.g. `npm test -- events saves`. An unknown name prints the list and
  exits 2; a filtered run ends "All passed (just events)".
- It reaches for `_hatchCount`, `deaths`, `lastHatch`, `world._completeProject` and an ant's `hp`,
  `age` and `lifespan`; rename one and the check fails and says what is gone, it doesn't go quiet.
  It makes no `'starved'` death: that passes through the same emit line as the two it does make.

Mutation-tested: 45 deliberate breaks, each making the check fail with the right message.
- 16 in the bus: no `live` check in `emit`; `live` never cleared; `on` pushing in place; an
  unsubscribe that splices in place (idempotent or not); unsubscribing by function; no
  `try`/`catch`; a silent `catch`; an error that doesn't name the event; `{}` for the `Map`; no guard
  for a type nobody listens to; a copy of the data; reverse order; every type hearing every emit;
  `logEvent` not telling its listeners; its repeated-line filter gone.
- 13 in `sky.js`, 11 in `ants.js`, 5 in `world.js`: each of the eight emits deleted; wrong or
  missing data; `dawn` emitted twice; `dusk` on every night tick; rain start announced as rain end;
  `hatch` emitted only with the every-4th-hatch log line, before the colony is updated, or twice;
  `death` for fights only, with a fixed cause, with an index, or twice; `projectDone` with a fixed
  kind, the project id, twice, or for galleries only.
- Writing them showed two blind spots in the check as first written, both now closed. Six mutants
  got through that version (tried): `on` pushing in place (its one add-during-an-emit came after
  an unsubscribe, which hid it; it has a scenario of its own now), `hatch` emitted twice or only
  every 4th time, `death` or `projectDone` emitted twice, and `projectDone` with a fixed kind
  (nothing held the events to one per occurrence, naming the right thing; the counts above do).
