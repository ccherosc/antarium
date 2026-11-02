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

## T1.3 [S] Ambient soundscape — DONE

As built (`src/audio/audio.js`, `mix.js` and `noise.js`, all new; also `src/main.js`, `src/ui/hud.js`,
`src/ui/controls.js`, `src/config.js` and `claude.md`):
- **The graph.** `buildGraph(ctx, destination)` (exported, so the tests can render it offline): five layer gains →
  `master` → `fade` → a limiter (a `DynamicsCompressor`, -8 dB, ratio 12: insurance for the thunder) → the
  speakers; effects go through an `sfx` gain into `master`. Wind is a looping 4 s stereo brown-noise buffer →
  high-pass 60 Hz → low-pass 350 Hz; rain a looping 2 s stereo white-noise buffer → band-pass 3 kHz, Q 0.7. Night,
  birds and soil have no continuous source: three 25 ms chirps at 4-5 kHz, two or three 150 ms sweeps from about
  2 kHz up by 1.75, and clicks of band-passed noise, each booked ahead.
- **What the sky asks for is `mix.js`**: plain functions of the colony and the camera, so Node can test them.
  `layerTargets(sky, view)` is the ticket's table (birds 0.18 while `phase` is 0.2-0.32 and the weather is clear;
  soil 0.1 while an ant digs in view at zoom 2 or more). `watchView` says how far the top of the view is under the
  ground (`buried`: 0 with the sky in view, 1 eight rows down, where the wind has fallen to 30%) and where from each
  digger in view is heard. `heardAt` and `panAt` give a pan of -0.8 to 0.8, or `null` out of reach. The numbers are
  `AUDIO_*` in `CONFIG`.
- **Aiming and booking.** `updateAudio(sim, camera, speed)` runs each frame, after `renderer.render`. Every 250 ms it
  sets each layer heading for its target (`setTargetAtTime`, time constant 0.8 s), and `book()` schedules the
  chirps, songs and clicks of the next 0.6 s on the audio clock: a slow frame makes no stutter, and a stall is not
  made up for with a heap of missed ones. Crickets come every 0.3-1.2 s, a song every 1.2-4.2 s, and clicks at
  random, 0.6 a second per digger (14 at most) times the colony's speed, so a paused colony is not heard digging.
- **Effects.** `playSfx(name, at)` returns whether it played. `place` (a soft pluck) from the food and water
  branches of `controls.js`; `thunder` (brown noise under a low-pass sweeping 500 to 120 Hz over 5 s) on `rainStart`;
  `hatch` (a 50 ms pop) on `hatch`, panned to where it happened and heard only when that is on screen at zoom 2 or
  more; `gameover` (a triangle wave falling 220 to 55 Hz), once, from `triggerGameOver`; `unlock` (659 then 988 Hz)
  is made and tested, and nothing plays it until there is something to unlock (T4.5). One effect twice within 60 ms
  plays once. `main.js` listens for events only after the start-up fast-forward, whose weather and hatchings would
  otherwise play back as one roar.
- **M** toggles `settings.muted` in `hud.js` (`toggleMute`, toast "Sound off" / "Sound on"); a held key is one press.
- **Nothing before the first click, and nothing for nobody.** `main.js` calls `initAudio()` from capture listeners on
  `pointerdown`, `pointerup` and `keydown`; that makes the audio context, so until then there is none. The sound fades
  in over 3 s from the first `updateAudio`, when the colony is on screen. Muted, or with the tab hidden, the master
  glides to 0 and 0.4 s later the context is suspended, so it costs nothing; a change of volume or mute, or the tab
  coming back, resumes it.
- **Optional.** Without WebAudio the sound is simply off. If anything in it throws, `guard()` closes the context and
  says `Sound stopped:` in the console, once; the game carries on.
- **Recorded loops.** `RECORDED` in `audio.js` is a manifest (`{ wind: 'assets/audio/wind.ogg' }`). `useRecording`
  loads each file named there and loops it into its layer's gain, so the sky still drives it, and stops what was
  made here: the noise of wind and rain, the booking of the other three. It is empty and no files ship, so the game
  asks the server for nothing. The `// recorded loop:` comments are in `buildGraph`, on the two continuous layers.
- `claude.md` has a Sound bullet, and `?debug` has `window.__pa.audio`: `audioGraph()` shows the live context, the
  nodes and what has played.

Measured, not listened to (`npm test -- sound` renders the recipes offline with the game's own `buildGraph`, and
listens to a live page with an analyser). The level is the rms of what reaches the speakers at the default volume
(0.6), through the limiter, in the lab:

| scene | rms | against a clear noon |
|---|---:|---:|
| clear noon (the wind) | 0.040 | 1 |
| overcast | 0.077 | 1.9 |
| rain | 0.19 | 4.6 |
| dusk (wind and crickets) | 0.040 | 1 |
| top of the view 8 rows under the ground | 0.012 | 0.3 |
| three diggers in close view | 0.042 | 1.05 |

On the live page a Zen colony measured 0.038-0.045 by day and 0.187-0.195 in the rain. Each layer alone at a gain of
1: wind 0.37, rain 0.40, crickets 0.044, birds 0.041, soil clicks 0.021. Everything the sky can ask for at once
(rain, wind at its loudest, crickets and diggers, with a clap of thunder, a pluck and a hatching on top, volume 1,
colony at 8x) peaks at 0.94-1.02 through the limiter.

What it costs, in headless Chromium (CPU time of all the browser's processes, as `npm run perf` reads it, with the
colony's loop stopped so that none of its noise is in it; read the ratios): sound on uses 2.4 points of one core more
than muted at noon (muted is 0.7%), 2.9 in the rain, 2.9 at dusk and 3.1 with 12 diggers in close view, which is
4-5% of what the headless Zen colony itself uses at its cap of 30. Muted or hidden it costs nothing: the context
sleeps. The graph's own work is 0.3-0.6% of a core (rendered offline); most of the rest is the browser keeping an
audio device open. `npm run perf` with the sound wired in and nobody having clicked, as on a first load: cap 60 107%
(59.3 fps), cap 30 57%, cap 60 at low quality 48%, cap 30 at low quality 28.5%, against T1.2's 113%, 60-63%, 45-51%
and 27-29%: no change.

Where it departs from the ticket, and why:
- **The listeners stay on.** A one-time listener gives up on a key that doesn't count as a gesture (Esc, for one) and
  leaves the context locked for good, and a touch counts when it ends, not when it begins. So every `pointerdown`,
  `pointerup` and `keydown` calls `initAudio()`: the first makes the context, each later one tries `resume()` again.
- **The fade-in starts when the colony is on screen,** not at `initAudio()`: from the menu's click it would be spent
  on the menu and the fast-forward.
- **Mute suspends the context** once the volume has faded out, and so does a hidden tab. The ticket only zeroes the
  master gain, which leaves the audio device and the graph running for nobody.
- **Trims and a limiter.** The filters take most of the noise away, so `AUDIO_TRIM` (wind 2.5, rain 1.5) brings each
  looped layer to an rms of about 0.4 at a gain of 1 and the ticket's gains (0.12, 0.5) mean what they say. A 60 Hz
  high-pass takes out the rumble of the wind and the thunder that small speakers can't play: at least 86% of the
  wind's power is below 200 Hz and the test keeps under 15% below 40 Hz. The thunder reaches an envelope of 2.6, to
  come out a little louder than full rain, and the limiter is for that.
- **Stereo noise and booked events.** The wind and rain buffers have two decorrelated channels, so they spread across
  the ears rather than sounding from the middle of the head. Chirps, songs and clicks are booked on the audio clock
  instead of started from a timer, for the reason above.
- **Recorded loops are a manifest, not a probe.** Trying `assets/audio/<layer>.ogg` for five layers would be five
  404s in the console on every load. All five layers can be replaced, not only the two noises.
- **"Quieter when zoomed far in underground" follows the top edge of the view,** not the zoom: the wind falls as the
  top of the screen goes under the ground, however far in or out the camera is.
- **A soil click is 6 ms,** not 5: its envelope falls from 3.5 to 0.001 over 6 ms, cut from a 12 ms slice of noise.
  The 3.5 makes up for what the band-pass leaves of so little noise.
- `updateAudio` takes a third argument, the colony's speed (`gameLoop.speed`), and `playSfx` a second, where the
  effect happens.

Things to know:
- **No one has listened to it.** What can be measured has been (pitch, level, balance, panning, timing, peaks, cost);
  how it sounds has not. The wind is nearly all below 200 Hz and may be faint on laptop speakers, and the thunder's
  level is a guess. `AUDIO_*` and `AUDIO_TRIM` in `CONFIG` are the knobs, and `__pa.sim.sky.rain = 1` in the console
  of a `?debug` page is the quickest way to hear a rainy day.
- The limiter is a compressor, not a brick wall: the loudest moment measured is 1.02, over full scale by 2% for an
  instant. The test allows 1.1.
- Soil clicks and hatching pops need zoom 2 or more, as the ticket says, so a Zen colony at its default zoom hears
  neither.
- The desktop and screensaver builds (M3) have no one to click: they must call `audio.initAudio()` at start.
- Chromium stops updating the value a page reads from a gain node that nothing is playing into. The test reads those
  values, so it gives each layer a silent `ConstantSourceNode` while it runs; the game doesn't read them.
- Where `decodeAudioData` takes callbacks and also returns a promise, that promise rejects with the same error as the
  callback, and the smoke test saw an uncaught error. `useRecording` swallows it.

Test: a new `sound` check in `tests/smoke.mjs` (about 33 s; `npm test -- sound`):
- In Node: `panAt` and `heardAt` (the middle is the middle, the edges stop short of the ends, nothing is heard from a
  camera zoomed out, a tile off screen or under the panel); `watchView` (the sky in view is not buried and a view
  deep in the soil is, counted in rows whatever `CONFIG` says; the diggers in view, none from far out);
  `layerTargets` for the sky of each hour and weather, and the dawn window against the ticket's 0.2 to 0.32;
  `soilRate`; the noise (white is white, brown is slow and as loud as asked, a loop of it has no click at the seam).
- On a lab page, the recipes rendered offline and measured: each layer alone (where its power lies in the spectrum,
  its level, its peak); each effect (pitch, length, and for eight claps of thunder when it peaks, when it is last
  heard, how much is below 40 Hz); where each is heard from; whole scenes at the player's volume through the real
  limiter, against each other and against what each layer adds to the wind of a clear day; the loudest moment of
  everything at once; and what `book()` schedules, counted (bursts of three chirps 0.3-1.2 s apart, songs of two or
  three sweeps 1.2-4.2 s apart, clicks at the right rate for one, ten and a thousand diggers and none while paused,
  never behind the clock, none for a layer too quiet or recorded, no heap after a freeze). Nothing a recipe starts is
  left running.
- On real pages: a Survival colony started muted with the clock in the test's hands (no audio context before the first
  key, one after three; nothing sounds before the colony is on screen; the fade-in, re-aim interval and glide are about
  3 s, 250 ms and 0.8 s; M turns it on, a held M is one press, M mutes and the context sleeps, an effect asked for
  just after muting stays quiet; a hidden tab sleeps and wakes; nine scenes of sky against camera put every layer at
  the gain the mix asks; the effects play once, with the game's own events and the controls' hooks; a recording takes
  over a layer and a bad one changes nothing; the end of a colony is heard once), a Zen colony started with a click on
  the menu and its real frame loop (one context, no effect during the founding, the level on the live page, a paused
  colony not heard digging, a sound that throws neither stops the game nor reports twice), and a browser with no
  WebAudio (the game runs, M still mutes and says so).
- Screenshot: `sound-muted` in `tests/out/`.

Checked by breaking things: 120 faults were put, one at a time, into a throwaway copy of the repo: in `CONFIG`, 24
levels, windows and timings (each layer too loud or too faint, the two trims, the wind's rise in cloud and fall
underground, the dawn window widened, moved or open at noon, the burial depth, the close zoom, the fade-in, the
re-aim interval, the glide, the gap between effects, the rate of soil clicks); in the mix, 21 (the pan reversed,
unclamped or the full width, the dashboard's inset ignored, the zoom threshold, burial, which ants dig, the birds'
hour and weather, the crickets not following the dark, rain all or nothing, the rate of clicks ignoring the speed
or without its cap); in the recipes, 28 (the pitch, length, level, panning, spacing or number of notes of the
crickets, birds, soil clicks, thunder, pluck, chime, hatching pop and game-over tone, and thunder left running);
in the noise (5); in the graph (6: the limiter off, either trim, a filter skipped or set wrongly); in the
lifecycle (12: a context made for every key, a muted start that wakes, a hidden tab that keeps playing or never
wakes, no fade-in, the volume ignored or halved, a sound before the colony is on screen, a throwing sound let out
or leaving the context open), the booking (5: no look-ahead, events booked late, a stall made up for, soil booked
while paused, a layer booked however quiet), recordings (2) and `playSfx` (4: no rate limit, mute or position
ignored, the camera not remembered); and in the wiring, 13 (`main.js` with no start on a key, no update, no speed,
no thunder, hatching or game-over sound, and a hatching heard from anywhere; `hud.js` with M for N, a repeating M,
a silent mute and the toasts swapped; `controls.js` with no pluck for food or for water). Every one made
`npm test -- sound` fail with the message written for it (for three, that the test stopped at the step that waits
for the sound to start or wake); the unbroken copy passed. Twenty-six did not on the run in which they first came
up, and the test was tightened for each. Twenty-two were missed outright: ten in the first run (a digger under the
dashboard, the rain's trim taken off, every sound sent to the middle, thunder left running, an effect asked for
just after M muted, an effect that ignores where it happens, a hatching heard from anywhere, the colony's speed not
passed on, a held M, the pluck for water); eight in `CONFIG` that the mix tests did not pin, the levels of night,
birds, soil and rain and the defaults of the fade-in, the re-aim interval and the glide, which are now compared
with the wind of a clear day and timed; and four on later runs: an effect played before the colony was on screen,
the rain against the same cloud without it, the dawn window widened (now held to the ticket's 0.2 to 0.32, with the
sunrise at 0.25) and the burial depth (a huge `AUDIO_BURY_ROWS` was missed and a tiny one caught: the test now
counts in rows, whatever `CONFIG` says). Four more were caught, but not by the check written for them:
`birds-fast-gap` and `mix-pan-full-width` failed under other messages, and `hidden-tab-never-wakes` and
`hud-m-is-n` left the test hanging, until its wait for the context to wake was made to give up with "the sound did
not wake". Three places were judged to behave the same from outside and were not tried, so they are not among the
120 and not counted as caught: the reset of a layer's schedule when it is not wanted (it differs only in when the
first event comes after a break shorter than a gap), `{ capture: true }` on the gesture listeners (nothing in the
game stops an event) and the flag that remembers there is no `AudioContext` (a later try fails in the same way).

---

## T1.4 [H] Settings menu UI — DONE

As built (`index.html`, `styles/main.css`, the new `src/ui/settingsMenu.js`; also `src/main.js`, `src/ui/hud.js`,
`src/ui/controls.js`, `src/modes.js`, `tests/smoke.mjs` and `claude.md`):
- **The gear.** `#btn-settings` (title and `aria-label` "Settings") is the last button in `#toolbar`, after `#btn-panel`,
  with the same `zoom-btn` markup and a cog drawn as an SVG path.
- **The dialog.** `#settings` is built from the tutorial's classes (`.tut-box`, `.tut-title`, `.tut-footer`,
  `.tut-btn-next`) plus `.set-box`, and shares its overlay rule in `main.css` (`#tutorial, #settings`, z-index 300), so
  the two look alike. It is `role="dialog"` and `aria-modal="true"`. Its rows: Volume (a 0-100 slider with the number
  beside it), Mute ("or press M"), Frame rate 30 / 60 / Unlimited and Quality High / Low (segmented radio buttons,
  `.set-seg`), Reduce motion, then Close with a note that Esc closes. The volume row dims while the sound is muted.
- **`SettingsMenu`** edits whatever carries `data-setting="<key>"`, and nothing else is named in it. `_show()` writes
  `settings.get(key)` into each control when the dialog opens and whenever any setting changes (`settings.onChange`),
  so the dialog is right if M is pressed while it is open. `_edit(el)` turns the control's text into the setting's type
  (a number if the default is a number, divided by the slider's `data-scale`: the volume is 0-1 in `settings` and 0-100
  on the slider), calls `settings.set` and shows what `settings` kept. A slider acts on `input`, the other controls on
  `change`: there is no Apply button. What a setting does is up to whoever reads it (`audio.js`, `main.js`, `hud.js`),
  as before. Letting go of the volume slider plays the `place` pluck, so a quiet farm still answers.
- **The dialog is modal.** Opening it focuses the volume slider. Esc and Close with the keyboard hand the focus back to
  the gear; Close with the mouse hands it to no one (a button that holds the keyboard turns Space into a click on
  itself, and Space pauses the game). A click on the dark outside the box closes it and goes no further; a click inside
  the box leaves it open. Tab and Shift+Tab go round the dialog and never out to the farm. `#settings` is in
  `hud._dialogs`, so while it is open the farm's keys (Space, H, M, ...) do nothing.
- **It will not open over another overlay.** The tutorial and the game-over screen cover the gear, so the mouse cannot
  reach it, but Tab can, and they have the keyboard first: `open()` does nothing while either is showing. The list is
  `OVERLAYS` in `settingsMenu.js`; the pause menu of T1.5, or any other full-screen overlay, goes in it. The mode menu
  has no entry on purpose: it is only up at page load and `main.js` makes the `Hud` and the `SettingsMenu` after it is
  gone (`#btn-restart` reloads the page), so the two never exist together.
- **Conditions.** The dig-speed and birthrate rows of the panel are `.slider-row.dev-knob`; `Controls` hides them
  unless `rules().showConditions`, a new field in each row of `src/modes.js` (false for Zen, true for Survival).
- **Reduce motion** has a reader already: `hud.js` puts `reduce-motion` on `<body>` while the setting is on, and
  `body.reduce-motion *` switches off every CSS transition and animation (the panel's slide, the toast's fade, ...) with
  `!important`. The choice starts from the system's own preference, as T0.4 made it.
- **Small screens.** Under 480 px wide the rows wrap, name above control, and the box scrolls if the screen is short.
- `claude.md`'s settings bullet says that a new option also gets a row in the dialog, and the `settingsmenu` check
  fails if it does not.

Where it departs from the ticket, and why:
- **Only the two developer rows are hidden in Zen, not the whole Conditions section.** The section also holds Sim Speed
  and Auto Tour, which a Zen player may want; the reason the ticket gives (developer knobs) is true of dig speed and
  birthrate alone.
- **Four rows are in the dialog but `hidden`: Theme, Show clock, 24-hour and Text size.** The ticket's test for the
  menu is that every setting changes something at once, and nothing reads these yet (the clock is T2.2, themes T2.3,
  text size T1.9). A control that does nothing is worse than none. The rows are there, with their `data-setting`, so
  the settings are stored and shown correctly the day something reads them; whoever gives one an effect takes `hidden`
  off its row (a comment in `index.html` says so) and adds its key to `TESTED` in the check.
- **Reduce motion works now, for the page's own CSS.** The ticket lists the checkbox and leaves what it does to T1.9;
  a checkbox that does nothing is the same problem as above, and one line of CSS gave it something to do. The farm's
  own motion (the camera's glide, the effects) is still T1.9's.
- **Not in the ticket, and added:** Esc, the click outside the box, the Tab trap and the focus rules, the chime on the
  volume slider, `aria-modal`, the small-screen layout, and the dialog refusing to open over another one.

Things to know:
- **Touching a control stores its setting, even at the value it already had** (T1.2's rule for `settings.set`, which
  is what lets a pick survive a later change of the mode's default). Opening and closing the dialog stores nothing,
  and the check proves it: a stored frame cap would pin Zen to 30 for good.
- Nobody has listened to the chime on the volume slider, and nobody has looked at the dialog with a screen reader.
- Holding Enter on Close past the keyboard's repeat delay closes the dialog, gives the gear the focus, and the repeat
  opens the dialog again. A tap does not.
- The dialog's z-index (300) is above the `?debug` frame read-out (250), as the tutorial's is.

Test: a new `settingsmenu` check in `tests/smoke.mjs` (about 11 s; `npm test -- settingsmenu`), with real clicks,
mouse movements and key presses, as a player makes them:
- Zen, new colony: nothing is open, nothing is stored, Zen's Conditions panel has Sim Speed and Auto Tour and no
  dig-speed or birthrate slider, and the toolbar's gear is titled Settings. The gear opens the dialog; at the middle of
  its Close button, of the panel and of the toolbar, what a click would reach is the dialog or something in it; the
  focus is on the volume slider, it is marked as a modal dialog, and it shows 60%, unmuted, 30 fps (Zen's own cap),
  high quality, motion not reduced, with the game loop itself held to 30. Esc closes it with the focus back on the gear
  and still nothing stored.
- The dialog shows what is chosen whether it changed before it opened or while it is open, and a click on its title
  leaves it open. Every setting in `DEFAULTS` has a row, every row a player can see has a test (`TESTED`), and every
  tested setting has a row that is shown. The three frame-rate buttons carry 30, 60 and 0.
- Each control and what follows it, at once: the volume slider by a click, by being held and dragged, and by the End,
  Home and arrow keys (the number beside it, the setting, the master gain of the live audio graph, the pluck on
  letting go); Mute from the box (the master falls to 0 and rises to the volume again); the three frame rates by
  clicking and by an arrow key (`gameLoop.fpsCap`); quality (the canvas is half the window's pixels each way, then all
  of them); Reduce motion from the box and from its label (`body.reduce-motion`, and the panel's slide taking 0 s
  instead of 0.55 s).
- Keys and focus: Space, H and M do nothing behind the dialog and work again after Close; Close with the mouse leaves
  the focus on no button, so that Space still pauses; Tab goes round the dialog and reaches every control, Shift+Tab
  from the first goes to Close, Enter on Close puts the focus on the gear; a click outside the box closes it without
  dropping food on the farm behind it (shown by the same click, once the dialog is gone, dropping some).
- Choices (a muted, unlimited, low-quality, reduced-motion farm) survive a reload: storage holds exactly the five
  settings chosen; the game loop's cap is the chosen 0 and not Zen's own; the canvas is at low quality; the page is
  in reduced motion; the dialog shows the choices; unmuting brings the volume that was kept.
- Survival: all four sliders of the Conditions panel. At 360x640 the dialog fits the screen, nothing sticks out of the
  box, the page does not scroll sideways, nothing covers it, and Close can be reached and closes it.
- The gear does not open the dialog over the tutorial (a first visit to Zen) or over the game-over screen (a Survival
  colony held still while the queen's health is set to 0), and does once each is gone.
- Screenshots: `settings-menu` and `settings-menu-narrow` in `tests/out/`.

Checked by breaking things: 68 faults were put, one at a time, into a throwaway copy of the repo: in
`settingsMenu.js`, 35 (Esc doing nothing or not handing the keyboard back to the gear; Tab with no trap, escaping from
the last stop or on Shift+Tab from the first, or starting at the wrong stop; Close always or never handing the focus
back, or taking a mouse click for a key press and the other way round; a click outside the box not closing the dialog
or a click inside it closing it; opening or drawing the dialog storing settings nobody chose; no pluck on letting go
of the volume; each of the five controls not writing its setting, the volume unscaled in either direction, numbers
kept as text, no percentage, a radio never checked, no dimming when muted; a dialog that never shows, never hides or
never takes the keyboard; no redraw when a setting changes elsewhere; a slider that acts only on release; the dialog
opening over any overlay, refusing to open when none is up, or missing the tutorial or the game-over screen from its
list); in the readers, 12 (`hud.js`: no listener for reduce motion, none at start, the setting ignored, the dialog not
among those that stop the farm's keys; `main.js`: the frame cap or the quality ignored, the quality's scale lost, the
loop seeded with the mode's cap and not the player's, or not seeded, no menu made; `audio.js`: volume or mute
ignored); in the Conditions rows, 4 (`controls.js` showing or hiding the two developer rows whatever the mode;
`modes.js` with the rows shown in Zen or hidden in Survival); in the markup, 11 (the four hidden rows shown, a row for
a setting that is not there, the dialog not marked modal, Unlimited carrying 1, the gear retitled or outside the
toolbar, the volume's top at 50 or its scale at 10); and in the CSS, 6 (the reduce-motion rule on the wrong selector
or without `!important`, the dialog under the panel, a hidden dialog shown, the narrow layout without its wrap, a box
wider than a phone). Every one made `npm test -- settingsmenu` fail with the message written for it; the unbroken copy
passed. Six did not on the first run, which tried 65 (the other 59 gave the right message). Two were missed outright.
The mode menu was listed among the overlays the gear must not open over, and the test of it passed with the entry
removed, because the mode menu is gone before a `SettingsMenu` exists: the entry was dead code, it is out of the list,
and the game-over screen has taken its place in the test. A loop not seeded with the frame cap at start passed because
the only start the test looked at was a reload with Unlimited chosen, which is the cap an unseeded loop has: the test
now wants a new Zen colony's loop at Zen's 30, and a loop seeded with the mode's cap alone is a fault of its own. Four
were caught, but not by the check written for them. Three only because a click timed out: Unlimited carrying 1 (the
test now reads the three frame-rate values), the dialog under the panel (it now asks, at the middle of Close, of the
panel and of the toolbar, what a click would reach, at 1600x900 and at 360x640) and a hidden dialog shown (the test
now reads whether the dialog is displayed and not what its classes say; two more faults, a dialog that never shows and
one that never hides, were added to be sure that this change lost nothing). The fourth, a click inside the box closing
it, showed only as the volume slider's steps failing one after another; a click on the dialog's title, early, now says
so. All 68 were run again against the tightened check, and every one failed with its own message. Two places were
judged to behave the same from outside and were not tried, so they are not among the 68: the `_show()` at the end of
`open()`, since the dialog is redrawn whenever a setting changes, and the one at the end of `_edit()`, which matters
only if `settings` turns a value down, and no control here offers one it would.

---

## T1.5 [H] Pause menu (Esc) and keyboard help (?) — DONE

As built (`index.html`, `styles/main.css`, the new `src/ui/pauseMenu.js` and `src/ui/dialogs.js`; also `src/ui/hud.js`,
`src/ui/tutorial.js`, `src/ui/settingsMenu.js`, `src/main.js`, `tests/smoke.mjs` and `claude.md`):
- **The menu.** `#pause` is built from the tutorial's and the settings dialog's classes (`.tut-box`, `.tut-title`,
  `.tut-btn-next`) plus `.pause-box`, and shares their overlay rule in `main.css` (`#tutorial, #settings, #pause, #keys`,
  z-index 300). It is `role="dialog"` and `aria-modal="true"`, titled Paused, with Resume (the primary button),
  Settings, Save, How to play, Keyboard and Main menu, and a line under them (`#pause-note`, `role="status"`) for what
  Save and Main menu have to say.
- **Esc.** Like every key of the farm it comes in through `Hud._onKey`, which hands Esc and `?` to `PauseMenu.key()`
  (`pauseMenu.js`) before it asks whether a dialog is up, since they have to be heard while the menu or the list is up,
  to close it; `key()` says whether it took the key. Opening the menu remembers `gameLoop.speed` and sets it to 0;
  Resume, Esc again and a click on the dark outside the box close it and set the speed back, so a farm at 4× comes back
  at 4×, one at ½× at ½×, and one paused by hand with Space stays paused. The farm goes on drawing while it is held, as it
  does when Space pauses it.
- **The toolbar's menu button** (`#btn-menu`, three lines, after the gear, its tip "Menu (Esc)") opens the menu with a
  click or a tap. It is the way in on a phone or a tablet, which have no Esc. `main.js` gives the menu to the HUD
  (`hud.menu`), which is how both the button and the keys reach it.
- **?** opens `#keys`, a dialog of the same kind with one row per entry of `SHORTCUTS`, the table `hud.js` exports
  (Space, [ ], the arrows and W A S D, + −, 0 (written "0 (zero)", since in the panel's font it looks like an O), H, C,
  F, M, Esc, ?). The menu's Keyboard button opens it too. Esc, ?, Close and a click outside the box close it back to
  where it was opened from, the menu or the farm.
- **Full screen.** The browser takes Esc in full screen, to leave it, before the page hears it. So when the page goes
  full screen it asks to keep Esc (`navigator.keyboard.lock(['Escape'])`, which Chrome and Edge have, and only in full
  screen) and lets go when it leaves (both on `fullscreenchange` in `hud.js`). There Esc opens the menu as ever, and
  holding Esc down leaves full screen, as the browser's own notice says. Where there is no lock (Firefox, Safari) the
  first Esc leaves full screen and the next opens the menu.
- **Settings and How to play** are dialogs of their own. The menu steps aside for them (`_hand`) and comes back, on the
  button that opened them, when they close, whichever way they are left; the farm stays held in between, and a dialog
  that would not open does not leave the farm held behind nothing. `SettingsMenu` and `Tutorial` each got an `onClose`
  hook for this, and the gear's own Settings sets none, so closing that does not bring the menu up. `Tutorial.show(mode,
  force)` has the flag the ticket asks for, and `main.js` now makes the tutorial whether or not it will show it, to give
  it and the mode to `PauseMenu`.
- **Save** is the toolbar Save button's own (`saveByHand()` in `main.js`, which both call: the panel says "Saved — Day N"
  or "Save failed"), and the menu's line says Saved, or that this browser won't keep it.
- **Main menu** saves first, then goes to `location.pathname`: no `?debug`, no `?mode=`, so the mode menu. If the colony
  cannot be saved (a browser that keeps nothing) the menu says so and leaves only when asked a second time.
- **Who has the keyboard.** The menu and the list do not open over the tutorial, the settings dialog, the end-of-colony
  screen, the founding of a colony or the mode menu (`OVERLAYS` in `pauseMenu.js`; the mode menu is gone before the
  pause menu is made, and is listed so that it stays that way if that ever changes): Esc is then for whichever of them
  has it, and `?` is left alone. When they do take a key they mark it used (`preventDefault`), so that the browser and the
  listeners that come after leave it alone. They and the farm's keys do nothing with Ctrl, Alt or Meta held (`chord` in
  `hud.js`), with one exception: AltGr, which Windows sends as Ctrl+Alt, and which is how a layout types the third
  character on a key (`[` and `]` on a German keyboard, `?` on some others). The repeat of a held Esc or ? does nothing.
  `Hud._dialogs` includes `#pause` and `#keys`, so the farm's keys (Space, H, M, ...) do nothing behind them. Tab and
  Shift+Tab go round the open dialog and never out to the farm. A dialog opens with the keyboard on its first button
  (Resume, Close) and leaves it on no button when it closes: a button that holds the keyboard turns Space into a click on
  itself, and Space pauses the game. The exception is a dialog that gives the menu back, which hands the keyboard to the
  button that opened it. A click on the dark outside a box does not take the keyboard as it goes (its `mousedown` is
  marked used), so that hand-back holds whichever way the dialog was left: Esc, Close or a click outside.
- **`src/ui/dialogs.js`** holds what the settings dialog and the pause menu both needed: `keepFocus`, the Tab trap, and
  `overlayUp`, which asks whether any of a list of overlays is showing. `settingsMenu.js` uses them in place of its own,
  and `pause` and `keys` are in its `OVERLAYS`.
- **Small screens.** Both boxes scroll if the screen is short; under 480 px the key column of the list narrows. At
  360×640 both fit.
- **The panel's help line** says `Esc menu · ? all the keys`.
- `claude.md` says how the farm's keys and the list are kept together (`SHORTCUTS` and `Hud._onKey`: the `pause` check
  fails for a key that works and is not listed, and for a key that is listed and does nothing), that `_onKey` hands Esc
  and `?` to `pauseMenu.js`, and where a new full-screen dialog has to be listed (`Hud._dialogs` and the `OVERLAYS` of
  the two menus, with its Tab trap from `dialogs.js`).

Where it departs from the ticket, and why:
- **The list is read from a table beside `_onKey`, not from `_onKey`.** A function's keys cannot be read back without
  parsing its source. `SHORTCUTS` is the list, and the `pause` check ties it to the handler in both directions: it
  presses the key of every row and wants what the row says to happen, and it presses the keys the farm does not use and
  wants nothing to happen. A key added to one and not the other fails the check with the key's name.
- **The menu has a Keyboard button, which the ticket does not list.** A touch screen has no `?`, and a Mac layout that
  types it with Option has it only with Alt held, which the farm leaves to the system; the button reaches the list from
  the menu on all of them.
- **No P (photo) row.** It is T2.4's key; that ticket adds the row to `SHORTCUTS` and a step for it to the check, which
  fails for a row it does not work.
- **Main menu does not always leave.** The ticket saves, then leaves; if the save fails the colony is lost, so the first
  press says so and the second leaves.
- **Not in the ticket, and added:** the menu stepping aside for Settings and How to play and coming back, the rules
  above for who has the keyboard, the Tab trap and the focus rules, the click outside the box, `aria-modal`, the
  small-screen layout, the Keyboard button, the toolbar's menu button, AltGr, the Esc lock in full screen, `dialogs.js`,
  and the help line in the panel.

Things to know:
- **Full screen without the lock** (Firefox, Safari): the first Esc leaves full screen and the second opens the menu.
  Nothing a page can do changes that. The test cannot show the lock at work either: headless Chromium gives the page its
  Esc in full screen with or without it, so the check shows that the lock is asked for on the way in and let go on the
  way out, and that Esc in full screen opens the menu and keeps full screen. A real full-screen Chrome was not tried.
- **Layouts.** AltGr is tested with synthetic key events (a test's keyboard cannot hold AltGr), as Chrome on Windows
  sends them (Ctrl and Alt set, and `AltGraph` among the modifiers). No real non-US keyboard was tried. A Mac layout
  that types `[`, `]` or `?` with Option sends them with Alt held and no AltGraph, so the farm leaves them to the system,
  as it does every Alt key; the toolbar's buttons and the menu's Keyboard button are the way there. Not tried on a Mac.
- **Esc, then Space or Enter, presses Resume,** because the keyboard is on it. That is meant: Space is the key for
  carrying on, and the menu's Resume is the same. Enter is in the test; Space is the same thing for a button.
- **A camera tour ends when the menu opens,** and an auto tour starts again after the usual 20 s with nothing touched,
  counted from when the menu closes (`director.blocked` is true while the loop is held or a dialog is up, and
  `Director.update` then stops a tour and holds its idle count at 0). The `pause` check watches this with the idle time
  set to 2 s.
- **The `pause` check names the menu's buttons.** A later ticket that adds one (a Collection button, a link to the full
  version) changes the line of the check that lists them (`the pause menu offers ...`); a version line is not a button
  and changes nothing.
- **A click on the farm in `settingsmenu` and `pause` dropped no food, twice,** in unbroken copies of the repo that the
  mutation workers ran. The cause was not shown; the likeliest is water that rain had left on the tile the click
  reached (food does not go onto it). Both checks now choose a column whose drop tile is air (`foodSpot`), wait out the
  mute that follows a tour, and say what was at the tile if no food falls (`noFoodBecause`). The `settingsmenu` check
  was touched for this, and nothing else in it. Since then it has not come back: 96 colonies probed for it, then 150 runs
  of the two checks (three copies of the repo side by side, for part of the time beside three mutation workers), all
  fed. If it comes back, its message says what was on the tile.

Test: a new `pause` check in `tests/smoke.mjs` (about 30 s; `npm test -- pause`), with real key presses, mouse movements
and clicks, as a player makes them:
- Zen, new colony, tour off: nothing is open, and the panel's help tells about Esc and ?. Esc and ? with Ctrl, Alt or
  Meta held open nothing. At 4× (two presses of `]`), Esc opens the menu: the listeners after it saw the Esc marked used,
  the farm runs at 0× and no tick passes while it is open, the keyboard is on Resume, at the middle of the panel and of
  the toolbar a click would reach the menu or something in it, the two dialogs are marked up as modal dialogs with
  their titles, and the menu offers Resume, Settings, Save, How to play and Main menu, with Keyboard. Space, H, [ ], M,
  + −, 0, C, F, an arrow key and D pressed behind it change nothing. Esc closes it: the farm is back at 4×
  with the keyboard on the page, and a few seconds later it has run the ticks that speed gives; Space pauses it
  afterwards. A farm paused with Space stays paused through Esc, Esc. A click outside the box closes the menu, leaves
  the farm held, and drops no food on the farm behind it (the same click, once the menu is gone, drops some). The
  repeat of a held Esc does not undo the press that opened the menu. Tab goes round the six buttons and back and
  never out; Shift+Tab from Resume goes to Main menu; with the keyboard on a control of the farm behind the menu (as
  after tabbing back into the page from the address bar), Tab goes to Resume and Shift+Tab to Main menu; Enter on
  Resume and a click on it both let the farm go at 4×.
- Settings from the menu: the dialog opens over it, held, with the keyboard on the volume slider, and the menu is back
  when it is closed by Esc, by Close and by a click outside its box, the keyboard on the Settings button each time; Esc
  then closes the menu with the farm at 4×. Settings from the gear closes
  without bringing the menu up, and with the menu up the gear cannot open it.
- ?, from the farm and from the menu: the list opens, the menu is closed, the farm is held, the keyboard is on Close,
  nothing covers it, Tab and Shift+Tab stay inside it, the farm's keys do nothing behind it, and Tab goes into it
  from the page (after a click on its title) and from a control of the farm behind it. Its rows are the entries of
  `SHORTCUTS`, in order. Esc, ?, Close and a click outside the box each close it
  back to where it was opened from: the farm at 4× with the keyboard on the page, or the menu, held, with the keyboard
  on the Keyboard button. ? does not open it over the settings dialog.
- Save: the menu's line and the panel say Saved, the stored colony is as new as the press, and the line is clear the
  next time the menu opens. Main menu: the page is the one without `?debug`, the stored colony is from after the click
  and was written while the page was still showing (the page also saves as it goes hidden, which would prove nothing),
  and the mode menu comes up.
- Every key in the list: each row has a step in the test (the key, what it must do, how long to hold it), and a row
  without a step fails, as does a step without a row. `0` brings the view back from wherever it has been taken. Then a
  set of keys that are in no row is pressed, and none of them may change anything.
- The first visit: the tutorial has the keyboard until it is closed (Esc closes it, ? does nothing over it and is left
  unused for it), closing it notes that it was seen, and Esc then opens the menu. How to play shows it again to a
  visitor who has seen it (and the plain `show` does not), its last step is the mode's own, and finishing or skipping
  it brings the menu back. In a browser that will not keep the note that the tutorial was seen, Skip still closes it.
- Survival, at ½×: the same hold and release. While a colony is being founded (the founding overlay shown), with the
  mode menu shown over the farm, and at the end of a colony (the queen's health set to 0), Esc and ? open nothing. With the end-of-colony screen up behind a menu,
  Settings that would not open leave the menu back and the farm held, not held behind nothing.
- On the mode menu, where there is no farm yet, Esc and ? open nothing.
- A page whose storage refuses every write: Save says it could not, and the panel says "Save failed". Main menu stays
  and says it asks again; closing the menu and opening it again forgets that permission; the second press leaves.
- Small screens, 360×640 and 640×300: both boxes are whole on the screen, nothing sticks out of them, the page does not
  scroll sideways, and the last button can be reached.
- Without Esc: the toolbar's menu button is labelled Menu with Esc in its tip; a click on it opens the menu, held, with
  the keyboard on Resume, and Esc closes it. On a 360×640 touch screen a tap on it opens the menu and a tap on Resume
  closes it at 1×. With AltGr (synthetic key events): Ctrl+Alt+? that is not AltGr opens nothing, AltGr ? opens the list
  and closes it, and AltGr ] speeds the farm up.
- Full screen: F asks for the Esc lock once full screen is on, Esc opens the menu and full screen stays, and F again lets
  the lock go with full screen off.
- The tour: C starts it, Esc stops it, it stays off with the menu open for longer than the idle time (2 s here), it has
  not started again the moment the menu closes, and it is back once the idle time has passed.
- Screenshots: `pause-menu`, `keys-help`, `pause-menu-narrow`, `keys-help-narrow` and `menu-button-phone` in
  `tests/out/`.

Checked by breaking things: 81 faults were put, one at a time, into a throwaway copy of the repo: in `pauseMenu.js`, 38
(Esc opening nothing, a held Esc undoing the press that opened the menu, an Esc not marked used, a key already used or
held with Ctrl, Alt or Meta not left alone; the menu not stopping the farm, not giving its speed back, or giving back 1×
from either end; the key list not holding the farm, finding its way back from the wrong place or handing the keyboard
back to the wrong button; the menu opening over the tutorial, the settings dialog, the end-of-colony screen or the
founding of a colony, with the guard that asks who has the keyboard gone or each of the four left out of `OVERLAYS`;
Settings and How to play with no way back to the menu, none when the dialog will not open, or the keyboard handed back
to the wrong button; Main menu leaving without saving, keeping `?debug` and `?mode=`, never asking after a failed save,
keeping its permission to leave once the menu was closed, or never leaving; the Save line inverted, saying Saved after a
failure, or still there when the menu opens again; a dialog opening with the keyboard nowhere or on the wrong button,
closing with the keyboard still on one of its buttons or still taken for the open one, or with no Tab trap; a click
outside the menu or the list not closing it, and a click inside the menu's box closing it); in `dialogs.js`, 5 (Tab
from outside the dialog or from its last stop going on to the page, Shift+Tab from the first stop going to the first
and not the last, `overlayUp` inverted or asking for every overlay and not any); in `hud.js`, 10 (the menu or the list
not among the dialogs that stop the farm's keys, or the guard itself gone; a list that lost M or Esc, gained a P row
for a key that does nothing yet, or had a wrong letter; a key that works and is not listed, a row that does nothing, and
`0` listed and not handled); in `tutorial.js`, 7 (Esc not marked used, `force` ignored, shown at every visit, no
`onClose`, a refused note of the visit not survived or never made, its keys heard while it is hidden); in
`settingsMenu.js`, 3 (no `onClose`, the menu or the list missing from its `OVERLAYS`); in `main.js`, 4 (no menu made,
the wrong mode given to How to play, Save that does not tell the panel or always says it worked); in `index.html`, 7
(the menu not marked modal, the list untitled, Resume or How to play renamed, the panel's help line gone, either dialog
starting open); and in `main.css`, 7 (the menu under the panel, either dialog shown while hidden, a box taller than a
short screen or not scrolling, the key column too wide at 640 px and under 480). Every one made `npm test -- pause`
fail with the message written for it; the unbroken copy passed. Twelve did not on the first run, which tried 80 (the
other 68 gave the right message). Two were missed outright: an Esc not marked used, and a menu that marked as used a `?`
it should have left to the tutorial; the test now records how each key reached the listeners that come after the menu,
used or unused, and wants it. Two were caught only because the test crashed: Main menu leaving without saving and never
asking after a failed save; the test now reads the address the click led to before anything else, and wants the stored
colony to have been written while the page was still showing (the page also saves as it goes hidden, which proves
nothing). Two were caught through cascades whose first message blamed something else: a closed dialog still taken for
the open one, which showed only as the next Esc failing to open the menu, and a click inside the menu's box closing it;
each now has a step that says so. Five were caught by the right check under a message my harness did not expect, and
the harness was changed, not the test. The twelfth was not judged at all: the test failed in its set-up (a click on the
farm dropped no food) before it reached the check, and the next full run found it missed. Tab from outside a dialog
going on to the page passed both of the test's steps that press Tab from the page, because the browser's own order
lands on the same button (the menu comes after Settings in the page, and the list has only the one button, after its
title); the test now puts the keyboard on a control of the farm behind the dialog and wants Tab to go to the first
button and Shift+Tab to the last, where the browser's order goes to the next control of the page or out of it. The key
column's narrow rule had no fault of its own, since the wide one is caught at 640 px and not at 360; one was added (the
81st). All 81 were run again against the final check, with the unbroken copy as the control in each of the three
workers that shared the run, and every one failed with its own message.

Then the menu button, AltGr, the full-screen lock, Esc through `Hud._onKey`, the mode menu in `OVERLAYS` and the click
outside that keeps the keyboard were added, and the faults were run again: 99 of them. Fifteen of the 81 had aimed at
lines since rewritten and were aimed again at the new ones (two of them, a key already used and a key held with Ctrl or
Alt, now in `hud.js`). Eighteen are new: in `hud.js`, 11 (Esc not handed to the menu, only Esc handed and not ?, the
dialog guard ahead of the hand-off, `chord` ignoring every modifier or not excusing AltGr, the menu button not bound, no
Esc lock, a lock on every key, no unlock, the tour never held, `0 (zero)` written `0`); in `pauseMenu.js` and
`settingsMenu.js`, 4 (the mode menu left out of `OVERLAYS`, a click outside the menu or the list, or outside Settings,
taking the keyboard as it goes, the Tab trap asking the wrong way whether a dialog is open); in `main.js`, 1 (the menu
made and not given to the HUD); in `index.html`, 2 (no menu button, its tip without Esc). 98 failed with their own
message, with the unbroken copy passing in each of the three workers. The 99th, the menu not taking the keyboard off a
button it hides, passed: the check read where the keyboard was a frame or more later, and Chromium can take it off a
hidden button by itself by then (Firefox and Safari do not). The check now also reads it as the press is handled, and
that fault fails it.

---

## T1.6 [H] Title screen polish, credits, version — DONE

As built (`index.html`, `styles/main.css`, the new `src/version.js` and `src/ui/titleScreen.js`; also `src/config.js`,
`src/main.js`, `src/modes.js`, `src/ui/settingsMenu.js`, `src/ui/pauseMenu.js`, `src/ui/hud.js`, `src/ui/tutorial.js`,
`manifest.json`, `tests/smoke.mjs` and `claude.md`):
- **The title.** `#mode-select` is now a solid dark cover (it was 97% and the farm's panels showed through). The logo is a
  small pixel ant (inline SVG, `shape-rendering="crispEdges"`) beside PIXEL ANTS with a glow, a line under it, and two
  cards, Zen and Survival, each with a one-line pitch and its longer description. Keeper's card comes with T4.1. Under the
  cards are small Settings and Credits buttons, `v0.9.0` at the bottom right and, along the foot, the strip of ants. It
  holds at 390 px wide: the cards stack and the logo goes above the name.
- **Zen.** `MODES.screensaver.label` is `Zen` and `badge` `ZEN`; the dashboard default, the first tutorial page, the
  page and share descriptions and `manifest.json` say it too. The id stays `screensaver`, so saves are untouched.
- **Version.** `src/version.js` holds `VERSION`; `TitleScreen` writes `v0.9.0` into every element with `data-version`
  (the title, the pause menu and the credits). Bump it in `version.js` alone.
- **Settings from the title.** The gear is under the title, so the title has its own Settings button. `SettingsMenu` is
  now made before the title is shown (`main.js`) and `open(opener)` remembers the button that asked: closing it with the
  keyboard puts the keyboard back there, and on the gear as before when nothing was given.
- **Credits.** `#credits` is a dialog like the others (shares their overlay rule, `role="dialog"`, Tab trap from
  `dialogs.js`; in `Hud._dialogs` and in the `OVERLAYS` of the settings and pause menus): "Game by John Such", "Made
  with plain JavaScript and Canvas: no engine, no libraries", and that every sound is made in the browser. There are no
  recordings, so no sound credits. Esc, Close and a click outside close it; the keyboard goes back to the Credits button
  after a key, not after a click.
- **The ants.** `#ms-ants` is a canvas one strip-pixel to `TITLE_ANT_PIXEL` screen pixels (`CONFIG`: `TITLE_ANTS`,
  `TITLE_ANT_PIXEL`, `TITLE_ANT_SPEED`, `TITLE_ANT_FPS`), twelve ants of five by three of them, every third carrying food,
  on a strip of soil. It draws at 12 a second, stops when the title is hidden, and with reduced motion is drawn once and
  stands.
- **Test.** A new `title` check (`npm test -- title`, 1920×1080): the version, the cards' names and pitches, nothing
  still called Screensaver, the ants walking, Settings from the title (over it, Esc, the keyboard back on its button),
  Credits (contents, focus on Close, the Tab trap, Esc, Close, a click outside, Enter), the strip stopped once a mode is
  chosen, the version in the pause menu, and the ants standing for a player who wants less motion. Six faults were put in
  to see it fail; five fail it. The sixth, the early stop for reduced motion, only redraws the same picture, so nothing
  on screen differs.

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
   `main.css` by it; set it from `settings.textScale` on load and on change. The control is in
   the settings dialog already (`#set-row-text` in `index.html`, hidden, writing `textScale`):
   take `hidden` off it and add `textScale` to `TESTED` in the `settingsmenu` check.
2. Every button has a `title` and `aria-label`; visible focus outline for keyboard users.
3. Status bars that rely on red vs green: add a second cue (an icon or a pattern) or use
   blue/orange.
4. Reduced motion (`settings.reducedMotion`): no camera shake / flashes in `effects.js`;
   the director uses slower, shorter moves (find its pan speed constant in `director.js`
   and halve it when set). T1.4 did the page's side: the setting is a checkbox in the settings
   dialog and `body.reduce-motion` (`hud.js`) switches off every CSS transition and animation.
   This step is the farm's own motion.

**Done when:** you can start a game, open every dialog and change every setting with the
keyboard only; `npm test` passes.
