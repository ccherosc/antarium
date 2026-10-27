# M4 — Keeper mode (casual)

"Your farm, your way." A relaxed mode where the player feeds the colony, decorates the
farm and unlocks new items as the colony reaches milestones. The queen can't die and the
colony can't collapse, but neglect shows: hungry ants slow down, fewer eggs.

Needs M0 (`rules()`, settings, save extras, event bus). Nice to have first: T1.4, T2.3.

---

## T4.1 [H] Add the `keeper` mode

1. `src/modes.js` — add:
   ```js
   keeper: {
     label: 'Keeper', badge: 'KEEPER', cls: 'keeper',
     lifespanMult: 1.25, noStarvation: false, queenHealthFloor: 5, freeEggs: false,
     digSpeed: 2, floors: { food: 30, water: 30 }, stress: true,
     foodSpawnTicks: 900, foodScalesWithColony: false, dewScalesWithColony: false,
     autoTour: false, gameOver: false, pregrow: true, catchUp: true,
     showConditions: true, tray: true,
   },
   ```
   (Add `tray: false` to the other modes.) Check every field name against the actual
   `MODES` object — use whatever names T0.3/T1.x settled on.
2. `index.html` — a third card `#btn-mode-keeper` in `#ms-pick`, between Zen and
   Survival, pitch: "Feed, decorate and grow your own colony. Unlock new things as it
   thrives." Style in `main.css` (a green accent, like Survival has its own).
3. `src/ui/tutorial.js` — a Keeper tutorial (4 short pages: feeding, decorating, unlocks,
   camera keys). Follow how `show(mode)` picks the pages today.
4. `tests/smoke.mjs` — add `'keeper'` to MODES.
5. Dashboard badge colour for `.keeper`.

**Done when:** Keeper can be started, saved, resumed; `npm test` passes for 3 modes.

---

## T4.2 [S] Decorations: data, placement, rendering, save

**Create `src/simulation/decor.js`:**
```js
// Things the keeper puts in the farm. Positions in tile units (floats ok).
export const DECOR_KINDS = {
  pebble:  { name: 'Pebble',      w: 2, h: 2, where: 'any',     solid: true  },
  twig:    { name: 'Twig',        w: 8, h: 2, where: 'surface', solid: false },
  leaf:    { name: 'Leaf',        w: 4, h: 2, where: 'surface', solid: false },
  flower:  { name: 'Flower',      w: 2, h: 5, where: 'surface', solid: false },
  moss:    { name: 'Moss clump',  w: 5, h: 2, where: 'surface', solid: false },
  crystal: { name: 'Crystal',     w: 3, h: 4, where: 'soil',    solid: true  },
  castle:  { name: 'Tiny castle', w: 10, h: 9, where: 'surface', solid: false },
  shell:   { name: 'Snail shell', w: 4, h: 3, where: 'any',     solid: true  },
};
export class Decor {
  constructor(world) { this.world = world; this.items = []; }   // { id, kind, x, y, flip }
  canPlace(kind, x, y) { … }   // 'surface': bottom edge sits on world.groundY(x); 'soil': all covered tiles are SOIL; no overlap with other items
  place(kind, x, y)   { … }   // pushes item; if solid and in soil, world.set(tile, TILE.ROCK) for covered tiles (ants route around)
  remove(id)          { … }   // reverse of place; ROCK tiles it created go back to SOIL
  itemAt(x, y)        { … }
  save() { return this.items; }
  load(d) { this.items = d || []; /* re-apply solid tiles */ }
}
```
- Add `decor: new Decor(world)` to `createSim()` in `main.js`; it's saved through the
  `EXTRAS` list from T0.5.
- When changing tiles, do whatever `world.finishDig` does to keep derived data and
  navigation in sync (read `finishDig` and copy its refresh calls; `world.dirty = true`).
- **Rendering:** create `src/rendering/renderDecor.js` with one draw function per kind,
  pixel-art style using `ctx.fillRect` on the tile grid (look at how
  `renderCreatures.js` draws small things and copy its approach to camera transform).
  Draw surface decor after the sky/grass, soil decor with the world. Call it from
  `renderer.js` at the right layer.
- **Adding a new kind later must be easy:** one entry in `DECOR_KINDS` + one draw
  function. Write that as a comment at the top of both files.

**Done when:** from the debug console, `__pa.sim.decor.place('castle', 120, <ground>)`
draws a castle on the surface; a crystal placed in soil makes ants dig around it; both
survive save/reload; `npm test` passes.

---

## T4.3 [H] Keeper tool tray (hotbar)

**Files:** `index.html`, `styles/main.css`, new `src/ui/tray.js`, `src/ui/controls.js`
(`handleTileClick`), `src/app/input.js` (if hover position is needed).

1. A bar centred at the bottom of the screen, shown only when `rules().tray`. Slots:
   Food types (T4.4; until then just Food) · Water · each decor kind · Remove · Inspect.
   Each slot: a 32×32 icon (draw the decor with its draw function into a small canvas, or
   an emoji for food/water), name on hover, a lock icon if not unlocked (T4.5).
2. Keys **1–9** select slots; the active slot is highlighted. Selecting a slot sets
   `controls.activeTool` to e.g. `'decor:castle'`, `'food:honey'`, `'remove'`.
3. Placing decor: while a decor tool is active, show a ghost of the item under the
   cursor, green if `canPlace`, red if not; click places; **R** flips it.
4. **Remove** tool: click a decor item → `decor.remove(id)`.
5. When `rules().tray` is true, hide the old Food/Water/Inspect buttons in the side panel
   (the tray replaces them).
6. Play `playSfx('place')` (T1.3) on place, if audio exists.

**Done when:** a player can place and remove every decor kind with mouse only and with
keys 1–9 + click; `npm test` passes.

---

## T4.4 [S] Food types

**Why:** gives the keeper choices, and visibly different results.

| Kind | Look | Amount | Spoils | Effect |
|---|---|---|---|---|
| `honey` | amber drop | 40 | 0.5× | sugar: fast to collect, ants that eat it walk a little faster for a while |
| `apple` | red/green slice | 120 | 2× | big but rots quickly |
| `cricket` | brown bug | 60 | 1× | protein: queen lays faster for a day |
| `seeds` | pale grains | 50 | 0.1× | keeps for ages — stocks the granary |

1. `world.js`: add `foodKind = new Uint8Array(size)` next to `foodAmount`; `placeFood(x, y,
   amount, kind = 0)` stores it; `_tickItems` multiplies decay by the kind's spoil factor;
   `clearItem` resets it; include it in `save()/load()` (bump the save VERSION + migration
   per T0.5: old saves get kind 0 everywhere).
2. Put the table in `src/config.js` as `FOOD_KINDS` (index 0 = the current generic food).
3. Protein: when food of kind `cricket` reaches the store (find where carried food is
   added to `world.foodStore` in `ants.js` `_deliver`), add to `world.layBoost` (decays
   ~1% per in-game hour). `queen.js` multiplies the laying rate by `1 + world.layBoost`.
4. Honey speed: optional; skip if it gets complicated.
5. Rendering: draw each kind with its own colours where food tiles are drawn
   (`renderWorld.js`/`renderer.js` — grep `TILE.FOOD`).
6. Tray (T4.3) gets one slot per kind.

**Done when:** each food kind looks different, apple visibly disappears faster than seeds,
and dropping crickets raises the egg count over the next day versus not (note the numbers
in the commit).

---

## T4.5 [H] Milestones → unlocks + Collection screen

**Create `src/progress.js`** — persistent across colonies (localStorage
`pixelants_progress`), separate from saves:
```js
export const MILESTONES = [
  { id: 'first_hatch', name: 'First steps',    test: s => s.hatched >= 1,        unlock: 'pebble' },
  { id: 'pop25',       name: 'A real colony',  test: s => s.population >= 25,     unlock: 'leaf' },
  { id: 'pop50',       name: 'Bustling',       test: s => s.population >= 50,     unlock: 'food:honey' },
  { id: 'chambers5',   name: 'Architects',     test: s => s.chamberCount >= 5,    unlock: 'twig' },
  { id: 'rain',        name: 'Weathered',      event: 'rainEnd',                  unlock: 'moss' },
  { id: 'pop100',      name: 'Hundred strong', test: s => s.population >= 100,    unlock: 'food:cricket' },
  { id: 'day7',        name: 'One week',       test: s => s.day >= 7,             unlock: 'flower' },
  { id: 'flight',      name: 'Wings',          event: 'flight',                   unlock: 'shell' },
  { id: 'pop250',      name: 'Metropolis',     test: s => s.population >= 250,    unlock: 'crystal' },
  { id: 'day30',       name: 'Old friends',    test: s => s.day >= 30,            unlock: 'castle' },
  // themes can be unlocks too: unlock: 'theme:sand'
];
export function isUnlocked(key) { … }
export function checkMilestones(stats) { … }   // returns newly reached milestones
```
- `main.js`: call `checkMilestones` every ~2 s of real time in Keeper (and Zen —
  milestones there unlock themes only, if the user wants that; default: Keeper only), and
  listen to `event` milestones via `on(...)`.
- New milestone → toast "Unlocked: Tiny castle — A real colony" + `playSfx('unlock')`.
- `hatched` count: keep a counter in stats via `on('hatch')`.
- **Collection** dialog (button in the tray + pause menu): grid of every unlockable,
  locked ones as dark silhouettes with the milestone that unlocks them.
- Tray slots check `isUnlocked`.

**Done when:** a new Keeper colony starts with only Food/Water/Inspect + pebble locked
(first hatch unlocks it within a minute); the Collection shows progress; unlocks persist
after starting a new colony.

---

## T4.6 [H] Name the colony; ant cards + follow cam

1. **Colony name:** when a new Keeper colony starts, a small dialog "Name your colony"
   with a random default (`src/names.js`: combine lists like `['Amber','Moss','Clay',
   'Dusk','Honey','Root']` + `['hold','hollow','deep','haven','reach']`). Store as
   `sim.name`, saved at the top level of the save (T0.5 `getSaveInfo` returns it), shown
   in the dashboard header and resume screen.
2. **Ant names:** `antName(id)` in `src/names.js` — deterministic from the id (pick
   syllables with `id * 7919 % n`), e.g. "Tibbet", "Moru".
3. **Ant card:** with the Inspect tool, clicking within ~2 tiles of an ant (search
   `sim.antSystem.ants` for the nearest by `x/y`) shows a card instead of the tile info:
   name, role (from `ROLE`), age in days (`ant.age / CONFIG.DAY_TICKS`, check `age`'s
   unit), carrying (`CARRY`), health `hp`, and a **Follow** button.
4. **Follow:** the director already has a `_follow(ant)` shot. Add a public
   `director.followAnt(ant)` that stops the tour and keeps the camera on that ant until
   the user pans/zooms, presses Esc, or the ant dies (then toast "<name> has died" and
   stop). If this needs more than a small change to `director.js`, hand it to Sonnet.

**Done when:** click an ant → card with its name → Follow keeps it centred while it works.

---

## T4.7 [S] Soil choice for a new farm

1. "New Keeper colony" dialog (with the name from T4.6) also offers **Soil**: Loam
   (current) · Sand (soft: dig 1.6× faster, tunnels slightly wider) · Clay (hard: dig
   0.6×, but chambers never crumble). And **Theme** (T2.3) if unlocked.
2. `createSim(opts)` passes `opts.soil` to `new World(opts)`; `_genHardness()` scales by
   the soil's factor; save it in `world.save()` (save VERSION + migration).
3. Default theme per soil: sand → `sand`, clay → `clay`, loam → `classic` (player can
   change it).

**Done when:** sand farms visibly dig faster than clay over one in-game day (numbers in
commit), choice survives reload.
