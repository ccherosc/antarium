# M1 — Commercial polish

The things a $3.99 buyer expects before they notice the ants: sound, settings, a pause
menu, no crashes, no battery drain, and a great first 30 seconds.

Needs M0 done (`npm test`, `rules()`, `settings`, `on/emit`).

---

## T1.1 [S] Fast-forward engine (catch-up + pre-grown colonies) — DONE

As built (`src/app/fastForward.js`, `src/main.js`; the numbers are the "Fast-forward" block of
`CONFIG`):
- `fastForward({ step, maxTicks, until, budgetMs = 8000, sliceMs = CONFIG.FF_SLICE_MS, onProgress })`
  resolves to the ticks it ran: `step()` for about `sliceMs` (12 ms), then a `setTimeout` yield so
  the page can paint. Beyond the sketch: `sliceMs` is an option and a slice always runs at least
  one tick; `until()` is asked before every tick, so a colony that is ready already runs none;
  `onProgress(f)` gets whichever of ticks/`maxTicks` and time/`budgetMs` is further along, then `1`
  once as it stops (also with `maxTicks: 0`); a `step` that throws rejects the promise.
- `main.js`: `function tick(dt)` is the old `GameLoop` callback, now shared by both.
  `fastForwardStart()` runs between building the colony and `gameLoop.start()`, behind a
  `#founding` overlay (a line of text and a bar, faded out over `FF_FADE_MS`), and returns what it
  did: `{ kind: 'pregrow', ticks }`, `{ kind: 'catchUp', ticks, hatched, chambers }` or `null`. If
  the fast-forward throws, that is logged (`console.error('Fast-forward failed; …')`) and the colony
  starts as it is, never stuck behind the overlay.
- **New colony** (`rules().pregrow`: Zen; Survival false; Keeper later): grown until there are
  `PREGROW_POP` (45) ants and the sun is up, or `PREGROW_DAYS` (1.5) in-game days have passed, or
  `PREGROW_BUDGET_MS` (8 s) has. Measured here: about 0.3 s (5.5-8.8k ticks at ~30,000 ticks/s) to a
  nest of about 20 chambers and 45 ants, at about midday of day 1.
- **Resumed colony** (`rules().catchUp`: Zen; Survival false): `missedTicks(ts)` from the save's
  `ts` is 0 when the save is under `CATCHUP_MIN_MS` (30 s) old, in the future or has no `ts`;
  otherwise at most `CATCHUP_MAX_DAYS` (0.5 day, 7,200 ticks), within `CATCHUP_BUDGET_MS` (5 s).
  The full 7,200 ticks take 0.25-0.5 s here. Hatchings are counted with `on('hatch')` and chambers
  with `world.chamberCount` (`stats.chamberCount` reads 0 until the first tick after a load), and
  toasted for 7 s if there is any news: "While you were away: 74 ants hatched". A new chamber is
  rarer than a hatching (none in the test's ten minutes away), so the toast is often only about
  hatchings.

Where it departs from the ticket, and why:
- A new colony is founded at midnight (`PREGROW_START_PHASE: 0`, not `DAY_START_PHASE`) and is not
  done until `sky.light` is at least `PREGROW_MIN_LIGHT` (0.9). Growing takes about half a day, so
  from the usual early-morning start it could open at dusk or in the night: a dark, empty-looking
  first impression for a screensaver. From midnight it opens at about noon (30 runs: all in full
  light, on day 1, 359 ms at most). `Sky` takes an optional `startPhase`; `createSim` gives it the
  pre-grow phase only when `rules().pregrow`.
- The catch-up overlay says "Catching up on your colony…"; the new colony's says "Founding your
  colony…".
- `window.__pa` now appears once the fast-forward is over, so a test that waits for it never races
  it, and it has a `startup` field: what `fastForwardStart()` returned.
- "Save corrupted — starting fresh" is said once the fast-forward is over; the overlay would hide it.
- One line of rendering changed, in `src/rendering/renderWorld.js`, though the ticket names no rendering
  file. A colony that has run before its first frame painted no soil: the first frame's
  `forceFullRedraw` does nothing because the tile canvas does not exist yet, and `renderWorld` redraws
  every tile only when the dirty set is empty or over 6,000, so a grown or caught-up world (a few
  thousand dirty tiles) put its tunnels on a blank canvas and the ground came out near-black (the
  middle of the farm averaged red 28, blue 46; brown soil is about red 108, blue 40). `ensureOffscreen`
  now says when it has just made the canvas and `renderWorld` then draws every tile. Found by
  measuring the colour of the farm against `master`'s.

Things to know:
- Events emitted during a fast-forward are real: dozens of `hatch`es and a `dawn` or `dusk`. A
  listener that must not hear them (T1.3's sound) has to be registered after `await fastForwardStart()`.
- No save is written right after a catch-up, so closing the tab within the 60 s autosave replays
  the same absence from the old `ts` next time (same result, 0.3 s).
- The pre-grow assumes timers run at full speed. A background tab throttles them, so the 8 s budget
  would cut the growth short and the nest would be smaller; the colony still starts. (Reasoned, not
  measured.)

Test: a new `fastforward` check in `tests/smoke.mjs` (about 20 s; `npm test -- fastforward`):
- The engine on its own, in Node: `maxTicks`, `until`, a colony that is ready already, `maxTicks: 0`,
  `sliceMs: 0`, slow ticks stopped by `budgetMs` while the page's timers still get their turns,
  progress rising within 0..1 and ending on 1, and a tick that throws.
- New colonies, in the browser (a script run before the page's own records what the overlay says and
  does). A mode that pre-grows opens with 45 ants or more, in daylight, on day 1, behind "Founding
  your colony…". One that doesn't (Survival) starts as it is, on the usual morning clock, with no overlay;
  `rules()` is also checked to say so. Founded at dusk (`PREGROW_START_PHASE` 0.6) it is grown on until
  daylight. `PREGROW_DAYS` 0.01 grows it for exactly 144 ticks and `PREGROW_BUDGET_MS` 1 cuts it short.
  A fault injected into the engine (the module is rewritten on its way to the page) is logged once and
  the colony still starts and runs. Settings are changed the same way, by rewriting `config.js` on its
  way to the page; the repo is never touched.
- Resumed colonies, from a real Zen save with its `ts` rewritten: 5 s ago, in the future, or no `ts` is
  left alone; a minute away catches up about 3,750 ticks, with the clocks to match; ten minutes away
  catches up exactly the 7,200-tick cap behind "Catching up on your colony…", the hatchings counted match
  the game's own count since the save, the chambers counted are fewer than the nest has, and the toast
  says exactly that; `CATCHUP_BUDGET_MS` 1 cuts it short; a Survival save from ten minutes ago is left
  alone; the old build's fixture catches up the cap and carries on.
- In all three of the Zen cases above (a new colony, founded at dusk, ten minutes away) and in a new
  Survival colony, the middle of the farm must be brown: more red than blue by a fifth. Brown soil reads
  1.7 red to blue at midnight, the darkest it gets, to 2.7 at midday; the unpainted ground read 0.5-0.6.
- Screenshots: `fastforward-screensaver`, `-survival`, `-dusk` and `-catchup` in `tests/out/`.

The other checks changed with it: `boot` and `saves` wait up to 20 s for the tutorial (the new colony
is grown first); `runMode` counts ticks from where the colony opened (a pre-grown one has run 5k+
already, so a stalled loop would pass otherwise); `saves` pins the old-build fixture's `ts` to now,
so that it tests loading rather than catching up, and expects the colony after a refused save to
be a pre-grown new one.

Checked by breaking things: 28 faults were put, one at a time, into a throwaway copy of the repo (the
pre-grow's light check; the catch-up cap, 30 s minimum and future-save guard; the tick length; hatchings
not counted or counted twice; `stats.chamberCount` in place of `world.chamberCount`; no toast; the wrong
overlay text; a resumed colony pre-grown; Survival's rules row switched on, or `main.js` ignoring the
`catchUp` rule; the wrong start phase; each of the three budgets ignored; the overlay never hiding; the
renderer not drawing every tile on a canvas it had just made; a failed fast-forward not caught; the
refused-save notice dropped; the engine without `until`, without its
budget, without yielding, without the closing progress call, or swallowing a throwing tick). Every one made
`npm test -- fastforward` (`saves`, for the notice) fail with the message written for it; the unbroken copy
passed.

---

## T1.2 [S] Frame cap, power saving — DONE

As built (`src/app/gameLoop.js`, `src/main.js`, `src/rendering/renderer.js`; also `src/settings.js`,
`src/modes.js`, `src/config.js`, `styles/main.css`, the new `src/ui/perfReadout.js` and `tests/perf.mjs`):
- **Frame cap.** `GameLoop.fpsCap` (0 = every frame the screen offers) follows `settings.get('fpsCap')` and
  `settings.onChange`, so a pick applies on the next frame. `_tick` still advances the sim on every frame and
  asks `_frameDue(now)` before it calls `onRender`. `onRender`'s second argument, `frameMs`, is the time
  since the last frame *drawn* (100 ms at most), not since the last tick, so what runs on real time (the
  camera, the sway of the grass) keeps its pace at 30 fps.
- **Defaults.** Zen draws at 30 until the player picks a cap, Survival at 60: `fpsCap` is a new field in each
  row of `src/modes.js`, and `main.js` offers it with a new `settings.setDefault(key, value)`. That sets the
  value without storing it, never replaces a value the player chose, ignores a value `DEFAULTS` doesn't
  allow, and calls the `onChange` listeners only if the value changed. A pick is stored by `set()` as
  before, even one equal to the default, so it survives a later change of default.
- **Low quality** (`settings.get('quality') === 'low'`; the setting has existed since T0.4): the canvas holds
  `CONFIG.LOW_QUALITY_SCALE` (0.5) of the window's pixels each way (800x450 in a 1600x900 window), is shown
  at the size of the window, and the browser stretches it up. The camera, the HUD and the mouse still work in
  window pixels: `fitWindow()` in `main.js` (at start, on `resize`, and when `quality` changes) gives them the
  window's size and `Renderer.resize(w, h, scale)` the scale. The renderer lays the farm out in window pixels
  (`renderer.w`, `renderer.h`) and starts every frame with
  `ctx.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0)`. Assigning `canvas.width` resets the
  context, so the transform can't be set once, and low quality can be switched while the game runs.
- **Hidden tab.** `visibilitychange` runs `autoSave()` when the page becomes hidden: the 60 s timer's own
  function, now named, which skips a colony that is over (its save was deleted with it and must not come
  back). The README's "pause when hidden" is the browser's doing: it stops calling `requestAnimationFrame`
  for a hidden tab, and the first frame back is told 100 ms at most, so the colony does not catch up in a burst.
- **Read-out.** `?debug` shows `PerfReadout` (`src/ui/perfReadout.js`) at the top left, refreshed every half
  second: `30 fps · 0.8 ms/frame (worst 2.1) · cap 30 · high`. ms/frame is the game's own time in `onRender`;
  the browser rasterises the frame after that, so it is in the CPU numbers below and not in this one.
  `renderer` joined `window.__pa`.
- **`npm run perf`** (`tests/perf.mjs`, about two minutes) measures the processor time the browser uses at each
  cap and quality; see the numbers below.

Measured with `npm run perf`: a new Zen colony in headless Chromium at 1600x900, each setting for 12 s after 3 s
of warming up, run A B C D D C B A and averaged so that a colony that grows or a machine that warms up favours
none; the CPU time of all the browser's processes, read over the DevTools protocol, as a % of one core. Two runs:

| | frames a second | CPU, run 1 | CPU, run 2 |
|---|---:|---:|---:|
| cap 60 | 56-57 | 113% | 113% |
| cap 30 | 30 | 60% | 63% |
| cap 60, low quality | 60 | 45% | 51% |
| cap 30, low quality | 30 | 29% | 27% |

A cap of 30 used 44-47% less processor time than a cap of 60, low quality alone 55-60% less, and both together
74-76% less. (At a cap of 60 and full quality this machine could not quite keep up: 56-57 frames a second,
with the CPU doing the drawing.)

Where it departs from the ticket, and why:
- **The cap is a schedule, not "at least `1000 / cap - 1` ms since the last render".** Counted from the last
  frame drawn, a cap of 60 gives 48 fps on a 144 Hz screen (the third frame is the first 15.7 ms on) and
  37.5 on a 75 Hz one. `_frameDue` instead keeps its own schedule, a frame due every `1000 / cap` ms: a
  refresh up to 1 ms early counts as on time, and one more than a frame late starts the schedule over rather
  than drawing a burst to catch up. It holds the cap on 30, 60, 75, 120, 144 and 240 Hz screens.
- **Low quality is the smaller canvas and nothing else; no effect is switched off.** The ticket expects a few
  costly effects in `src/rendering/effects.js`. Timing `renderer.render` stage by stage (headless Chromium
  with the CPU rasterising, 1600x900 at zoom 1.25, median of 60 frames), a whole frame took 15 ms, and
  `effects.js` took 0.2 ms of it, no part of it over 0.1. The cost is in the big fills, which scale with the
  pixels: the room round the farm 4.2 ms, the vignette 4.2, the farm's frame 3.0, the glows 1.0, then the
  ants 0.6, the sky 0.5, the world blit 0.5. At half the resolution the same frame took 5 ms (the room 1.1,
  the vignette 1.1, the frame 0.8; the ants, whose cost doesn't depend on the pixels, 0.6 either way). There
  was nothing to skip that would save more than the half-size canvas already does. (A browser with a GPU
  will split the cost differently; the stages were timed once, here.)
- **`image-rendering`.** The stylesheet listed `pixelated` and then `crisp-edges`, and Chromium takes the last
  one it understands, so its computed value was `crisp-edges`. They are in the other order now, as the
  fallback pattern intends, and the test asks the browser for the computed value.
- **Not Chrome's Task Manager.** The ticket's "Done when" reads the tab's CPU in Task Manager (Shift+Esc),
  which a script can't. `npm run perf` reads the same per-process CPU time over the DevTools protocol in
  headless Chromium instead. To see the real thing: open the game with `?debug`, then in the console
  `__pa.settings.set('fpsCap', 60)` and `__pa.settings.set('fpsCap', 30)` while watching the tab's CPU column.

Things to know:
- Headless Chromium rasterises with the CPU; a desktop with a GPU shows lower percentages and, since the
  colony's 62.5 ticks a second run whatever the cap, a smaller saving from a cap. Read the direction and the
  ratios, not the percentages. Its screen refreshes at 60 Hz, so "no cap" is the same as 60 there (the
  loop test covers it on a simulated screen).
- There is no menu for the cap or the quality until T1.4; `__pa.settings.set(...)` with `?debug` is the way.
- A refresh time stamp that is more than 1 ms ahead of the schedule is waited out, so with jitter of about
  1.5 ms or more a frame is now and then skipped (a gap of 50 ms at a cap of 30); the rate stays exact.
  Chromium's stamps are well inside that (the loop held 30.0 and 60.0 fps in the browser), but it has not been
  tried on other browsers or real screens.
- The hidden-tab save also fires when a running game is navigated away from, as the page is hidden first. A
  test that plants a save must therefore leave the game page first: `saves` and `fastforward` now go to
  `styles/main.css` before they write one.
- A save that was refused for being from a newer build is overwritten by the first autosave of the colony that
  replaces it, as it was by the 60 s timer; hiding the tab makes that happen sooner. T1.7 should keep a copy.

Test: a new `performance` check in `tests/smoke.mjs` (about 10 s; `npm test -- performance`), and a
`setDefault` case in `settings`:
- The loop on its own, in Node, on a simulated screen (a fake `requestAnimationFrame` and clock, `playLoop`):
  ten screen and cap pairs from 30 Hz to 240 Hz, and a cap of none, each for ten seconds. The cap must hold to
  0.3 fps, the sim must run its 625 ticks however few frames are drawn, the `frameMs` values must add up to
  the time of the last frame drawn, and no gap may be more than one refresh longer than the cap's interval.
  The same with the time stamps off by up to 0.4 ms. A stall (half a second with no frames) and ten minutes
  in a hidden tab must not be made up for with a burst of frames or of colony time. The cap can change while
  the loop runs (60, then 30, then none, on a 120 Hz screen), and a cap of NaN, -30 or nothing means none.
- In the browser: a new Zen colony draws at 30, the cap is not in storage, and a new Survival colony draws at 60;
  the game really draws about 30 and about 60 frames a second at those caps and the colony lives 62.5 ticks a
  second at both; a cap chosen in Survival survives a reload and holds in Zen; the read-out says the right
  thing, both for the numbers it is given and on the live page; and at low quality the canvas is half the window,
  shown at the whole window, `pixelated`, with the camera still in window pixels and the farm laid out in window
  pixels; its picture is the full-size one, softened (1.7 levels of 255 off on average, against a limit of 8;
  the soil still brown), with every 2x2 block of screen pixels one colour; and window sizes of 1000x600 and
  1300x800 at both qualities agree between the canvas, the camera and the layout, and the picture reaches
  every corner of the canvas. A hidden tab saves, one that comes into view does not, and a finished game is
  not saved back.
- Screenshots: `perf-readout` and `low-quality` in `tests/out/`.

Checked by breaking things: 46 faults were put, one at a time, into a throwaway copy of the repo: in the loop,
the 1 ms grace dropped, the cadence counted from the last frame drawn (the ticket's own rule), the cap ignored
or never unlimited at 0, the schedule not restarted after a stall, `frameMs` unclamped, counted from the last
tick, or its clock never set or not restarted, and the sim following the drawn frames or slowed by the cap;
in the renderer and `main.js`, no transform, the CSS size or the scale missing for either side, a stale
`renderer.w` or `renderer.h`, the quality ignored or its change not applied, no `resize` listener, a scale of
1, the `image-rendering` order swapped or smoothed; in `settings`, `setDefault` beating a choice, firing for no
change, accepting any value, storing the default or saying nothing; either mode given the other's cap,
`main.js` not offering the default, not seeding the loop or not applying a pick; the hidden-tab save missing,
firing on becoming visible or ignoring game over; and eight faults in the read-out. Every one made
`npm test -- performance settings` fail with the message written for it; the unbroken copy passed. Four did
not on the first run. The 1 ms grace was missed: without it a cap of 60 on a 60 Hz screen loses only 0.4 fps,
inside the 2% tolerance the test then had, which is now 0.3 fps and is tried with jittered time stamps. A stale
`renderer.w` was missed and a stale `renderer.h` was caught only by accident (the soil came out blue), because
the transform stretches any layout over the whole canvas, so the picture looks right whatever the layout size;
the test now asks the renderer for its layout size. The fourth, `setDefault` storing its default, was caught by
the right check under a message my harness did not expect.

---

## T1.3 [S] Ambient soundscape

**Why:** sound is the biggest "this is a product" jump. No sound files needed to start —
WebAudio can make all of this; recorded loops can replace layers later.

**Create `src/audio/audio.js`** exporting `initAudio()`, `updateAudio(sim, camera)`,
`playSfx(name)`.

- Browsers block audio until the user interacts: call `initAudio()` from the first
  `pointerdown` / `keydown` (one-time listener in `main.js`).
- Master gain = `settings.volume`, 0 when `settings.muted`; fade in over 3 s on start.
- **Layers** (looping, each with its own gain node; `updateAudio` sets target gains every
  ~250 ms with `gain.setTargetAtTime(v, now, 0.8)` so changes are smooth):

  | Layer | Recipe | Loudness driven by |
  |---|---|---|
  | Wind | 4 s looping buffer of brown noise → low-pass 350 Hz | `0.12 + 0.12 * sky.overcast`; quieter when zoomed far in underground |
  | Rain | white noise → band-pass ~3 kHz, Q 0.7 | `sky.rain * 0.5` |
  | Night insects | every 0.3–1.2 s, a burst of 3 short (25 ms) sine chirps at 4–5 kHz, random pan | `(1 - sky.light) * 0.15` |
  | Dawn birds | occasional 150 ms sine sweeps 2→3.5 kHz | only when `sky.phase` is 0.2–0.32, clear weather |
  | Soil life | tiny 5 ms filtered-noise clicks, rate ∝ digging ants on screen | camera zoom ≥ 2 and ants with `state === STATE.DIGGING` in view |
- **One-shot effects** (`playSfx`): `place` (soft pluck when food/water dropped), `unlock`
  (two-note chime), `thunder` (low noise swell — hook `on('rainStart')`), `hatch` (tiny
  pop, only when zoomed in near it), `gameover` (low falling tone).
- **M** toggles mute (add to `hud.js` `_onKey`, show a toast "Sound off"/"Sound on").
- Leave a `// recorded loop:` hook per layer: if `assets/audio/<layer>.ogg` loads, use it
  instead of the generated noise. (Free CC0 sources for later: freesound.org CC0 filter,
  Sonniss GDC bundles.)

**Done when:** day sounds gentle, rain is audible when it rains, crickets come in at dusk,
M mutes, nothing plays before the first click, `npm test` passes (no audio errors in
headless).

---

## T1.4 [H] Settings menu UI

**Files:** `index.html`, `styles/main.css`, new `src/ui/settingsMenu.js`, `src/main.js`.

1. Add a gear button to `#toolbar` in `index.html` (same markup as `#btn-panel`), title
   "Settings".
2. Add a `#settings` dialog (copy the structure/classes of `#tutorial` so it looks the
   same) with:
   - Volume slider (0–100) and Mute checkbox
   - Frame rate: 30 / 60 / Unlimited
   - Quality: High / Low
   - Theme select (hidden until T2.3 adds themes)
   - Show clock checkbox + 24-hour checkbox
   - Reduce motion checkbox
   - Text size: 100% / 125% / 150%
   - Close button
3. `settingsMenu.js`: `open()`/`close()`; each control reads its value from `settings.get`
   on open and calls `settings.set` on change.
4. Register the dialog wherever `hud.js` keeps `this._dialogs` so keyboard shortcuts don't
   fire while it's open.
5. In Zen, hide the "Conditions" sliders (dig speed, birth rate) in the side panel — they
   are developer knobs. Add `showConditions: false` to Zen in `src/modes.js`, `true` for
   Survival (and Keeper later), and hide the section when false.

**Done when:** every setting changes something visible or audible immediately and survives
a reload; `npm test` passes; screenshot of the open menu looks consistent with the tutorial
dialog.

---

## T1.5 [H] Pause menu (Esc) and keyboard help (?)

**Files:** `index.html`, `styles/main.css`, new `src/ui/pauseMenu.js`, `src/ui/hud.js`
(`_onKey`), `src/ui/tutorial.js`.

1. **Esc** opens `#pause` (same dialog style): Resume · Settings · Save · How to play ·
   Main menu. Opening remembers `gameLoop.speed` and sets it to 0; Resume restores it.
   Esc again = Resume.
2. "How to play" re-opens the tutorial: give `Tutorial.show(mode, force)` a `force` flag
   that skips the "already seen" localStorage check.
3. "Main menu": `doSave()` then `location.href = location.pathname` (drops URL params).
4. **?** opens `#keys` listing every shortcut (read them from `hud.js` `_onKey`; today:
   C tour, F fullscreen, H panel, Space pause, 0 fit, +/- zoom; plus M mute, P photo
   (T2.4), Esc menu).

**Done when:** Esc pauses and resumes exactly where it was; ? lists the real shortcuts;
`npm test` passes.

---

## T1.6 [H] Title screen polish, credits, version

**Files:** `index.html` (`#mode-select`), `styles/main.css`, new `src/version.js`.

1. `src/version.js`: `export const VERSION = '0.9.0';` — shown small on the title screen
   and in the pause menu. Bump it in every release (T3.3).
2. Title screen: bigger logo treatment, the mode cards (Zen, Keeper — added in T4.1 —,
   Survival) with one-line pitches from `docs/gameplan/README.md`, plus small buttons:
   Settings, Credits.
3. Rename the visible label "Screensaver" to **Zen** everywhere the player sees it (mode
   card, dashboard badge via `MODES.screensaver.label/badge`). Keep the internal id
   `screensaver` — save keys depend on it.
4. Credits dialog: game by (ask the user for the name to show), "Made with plain
   JavaScript and Canvas", sound credits if any recorded loops were added.
5. Optional flourish: a thin strip along the bottom of the title screen where a line of
   pixel ants walks across (small canvas, a dozen 3-pixel ants, loops).

**Done when:** the title looks like a finished game in a 1920×1080 screenshot;
`npm test` passes.

---

## T1.7 [H] Crash safety

**File:** `src/main.js`.

1. Wrap the body of the sim tick and the render callback in `try/catch`. On the first
   error: stop the loop, try `doSave()` in its own try/catch, and show a dialog
   "The colony hit a snag. Your colony was saved." with a **Reload** button. Never leave a
   frozen or black screen.
2. `window.addEventListener('unhandledrejection', …)` → `console.error` + same dialog
   only if the game loop is not running.
3. `window.addEventListener('pagehide', () => doSave())`.
4. Test it: with `?debug`, `__pa.sim.world.update = () => { throw new Error('test') }`
   must show the dialog, and Reload must resume the colony.

**Done when:** the forced error shows the dialog and reloading resumes; `npm test` passes.

---

## T1.8 [S] 8-hour stability pass

1. `npm run soak -- --mode screensaver --days 30` and `--mode survival --days 10`. Fix
   everything that fails (growing arrays, stuck ants, NaN, slowing ticks, save size).
2. Add a real-time option to `tests/soak.mjs`: `--realtime --hours 8` keeps the game at
   1× in a real (headed) Chromium window and every 10 minutes records fps (count
   `requestAnimationFrame` calls over 5 s), heap and population into the CSV.
3. Run it overnight once. Attach the CSV summary (first, middle, last rows) to the commit
   message.

**Done when:** 8 hours real time with no errors, fps at hour 8 within 10% of hour 1, heap
flat.

---

## T1.9 [H] Accessibility pass

**Files:** `styles/main.css`, `index.html`, `src/ui/*.js`, `src/rendering/effects.js`,
`src/app/director.js`.

1. Text size: `:root { --text-scale: 1 }`, multiply the panel/dialog font sizes in
   `main.css` by it; set it from `settings.textScale` on load and on change.
2. Every button has a `title` and `aria-label`; visible focus outline for keyboard users.
3. Status bars that rely on red vs green: add a second cue (an icon or a pattern) or use
   blue/orange.
4. Reduced motion (`settings.reducedMotion`): no camera shake / flashes in `effects.js`;
   the director uses slower, shorter moves (find its pan speed constant in `director.js`
   and halve it when set).

**Done when:** you can start a game, open every dialog and change every setting with the
keyboard only; `npm test` passes.
