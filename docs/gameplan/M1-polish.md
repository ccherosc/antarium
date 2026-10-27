# M1 — Commercial polish

The things a $3.99 buyer expects before they notice the ants: sound, settings, a pause
menu, no crashes, no battery drain, and a great first 30 seconds.

Needs M0 done (`npm test`, `rules()`, `settings`, `on/emit`).

---

## T1.1 [S] Fast-forward engine (catch-up + pre-grown colonies)

**Why:** a brand-new Zen colony is 30 ants and a hole for the first minutes — a poor first
impression for a screensaver. And a resumed colony should feel like life went on.

**Create `src/app/fastForward.js`:**
```js
// Runs sim ticks in small slices so the page stays responsive.
// step() runs one sim tick. Stops at maxTicks, when until() is true, or after budgetMs.
export function fastForward({ step, maxTicks, until = () => false, budgetMs = 8000, onProgress }) { … returns Promise<ticksRun> }
```
Slice = run ticks for ~12 ms, then `await new Promise(r => setTimeout(r))`, call
`onProgress(ticksRun / maxTicks)`.

**Use it in `src/main.js`** (sim tick = the body of the `GameLoop` update callback; pull it
out into a `function tick(dt)` so both can call it):
1. **New colony, `rules().pregrow` true** (add `pregrow: true` to Zen and later Keeper, false
   for Survival): before `gameLoop.start()`, show a small overlay "Founding your colony…"
   with a progress bar, run until population ≥ 45 or 1.5 in-game days or 8 s. Then fade
   the overlay out.
2. **Resumed colony, `rules().catchUp` true** (Zen, Keeper): use the save's `ts` (from T0.5
   `getSaveInfo`). Run `min(elapsedTicks, 0.5 day)` ticks with a 5 s budget. Before and after,
   snapshot `antSystem.population`, `stats.chamberCount`, total hatched (count `hatch` events
   via `on('hatch')`), then toast: "While you were away: 12 ants hatched · 1 new chamber".
3. Survival never fast-forwards.

**Done when:** a new Zen colony opens on a busy nest (≥ 45 ants) within ~8 s; resuming a
Zen save made 10 minutes ago shows the "While you were away" toast; `npm test` passes
(the smoke test's `?new` path now pregrows — keep its 15 s wait after the overlay closes).

---

## T1.2 [S] Frame cap, power saving

**Files:** `src/app/gameLoop.js`, `src/main.js`, `src/rendering/renderer.js`.

1. **Frame cap** from `settings.get('fpsCap')` (30 / 60 / 0 = unlimited). In
   `GameLoop._tick`, still advance the sim every frame, but only call `onRender` when at
   least `1000 / cap - 1` ms have passed since the last render. Listen to
   `settings.onChange` so it applies live.
2. **Zen defaults to 30 fps** the first time (only if the user never chose).
3. **Low quality** (`settings.get('quality') === 'low'`): render the canvas at half
   resolution — set `canvas.width/height` to half the window size, keep CSS size at 100%,
   and make sure `image-rendering: pixelated` is on the canvas in `styles/main.css`.
   Also skip the costliest effects in `src/rendering/effects.js` (find what costs most by
   timing `renderer.render` with each effect off).
4. **Autosave when the tab is hidden**: `document.addEventListener('visibilitychange', …)`
   in `main.js` → `doSave()` when it becomes hidden.
5. Measure: add an on-screen FPS / ms-per-frame readout when `?debug` is set.

**Done when:** at a 30 fps cap, Chrome's Task Manager shows clearly lower CPU for the tab
than at 60 (write both numbers in the commit message); low quality looks the same pixel
style, just softer at the edges; `npm test` passes.

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
