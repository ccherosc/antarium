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
  `&clock=1` forces it on.
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

**Step 3:** theme select in the settings menu (T1.4); in the demo edition only `classic`
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

Respect `settings.reducedMotion` (slower moves). Never cut more often than every 20 s.

**Done when:** at 4× speed over 3 in-game days, the caption log shows each new shot type
at least once (check with a debug console listener on `onEvent`/captions).

---

## T2.7 [S] (Optional) Sky follows the real clock

Setting "Match my time of day": Zen's sky phase follows the computer's clock (dawn at
6:00, dusk at 20:00) instead of the 4-minute game day. The colony's own clock (`sky.time`,
day counter, ants' ages) keeps running at game speed; only what `_calc()` returns for
`phase` / `light` / `isNight` comes from `new Date()`. Make sure `_dawn`/dusk events still
fire exactly once per real dawn/dusk.
