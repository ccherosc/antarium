# M2 — Zen screensaver features

What makes people leave it running and show it to friends: start straight into it, a
clock, beautiful farm styles, seasons, and a camera that never misses the good moments.

Needs M0. T1.4 (settings menu) should exist for T2.2/T2.3 toggles.

---

## T2.1 [H] Screensaver URL mode (`?zen`)

**Why:** the desktop screensaver (M3), "live wallpaper" apps (Lively Wallpaper, Wallpaper
Engine's web wallpapers) and browser start pages all open a URL. It must go straight into
a running farm with no menus.

**File:** `src/main.js` (extends the URL handling from T0.2).

`?zen` means: mode `screensaver`, resume the Zen save if one exists (new colony if not),
no tutorial, side panel hidden, director tour on, hint bar hidden. Optional extras:
`&slot=2` uses a separate save (append `_2` to the mode used for save keys — add an
optional `slot` argument to the `saveLoad.js` functions), `&ui=1` keeps the panel.

**Done when:** `http://localhost:8080/?zen` opens a running, touring farm with nothing but
the farm on screen; a second visit resumes the same colony; `npm test` passes.

---

## T2.2 [H] Clock / info overlay

**Files:** `index.html`, `styles/main.css`, new `src/ui/clock.js`.

- `#clock` element bottom-left, large pixel-style digits (use the existing UI font),
  semi-transparent, soft shadow. Real wall-clock time, updates each second.
  `settings.clock24h` picks 24 h vs 12 h.
- Under it, small: "Day 12 · 214 ants" from `stats`.
- Shown when `settings.showClock` (toggle in the settings menu). In `?zen`, the URL param
  `&clock=1` forces it on. The two checkboxes are in the dialog already (`#set-row-clock` and
  `#set-row-clock24` in `index.html`, hidden): take `hidden` off both and add `showClock` and
  `clock24h` to `TESTED` in the `settingsmenu` check.
- Slowly drift the overlay a few pixels every minute (screen burn-in protection).

**Done when:** toggling the setting shows/hides it instantly; screenshot looks clean on a
dark night scene and a bright noon scene.

---

## T2.3 [S] Farm themes

**Why:** themes are the cheapest "wow" and the main thing to unlock in the full edition.

**Step 1 — extract (no visual change).** Create `src/rendering/themes.js`:
```js
export const THEMES = {
  classic: { name: 'Classic Loam', soil: […], tunnel: […], chamberTint: […], sky: {…},
             grass: […], flowers: […], wood: {…}, glass: … },
};
export function theme() { return THEMES[settings.get('theme')] || THEMES.classic; }
```
Move the colour constants into `classic`: `ROOM_TINT` and the `TILE.SOIL` / tunnel
colours in `renderWorld.js`; `KEYS`, `NIGHT`, `FLOWERS`, `GREENS` in `renderSky.js`;
`SEEDS`, `WOOD` in `renderer.js`. Replace the uses with `theme().xxx`. If the world is
pre-rendered to an offscreen canvas, re-render it when the theme changes (`world.dirty =
true` or the renderer's equivalent — find how `renderWorld` caches). Take before/after
screenshots: they must be identical.

**Step 2 — add themes:**

| id | Name | Look |
|---|---|---|
| `sand` | Desert Sand | pale gold sand, sparse dry grass, hot white sky at noon, cactus flowers |
| `clay` | Red Clay | terracotta soil, dark red strata, olive grass |
| `gel` | Blue Gel | the classic translucent blue gel farm: glowing cyan medium, lighter tunnels, no strata, faint bubbles |
| `glow` | Night Glow | near-black soil, tunnels faintly bioluminescent teal, ants slightly lit, starry sky |

**Step 3:** theme select in the settings menu (T1.4: `#set-row-theme` in `index.html` is
there, hidden, with the one `classic` option — add an `<option>` per theme, take `hidden` off
the row and add `theme` to `TESTED` in the `settingsmenu` check); in the demo edition only `classic`
is selectable — the others show a lock (T6.1 adds the check; just leave an
`isFull()`-style hook comment if T6.1 isn't done).

**Done when:** all five themes switch live without reload and each has a screenshot in
`tests/out/` (extend `npm test` with `&theme=<id>` URL param support, or a separate
`tests/shots.mjs`).

---

## T2.4 [H] Photo mode (P)

**Files:** `src/ui/hud.js` (`_onKey`), new `src/ui/photo.js`.

- **P**: hide all UI (reuse whatever H does to hide the panel, plus toolbar, hint,
  caption, toast), pause the director, show a small hint "P again to save · Esc to
  cancel".
- **P again**: `canvas.toBlob(blob => download)` named `pixel-ants-day<N>.png`
  (create an `<a download>` with `URL.createObjectURL`). Flash the screen white for
  150 ms (skip if reduced motion). Restore the UI.

**Done when:** pressing P twice downloads a clean PNG with no UI in it.

---

## T2.5 [S] Seasons

**Why:** a screensaver that runs for weeks needs slow change.

**Files:** `src/simulation/sky.js`, `src/config.js`, `src/simulation/world.js`
(`_tickFoodSpawn`), `src/simulation/queen.js` (`_lay`/`update`), `src/rendering/renderSky.js`.

1. `CONFIG.YEAR_DAYS = 16` (4 days per season). `sky.season` = `'spring' | 'summer' |
   'autumn' | 'winter'` and `sky.seasonT` (0–1 through the year), computed in `_calc()`;
   emit `on`-bus event `season` when it changes and `logEvent` it ("Autumn — the leaves
   turn").
2. Effects (as multipliers in one table in `sky.js`, e.g. `SEASON = { spring: { rain: 1.3,
   food: 1.2, lay: 1.2, grass: …, sky: … }, … }`):
   - rain chance (`_nextRain` interval), food spawn rate, queen laying rate
   - winter: daylight shorter (shift DAWN/DUSK by ±0.04), activity slower (ants rest more:
     find where `_toBed`/`_rest` decides sleep and lengthen it by a winter factor), queen
     stops laying, no nuptial flights; grass browns, occasional snow-like white flecks
     on the surface in `renderSky.js`
   - summer: nuptial flights only happen in summer (`_flight` checks season)
   - autumn: leaves fall on the surface as food items (`world.placeFood` on random
     surface columns, small amounts)
3. In Zen, winter must not kill anything (rules floors already protect stores) and the
   colony must look alive: some ants still patrol.
4. Save `season`-related state through `sky.save()/load()` if any is not derived from
   `time`. (If it's all derived from `sky.time`, nothing to save.)

**Done when:** a 16-day soak shows four seasons in the log, population dips in winter but
recovers in spring, and screenshots of each season look different.

---

## T2.6 [S] Director: cut to every story beat

**File:** `src/app/director.js` (its shot list is built around line 330–395: `queen`,
`nursery`, `store`, `sleep`, `shaft`, `follow`, `hatch`, `spoils`).

Using the event bus (T0.7) add shots that interrupt the tour (high weight, once each):
- `flight` → wide shot of the surface during a nuptial flight ("Nuptial flight")
- `rainStart` → surface shot of rain arriving ("Rain")
- `projectDone` with kind `gallery` → close-up of the new chamber ("A new chamber")
- creature fight → find where `creatures.js` `_alertAnts` raises the alarm; emit
  `fight` with `{ x, y }` there; shot "Under attack"
- `season` → slow wide pan with the season name as caption
- `dawn` → sunrise wide shot when the camera isn't busy

If T2.8 is done, queue these through `director.news()` instead of adding more checks to
`_breaking()`/`_choose()`. Respect `settings.reducedMotion` (slower moves). Never cut more often than every 20 s.

**Done when:** at 4× speed over 3 in-game days, the caption log shows each new shot type
at least once (check with a debug console listener on `onEvent`/captions).

---

## T2.7 [S] (Optional) Sky follows the real clock

Setting "Match my time of day": Zen's sky phase follows the computer's clock (dawn at
6:00, dusk at 20:00) instead of the 4-minute game day. The colony's own clock (`sky.time`,
day counter, ants' ages) keeps running at game speed; only what `_calc()` returns for
`phase` / `light` / `isNight` comes from `new Date()`. Make sure `_dawn`/dusk events still
fire exactly once per real dawn/dusk.

---

# Zen, part two: reasons to leave it on all night (T2.8–T2.17)

Five features, ten tickets. They make an 8-hour Zen run keep changing: rare moments, a
time-lapse of the nest's growth, a few named ants to follow, music that follows the
colony, and wallpaper and stream builds.

**Order.** Do T2.8 first: it adds the director's news queue that T2.9, T2.10, T2.13 and
T2.14 use. T2.16 needs T2.1. T2.17 needs T3.3. Apart from that the tickets can be done in
any order. The recommended order is the checklist order in `README.md`.

**Rules for every ticket here** (on top of `claude.md`):
- Numbers go in `CONFIG`. Name them with the ticket's prefix (`MOMENT_*`, `TIMELAPSE_*`,
  `STORY_*`, `AUDIO_MUSIC_*`).
- Anything that changes what a save holds bumps `VERSION` in `src/saveLoad.js` by one from
  whatever it is when you start, and adds `MIGRATIONS[old]`. Usually that is `d => d`,
  because the loader copes with the missing field. New per-colony state is a new key in
  `EXTRAS`, and the object at `sim[key]` gets `save()`/`load(d)`. `npm test -- saves`
  must still resume `tests/fixtures/`.
- Code that only reads the simulation stays out of `ants.js` and `world.js`. Where a ticket
  has to edit them, it says exactly where, and you grep for that spot.
- Every ticket adds or extends a check in `tests/smoke.mjs`, and every check gets a mutation
  run. Break the feature in 4–6 ways, one at a time, confirm the check fails for each, and
  undo. Report how many faults it caught in the as-built note, as M1 did.
- Ticketed visuals get a screenshot in `tests/out/`, and you look at it.
- When the ticket is done, put an "As built" note under its heading, like M1's notes.

---

## T2.8 [S] Moments engine, director news, and the first moment (fireflies)

**Why:** a screensaver that does the same few things for eight hours gets switched off.
A moment is a rare scene with a beginning and an end. The engine picks moments so that
each is a surprise and none repeats too soon, and the camera cuts to each one.

**Files:**
- new `src/simulation/moments/index.js`, the engine and the table
- new `src/simulation/moments/fireflies.js`
- new `src/rendering/renderMoments.js`
- edits to `src/main.js`, `src/saveLoad.js`, `src/modes.js`, `src/app/director.js`,
  `src/rendering/renderer.js`, `src/audio/audio.js`, `src/config.js` and `tests/smoke.mjs`

1. **The table.** Each moment is a row exported from its own file in
   `src/simulation/moments/`:
   ```js
   export default {
     id: 'fireflies',
     title: 'Fireflies',               // caption and news line
     weight: 3,                        // how often it is picked, relative to the others
     gapDays: 2,                       // never again within this many in-game days
     can(sim) { … },                   // true when it may start now (night, clear sky, …)
     start(sim) { … },                 // returns its state { x, y, … } or null if there is nowhere for it
     tick(m, sim) { … },               // advances one sim tick; returns false when it is over
     shot: { tall: 40, dur: 18 },      // the director's close-up: rows in view, seconds
     subject: m => ({ x: m.x, y: m.y }),   // optional: what the camera follows
   };
   ```
   `index.js` imports the rows into `MOMENTS`, an array.
2. **The engine.** `index.js` exports `class Moments` with `active` (the one running
   moment, or null), `last` (id to the day it last ran), `update(sim)`, `force(id)`,
   `save()` and `load(d)`.
   - Every `MOMENT_CHECK_TICKS` (1200) it rolls `MOMENT_CHANCE` (0.08). On a hit, if
     nothing is active and at least `MOMENT_MIN_GAP_TICKS` (DAY_TICKS / 2) have passed
     since the last moment ended, it calls `pickMoment`.
   - Put the choice in a pure export, `pickMoment(rows, last, day, rand)`. It considers only
     rows with `can()` true and `day - (last[id] ?? -Infinity) >= gapDays`. The weight is
     `row.weight * Math.min(3, 1 + (day - last) / row.gapDays)`, so the longer a moment
     hasn't been seen, the likelier it is. A moment never seen gets weight × 3.
   - When a moment starts: `last[id] = sky.day`, `logEvent(title)`, and
     `emit('moment', { id, title, x, y, shot, subject })`. Here `subject` is a function that
     returns the live `{x, y}`, or null once the moment is over.
   - When it ends: `emit('momentEnd', { id })`.
   - `force(id)` starts that row now, ignoring the chance, the gaps and `can()`. Only the
     tests call it, through `window.__pa.sim.moments`. It returns false when `start()`
     returned null.
   - `save()` keeps `last` and the timer. The active moment is not saved, so a reload ends
     it.
3. **Wiring.**
   - In `main.js`, grep `creatures.update(` and create `sim.moments = new Moments()` where
     the sim is made.
   - Call `sim.moments.update(sim)` next to `creatures.update`, but only when
     `rules().moments` is true.
   - Add `moments: true` to the Zen row of `modes.js` and `moments: false` to Survival's.
     Survival's threats come in T5.3.
   - Add `'moments'` to `EXTRAS`, bump `VERSION` and add the migration.
4. **Director news queue.** This replaces ad-hoc checks for future interrupts. T2.6 should
   use it too.
   - In `Director`: `this._news = []`.
   - Add a public `news(item)` that pushes `{ kind, title, x, y, tall, dur, subject }` and
     drops the item if the same kind is already queued.
   - The constructor subscribes `on('moment', e => this.news({ kind: 'moment:' + e.id,
     title: e.title, x: e.x, y: e.y, ...e.shot, subject: e.subject }))`.
   - `_breaking()` also returns true when `_news.length > 0`.
   - `_choose()`, after the nuptial flight check: if there is news, shift it and return
     `this._close(item.kind, item.title, item.x, item.y, item.tall, { dur: item.dur, subject: item.subject })`.
   - Never cut away from a news shot for another news item in less than 12 s. Keep that in
     `CONFIG.DIRECTOR_NEWS_HOLD`.
5. **Fireflies** (`fireflies.js`).
   - `can`: `sky.isNight && sky.weather === 'clear' && sky.rain === 0`.
   - `start`: 10–16 flies spread over a 60-tile stretch of the surface away from the edges,
     each `{ x, y, phase, speed }`, with `y` from 2 to 14 rows above the ground. The state's
     `x, y` is the stretch's centre, 6 rows up. It lasts `DAY_TICKS * 0.2` ticks.
   - `tick`: each fly drifts on two slow sines. It is pure state; do not touch the world.
   - Fade the swarm in over the first and out over the last 10% of the moment.
6. **Drawing.** `renderMoments.js` exports `drawMoments(ctx, camera, sim, t)` and a `DRAW`
   map from id to function.
   - `renderer.render` calls it inside the glass clip, right after `drawCreatures`.
   - A firefly is a 1-tile-pixel pale yellow-green dot, with a soft glow drawn with
     `globalCompositeOperation = 'lighter'`. It blinks: on for 0.3 s every 2–4 s, using `t`
     and its `phase`.
   - With `settings.get('reducedMotion')` the flies drift at half speed.
   - Draw nothing for moments off screen.
7. **Sound.** Add `SFX.moment`, a soft two-note chime (`tone()`, triangle, about 0.6 s).
   Play it from `main.js` next to the other `on(...)` sound lines:
   `on('moment', () => audio.playSfx('moment'))`.
8. **Test.** A new `moments` check, and add `'moments'` to `CHECKS`.
   - Node part, no browser: `pickMoment` over 120 simulated days, 12 checks a day, with
     stubbed rows that are always allowed. Every row is picked, none gets more than 45% of
     the picks, and no row repeats inside its `gapDays`.
   - Browser part (`?debug&new&mode=screensaver`):
     - set the sky to night, then `force('fireflies')`;
     - the next director shot has kind `moment:fireflies` and caption "Fireflies";
     - screenshot `moment-fireflies.png` taken at night;
     - at speed 8 the moment ends within its length;
     - `sim.moments.last.fireflies` survives a save and reload;
     - no console errors.
   - Survival never starts a moment.
   - Run `npm run perf`; the ratios should not move.

**Done when:** a Zen colony left at 4× shows fireflies on some clear nights, the tour cuts to
them with the caption, and `npm test` passes.

---

## T2.9 [S] Moments: the earthworm and the burrowing beetle

**Needs:** T2.8. **Files:** new `src/simulation/moments/earthworm.js` and
`burrowingBeetle.js`, plus `renderMoments.js`, `config.js` and `tests/smoke.mjs`.

1. **Earthworm** ("An earthworm passes the glass"; weight 3, gapDays 3; `can` true
   unless a flood is active).
   - It is pure state and never changes tiles. It moves through the soil pressed against the
     glass.
   - `start`: it enters at one side (just inside `GLASS_THICKNESS`) at a depth from 15% to
     70% of the soil. It travels 60–120 tiles at `MOMENT_WORM_SPEED` (0.025 tiles/tick)
     with a slow sine for depth. Then it turns down and fades into the deep over 200
     ticks.
   - It keeps the last 60 head positions. Its body is 14 segments sampled along them.
   - Steering: look 2 tiles ahead with `world.tiles`. If the tile is `ROCK`, bend up or down.
     It may cross a tunnel, and that is the moment people will screenshot.
   - Draw it pink (`#c9787a`) with darker rings every third segment. The head segment is a
     little thicker, and segments shrink toward the tail. Draw it over the soil.
   - `subject` follows the head.
2. **Burrowing beetle** ("A beetle is burrowing in"; weight 2, gapDays 6; `can` when the
   sky is clear and in daylight).
   - This one *does* change the world: it leaves a real tunnel the colony can use.
   - `start`: it starts at the surface at least 40 tiles from `COLONY_X` and digs down and
     sideways toward the nearest existing tunnel tile below it. If there is no tunnel tile
     within 50 tiles, it returns null.
   - Every `MOMENT_BEETLE_DIG_TICKS` (90) it digs the next tile, a step toward the target
     with a little wander. **Dig with the same world function the ants' digging uses:**
     grep `ants.js` for where `STATE.DIGGING` finishes a tile and call that same
     `world.…` method, not `world.set`, so nav, `tunnelCount` and the render cache update.
   - It only digs `SOIL`. It never digs `ROCK`, a tile with `world.planRoom[i]` set, or a
     tile within 2 of a `CHAMBER` or an egg. When the next tile is not allowed, it tries the
     other diagonal, then gives up.
   - It ends when it breaks into a tunnel (logEvent "The beetle broke into the tunnels"),
     after 45 tiles, or when it gives up. Then it climbs back out the way it came over 300
     ticks, and the tunnel stays.
   - Draw it with the beetle drawing in `renderCreatures.js`. If that drawing is module
     local, export a small `drawBeetle(ctx, x, y, angle, scale)` helper rather than copying
     it.
3. **Test.** Extend `moments`.
   - `force` each one.
   - Earthworm: it changes no tiles; compare `world.tiles` before and after.
   - Beetle: the count of `TUNNEL` tiles goes up. It dug no `ROCK` or chamber tile. Ants can
     still path to the queen; the `fastforward` and `events` checks still pass.
   - Screenshots `moment-earthworm.png` and `moment-beetle.png`.
4. Run `npm run soak` once after this ticket, because the beetle changes the nest.

**Done when:** both play, are filmed and captioned, the beetle's tunnel is walked by ants
afterwards, and `npm test` and `npm run soak` pass.

---

## T2.10 [S] Moments: mushroom bloom and the storm flood

**Needs:** T2.8. **Files:** new `src/simulation/moments/mushroomBloom.js` and `flood.js`,
plus `index.js` (listens for rain), `renderMoments.js`, `renderer.js` (shared mushroom
drawing), `config.js` and `tests/smoke.mjs`.

1. **Damp.** There is no moisture model until U5. For now the engine records
   `this.lastRainEnd = sky.time` on `on('rainEnd')`, and "damp" means within
   `DAY_TICKS * 0.6` of it.
2. **Mushroom bloom** ("Mushrooms bloom in a damp chamber"; weight 2, gapDays 4; `can`
   when damp and at least one built chamber that isn't the queen's has 4 or more floor
   tiles).
   - Choose the deepest such chamber. Floor tiles follow the rule in
     `Renderer._mushrooms`: the tile below is not passable.
   - Place 6–14 mushrooms on its floor. Each grows over `DAY_TICKS * 0.3`, stands for
     `DAY_TICKS * 0.6` and withers over `DAY_TICKS * 0.2`.
   - At night the caps glow faintly pale blue. Draw it with `'lighter'` at low alpha.
   - When it ends, add `MOMENT_BLOOM_FOOD × count` to `world.foodStore` (not past
     `world.foodCap`, if that exists) and logEvent "The ants harvested the mushrooms".
   - Take the mushroom drawing out of `renderer.js` into an exported helper, so the garden
     mushrooms and the bloom look like one species.
3. **Storm flood** ("The storm floods a low tunnel"; weight 1, gapDays 8; `can` when
   `sky.weather === 'rain' && sky.rain > 0.7`).
   - Pick a `TUNNEL` tile in the top 40% of the soil whose tile below is not passable (a
     dip). Flood-fill passable `TUNNEL` tiles (never `CHAMBER`) from it, only at rows from
     the floor up to `MOMENT_FLOOD_DEPTH` (3) rows above it, at most 60 tiles.
   - Water level: it rises over `DAY_TICKS * 0.08`, holds `0.15`, and drains `0.2`.
   - It changes no tiles and nothing the ants do. The Survival version with consequences
     belongs to T5.3, so say so in a comment.
   - Draw a translucent blue per flooded tile below the current level, with a lighter
     shimmering line at the water's top. Play `playSfx('thunder')` on start (wired in
     `main.js` like `moment`).
4. **Test.** Extend `moments`.
   - Make a chamber damp (set `lastRainEnd`), then `force('mushroomBloom')`. The food store
     rises when it ends.
   - Set the rain to 1, then `force('flood')`. The flooded tiles are all `TUNNEL`, and the
     tiles are unchanged afterwards.
   - Screenshots `moment-bloom.png` (at night) and `moment-flood.png`.
   - Mutation runs as usual.

**Done when:** all five moments appear in a long 8× Zen run (the `moments` check can force
them; also leave one running for 10 minutes and read the event log), and `npm test` passes.

---

## T2.11 [S] Time-lapse: recording the nest

**Why:** "watch 40 days of digging in 20 seconds" is the best trailer shot this game has,
and the most shareable thing in Zen.

**Files:** new `src/simulation/timelapse.js`, plus `src/main.js`, `src/saveLoad.js`,
`config.js` and `tests/smoke.mjs`. Do not edit `world.js`.

1. `class TimeLapse` keeps `dug`, a `Uint16Array(W * H)` holding the in-game day each tile
   was first seen open, where 0 means never. Also keep `firstDay`.
2. `record(world, day)`: for every tile that is `TUNNEL` or `CHAMBER` with `dug[i] === 0`,
   set `dug[i] = day`. It is one pass over 38,400 tiles, once a day, so it is cheap.
   - Call it on `on('dawn', e => …)` from `main.js`.
   - Also call it once right after the colony is created or loaded. That way a pre-grown
     colony, or an old save with no history, starts with what is already there, as day 1
     or the current day.
3. Save it in `EXTRAS` as `timelapse`, in a compact form: `{ first, days: { "<day>":
   "<base36 gaps>" } }`. Each day's tile indices are sorted and stored as the
   differences from the previous one, in base 36, joined with `,`. Write a round-trip
   `encode`/`decode` pair, and test them in node.
4. Budget: `JSON.stringify(save().extra.timelapse).length < 40_000` for a fully dug farm.
   Test it by marking every soil tile below the surface as dug on random days from 1 to 200.
5. Bump `VERSION` and add the migration (old saves have no `timelapse`, which is fine).
6. **Test.** A new `timelapse` check, and add it to `CHECKS`.
   - Node: `encode`/`decode` round trip and the budget.
   - Browser: a new colony, then `sky.time` jumped forward 3 dawns with ticks in between
     (or speed 8 for 3 days). `dug` has entries for at least two different days, and
     they survive save and reload.

**Done when:** the save carries the dig history compactly, and `npm test` passes.

---

## T2.12 [H] Time-lapse: playback

**Needs:** T2.11. **Files:**
- new `src/ui/timelapse.js` (the player)
- `index.html`: a `#timelapse` overlay with a canvas, a day caption and a close hint, plus a
  "Time-lapse" button in `#pause`
- `styles/main.css`
- `src/ui/hud.js`: key and `_dialogs`
- `src/ui/pauseMenu.js` and `src/ui/settingsMenu.js`: `OVERLAYS`
- `src/app/director.js`: the auto-play
- `src/modes.js`, `config.js` and `tests/smoke.mjs`

1. **Player.** `TimeLapsePlayer.play(sim)` draws the whole farm fitted to the window, not
   through the camera. Draw an offscreen canvas with one pixel per tile, scaled up with
   `imageSmoothingEnabled = false`.
   - Draw sky above `SURFACE_ROW`, soil below, and the open tiles in the tunnel colour,
     or the chamber colour if the tile is a chamber now. Use the colours `renderWorld.js`
     uses; export them from there if they are module local.
   - Show the tiles with `dug[i] <= shownDay`. Inside a day, tiles appear in a fixed hashed
     order, so the digging grows instead of jumping.
   - The whole history plays in `TIMELAPSE_SECONDS` (20). Hold the last frame for 2 s, then
     fade out into the live farm. Very young colonies (fewer than 3 days) get "Not much to
     show yet — check back in a few days".
   - Caption at the bottom left: "Day 1" … "Day 37", plus the colony name if T4.6 exists.
2. **Controls.**
   - A key (use `T` if it is free in `SHORTCUTS`, otherwise pick a free one). Add a
     `SHORTCUTS` row: "Time-lapse of the nest".
   - Also the pause menu button.
   - Esc, a click or any key closes it.
   - It is a full-screen dialog: it goes in `_dialogs` and in both `OVERLAYS` lists and
     gets the Tab trap. The farm keeps living underneath.
3. **Auto-play in Zen.** A mode row field, `timelapseEvery: 10` for Zen and `null` for
   Survival.
   - While the director's tour is active, at a dawn when `day % timelapseEvery === 0` and
     the colony is at least that many days old, the director queues news of kind
     `timelapse` and the player plays it instead of a camera shot.
   - The director needs an `onNews(kind)` hook that the HUD wires to the player, so the
     director doesn't import UI.
4. With reduced motion, show one cross-fade per tenth of the history instead of continuous
   growth.
5. **Test.** Extend `timelapse`.
   - The key opens it; the canvas is not blank (sample pixels); the caption counts up.
   - Esc closes it and does not open the pause menu.
   - Screenshot `timelapse.png` taken halfway through.
   - With `timelapseEvery` set to 1 and the tour on, a dawn plays it.
   - The `pause` check still passes, with the new key listed and handled.

**Done when:** T (or the button) plays the colony's whole history in about 20 s, Zen shows
it by itself every 10 days, and `npm test` passes.

---

## T2.13 [S] Ant life stories: the story keeper

**Why:** a farm of 300 identical ants turns into a place with characters once three of them
have names and a life you can follow from hatching to death. T4.6 (ant cards) will build on
this, so keep the data general.

**Files:**
- new `src/simulation/stories.js` and `src/simulation/names.js`
- `ants.js`: three small edits, listed below
- `src/main.js`, `src/saveLoad.js`, `config.js` and `tests/smoke.mjs`

1. **`names.js`.** Export about 100 short, gender-neutral names (plants, stones, weather:
   Maple, Clover, Pip, Sorrel, Flint, Juniper…). The keeper takes one not used by a living
   or remembered story ant.
2. **The three edits to `ants.js`** (grep for each and change nothing else):
   - `makeAnt`: add `story: 0` to the object; 0 means not followed.
   - `save()`: append `a.story` as the 11th element of each ant's array. `load()`: set
     `ant.story = a[10] || 0`.
   - The `emit('hatch', …)` and `emit('death', …)` calls pass the ant too:
     `{ x, y, ant }` and `{ cause, ant }`. The existing listeners ignore extra fields.
     Check `main.js` line `on('hatch', e => audio.playSfx('hatch', e))` still works.
3. **`StoryKeeper`** keeps `followed`, a list of living story records, and `memorial`,
   the last `STORY_MEMORIAL` (12) finished ones. A record looks like this:
   ```js
   { id, name, role, bornDay, beats: [[day, text]], end: null | { day, cause, days } }
   ```
   - **Adopting.** On `hatch`, while fewer than `STORY_ANTS` (3) are followed, adopt the new
     ant: give it the next `id` (from 1), set `ant.story = id`, and add the beat
     "Hatched in the nursery". After a load with nobody followed (old saves, pre-grown
     colonies), adopt the youngest worker-type ants, with the beat "We started following
     <name> on day N".
   - **Beats.** Every `STORY_CHECK_TICKS` (60), for each followed ant, record each of these
     once:
     - first time above ground: `y < SURFACE_ROW`, "Saw the sky for the first time"
     - first food carried: `carry === CARRY.FOOD`, "Carried food home"
     - first dig: `state === STATE.DIGGING`, "Dug a tunnel"
     - first night asleep: `state === STATE.RESTING && sky.isNight`, "Slept through the night"
     - wounded and alive: `hp < 60`, "Was hurt, and lived"
     - old age: `age > 0.8 * lifespan`, "Is growing old"
   - Keep the beat texts in one table in `stories.js`, so T4.6 and translations find them.
   - **Death.** On `death` with `ant.story`, write `end` (days lived = `age / DAY_TICKS`,
     one decimal), with the cause in words. Move the record to `memorial` and
     `emit('storyEnd', { name, x, y, days, cause })`. Then the next hatch is adopted.
   - **Relinking.** After a load, the keeper finds its ants by scanning `antSystem.ants`
     for `story` ids on its first `update`. If a followed ant is missing, close its story
     with cause 'unknown'.
4. Save it in `EXTRAS` as `stories` (followed records, memorial, next id). Bump `VERSION`
   and add the migration. Old ants arrays have 10 elements and load with `story` 0.
5. Wire it in `main.js` like the other systems, so it runs in every mode. Survival players
   get names too; that is not mode-specific.
6. **Test.** A new `stories` check.
   - A new colony has 3 followed ants with names.
   - After a minute at 8×, at least one has a beat past "Hatched".
   - Kill one through the debug hook (set its age to its lifespan): its record moves to the
     memorial with an end, a `storyEnd` was emitted, and a new ant is adopted at the next
     hatch.
   - Save and reload: the same names are attached to the same ants (compare role, x and y).
   - The fixture save still loads and gets adopted ants.

**Done when:** three named ants are followed through their lives across reloads, and
`npm test` passes.

---

## T2.14 [H] Ant life stories: captions, name tags, and the Stories dialog

**Needs:** T2.13 (and T2.8 for news).

**Files:**
- `src/app/director.js`
- `src/ui/hud.js`: caption second line, `_dialogs`
- new `src/ui/storiesDialog.js`
- `index.html`: the `#stories` dialog, a pause menu button, and a settings row
- `styles/main.css`
- `src/rendering/renderer.js`: name tags
- `src/settings.js`, both `OVERLAYS` lists, and `tests/smoke.mjs`

1. **Story shots.** In `Director._choose()`, add weight 3 for `'story'` while a followed
   ant is alive and speed is at most 4. It is `_follow(ant)` with title "<Name> the
   <role>" and `shot.sub` set to the ant's latest beat ("Saw the sky for the first time").
   - `Hud`'s caption shows `shot.sub` as a smaller second line when present. Grep
     `_setTitle` and give it an optional second argument.
2. **Farewells.** `on('storyEnd')` queues news of kind `story-end`: "Farewell, <Name>",
   with sub "Lived <days> days", at the death's x and y, `dur` 10.
3. **Name tags.** When `camera.zoom >= STORY_TAG_ZOOM`, draw each followed ant's name in
   small pixel text above it, drawn after the ants in `renderer.render`. The ant positions
   are in tiles. Add a new setting `storyTags` (default true), with a row in `#settings`.
4. **Stories dialog** (pause-menu button "Ant stories").
   - Show each followed ant: name, role, age in days, and its beats with the day.
   - Then "Remembered": the memorial, newest first, with days lived and cause.
   - Clicking a living ant closes the dialog and has the director follow it. Add a public
     `director.followAnt(ant)` that starts the tour on a `_follow` shot.
   - Dialog rules: `_dialogs`, both `OVERLAYS`, `keepFocus`, Esc and a click outside close
     it, and focus goes back to the button.
5. **Test.** Extend `stories`.
   - A story shot's caption has the name and a sub line.
   - The dialog lists 3 living ants and opens and closes by keyboard.
   - Name tags are drawn at high zoom and not at low zoom (pixel sample or a draw counter).
   - The `settingsmenu` check passes with the new row.
   - Screenshot `stories.png` of the dialog and `story-shot.png`.

**Done when:** the tour sometimes follows a named ant with its latest beat, deaths get a
farewell, and the dialog tells each life; `npm test` passes.

---

## T2.15 [S] Music that follows the colony

**Why:** the soundscape (T1.3) is wind, rain and insects. A slow, generated ambient layer
makes Zen feel finished. It must stay quiet, swell when the colony is busy, thin out at
night, never repeat as a loop, and use no files.

**Files:** `src/audio/audio.js` (layer, voices, booking), `src/audio/mix.js` (pure targets),
`src/settings.js`, `index.html` (settings row), `config.js` and `tests/smoke.mjs`.

1. **What it hears** (`mix.js`, pure, tested in node). `musicTargets(sim, sky)` returns
   `{ gain, rate, bright, night }`:
   - `activity` (0..1) is the share of ants not `RESTING`, times `min(1, population / 150)`.
     Compute it at most once a second; cache it in `audio.js`, not in mix.
   - `gain = AUDIO_MUSIC * (0.4 + 0.6 * activity) * (sky.isNight ? AUDIO_MUSIC_NIGHT : 1)`
   - `rate`: notes per minute, from `AUDIO_MUSIC_RATE[0]` (calm) to `[1]` (busy) by
     activity, halved at night.
   - `bright`: a low-pass cutoff in Hz, from `AUDIO_MUSIC_BRIGHT[0]` to `[1]` by
     `sky.light`, darker in rain.
   - `layerTargets` adds `music: gain * settings.get('music')`.
2. **The layer** (`audio.js`).
   - Add `'music'` to `LAYERS`.
   - In `buildGraph`: layers.music is fed by a low-pass filter (`filters.music`, its cutoff
     glided toward `bright` with `setTargetAtTime`, time constant `AUDIO_MUSIC_GLIDE`)
     and a feedback delay for space. The delay is 0.42 s, with 0.35 feedback through its
     own low-pass at 1800 Hz, mixed at 0.3.
   - Add a `music` entry to `EVENTS`, booked by `book()` like the chirps, with the gap
     from `rate` (seconds = 60 / rate × a random 0.6–1.4).
3. **The notes.** These are new voices next to `chirps`/`song`.
   - **Scale:** D major pentatonic (D E F♯ A B) across two octaves from D3. At night the
     same notes are centred on B (B minor pentatonic), so it darkens without a key
     change.
   - **Melody:** a random walk of ±1 or ±2 scale steps, kept in range. One time in six it
     rests instead of playing.
   - **Pluck:** sine plus a quiet octave, 5 ms attack, 1.8 s exponential decay.
   - **Pad:** every 4th booking also starts a pad on the current chord root and fifth: two
     triangle oscillators detuned ±6 cents, 2.5 s attack, 7 s hold, 5 s release.
   - **Chords:** the root follows `I – vi – IV – V` (D, B, G… use the pentatonic-safe roots
     D, B, E, A), moving every 4 pads.
   - Every oscillator has `start` and `stop` booked, so nothing piles up over 8 hours.
     Cap pads at 3 sounding at once.
4. **Setting.** `music: 0.5` in `DEFAULTS`, with a "Music" slider row in `#settings`
   (`data-setting="music"`). At 0 nothing is booked. Mute already silences it.
5. **Recordings.** `useRecording('music', url)` should not be possible: leave `music` out
   of the recorded loops.
6. **Test.** Extend `sound`.
   - Node: `musicTargets` is louder for a busy colony than an idle one, and quieter and
     sparser at night.
   - Browser: after the first click, music voices are booked (`audioGraph()`'s played
     counts) at day and at night, and none at `music: 0`.
   - The live oscillator count stays under 20 over 2 minutes at 8×. Count `start`/`stop`
     calls through a small counter in `tone()`.
   - Run `npm run perf`; the ratios should not move.

**Done when:** a busy colony at noon has a gentle melody with pads, the night is sparse and
darker, the slider works, and `npm test` passes. Listen to it for five minutes yourself;
if it gets annoying, slow it down before you tick it.

---

## T2.16 [S] Live-wallpaper and stream URL modes

**Needs:** T2.1 (`?zen`).

**Files:** `src/main.js` (params), `src/rendering/renderer.js` (backdrop),
`src/ui/hud.js` (hide everything), `styles/main.css`, `src/app/input.js`, `config.js` and
`tests/smoke.mjs`.

1. **`?wallpaper`** is `?zen` plus:
   - no toolbar, panel, toasts, event log or hint bar; captions off unless `&captions=1`;
   - `cursor: none`;
   - the mouse does nothing to the farm (live-wallpaper apps pass desktop clicks through),
     with input ignored behind one flag;
   - sound off unless `&sound=1`;
   - the director tour always on and never stopped by input.
   Put these in one object built from the URL in `main.js`, for example
   `const shell = { ui: false, captions, input: false, sound, … }`. Pass it to `Hud` and
   `Input`, rather than reading the URL in several files.
2. **`?stream`** is the same as `?wallpaper&bg=clear&captions=1`, for OBS browser
   sources.
3. **Backdrop.** `&bg=` takes `room` (the default: the wall, shelf and case), `clear`, or a
   hex colour such as `00ff00` for a chroma key.
   - `clear` means transparent everywhere outside the soil, the sky included.
   - The renderer gets `this.backdrop = { room, sky, color }`, set from the shell.
   - With `clear`, `render()` starts with `ctx.clearRect`, skips `_drawRoom` and `drawSky`
     (the world canvas is already clear above the ground) and `_drawVignette`, and keeps
     `_drawLight`'s darkening below the ground line only.
   - With a colour, it fills that colour and skips the room and the sky.
   - `&frame=0` also skips `_drawFrame`.
   - The page needs a transparent `html`, `body` and game container. Add a `shell-clear`
     class on `<html>` and CSS for it. Check the canvas context has alpha (the default).
4. **View.** `&tour=0` holds a fixed whole-farm view (`camera.fitWorld`) and refits on
   resize.
5. **Frame rate.** `&fps=15|30|60` sets the cap for this page only. Use
   `settings.setDefault`, which never stores it. Wallpapers run all day.
6. **Test.** A new `wallpaper` check.
   - `?debug&wallpaper`: no visible HUD element (`#toolbar`, `#dashboard`, toasts, hint),
     the tour active, and clicks don't move the camera.
   - `?debug&stream`: a pixel in the sky region of the canvas reads alpha 0, and a soil
     pixel reads alpha 255.
   - `&bg=00ff00`: the sky pixel is pure green.
   - Screenshots `wallpaper.png` and `stream.png`. Render it over a checkerboard page
     background for the screenshot, so the transparency shows.
   - The other checks don't change.

**Done when:** the live site URL `?wallpaper` works as a Lively Wallpaper URL wallpaper,
`?stream` shows a transparent farm in an OBS browser source (state that you tested it in
OBS, or that you didn't), and `npm test` passes.

---

## T2.17 [S] Wallpaper Engine and Lively packages

**Needs:** T2.16 and T3.3 (release script).

**Files:** new `wallpaper/` (Wallpaper Engine `project.json`, a preview image, a small
`wallpaper.html` entry) and `tools/release.mjs` (the T3.3 script).

1. **Find out first, and write down what you find in the as-built note.** Can Wallpaper
   Engine's web wallpaper (CEF, loading local files) load ES module scripts from its folder?
   Make a two-file test package and try it.
   - If modules load, `wallpaper.html` sets the shell (wallpaper, `bg=room`) and loads
     `src/main.js`. You can pass the shell on `window.PIXELANTS_SHELL` before the module
     runs, and have `main.js` read it ahead of the URL.
   - If they don't, the package bundles the modules into one classic script at release
     time. That is a dev-only step in `tools/`; the game itself still has no build.
2. **Wallpaper Engine user properties.** `window.wallpaperPropertyListener.applyUserProperties`
   maps to the shell and settings:
   - backdrop: room, clear or colour, with a colour picker
   - captions on or off
   - clock (T2.2)
   - theme (T2.3)
   - frame rate
3. **Lively.** It accepts the plain URL; add a `LivelyInfo.json` package for offline
   use.
4. **Release script.** It writes `dist/pixelants-wallpaper-engine.zip` and
   `dist/pixelants-lively.zip` alongside the T3.3 zips.

**Done when:** both packages install and run in their apps on Windows (tested by hand; say
which versions), and the release script builds them.
