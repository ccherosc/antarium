# M9 — Biome (the colony in the open)

A third mode between Zen and Survival. Zen stays the glass tank on the shelf, unchanged.
**Biome** takes the same calm colony out of the glass and sets it in open land: a wide
strip of country, about three Zen tanks across, that runs from woodland through meadow
and a pond to sand and rocks. Each stretch has its own soil, plants, creatures, food and
moments. The camera wanders it the way Zen's director tours the nest.

The ant simulation is the same one. What changes is the world around it: its size, its
ground line (hills and banks), what the soil is made of from column to column, what lives
on the surface, and how it is framed and filmed.

Needs M0 (modes table, settings, saves), M1's smoke and soak tests, and M2's moments engine
(T2.8, T2.9). T9.11 needs M8 T8.1–T8.6. Everything else stands alone.

---

## Product decisions (already made — don't re-decide in tickets)

- **Three modes on the title screen, in this order:** Zen (the tank), Biome (the open
  land), Survival (the tank, with stakes). The mode id is `biome`; the label is `Biome`;
  the badge is `BIOME`. Its save key is `pixelants_biome` (automatic from the id).
- **Biome is gentle, like Zen.** It copies Zen's rules (no starvation, the queen's health
  floor, free eggs, moments, the auto tour, no game over, pregrow and catch-up). Its own
  differences are only the world fields listed in T9.1 and T9.3. Survival stays a tank.
- **The world is one long strip, not a map.** About 720 tiles wide and 180 tall (Zen is
  240 × 160). The colony starts at the middle, in meadow. Left and right ends fade into
  fog; there are no glass walls to see. The world is still finite: the edge columns and
  the bottom rows stay `TILE.GLASS` in the data (so every existing bounds check keeps
  working) and are drawn as fog and bedrock instead of glass.
- **The land is made of biomes.** A biome is one row in a data table (`BIOMES`, T9.5):
  soil colours, hardness, rocks, plants, creatures, food and dew. The strip is cut into
  5–7 stretches, each 80–160 tiles wide, with soft 16-tile blends between them. The
  colony's stretch is always meadow. The order of the others is seeded per colony, so
  every Biome colony has its own country.
- **The ground has shape.** Hills, banks and dips lift the ground line above
  `SURFACE_ROW`; nothing ever goes *below* it. So the 41 places that use `SURFACE_ROW` as
  "the top of the soil" stay correct, and only the ground line itself is new. A pond is
  a flat stretch of water at `SURFACE_ROW` held between raised banks.
- **Hills are not dug.** Raised ground is soil the ants walk over, not into. Tunnels stay
  below `SURFACE_ROW`, exactly as in Zen. (Digging into hillsides is a later idea, not in
  this milestone.)
- **Performance budget.** Biome may cost at most **1.3 ×** Zen's CPU at the same frame
  cap and quality (`npm run perf`), and must pass the 8-hour soak. The world is 3.4 × the
  tiles, so anything that scales with area (nav fields, BFS, full redraws, saves) is
  measured and bounded in T9.2 before any art goes in.
- **Editions.** Biome is part of the full edition, beside Keeper and Survival. The free
  web demo stays Zen. Until T6.1's edition flag exists, Biome is simply on.
- **"Release into the wild."** A player with a Zen colony can copy it into a new Biome
  world (T9.10). The Zen save is left untouched; the copy is a new Biome colony.

---

## How the pieces fit

```
modes.js     MODES.biome row  ──► world: {w, h, surface, colonyX}, frame: 'open', land: true
main.js      after pickMode(): applyWorldSize(rules().world) copies those into CONFIG
             (one mode per page load, so CONFIG never changes again until reload)
world.js     terrainH[x]  (shape of the land, set once at generation, saved)
             hillH[x]     (the anthill, grows, as today)
             lift(x) = terrainH[x] + hillH[x]   ◄── groundRow / groundY / renderers use it
             biomeAt[x]   (index into BIOMES, with blend weights)  ◄── soil, hardness, rocks
land/        biomes.js (the table), terrain.js (hills, banks, ponds), flora.js (plants),
             layout.js (cuts the strip into stretches from the seed)
rendering/   renderLand.js replaces _drawRoom in Biome: sky to the screen edges, three
             parallax ridges, fog at the world's ends, bedrock at the bottom
app/         camera: fit the height, pan the width; director: journeys and place shots
creatures.js spawn tables per biome (who lives where)
moments/     biome moments use can(sim) to ask for a biome
```

The mode row decides everything. Nothing checks `GameState.mode === 'biome'`.

---

## T9.1 [S] World size per mode

The groundwork. After this ticket a mode can have its own world size, and Zen and
Survival look exactly as they do now.

**Files:** `src/modes.js`, `src/main.js`, `src/config.js`, `src/app/camera.js`,
`src/app/director.js`, `src/rendering/effects.js`, `src/rendering/renderer.js`,
`src/rendering/renderSky.js`, `src/simulation/ants.js`, `tests/smoke.mjs`.

1. **The mode field.** Give each row in `MODES` a `world` field:
   ```js
   world: { w: 240, h: 160, surface: 20, colonyX: 120 },
   ```
   Zen, Keeper (if present) and Survival all get today's numbers. Don't add Biome yet
   (T9.3).
2. **Applying it.** In `src/config.js` add
   ```js
   // A mode's world size, copied in once at boot before anything is built (src/main.js).
   export function applyWorldSize(w) {
     CONFIG.WORLD_WIDTH = w.w; CONFIG.WORLD_HEIGHT = w.h;
     CONFIG.SURFACE_ROW = w.surface; CONFIG.COLONY_X = w.colonyX;
   }
   ```
   Call it in `main.js` straight after `pickMode()` sets the mode and before
   `createSim()` (and before anything else reads the size). This is safe only because a
   page load runs one mode; add a one-line comment saying so.
3. **The six import-time copies.** These modules copy the world size into module
   constants when they load, which is before `applyWorldSize` runs:
   - `src/app/camera.js` lines 4–5 (`WORLD_W`, `WORLD_H`);
   - `src/app/director.js` lines 6–7 (`W`, `H`, `SR`, `CX`);
   - `src/rendering/effects.js` lines 5–7 (`GT`, `SR`, `CX`);
   - `src/rendering/renderer.js` lines 10–12 (`GT`, `SR`, `CX`);
   - `src/rendering/renderSky.js` lines 7–9 (`GT`, `SR`, `CX`);
   - `src/simulation/ants.js` lines 8–9 (`W`, `H`, `SR`, `GT`, `CX`).

   For each one: turn the `const` into `let`, and set it at the start of the thing that is
   always built first (the class constructor, or for `renderSky.js` the top of `drawSky`).
   Keep the short names, so the rest of the file is untouched. In `ants.js` grep for the
   names first to be sure no other top-level code uses them before the constructor runs;
   don't read the file whole. `GLASS_THICKNESS` never changes per mode, but leave it in
   the same `let` block for clarity.
4. **Find any others.** `grep -rn "CONFIG\.\(WORLD_WIDTH\|WORLD_HEIGHT\|SURFACE_ROW\|COLONY_X\)" src`
   and check every hit that sits at module top level (outside a function). Fix them the
   same way.
5. **Test.** In `tests/smoke.mjs` add a `worldsize` check: start Zen with
   `?debug&new&mode=screensaver`, then assert `__pa.sim.world.width === 240` and
   `__pa.CONFIG.SURFACE_ROW === 20`. (T9.3 adds the Biome half.)

**Done when:** `npm test` passes; the screenshots in `tests/out/` for every mode are
pixel-for-pixel the same as on `master` (compare a couple with a quick image diff, or by
eye side by side); and a temporary local change of Zen's row to `w: 300` gives a wider
tank that draws, plays and saves with no errors. Revert that change before committing.

**As built.**
- Every mode row has `world: { w, h, surface, colonyX }`; `applyWorldSize()` in `config.js`
  copies it into `CONFIG` in `main.js` straight after `pickMode()`.
- The camera and the renderer used to be built at the top of `main.js`, before the mode was
  known. They are now built after `applyWorldSize()`, beside `fitWindow()` and its resize
  listener. Nothing touched them earlier.
- `camera.js`: `HOME` is still the same exported object, but its `x` and `y` are filled in by
  the `Camera` constructor, along with `WORLD_W/H` and `BOX_W/H`.
- `ants.js`: the neighbour offsets `NO`, plus `SKY` and `NEST`, depend on the width too. All
  three are set in the `AntSystem` constructor.
- `renderSky.js` has no class, so `drawSky` and `drawSurface` both call `sizeUp()`.
- The size check is part of each mode's smoke run (`runMode`), rather than a separate
  `worldsize` check. It compares the world's width, height, surface row and colony column
  with the mode's row.
- Checked with Zen temporarily set to 300×170 (surface 26, colony 150): the tank is wider,
  centred and framed, the colony plays, saves and resumes, and there are no errors. Reverted.

---

## T9.2 [S] The simulation at three times the size

Measure first, then bound everything that grows with the world's area. No art.

**Files:** `src/simulation/nav.js`, `src/config.js`, `src/saveLoad.js` (read only, unless a
fix is needed), new `tests/scale.mjs`, `package.json` (a `scale` script).

1. **A test world.** Add a temporary local mode row `wide` (a copy of Zen with
   `world: { w: 720, h: 180, surface: 30, colonyX: 360 }`) for this ticket only. Delete it
   before committing; `tests/scale.mjs` reaches the same world with `?mode=screensaver`
   plus a `&world=720x180` debug parameter that `main.js` honours only with `?debug`
   (keep that: it is how later tickets test). Parse it next to `?debug` and pass it to
   `applyWorldSize`.
2. **`tests/scale.mjs`.** Like the soak's simulation mode: run 10 Zen days fast-forwarded
   at 240×160 and at 720×180, each from a fresh colony, and print for both:
   - ms per tick (mean, 99th percentile) and the share spent in `nav` rebuilds
     (wrap `nav._get` with a timer in the test, not in the game);
   - the JS heap at the end;
   - the save size in bytes (`localStorage` value length for the save key);
   - the number of nav fields alive.

   Write the table to `tests/out/scale.txt`.
3. **Nav memory.** Each field is a `Uint16Array(world.size)` and up to `MAX_FIELDS` (140)
   are kept, so a 720×180 world can hold ~36 MB of fields. Replace the constant with a
   budget:
   - `CONFIG.NAV_FIELD_BUDGET_MB: 12`;
   - `maxFields = clamp(floor(budget bytes / (2 × world.size)), 24, 140)`, worked out in
     the `Nav` constructor. Zen keeps 140 (12 MB / 76.8 KB = 156, clamped to 140), so Zen's
     behaviour does not change.
4. **Nav time.** If rebuild time per tick at 720×180 is more than 2 × Zen's, cap the work:
   rebuilds already wait `MIN_REBUILD`; add `CONFIG.NAV_REBUILDS_PER_TICK: 2` and queue any
   more for the next tick (a stale field for one tick is fine; ants already live with
   that between rebuilds). Only do this if the measurement says so; note the numbers in
   the commit either way.
5. **Saves.** If the 720×180 save is over 1.5 MB, look at which array is the biggest and
   tighten its packing (the RLE in `world.js` `pack()` already handles long runs; the sky
   rows and the deep soil should compress well). The hard limit is the browser's
   ~5 MB per origin, shared with Zen's and Survival's saves, so all three together must fit.
6. **Full redraws.** `renderWorld.js` redraws everything when more than 6000 tiles are
   dirty. Make that limit a share of the world (`CONFIG.WORLD_FULL_REDRAW_SHARE: 0.15`;
   Zen: 0.15 × 38,400 = 5,760, close to today's 6000) so a big world doesn't redraw the lot
   for a medium change.

**Done when:** `npm run scale` prints both rows; at 720×180, ms per tick is at most
3 × Zen's, the heap at most 2.5 × Zen's, and the save under 1.5 MB; `npm test` still passes
and Zen's numbers are within noise of `master`'s. Put the table in the commit message.

**As built.** Measured over 10 days with `npm run scale`:
```
   world     size   pop  ms/tick     p99    nav  fields  most  heapMB  saveKB
     zen  240x160   408    0.075   0.145    27%      74 74/140    13.2     123
   biome  720x180   406    0.105   0.365    29%      40 48/48    27.2     312
biome / zen: 1.41x the time a tick, 2.05x the heap, 2.54x the save
```
- The debug parameter is `&world=WxH[xS]`. `S` is the surface row; it defaults to the mode's.
  The colony column is `W / 2`. No temporary `wide` mode was needed.
- Nav now keeps `maxFields`, worked out from `NAV_FIELD_BUDGET_MB` (12) and clamped to
  24–140. Zen keeps 140; 720×180 gets 48 and reaches it.
- Nav rebuild time per tick at 720×180 is about 1.5× Zen's, under the 2× trigger, so
  `NAV_REBUILDS_PER_TICK` was not added.
- The save is 312 KB, so packing was left alone.
- `WORLD_FULL_REDRAW_SHARE: 0.15` replaces the fixed 6000 in `renderWorld.js`.

---

## T9.3 [S] The Biome mode

A third button on the title screen and a mode row. After this the Biome mode plays: a
Zen colony in a world three times as wide, still flat and still meadow-coloured. The
next tickets give it its land.

**Files:** `src/modes.js`, `index.html`, `src/main.js` (only if `pickMode()` needs it),
`src/rendering/renderer.js`, `src/app/camera.js`, `tests/smoke.mjs`, `styles` (where the
title buttons are styled).

1. **The row.** Add `biome` to `MODES`, between `screensaver` and `survival` (the title
   order follows the object's key order; check `pickMode()` and the title screen use
   `Object.keys(MODES)`). Copy Zen's row and change:
   - `label: 'Biome'`, `badge: 'BIOME'`;
   - `world: { w: 720, h: 180, surface: 30, colonyX: 360 }` (adjust `w` down if T9.2's
     numbers said so; say why in the commit);
   - `frame: 'open'` (Zen and Survival get `frame: 'glass'`);
   - `land: true` (Zen and Survival get `land: false`; T9.4 onwards read it);
   - `fpsCap: 30` like Zen.
2. **The title button.** In `index.html`, in `#ms-pick .ms-options`, add
   `btn-mode-biome` between Zen's and Survival's, in the same markup:
   - name: `Biome`;
   - pitch: `The colony in the open`;
   - description: `Your colony out of the glass, in a long strip of country: woods,
     meadow, a pond, sand and stones, each with its own life. As calm as Zen.`
   Check the three buttons still fit at phone width and at 1080p (the screenshot), and
   that keyboard focus goes Zen → Biome → Survival.
3. **The frame.** With `rules().frame === 'open'`, `renderer.js` skips `_drawRoom` (the
   wall, shelf and wooden frame) and instead fills the screen with the sky colour; the
   glass edge tiles are drawn the colour of the soil next to them. This is a stand-in:
   T9.6 makes it the real land.
4. **The camera.** A 720-wide world fitted to the screen is a thin line. With
   `frame: 'open'`, `fitZoom()` fits the **height** of the world (soil and sky) to the
   screen, not the whole world, and `_clamp()` lets the camera pan along the width. Start
   the camera on `COLONY_X`. The farthest zoom-out shows the whole height; never more.
5. **Smoke test.** `tests/smoke.mjs` already runs every mode in `MODES`; make sure the
   Biome run writes its screenshots and that the `worldsize` check from T9.1 now also
   asserts `width === 720` for `?mode=biome`.

**Done when:** `npm test` passes for all three modes; the title screen shows three
buttons; Biome starts a busy colony in the middle of a wide flat world; panning reaches
both ends; Zen and Survival look as before.

**As built.**
- `land` was not added. Nothing reads it yet, so T9.4 adds it to the three rows with the
  first code that does. `frame` is in all three rows.
- The world is 720 wide, as planned: T9.2's numbers did not call for less.
- The description reads "Out of the glass, into a long strip of country: woods, meadow,
  a pond, sand and stones. As calm as Zen." The planned one wrapped to five lines in the
  narrow card. The title cards are `min(270px, (100vw - 96px) / 3)` wide. Biome's colour
  is `#8cc068`, also on the dashboard badge (`.dash-mode.biome`). The cards fit at 375,
  800 and 1920 wide with no sideways scroll, and focus goes Zen → Biome → Survival (page
  order).
- The frame: open land fills the screen with `#0a0d13` instead of drawing the room, and
  skips `_drawFrame`.
- The border tiles are not recoloured, because they are never seen. The camera's
  `_clamp()` keeps the view inside the border plus one world pixel, so rounding the
  corner never shows a sliver of it. It runs at the end of every `update()`, so the tour
  and the sliding panel are held too.
- `fitZoom()` fits the inner height exactly. Rounding up to whole pixels a tile would
  hide a sixth of the land, and that zoom is also the closest the player can zoom out.
  `HOME` is the colony column, halfway down.
- Tested: from either end at 1600×900 and 1366×768, only tiles 2–717 across and 2–177
  down are in view. The smoke test's title check now takes the cards from the mode
  table. The `moments` check now ends a moment that came on its own before forcing the
  fireflies; one that did so failed the check once.
- Perf, with Zen's frame cap and quality left as they were: cap 30 uses 62% of cap 60,
  low quality 47%, both 24%.

---

## T9.4 [S] The shape of the land: hills, banks and ponds

**Files:** new `src/simulation/land/terrain.js`; `src/simulation/world.js`,
`src/rendering/renderSky.js`, `src/rendering/effects.js`, `src/saveLoad.js`,
`src/config.js`.

1. **`terrainH`.** In `World`, beside `hillH`, add `terrainH = new Uint8Array(W)`: how
   many tiles the land stands above `SURFACE_ROW` in each column, set once when the world
   is made and never changed by the ants. In Zen and Survival it stays all zero.
2. **`lift(x)`.** Add `lift(x) { return this.terrainH[x] + this.hillH[x]; }` and use it in
   `groundRow(x)` and `groundY(xf)` instead of `hillH`. Then grep `hillH` in
   `renderSky.js` and `effects.js` (8 reads in all) and switch every read that means
   "where the ground is" to `world.lift(x)`. Reads that mean "how big is the anthill"
   (for example `hillTotal`, or drawing the mound's own colour) keep `hillH`.
3. **Making the land (`terrain.js`).** `makeTerrain(world, rng, layout)` fills `terrainH`
   and the tiles above `SURFACE_ROW`:
   - gentle hills: a sum of three sine waves with random phase, wavelengths 160, 70 and
     25 tiles, amplitudes from the biome (T9.5; before that, 0–6 tiles);
   - **the colony's ground is flat:** `terrainH` is 0 for 30 tiles either side of
     `COLONY_X`, eased in over 12 tiles, so the anthill and the entrance work as in Zen;
   - every column's raised tiles (rows `SURFACE_ROW - terrainH` to `SURFACE_ROW - 1`) are
     `TILE.SOIL` with `hardness` 255 (`CONFIG.TERRAIN_HARDNESS`); check `digTick` treats
     255 as never finishing, or add that check;
   - neighbouring columns differ by at most 1 tile, so the slope stays walkable (the same
     rule `_dropGrain` keeps for the anthill).
4. **Ponds.** A pond is a run of 24–50 columns where `terrainH` is 0, with banks of 3–5
   tiles on either side. Fill the pond's rows `SURFACE_ROW - 2 … SURFACE_ROW - 1` with
   `TILE.WATER` (the tile code already exists). Then:
   - surface walkers must not walk into it: grep `groundY`/`groundRow` users in
     `ants.js` and `creatures.js` and make a column whose ground tile is `TILE.WATER`
     impassable for ants on the surface (they turn back at the bank);
   - ants must not dig under it: `_pickSite` and `_planGallery` skip columns under a pond
     and 4 tiles either side (`CONFIG.POND_KEEP_OUT`).
   Before T9.5 there are no ponds yet; this ticket adds the code and a debug parameter
   `&pond=1` that puts one 80 tiles from the colony so it can be checked.
5. **Saves.** `terrainH` is saved with the world (one more packed array). Bump the save
   `VERSION` and add a migration that fills `terrainH` with zeros for old saves (Zen,
   Survival and early Biome saves). `tests/fixtures/` must still resume.
6. **Sky and grass.** The grass, the surface strip and the sky's bottom edge must follow
   `lift(x)`: check by eye on the hills that grass sits on the ground and sky never shows
   under it.

**Done when:** Biome has rolling hills that ants walk over, a flat home meadow, and with
`&pond=1` a pond they walk round; Zen's screenshots are unchanged; the old save fixture
loads; `npm run soak` (simulation) passes for Biome.

**As built.**
- `rules().land` is a new mode field (Biome true, the others false); `makeTerrain(world, rng, opts)` in
  `src/simulation/land/terrain.js` runs from `_generate` when it is set. `opts.ponds` lists the columns
  to put a pond's middle at; T9.5's layouts will fill it. `?debug&pond=1` gives one 80 tiles right of the colony.
- **Deviation from the plan: nothing new is saved.** `terrainH` (raised SOIL tiles, hardness
  `TERRAIN_HARDNESS` 255) and `pond` (new `TILE.POND`, `POND_DEPTH` rows of water) are read back from the tiles
  in `rebuildDerived`, as is `wet` (pond columns plus `POND_KEEP_OUT` either side). The save shape is the
  same, so no VERSION bump; old saves derive zeros and the fixture still resumes.
- `world.lift(x)` = `terrainH + pond + hillH`; `groundRow`/`groundY`, the rain, lightning and fireflies use it.
  Water is neither OPEN nor GROUND: air above it is not passable, `_surfaceStep` turns ants back at the bank,
  food and puddles skip it, galleries and prospects are never planned under `wet`, and a creature that
  reaches a pond turns round (no swimming: T9.8 may want a bridge or a drink).
- The land is drawn on the world canvas like soil (humus skin on top, soil texture, pond shine); turf,
  grass and flowers follow `terrainH`; `_lightLand` in the renderer gives it the day's sun and the night tint.
- Fixed two T9.1 misses: `renderWorld.js` and `renderAnts.js` captured `SURFACE_ROW` at module load.
- Tested: `npm test` passes; with `&pond=1` no ant stood on the pond in 15 s at 8x speed. Perf was noisy
  (Zen drew 33 fps instead of 51), so the ratios are not comparable with T9.3's.

---

## T9.5 [S] Biomes: the table and the layout

**Files:** new `src/simulation/land/biomes.js`, `src/simulation/land/layout.js`;
`src/simulation/world.js` (`_generate`, `_genHardness`, `_genRocks`), `src/config.js`,
`src/rendering/renderWorld.js`, `src/saveLoad.js`.

1. **The table.** `biomes.js` exports `BIOMES`, one row per biome. Start with five:

   | id | name | soil (base / dark / tunnel) | hardness | rocks | hills (amp) | surface |
   |---|---|---|---|---|---|---|
   | `meadow` | Meadow | today's soil colours | 1.0 | 1.0 | 0–4 | tall grass, clover, daisies |
   | `woodland` | Woodland | dark loam `#4a3424` / `#2e2016` / `#1c130c` | 0.9 | 0.7 | 2–8 | leaf litter, ferns, roots, a fallen log |
   | `pond` | Pond | wet clay `#5c5346` / `#3e382f` / `#25211b` | 1.3 | 0.4 | banks only | reeds, rushes, mud |
   | `sand` | Sand | pale sand `#c8a468` / `#a8864e` / `#8a6a3c` | 0.6 | 0.5 | 0–3 | sparse dry grass, pebbles |
   | `rocks` | Stony ground | grey-brown `#6a6058` / `#4c443e` / `#2e2a26` | 1.6 | 2.5 | 4–12 | moss, lichen, boulders |

   Each row also has `food` (a multiplier on food spawns), `dew` (on dew), `creatures`
   (T9.8), `flora` (T9.6) and `moments` (T9.9) fields; leave those as `1`, `1`, `[]`,
   `[]`, `[]` for now. Keep the colours here, not in `CONFIG`; the numbers that tune
   generation (`BIOME_MIN_W: 80`, `BIOME_MAX_W: 160`, `BIOME_BLEND: 16`) go in `CONFIG`.
2. **The layout.** `layout.js` exports `makeLayout(width, colonyX, rng)`: an array of
   `{ id, x0, x1 }` stretches that cover the strip with no gaps. The stretch containing
   `colonyX` is `meadow` and is at least 100 tiles wide, centred on the colony. The rest
   are drawn from the other four, each at most once on each side, in a seeded order, with
   one `pond` guaranteed somewhere (it is the prettiest one). It also fills
   `world.biome = new Uint8Array(W)` (the biome index per column) and
   `world.blend = new Uint8Array(W)` (0–255: how far a column is into the next biome over
   the `BIOME_BLEND` tiles at each border).
3. **The seed.** A Biome world has a `seed` (saved). All land generation uses a seeded
   random from it (`mulberry32`, added to `src/util/` if no seeded random exists yet;
   grep first). Ants and everything after generation keep using `Math.random`.
4. **Soil per biome.** In `_genHardness` and `_genRocks`, multiply by the column's biome
   `hardness` and `rocks` (blended across borders). In `renderWorld.js`, the soil,
   tunnel and chamber colours come from the column's biome, cross-faded by `blend`. Build
   a per-column colour table once at load (three colours per column), not per tile per
   frame.
5. **Zen and Survival** keep `land: false` and never call any of this: their soil is
   unchanged.
6. **Saves.** Save `seed`, `biome` and `blend` (or only the seed, and regenerate the
   layout on load from it: prefer that, it is smaller and always the same). Bump
   `VERSION` with a migration if the saved shape changes.

**Done when:** a new Biome colony shows five or more stretches of differently coloured
soil with soft borders; the colony is in meadow; two new colonies have different
layouts; a reload gives the same layout; Zen is unchanged.

---

## T9.6 [S] Dressing the land: plants, sky and fog

The art ticket. Everything here is drawing; nothing changes the simulation.

**Files:** new `src/simulation/land/flora.js`, `src/rendering/renderLand.js`;
`src/rendering/renderer.js`, `src/rendering/renderSky.js`, `src/simulation/land/biomes.js`.

1. **Flora.** `flora.js`: `makeFlora(world, rng)` returns a list of plants placed once at
   generation (from the seed, so not saved): `{ kind, x, h, sway }`. Each biome's
   `flora` field lists kinds with a density. Kinds to start: grass tuft, tall grass,
   clover, daisy, fern, reed, rush, dry grass, pebble, boulder, moss, a fallen log (one per
   woodland, 10–16 tiles long), a tree trunk at the back (woodland only, too big to climb,
   drawn behind everything). Plants are drawn on `lift(x)`, never on the anthill's crater
   (skip 4 tiles either side of `COLONY_X`).
2. **Drawing them.** In `renderLand.js`, draw plants as pixel sprites made in code (like
   the rest of the game: `fillRect` runs, no image files). Grass and reeds sway with the
   wind the sky already has (grep `wind` in `sky.js`). Cache each kind into a small
   offscreen canvas per frame of its sway (4 frames), so a frame draws only `drawImage`s,
   and only for plants on screen.
3. **The land behind.** Replace T9.3's stand-in:
   - the sky fills the screen edge to edge (call `drawSky` with the screen's width, not
     the tank's);
   - three parallax ridges behind the ground, each a silhouette made from the layout's
     biomes (tree tops over woodland, flat over sand, jagged over rocks), each paler and
     slower than the one in front (scroll factors 0.2, 0.4, 0.6), lit by the time of day
     and greyed by rain and fog the way the sky is;
   - fog over the world's two ends: the last 24 tiles fade to the sky's horizon colour,
     so the glass columns are never seen;
   - the bottom glass rows are drawn as dark bedrock fading to black.
4. **Cost.** Ridges are drawn into offscreen canvases when the layout is made and again
   only when the time-of-day tint changes enough to see (reuse the sky's palette step, if
   it has one; otherwise every 300 ticks).

**Done when:** each biome looks clearly different above ground and below; the edges fade
to fog; there is no glass or wooden frame in Biome; `npm run perf` puts Biome within
1.3 × Zen's CPU at the 30 fps cap; Zen is unchanged. Look at the screenshots at 1080p and
4K.

---

## T9.7 [S] Filming a wide world: camera and director

**Files:** `src/app/director.js`, `src/app/camera.js`, `src/modes.js`, `src/config.js`.

1. **Places.** The director already knows nest shots (chambers, the entrance, the queen).
   Add **place shots** in a land world: a stretch of the layout picked by weight
   (`CONFIG.DIRECTOR_PLACE_WEIGHT`), framed on its surface at a medium zoom, held for
   12–20 seconds. A place with something happening in it (a creature, a moment, foragers)
   is picked more often.
2. **Journeys.** Between two shots that are far apart, the camera doesn't cut: it pulls
   out to the widest zoom, glides along the strip at a steady speed
   (`CONFIG.DIRECTOR_JOURNEY_SPEED` tiles per second, eased in and out) and pushes back in.
   No journey is longer than 18 seconds; further than that, it fades through black.
3. **Foragers lead.** Now and then (1 shot in 6) the director follows a forager from the
   entrance out to wherever it is going, then holds on the place it reaches.
4. **Mode field.** These are on with `land: true` only; Zen's tour is unchanged. Add a
   `tour` field to the mode row (`'nest'` for Zen, `'land'` for Biome) if that reads more
   clearly than reusing `land`; pick one and don't check the mode name.
5. **The player.** Dragging or zooming still takes the camera from the director, as in
   Zen, and it comes back after the same idle time.

**Done when:** a 20-minute unattended Biome run (screenshots every minute, a tiny
temporary test script, not committed) shows nest shots, place shots of at least four
biomes, and at least one journey; Zen's tour behaves as before.

---

## T9.8 [S] Who lives where: creatures and the food web

**Files:** `src/simulation/creatures.js`, `src/rendering/renderCreatures.js`,
`src/simulation/land/biomes.js`, `src/simulation/world.js` (`placeFood`, dew),
`src/config.js`.

1. **Spawn tables.** Today `creatures.js` `_trySpawn` picks from one list. Give each
   biome a `creatures` list of `{ kind, weight }`, and in a land world pick the biome
   first (where on the strip), then the creature from its list. Zen keeps its one list.
2. **New creatures** (one file of art each in `renderCreatures.js`, behaviour in the
   existing creature tick where possible):
   - meadow: grasshopper (hops in arcs), ladybird (on clover), butterfly;
   - woodland: woodlouse (rolls up when an ant touches it), millipede, a snail;
   - pond: water strider (skates on the pond's surface), damselfly, a frog that sits on
     the bank and now and then snaps (never at ants in Biome: it eats a fly);
   - sand: antlion pit (a cone in the sand, still; T8.16 gives it its moment), dune beetle;
   - rocks: spider in a crevice, lizard that basks on a boulder by day.
3. **Food per biome.** `placeFood` places food weighted by each biome's `food` field:
   seeds in meadow and sand, fallen fruit in woodland, dead insects anywhere. Ants still
   find it the way they do now; a far stretch of land simply means a longer trail.
4. **Dew and water.** Dew per biome by its `dew` field. Ants can drink at the pond's edge
   (the bank column next to `TILE.WATER`), which counts like a water drop.
5. **Gentle.** In Biome no creature kills an ant, the same as Zen's rules (use the mode
   row's existing field for that, grep how Zen keeps threats harmless).

**Done when:** each biome has its own creatures in the screenshots of an unattended run;
foragers go out to more than one biome over a day; `npm run soak` (simulation) passes for
Biome; Zen's creatures are unchanged.

---

## T9.9 [S] Moments of the land

**Files:** new files in `src/simulation/moments/`, `moments/index.js`,
`src/rendering/renderMoments.js`, `src/simulation/land/biomes.js`.

1. **Asking for a biome.** A moment that belongs to a biome says so with a `biome: 'pond'`
   field. The engine (`moments/index.js`) only offers it in a land world, and only if the
   layout has that biome; `start(sim)` picks the stretch to play in and the director
   frames it (the moment's `subject`).
2. **The moments** (each in the existing row format: `id`, `title`, `weight`, `gapDays`,
   `shot`, `can`, `start`, `tick`, `subject`):
   - `pond`: **Frog chorus at dusk** (frogs on the bank, throats pulsing, ripples);
     **Dragonfly hatch** (nymphs climb a reed and split open into dragonflies);
   - `woodland`: **Leaf fall** (an autumn gust; leaves drift down and cover the litter,
     ants carry one or two); **Mushrooms after rain** (they push up overnight and are gone
     in two days);
   - `meadow`: **Wildflowers open** (a dawn time-lapse of daisies opening);
     **A butterfly lands** (and the camera follows it between flowers);
   - `sand`: **Heat shimmer** (midday; the air wobbles, ants hurry);
   - `rocks`: **The lizard basks** (it climbs the warmest boulder at noon and doesn't move
     for a minute; a beetle crosses its shadow).
   Fireflies (T2.8) prefer meadow and pond in a land world; the earthworm and the beetle
   work anywhere underground.
3. **Weather and time.** Each `can(sim)` checks time of day and weather the way the
   fireflies do. Nothing here touches tiles except the mushrooms, which are drawn, not
   placed.

**Done when:** each moment can be forced with the debug moment trigger (grep how T2.8
made it), plays and ends, and the director films it; an unattended 2-day Biome run plays
at least three different land moments.

---

## T9.10 [S] Release into the wild

**Files:** new `src/simulation/land/release.js`; `index.html` (the Biome title button and
the pause menu), `src/ui/pauseMenu.js`, `src/main.js`, `src/saveLoad.js`,
`tests/smoke.mjs`.

1. **Where the player finds it.**
   - On the title screen, when a Zen save exists and no Biome save does, the Biome button's
     description adds a second line: `Or release your Zen colony into it.` Picking Biome
     then asks (a small dialog, in `_dialogs` and the `OVERLAYS` lists, with its Tab trap)
     `Start a new colony` / `Release my Zen colony`.
   - In Zen's pause menu, a button `Release into the wild` with a confirm line:
     `Your Zen farm stays as it is. A copy of the colony starts a new life in Biome.`
     It is hidden when a Biome save exists (offer to replace it instead, with a clear
     warning).
2. **The copy (`release.js`).** `releaseZen(zenSave) → biomeSave`:
   - make a new Biome world (its seed, layout and terrain) of the Biome size;
   - copy the Zen nest's tiles (everything from `SURFACE_ROW` down, inside the glass) into
     the Biome world at the colony, offset by `dx = biome.colonyX - zen.colonyX` and
     `dy = biome.surface - zen.surface`, with every per-tile array (`tiles`, `hardness`,
     `digProgress`, `organics`, `chamberType`, `roomId`, `planRoom`, `under`, food, water);
   - the Biome world is deeper than the tank, so the rows under the copied nest are new
     soil of the meadow biome;
   - shift every ant, egg, item, chamber, project and the queen by the same offset;
   - keep the colony's stats, its name, its day count and its chronicle; log
     `The colony was released into the wild` on day one of the new world.
3. **Then** save it under the Biome key and load Biome. The Zen save is never written.

**Done when:** a smoke check releases the fixture save into Biome, the colony resumes
with the same ants and chambers in the middle of the land, and the Zen save is byte for
byte unchanged.

---

## T9.11 [S] Wars in the open (needs M8 T8.1–T8.6)

M8 puts the neighbours in a second glass farm on the shelf. In Biome they live in the
land instead.

**Files:** `src/simulation/war/rivalFarm.js`, `src/rendering/renderRivals.js`,
`src/simulation/war/army.js`, `src/modes.js`.

1. **Mode field.** `rivalSite: 'shelf'` for Zen, `'land'` for Biome.
2. **Where.** With `'land'`, the neighbours' mound is on the surface of the sand stretch
   (their tribe is the black one, which reads best on sand); if the layout has no sand,
   the farthest stretch from the colony. Their nest is not drawn underground (it is
   behind our soil's edge, so to speak); only their mound, their entrance and their
   foragers on the surface.
3. **The march.** No tube: the army walks overland along the ground line from their
   mound to our entrance, which the director films as a journey. Everything else (the
   ladder, the acts, the guarantees, the setting) is M8's, unchanged.

**Done when:** a forced level-1 war in Biome marches overland, fights on the meadow and
withdraws home; the Zen guarantees hold; Zen's shelf war is unchanged.

---

## T9.12 [S] Stability and performance pass for Biome

**Files:** `tests/soak.mjs`, `tests/perf.mjs` (or whatever `npm run perf` runs),
`tests/smoke.mjs`.

1. `npm run perf` covers Biome as well as Zen; record Biome ÷ Zen per frame cap and
   quality. It must be ≤ 1.3.
2. `npm run soak -- --mode biome` (add the flag if the soak only runs Zen) for the
   simulation soak, then the 8-hour real-time soak for Biome.
3. Check the save size after 30 days (simulation soak) is under 1.5 MB.
4. Fix what they find. Write the numbers in the commit.

**Done when:** all three pass and the numbers are in the commit message.

---

## Later (not tickets yet)

- **Digging into hillsides**, so a colony can live in a bank or under a boulder.
- **Seasons** that move through the land (leaves turn, the pond freezes).
- **A second colony** in Biome (a new queen from a nuptial flight founds a nest elsewhere
  on the strip).
- **Survival "wild" scenarios** that use a land world with real threats (flooding pond,
  marauders across the sand). Survival stays a tank in this milestone.

---

## Suggested order

1. **T9.1 → T9.3** give a playable Biome mode (wide, flat, plain). The engine work is done
   here; measure in T9.2 before anything else lands on top.
2. **T9.4 → T9.6** make it the land: shape, biomes, dressing. Ship-able after T9.6.
3. **T9.7 → T9.9** make it alive and filmed.
4. **T9.10** (release) and **T9.11** (wars, after M8) are the bridges to the other modes.
5. **T9.12** is the pass before merging.
