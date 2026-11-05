# M8 — Wars of nature

The next phase of Zen. One morning the keeper sets a second ant farm on the shelf, joined
to yours by a clear connector tube. From then on the camera can pull back to show the whole
shelf: two glass farms, two mounds, two tribes. Every couple of weeks the neighbours march
through the tube. Most wars are a skirmish on the meadow. Now and then one is worse, and
very rarely one is a catastrophe the colony has to dig itself out of. This is the
**war ladder**, five levels of disaster. Between wars, smaller wars of nature play out on
the surface: an army-ant sweep, a ladybug among the colony's aphids, an antlion pit, a
spider wasp. Survival gets the same machinery with real stakes (last section).

Needs M2's moments engine (T2.8, T2.9). T2.13–T2.15 (life stories, music) are used when
they exist and skipped when they don't. The survival tickets need M5 (T5.1–T5.6).

---

## Product decisions (already made — don't re-decide in tickets)

- **The setting stays the shelf.** The rival is a second, smaller glass farm on the same
  shelf, to the **left** of ours, with the same height and surface row so a straight tube
  joins the two surfaces. No open-world map and no second full simulation: the neighbours
  are a *light* simulation (a nest that grows by itself, a crowd that walks it, an army
  when it marches). Our colony stays the only fully simulated one.
- **Tribes are data.** `src/simulation/war/tribes.js` has one row per tribe: palette, size,
  temper, fighting style. Three rows to start:
  | id | who | colours | style |
  |---|---|---|---|
  | `red` | our colony | today's ant colours, unchanged | — |
  | `black` | the neighbours | glossy black-brown body `#1c1a22`, blue-grey sheen `#5a6478`, pale amber mandibles `#c8a060`; far dot `#26242e` | ritual tournaments, real raids in Survival |
  | `army` | the marauders (army-ant sweep) | rust-amber `#a8501c`, dark head `#3a1a0c`, big pale jaws on soldiers | a moving carpet, never stops, never retreats |
  The neighbours' farm is filled with pale **desert sand** so black ants read on it, and so
  the two farms look different from across the shelf.
- **Wars happen in daylight and dry weather**, like real ant wars. Never at night or in
  rain. A war comes about every 12 days (`WAR_GAP_DAYS`), with scouts one or two days
  before.
- **The colony in Zen never dies.** Every level, even the worst, ends with a living queen,
  a working nest and enough ants to rebuild. The hard guarantees are listed under the
  ladder below and are tested for every level.
- **Players choose how much war they see.** The `wars` setting is a select:
  - `natural` (the default): the whole ladder;
  - `gentle`: level 1 only;
  - `off`: no wars.
- **The cinematic language**, used by every war and nature-war ticket:
  - letterbox bars ease in;
  - each act gets a chapter caption ("I · The march", "II · The clash", …);
  - the camera holds long shots and pans slowly along the front;
  - it cuts to the longest-running duel for close-ups;
  - a low drum layer comes in under the soundscape;
  - the aftermath is always a quiet, slow shot.

  Nothing shakes the screen. With reduced motion on, the bars appear without easing.
  After a level 2+ war, **the rebuild is part of the film**: the director keeps coming
  back to it over the following days.
- **Performance budget.** At most `WAR_LEVELS[n].warriors` rival agents at once: 60 at
  level 1, 160 at level 4. `npm run perf` at the peak of a forced war must stay within 10%
  of a quiet farm's ratios at levels 1–2. At levels 3–5 it must still hold the frame cap.
  Far zoom draws the war as two-colour dots.

---

## The war ladder (five levels)

When the scouts come (1–2 days before a war), the war's level is rolled and stored in
`sim.war.pending = { level, day }`. Scouts behave differently by level, so the attentive
watcher gets a warning (foreshadowing):
- at level 1 they sniff the meadow;
- at level 2+ one slips into our entrance and runs back out;
- at level 3+ the scouts come twice, and the news says "The neighbours' farm is crowded".

| L | name | Zen odds | what happens | our losses (at most) | nest damage | queen |
|---|---|---|---|---|---|---|
| 1 | **The skirmish** | ~80% | a ritual tournament on the meadow; raiders no deeper than the gate; the neighbours withdraw | 6 ants | none | untouched |
| 2 | **The breach** | ~15% | they break in through the entrance and fight down the tunnels to the nurseries; nurses race eggs to safety | 15% of ants (≤ 25) | at most **2 nursery chambers** cave in; eggs in them are lost or stolen; the colony digs them out again | untouched |
| 3 | **The flood** (ultra rare) | ~4% | a black tide pours through the whole nest in waves; fighting in every tunnel; our ants drive them out and **drag the dead to the topside** (a midden beside the mound) | 35% of ants | nurseries and up to 2 stores wrecked (≤ 5 chambers); most eggs lost; food stolen | guarded; not reached |
| 4 | **Devastation** (ultra rare) | ~0.8% | as level 3, and the fighting brings **tunnels down**; parts of the nest are cut off and must be re-dug or **re-routed**; raiders reach the queen's chamber and **attack her**; her guard drives them out | 50% of ants | 3–6 tunnel cave-ins, up to 8 chambers | attacked, health falls to the floor, **never dies** |
| 5 | **The exodus** (rarest; *suggested*) | ~0.2% | a level 4 so bad the colony **abandons its nest**: it digs a new queen chamber elsewhere, carries every egg there, and escorts the queen through the tunnels in a procession | as level 4 | as level 4, and the old queen chamber is left to collapse | walks to her new home |

> Level 5 is a suggestion: the brief asked for five levels and described four. Colony
> emigration is real ant behaviour and makes a spectacular ending. If you prefer a
> different level 5, replace T8.11 and keep the rest.

**How rare is "ultra rare"?** With a war every ~12 days and a game day of 3.84 min at 1×,
a war comes about every 46 minutes of real time:
- level 3: about 1 war in 25, roughly once a day of non-stop play;
- level 4: about 1 in 125, once in 4 days;
- level 5: about 1 in 500.

The odds are `WAR_LADDER_WEIGHTS: [80, 15, 4, 0.8, 0.2]` in `CONFIG`; tune them there.

**Gates.** A level can only be rolled when the colony can take it. When it can't, the roll
drops to the highest allowed level. The gates are in `CONFIG.WAR_LEVELS[n]`:
| L | needs |
|---|---|
| 2 | population ≥ 150, ≥ 2 nurseries, no level 2+ war in the last 10 days |
| 3 | population ≥ 300, ≥ 8 chambers, no level 3+ in 45 days, the colony has recovered from the last level 2+ (population ≥ 90% of what it was before, no rebuild project left) |
| 4 | population ≥ 400, ≥ 15 chambers, no level 4+ in 90 days, recovered |
| 5 | as level 4, the nest is at least 60 days old, and the roll is made *during* a level 4 war, once the queen's chamber has been reached |

The neighbours must also be big enough: the raid size is
`min(WAR_LEVELS[n].warriors, rival.population × WAR_LEVELS[n].share)`. If they are too
small, the level drops. Their farm visibly fills up before a big war; that is part of the
foreshadowing.

**Variety inside a level.** Every war is assembled from random choices, so no two play the
same:
- which chambers are targeted;
- whether the nurses save the brood (each egg is saved if a nurse gets it out before the
  chamber falls);
- how a level 1 skirmish goes: a ritual tournament (most), a real skirmish, or a standoff
  that lasts the afternoon with neither side giving way;
- where a tunnel caves in, and so whether the colony re-digs the old route or finds a new
  one;
- whether the queen's guards hold the chamber door (a last stand) or fight around her.

### Zen guarantees (tested for every level; Survival turns them off)
1. **The queen never dies.** The mode row's existing `queenHealthFloor` holds. Level 4
   brings her down to it and never below.
2. **Survivors.** At least `max(WAR_MIN_SURVIVORS (30), war.survivorFloor (0.5) ×
   population before the war)` ants live. Once the cap is reached, damage to our ants
   floors at hp 1 and the raiders withdraw at the next act.
3. **The queen's chamber never caves in and always stays connected to the entrance.**
   Before any tunnel collapse, check it doesn't cut her off; skip any collapse that would.
4. **At least one nursery is never touched**, so the queen has somewhere to lay.
5. **The larder** never goes below `WAR_MIN_FOOD` (enough to recover).
6. **No ant is buried alive.** Before a tile caves in, every ant and egg on it moves to the
   nearest open tile. The exception is eggs in a falling nursery: those are deliberately
   lost, and logged.
7. **Every war ends.** Each level has its own `maxTicks`. After that the raiders go home,
   and any left 600 ticks later are removed.
8. **Every wound can heal.** Every wrecked chamber gets a rebuild project, and every
   chamber cut off from the entrance gets a reconnect project.

---

## How the pieces fit

```
src/simulation/war/
  tribes.js     TRIBES table (palette, size, temper, style)
  rivalFarm.js  RivalFarm: tiles, nest growth, population, crowd   (T8.1, T8.2)
  army.js       WarSystem: warriors, tube, tunnels, fights, morale (T8.3, T8.4, T8.7)
  ladder.js     rolling a level, gates, the Zen guarantees          (T8.6)
  campaign.js   the war as acts per level; emits 'warAct'           (T8.5 onwards)
  damage.js     wreck a chamber, cave in a tunnel, rebuild, reconnect (T8.8, T8.10)
src/simulation/moments/
  scouts.js, marauders.js, aphids.js, antlion.js, spiderWasp.js, dragonflies.js
src/rendering/
  renderRivals.js   the neighbours' farm + tube (cached canvas)     (T8.1, T8.3)
  renderWar.js      warriors, duels, fallen, spray, dust, midden     (T8.4, T8.9)
```

`sim.rival` (a `RivalFarm`) and `sim.war` (a `WarSystem`) are created in `createSim()` in
`src/main.js` when `rules().rivals` is true. The rival farm is saved as a save extra
(follow the save rules in `src/saveLoad.js`: bump `VERSION`, add a migration).

**A war in progress is not saved.** On load, any war that was running is gone: its
warriors vanish, as if the neighbours had withdrawn. What the war *did* is saved, because
it is in the world: wrecked tiles, rubble, rebuild projects, the midden, lost ants and
eggs.

Coordinates are **our world's tile coordinates**. The neighbours' farm lives at negative x
(`RIVAL_X0` to `RIVAL_X0 + RIVAL_W`), so the camera, the director and `worldToScreen` work
unchanged.

Our ants fight with the code they already have. `antSystem.recruit(ant, target)` and
`_defend` in `ants.js` work on "anything with `x`, `y`, `hp`, `dead`, `gone`,
`foodChunks`". T8.3 changes `_defend`'s one `cs.damage(c, dmg)` call to
`(c.owner ?? cs).damage(c, dmg)`, so a warrior (whose `owner` is the `WarSystem`) takes the
hit through `WarSystem.damage`. T8.7 teaches `_defend` to chase underground.

What the nest code already gives us (read before T8.7–T8.11):
- **Chambers** are `world.chambers[]`, each with `tiles`, `type` (`ROOM`), `built`.
  `roomId`, `chamberType` and `planRoom` are per-tile arrays.
- `_roomsChanged()` recomputes the nurseries, stores and capacities.
- **Dig projects** (`world.projects`, saved) are made with `_addProject(kind, path, room,
  plan)` and finished in `_completeProject` (`'gallery'` → `ch.built`).
- `_soilPath(sources, isGoal, opts)` finds a dig route.
- `_touchesNest(i)` only checks that a tile has an open neighbour below the surface. It
  does **not** check that the neighbour is connected to the entrance; reconnect needs that
  (use `nav.entrance().dist[j] < FAR`).
- `world.set(x, y, SOIL)` closes a tile and fixes `passable`. **Then call
  `world.nav.closed(i)`** for it, which marks every field for rebuild. `nav.opened(i)`
  only stitches tiles that open.
- **Eggs** are `antSystem.eggs[]` objects with `room` (a chamber id). Nurses carry them
  with `CARRY.EGG` (`FETCHING_BROOD` / `CARRYING_BROOD` states).
- The **queen** has `health`, floored by the mode row's `queenHealthFloor` (Zen 5,
  Survival 0). It recovers on its own towards a target (`queen.js` ~line 53).

---

## T8.1 [S] The neighbours' farm on the shelf

**Files:** new `src/simulation/war/rivalFarm.js`, `src/rendering/renderRivals.js`; plus
`config.js`, `modes.js`, `main.js`, `saveLoad.js`, `app/camera.js`, `app/director.js`,
`rendering/renderer.js`, `tests/smoke.mjs`.

1. **Config.** All of these go in `CONFIG`:
   - `RIVAL_W: 120` (tiles wide; same `WORLD_HEIGHT` and `SURFACE_ROW` as ours);
   - `RIVAL_GAP: 40` (tiles of shelf between the two frames);
   - `RIVAL_X0: -(RIVAL_W + RIVAL_GAP)`;
   - `RIVAL_ARRIVES_DAY: 6` (the Zen day the keeper brings it);
   - `RIVAL_GROW_TICKS: 2400` (a growth step every this many ticks);
   - `RIVAL_POP_PER_CHAMBER: 25`.
2. **Mode row.** Add `rivals: true` to `screensaver` and `rivals: false` to `survival`
   (T8.20 turns it on).
3. **`RivalFarm`.**
   - `constructor(seed)`: `tiles = new Uint8Array(RIVAL_W * WORLD_HEIGHT)`, using the same
     `TILE` codes. Sky above `SURFACE_ROW`, SOIL below, glass at the edges. It starts with
     a small founding nest: an entrance shaft at the middle, and one chamber 12 rows down
     with the queen in it.
   - `update()`: every `RIVAL_GROW_TICKS` it grows one step, using a small seeded random
     (`mulberry32(seed)` style, kept in the state so a reload grows the same way). A step
     is one of:
     - a tunnel branch: a random walk 6–14 tiles long from an existing tunnel tile,
       mostly down and sideways, that never breaks the glass;
     - every third step, a chamber: an ellipse 5–9 wide and 3–4 tall at the end of a
       branch.

     Set `dirty = true` after each step.
   - `population = 20 + chambers × RIVAL_POP_PER_CHAMBER`, capped at 1.3 × ours.
     (Big wars need a big neighbour; see the ladder's gates.)
   - `save()` / `load()`: the seed, the growth count, the random's state and `pending`
     (the rolled war level). Tiles are **not** saved; they are regrown from the seed on
     load (faster than storing them, and always the same). Store it as a save extra.
4. **Arrival.**
   - In Zen, when `stats.day` reaches `RIVAL_ARRIVES_DAY` and there is no `sim.rival` yet,
     create it. Grow it at once to match our colony: one step per 2 of our chambers.
   - Then `logEvent('The keeper set a second farm beside yours')` and
     `emit('rivalArrived')`.
   - A save from before this ticket gets its neighbour the same way on its next day, so
     the migration just leaves it out.
5. **Drawing (`renderRivals.js`).**
   - Draw the second farm in `renderer.js` after `_drawRoom` and before our farm, and only
     when any of it is on screen.
   - It has a wooden frame and plinth like ours (reuse the `box`/`ring` helpers: lift them
     out of `_drawRoom` into module functions taking the frame's x-offset rather than
     copying them).
   - The soil is desert sand: base `#c8a468`, tunnels `#8a6a3c`, chambers `#7a5c32`.
   - Its sky is ours: call `drawSky` and `drawSurface` from `renderSky.js` with a camera
     offset or clip rectangle for the rival box. If they are hard-wired to our world's
     width, give them an optional `{x0, w}` and keep today's call unchanged.
   - Cache the soil and tunnels in an offscreen canvas at 1 px per tile. Redraw it only
     when `dirty`, then scale it with `imageSmoothingEnabled = false`.
   - The brass plate reads "T H E   N E I G H B O U R S".
6. **Camera.**
   - `_clamp` lets x reach `RIVAL_X0 - 10` when `sim.rival` exists. Pass a `leftBound`
     into the camera; the camera does not import the simulation.
   - Add `fitShelf()`, the zoom that shows both farms frame to frame, with the same
     pixel-even rounding as `fitZoom`.
   - Home and `fitWorld` stay our farm.
7. **Director.**
   - New wide shot `shelf`, titled "The neighbours". Weight 0.6 in daylight, 0.3 at night.
     It goes to `fitShelf()` centred between the farms and holds 14 s.
   - On `rivalArrived`, queue it as news with the title "A second farm on the shelf".
     Start it zoomed in on our farm and ease out to the whole shelf over 6 s: that is the
     reveal.
8. **Test.** Add a smoke check `rivals`:
   - `?debug&new&mode=screensaver`; force the arrival (`__pa.sim` day hook or a
     `forceRival()` on the sim).
   - Check the farm exists, has a chamber and has population > 0.
   - Save, reload, and check the same tiles come back (compare a hash of `tiles`).
   - Force the `shelf` shot and take the screenshot `rivals-shelf.png`. Look at it: two
     farms, one tube gap, and our farm unchanged.
   - Run `npm run perf`; the ratios must hold.

**Done when:** a Zen colony on day 6 gets a neighbour, the camera reveals the shelf, the
neighbour grows over days and survives a reload unchanged; `npm test` passes.

---

## T8.2 [S] Tribes and the neighbours' crowd

**Files:** new `src/simulation/war/tribes.js`; `rivalFarm.js`, `renderAnts.js`,
`renderRivals.js`, `tests/smoke.mjs`.

1. **`TRIBES`** in `tribes.js`, rows as in the product decisions. Each palette has the keys
   `body`, `head`, `sheen`, `shadow`, `jaw`, `eye`, `far`, `load`. The `red` row holds
   **exactly today's colours** from `renderAnts.js`: lift each hard-coded `fillStyle`
   into it.
2. **`renderAnts.js`.**
   - `drawAntFar`, `drawAntTiny`, `drawAntMid` and `drawAntClose` take a `pal` argument
     (default `TRIBES.red.palette`) and use it instead of literals.
   - Export a `drawTribeAnt(ctx, sx, sy, angle, zoom, lod, pal, frame, pose)` that picks the
     LOD the same way `renderAnts` does. `pose` is `'walk' | 'grapple' | 'fallen' |
     'carry'`. 'fallen' draws the ant on its back with the legs curled up; 'carry' draws
     it with something in its jaws (an egg, a pellet, or a body).
   - Our colony's screenshots must not change: compare `screensaver.png` before and after.
3. **The crowd.**
   - `RivalFarm` keeps up to `RIVAL_CROWD` (40) cheap walkers: `{x, y, dir, t}` on the
     farm's TUNNEL and CHAMBER tiles and its surface strip.
   - Every 2 ticks each walker steps to a random open neighbour, preferring the way it was
     going. A few walk the surface and back into the mound.
   - Their number is `min(RIVAL_CROWD, population / 4)`. Before a level 3+ war it is
     `RIVAL_CROWD × 1.5`: the farm *looks* crowded.
   - Draw them with `drawTribeAnt` and the `black` palette, plus their queen in her chamber
     (a still queen with a slow breathing scale, nothing more).
4. **Test.** In `rivals`, check the walkers stay on open tiles over 2000 ticks (none ever
   on SOIL) and have finite positions. Take a close screenshot `rivals-crowd.png` at
   zoom 4 in their chamber.

**Done when:** from the shelf shot the neighbours' farm visibly lives; up close their ants
are black and ours look exactly as before.

---

## T8.3 [S] The tube, warriors and the scouts

**Files:** new `src/simulation/war/army.js`, `src/simulation/moments/scouts.js`;
`ants.js` (one line in `_defend`, one in `_kill`), `renderRivals.js`, `config.js`,
`tests/smoke.mjs`.

1. **The tube.**
   - It runs level from the neighbours' right glass (`RIVAL_X0 + RIVAL_W`) to our left
     glass (`0`), centred on row `SURFACE_ROW - 2`, 3 tiles across. It passes through a
     collar in each frame.
   - Draw it as pale glass: a translucent `rgba(200,225,240,0.18)` body, a 1 px highlight
     along the top, a darker rim along the bottom, and brass collars.
   - The tube mouth inside our farm is at `x = GLASS_THICKNESS`. Warriors step out of it
     onto `world.groundY(x)`.
2. **`WarSystem`** (`sim.war`).
   - It holds `warriors[]`. A warrior is:
     ```
     {id, tribe, x, y, ang, hp, maxHp, state, foe, t, target, inTube, carry, owner: this,
      dead, gone, foodChunks}
     ```
   - `state` is one of `march | wander | fight | grapple | raid | carry | flee | home |
     fallen`.
   - `update(sim)`:
     - **Tube:** move along the tube centre line at `WAR_MARCH_SPEED` (0.12 tiles/tick)
       with a little sideways jostle. Warriors queue rather than overlap: keep 0.8 tiles
       to the one ahead.
     - **Our meadow:** walk the surface like a creature does (`y` eases to `groundY`).
     - **Inside the neighbours' farm:** follow the crowd tiles to the mound and the tube.
     - Tunnels come in T8.7.
   - `damage(w, dmg)` sets `hp`, `hitFlash`, and on 0 makes it `fallen` with
     `foodChunks = 1`. A fallen warrior lies still for `WAR_FALLEN_TICKS` (1800), then is
     `gone`, unless T8.9 has it carried off first.
   - It keeps nothing after a war: every warrior ends `gone` and the array empties.
3. **`ants.js`**, two one-line changes:
   - In `_defend`, `cs.damage(c, …)` becomes `(c.owner ?? cs).damage(c, …)`.
   - In `_kill`, the `death` event gains the ant's position: `emit('death', { cause, x,
     y })`, so T8.4 can lay a body where it fell. Check that the `events` smoke check
     still passes.
4. **Recruiting our defenders.**
   - `WarSystem` recruits the way `CreatureSystem._alertAnts` does. While warriors are on
     our meadow it calls `antSystem.recruit(ant, warrior)` for surface ants, and for deep
     ants once `world.alarmLevel > 0.4`.
   - The cap is `min(WAR_MAX_DEFENDERS, 1.2 × warriors on our side)`.
   - Raise `world.alarmLevel` the way creatures do.
   - Read `_alertAnts` and share a helper rather than copying the loop.
5. **Moment `scouts`** ("Scouts from the neighbours"; weight 2, gapDays 4; `can`: a
   neighbour exists, daylight, clear, and no war in the next day).
   - 2–3 warriors leave the neighbours' mound, cross the tube and `wander` our meadow for
     `MOMENT_SCOUT_TICKS` (2400), sniffing near our mound.
   - If one of our ants touches one, they face off: a 60-tick grapple, after which both let
     go and the scout runs home.
   - The scouts go home, and the moment ends when the last is back in its mound.
   - `subject` is the lead scout.
   - Draw them with the T8.2 helper.
   - From T8.6 on, this is also where the next war's level is rolled, and where scouts
     behave by level.
6. **Test.** Add a smoke check `war`. Force `scouts`, wait for it to end, then check:
   - no warrior is left;
   - none had a non-finite position;
   - no tiles changed;
   - the director filmed it (`moment:scouts`).

   Screenshot `war-scouts.png`.

**Done when:** scouts come through the tube, meet our ants, go home, and leave nothing
behind.

---

## T8.4 [S] Fights that read in pixels

**Files:** `army.js`, new `src/rendering/renderWar.js`, `effects.js` (if its particles
fit), `config.js`, `tests/smoke.mjs`.

What makes an ant war read on screen is *contact*: pairs locked together, knots of ants
pulling one enemy apart, bodies left on the field. Build these four:

1. **Duel (`grapple`).**
   - When a warrior and one of our ants are within 1.3 tiles, they lock.
   - The two face each other, jaws to jaws. Each tick they jitter ±0.15 tiles and turn
     ±10°, out of phase with each other.
   - The duel lasts `rand(WAR_DUEL_TICKS)` ([90, 240]). It ends one of three ways:
     - one side lets go and backs off: the **ritual** ending (chance `war.ritual`);
     - one side takes `WAR_DUEL_DAMAGE`;
     - a third ant joins, and it becomes a gang-up.
   - Our ant is held with `ant.pause` for the duel's length and turned toward its foe.
2. **Gang-up (spread-eagle).**
   - With 2–4 of our ants on one warrior, place them at even angles around it, each tugging
     outward (an offset that pulses).
   - The warrior can't move. Damage is per ant, so a gang-up usually ends in `fallen`.
   - This is the shot the director wants most.
3. **Formic spray and dust.**
   - **Spray:** in a duel, now and then one side curls its gaster forward and puffs 3–5
     yellow-green (`#c8d860`) pixels that arc 1–2 tiles and fade over 20 frames.
   - **Dust:** every lock and every fall kicks up 4–6 soil-coloured pixels.
   - Use `effects.js` if it has a particle list that fits; otherwise keep a small ring
     buffer in `renderWar.js`. Effects are draw-only and never saved.
4. **The fallen.**
   - A fallen warrior is drawn on its back in grey-black, legs curled.
   - Our ants that die in a fight (the `death` event with `cause: 'fight'`) leave a fallen
     red body there too: WarSystem keeps `bodies[]` (x, y, tribe, t) and drops them after
     `WAR_FALLEN_TICKS`.
   - On the meadow, our foragers carry fallen enemies home as food (`_feast` already does
     this).
   - Rival retreaters pick up their own dead: a `carry` warrior drags a body back through
     the tube.
5. **LOD.** At `far` LOD draw everything as tribe-coloured dots, with a duel as two
   touching dots. At `mid`, simplified poses. `close` gets the full poses.
6. **Test.** Extend `war`:
   - Force a duel between one warrior and one ant (a `force('duel')` hook on WarSystem for
     the test), run 600 ticks, and check it ended (lock released, both finite, at most one
     fallen).
   - Force a gang-up of 3 on 1: the warrior is fallen within 600 ticks, and a forager
     eventually feasts on it (`foodChunks` drops to 0).
   - Screenshots `war-duel.png` and `war-gangup.png` at zoom 6.

**Done when:** a duel and a gang-up are unmistakable at close zoom, and the war still reads
as two colours at the shelf wide shot.

---

## T8.5 [S] The war as a film: acts, letterbox, shots

**Files:** new `src/simulation/war/campaign.js`, `director.js`, `renderer.js` (letterbox),
`hud.js` (chapter captions use the existing caption), `config.js`, `tests/smoke.mjs`.

This ticket builds the film machinery and **level 1's** script. Each later level adds its
own acts to the same table.

1. **The campaign is a moment row** (`id: 'war'`, title "War on the shelf", weight 1,
   `gapDays: WAR_GAP_DAYS` (12); `can`: a neighbour exists, the `wars` setting isn't
   `off`, daylight before noon, clear, scouts came within the last 3 days). The moments
   engine then guarantees one at a time and no clash with floods.
2. **Acts.** The campaign runs a list of acts, `SCRIPTS[level]`. Each act is
   `{ id, caption, enter(war, sim), tick(war, sim) → done?, shot }`, and entering an act
   emits:
   ```
   emit('warAct', { act, level, title, x, y, tall, dur, subject })
   ```
   Level 1's script:
   | act | caption | what happens | shot |
   |---|---|---|---|
   | `march` | "I · The march" | the army pours out of the neighbours' mound and through the tube | `shelf` wide, held, then a slow track along the tube with the head of the column |
   | `clash` | "II · The clash" | the front meets our defenders near the tube mouth; duels and gang-ups | a slow pan along the front, then a cut to the longest-running duel, then the biggest gang-up |
   | `gate` | "III · At the gate" | (only if warriors reach our mound) defenders pour out of the entrance; warriors go no deeper than `WAR_LEVELS[1].maxDepth` rows (2) | close on the entrance |
   | `retreat` | "IV · The retreat" | morale breaks (alive / started < `WAR_MORALE_BREAK` 0.45, or the level's `maxTicks`); warriors turn `home`, carrying their dead | the tube, watching them go |
   | `after` | "The field" | bodies lie, our foragers carry the enemy dead in; quiet | one long, slow pan across the meadow (`dur` 20) |

   Level 1's variety comes from the `clash` act, which picks one of these at random:
   - `tournament` (weight 6): duels mostly end ritually;
   - `skirmish` (weight 3): real fighting, a handful fall;
   - `standoff` (weight 1): both lines face each other and grapple for a long afternoon,
     until dusk sends them home.
3. **Director.**
   - `on('warAct', …)` queues the shot as **urgent** news: it skips `DIRECTOR_NEWS_HOLD`
     and replaces whatever news is waiting.
   - While a war runs (`director.cinematic = true`) the tour picks no other shots. Between
     acts it may fill with `follow` shots of a defender (`ant.state === STATE.DEFENDING`).
   - Pick the "longest-running duel" and the "biggest gang-up" from WarSystem getters, not
     by scanning in the director.
4. **Letterbox.**
   - While `director.cinematic` is true, the renderer draws a black bar top and bottom,
     each 7% of the screen height, eased in over 1.2 s (instant with reduced motion).
   - Captions sit just above the bottom bar.
   - The bars are drawn last, over everything, and not into photo mode (T2.4) captures.
5. **Log.** Each act gets one `logEvent`. The last one reads "The neighbours withdrew.
   N of theirs fell, M of ours." Record the war in `stats.wars`:
   `{day, level, theirs, ours, eggs, chambers}`.
6. **Test.** In `war`, `force('war', { level: 1 })` and drive it with the `finish()` helper
   from the moments check (speed 0, tick the engine), then check:
   - the acts fired in order (`gate` may be skipped);
   - every warrior is gone at the end;
   - `stats.wars` has one entry;
   - the director filmed `march` and `clash` (watch `director.shot.kind`).

   Screenshots `war-march.png` and `war-clash.png` with the letterbox.

**Done when:** a forced level 1 war plays as a short film from march to field, in
letterbox, and ends with nothing left over.

---

## T8.6 [S] The ladder, the Zen guarantees and the setting

**Files:** new `src/simulation/war/ladder.js`; `modes.js`, `settings.js`, `index.html`
(`#settings` row), `config.js`, `scouts.js`, `campaign.js`, `army.js`, `tests/smoke.mjs`,
`tests/soak.mjs`.

1. **Config.**
   - `WAR_LADDER_WEIGHTS: [80, 15, 4, 0.8, 0.2]`.
   - `WAR_LEVELS`: one row per level, `[1..5]`, with the gates from the ladder table and
     the numbers below. Every later ticket reads its numbers from its row; add fields
     there, not new constants.
     ```js
     { warriors, share, maxDepth, lossCap, lossShare, maxTicks,
       minPop, minChambers, gapDays, needsRecovered,
       nurseries, stores, chambers, tunnels, eggShare, foodShare }
     ```
   - `WAR_MIN_SURVIVORS: 30`, `WAR_MIN_FOOD`.
2. **Mode row `war`:**
   ```js
   // screensaver
   war: { maxLevel: 5, survivorFloor: 0.5, ritual: 0.7, alwaysWithdraw: true, guarantees: true }
   ```
   Survival gets `war: null` until T8.20. The queen's floor is the existing
   `queenHealthFloor`.
3. **`ladder.js`.**
   - `rollLevel(sim)`:
     - weight each level by `WAR_LADDER_WEIGHTS`;
     - zero any level above `rules().war.maxLevel`, above 1 when the setting is `gentle`,
       or whose gates fail;
     - pick one.

     Level 5 is never rolled here (T8.11 rolls it during a level 4 war).
   - `gates(sim, n)` returns the first gate that fails, as a string (for the debug read-out
     and the tests), or `null`.
   - `guard(sim)` is called by `WarSystem` every tick while a war runs. It enforces the
     Zen guarantees that are about *ants* (2, and 7's timeout). Later tickets add theirs
     here: queen (T8.10), food (T8.9), tiles (T8.8, T8.10). Keep every guarantee in this
     one file, so it is easy to read what Zen promises.
   - `stats.recovered` is true when the population is ≥ 90% of what it was before the last
     level 2+ war and no `'rebuild'` / `'reconnect'` project is left.
4. **Scouts by level.**
   - `scouts.start` rolls the level into `sim.war.pending`.
   - Level 2+: one scout runs into our entrance, 6 tiles down, and back out.
   - Level 3+: a second scout visit is scheduled for the next morning, and the news says
     "The neighbours' farm is crowded".
   - The `war` campaign plays `pending.level` (default 1). Until T8.7–T8.11 exist, any
     level above 1 plays as level 1; leave a `// T8.7:` comment where each level plugs in.
5. **Setting `wars`.** A select, `natural | gentle | off`, default `natural`. Its row in
   `#settings` is "Ant wars" (`data-setting="wars"`). The `settingsmenu` check wants the
   row to work: switching to `off` stops a running war at its next act (straight to
   `retreat`); `gentle` only affects the next roll.
6. **Stories.** If T2.13's story keeper exists, a defender that fought gets the beat
   "fought the neighbours on day N", and one that fell gets "fell defending the gate on
   day N". If T2.13 doesn't exist yet, leave a `// T2.13:` comment where it plugs in.
7. **Fair growth.** After a war the neighbours' population drops by the warriors that
   fell, and grows back over the next days (fewer growth steps until it has).
8. **Test.**
   - `rollLevel` over 100,000 rolls on a big recovered colony is within 1% of the weights.
   - A 40-ant colony always rolls 1.
   - `gentle` always rolls 1, and `off` makes `can` false.
   - Force 3 level 1 wars back to back. Each time, check our deaths ≤ `lossCap`, no warrior
     ever goes below `SURFACE_ROW + maxDepth`, the queen is untouched, and nav to the queen
     still works.
9. **Soak.** Add `--wars` to `tests/soak.mjs` (day mode): it forces a war every 2 days,
   cycling levels 1→5 (each level falls back as far as its tickets allow). Run
   `npm run soak -- --mode screensaver --days 30 --wars`; heap and ms/tick must pass as
   they do now.

**Done when:** the level is rolled at the scouts, the gates and weights hold, the setting
works, and a 30-day soak with wars passes.

---

## T8.7 [S] Level 2 groundwork: war in the tunnels

**Files:** `army.js`, `ants.js` (`_defend`, brood evacuation), `nav.js` (one new field),
`campaign.js`, `config.js`, `tests/smoke.mjs`.

1. **Raiders underground.**
   - A `raid` warrior goes in at the entrance and walks the tunnels toward its `target`
     chamber by stepping down `nav.room(id).dist`. To leave, it climbs `nav.entrance()`.
   - Grep how `_defend` follows `nav.entrance()` and reuse the same field-stepping helper;
     don't write a second one.
   - Underground warriors draw like ants do underground (same depth shading).
2. **Defenders underground.** One shared field, not one per warrior.
   - Add `nav.war(sources, ver)`, built like `_fEnt`. Its sources are the tiles of every
     underground warrior.
   - `WarSystem` bumps `ver` every `WAR_FIELD_TICKS` (30), so the field rebuilds at most
     that often.
   - In `_defend`: when the target is underground (`target.y >= SURFACE_ROW`), step
     *down* `nav.war()` instead of up the entrance. When it is on the surface, keep
     today's code.
   - Contact and fighting are unchanged (T8.4's duels work in a tunnel).
   - A tunnel is one tile wide, so a duel in it **blocks it**. Let that happen: it makes
     the chokepoint fights that read so well ("the tunnel held").
3. **Brood evacuation.**
   - When a nursery is a raid target and raiders are inside the nest, the nurses in that
     nursery switch to `FETCHING_BROOD` for its eggs, and carry them to the safest nursery:
     the one furthest from any raider by `nav.war()` distance, never a target.
   - Reuse the existing fetch/carry states; only the choice of egg and destination is
     new. An egg carried out is safe.
   - This is real ant behaviour and the most touching shot of a breach: the director
     follows one nurse with an egg ("The nurses save the brood").
4. **Level 2's script.** Add to `SCRIPTS[2]`: `march`, `clash`, then:
   | act | caption | what happens | shot |
   |---|---|---|---|
   | `breach` | "III · The breach" | up to `WAR_LEVELS[2].warriors × 0.5` warriors go `raid`; targets are 1–2 random nurseries (never the last one, guarantee 4) | close on the entrance as they pour in, then follow the lead raider down |
   | `tunnels` | "IV · In the tunnels" | the fight follows them down; evacuation runs | chokepoint duel; a nurse with an egg |
   | `nursery` | "V · The nursery" | the raiders reach the nursery; T8.8 resolves it | close on the chamber |
   then `retreat` and `after`. Until T8.8, `nursery` ends with the raiders driven out and
   no damage.
5. **Test.**
   - Force a level 2 war. Check:
     - raiders enter and leave;
     - no warrior or ant is ever on a non-passable tile;
     - every warrior is gone at the end;
     - nav to the queen still works.
   - With a nursery targeted, check at least one egg is carried to another nursery.
   - Screenshots `war-breach.png` and `war-tunnels.png`.

**Done when:** raiders fight their way down the tunnels and back out, defenders chase them
underground with one shared field, and nurses carry eggs to safety.

---

## T8.8 [S] Level 2: the nursery falls, and the colony rebuilds

**Files:** new `src/simulation/war/damage.js`; `world.js` (rubble, a `rebuild` project
kind), `saveLoad.js` (VERSION bump + migration), `renderer`/tile drawing (rubble),
`ladder.js`, `campaign.js`, `director.js`, `tests/smoke.mjs`.

1. **Rubble.**
   - Add `world.rubble = new Uint8Array(N)`, saved with `pack()` like the other per-tile
     arrays. Bump the save `VERSION` and add a migration that fills it with zeros.
   - A rubble tile is SOIL with `rubble[i] = 1` and `hardness[i] = WAR_RUBBLE_HARDNESS`
     (low, so it digs ~3× faster; `digTick` already uses hardness).
   - Draw rubble as loose, darker soil with lighter speckles. Its look fades as it is
     dug, and goes when `finishDig` clears the flag.
2. **`wreckChamber(sim, ch, frac)`** in `damage.js:`
   - Pick `frac` (0.5–0.8) of the chamber's tiles, top rows first (the ceiling comes
     down).
   - Move every ant on those tiles to the nearest open tile (guarantee 6). Eggs with
     `egg.room === ch.id` still in the chamber are lost: remove them the way hatching
     does, and count them for the log. Raiders `carry` some home first (brood theft;
     `WAR_LEVELS[n].eggShare` of them, at most 6).
   - For each picked tile:
     - `world.set(x, y, SOIL)`, `rubble = 1`, low hardness;
     - `roomId = chamberType = 0`;
     - `world.nav.closed(i)`;
     - a dust burst.

     Spread this over ~2 s of ticks, top to bottom, so the cave-in is *seen*.
   - The chamber's remaining tiles stay open. Set `ch.tiles` to just those, and
     `ch.built = false`.
   - Ants whose `home` was this chamber call `_pickHome` again.
   - Call `world._roomsChanged()`.
3. **`rebuild(sim, ch)`.**
   - Set `planRoom[i] = ch.id + 1` for every SOIL tile of the chamber's original oval
     (`_ovalTiles(ch.cx, ch.cy, ch.rx, ch.ry)`).
   - Add a project with kind `'rebuild'` and that plan. Its path comes from `_soilPath`
     from the plan tiles to a tile connected to the entrance; it may be empty when the
     plan already touches the nest. Check `_refreshFrontier` copes with an empty path;
     if not, use the first plan tile.
   - In `_completeProject`, treat `'rebuild'` like `'gallery'`, with the log "The
     nursery is dug out again" (or the room type's name).
   - Rebuilds come first: give them crew `cap: 6`. In `_updateProjects`, don't start new
     galleries while a rebuild is short of diggers.
   - **Recovery:** for `WAR_RECOVERY_DAYS` (3) after a level 2+ war, the queen lays
     `WAR_RECOVERY_LAY` (1.4×) faster. That is real ant behaviour, and it makes the
     colony come back.
   - Rebuild projects are saved with the other projects, so a reload mid-rebuild just
     carries on.
4. **Level 2's `nursery` act.**
   - The nursery falls if the raiders hold it (≥ 3 raiders inside, more raiders than
     defenders) for `WAR_WRECK_TICKS` (240). Otherwise the defenders drive them out and
     it stands.
   - Either way, at most `WAR_LEVELS[2].nurseries` (2) chambers fall.
   - Add the tile guarantees to `ladder.guard`: never the queen chamber, never the last
     untouched nursery.
5. **The rebuild in the film.** After a level 2+ war:
   - for `WAR_RECOVERY_DAYS`, the director has a shot `rebuild` (weight 3), titled
     "Rebuilding the nursery". It follows a digger on a `'rebuild'` project's frontier;
   - news when each rebuild finishes;
   - when the last finishes and `stats.recovered` is true, the news reads "The colony is
     whole again".
6. **Test.**
   - Force a level 2 war with the `nursery` act set to fall (`force('war', { level: 2,
     fall: true })`). Check:
     - ≤ 2 chambers lost;
     - the queen chamber is untouched;
     - no ant is on a non-passable tile;
     - rubble tiles exist;
     - a `'rebuild'` project exists;
     - run 2 game days: the chamber is `built` again and `rubble` is cleared there.
   - Save mid-rebuild, reload: the project and rubble come back.
   - The `tests/fixtures/` old save still resumes.
   - Screenshots `war-nursery-falls.png` and `war-rebuild.png`.
   - Run the soak (the nest changed).

**Done when:** a breach can bring down up to two nurseries, the cave-in is visible, eggs
are lost or saved, and the colony digs the rooms out again within a couple of days.

---

## T8.9 [S] Level 3: the flood, and the dead carried to the topside

**Files:** `army.js` (waves), `campaign.js`, `damage.js`, `ants.js` (a body-carrying
state), `world.js` (`midden`), `renderWar.js`, `saveLoad.js` (VERSION bump),
`ladder.js`, `tests/smoke.mjs`.

1. **The flood.**
   - Raiders come in 3 waves, `WAR_WAVE_TICKS` (900) apart, up to
     `WAR_LEVELS[3].warriors` (140) in all.
   - Targets are spread over the whole nest: nurseries, up to 2 stores and generic
     chambers, ≤ `WAR_LEVELS[3].chambers` (5) in all. The queen chamber is never a target
     at level 3.
   - Every target uses T8.8's fall rule.
   - **Stores:** raiders that hold a store carry food home (black ants with pellets going
     back through the tube). Take it off `world.foodStore`, at most `foodShare` (40%) and
     never below `WAR_MIN_FOOD` (guarantee 5, added to `guard`). The store piles shrink
     on their own because they come from `foodStore`.
   - All deep ants are recruited. The cap on our losses is `lossShare` (35%), floored by
     guarantee 2.
2. **Carrying the dead to the topside.**
   - Underground bodies (both tribes, `war.bodies` with `y >= SURFACE_ROW`) are carried
     out. Add a state `CARRYING_BODY` (the next free `STATE` id; grep `STATE` in
     `config.js`) and `CARRY.BODY` (5).
   - An idle or returning worker near a body picks it up, climbs `nav.entrance()`, walks
     the surface to the **midden**, drops it, and goes back to work. Model it on
     `_feast`'s carry-home code, read first.
   - The midden is a column `WAR_MIDDEN_DX` (10–16) tiles from `COLONY_X`, on the side
     away from the tube.
   - `world.midden`: `[{x, tribe, t}]`, at most 60, saved (bump `VERSION`, add a
     migration with `[]`). It is drawn as a little heap of tribe-coloured bodies on the
     ground and fades after `WAR_MIDDEN_DAYS` (3).
   - Surface bodies on the meadow are still carried *in* as food, as in level 1.
3. **Level 3's script:**
   | act | caption | shot |
   |---|---|---|
   | `march` | "I · The march" (a longer column) | shelf wide, then the tube |
   | `flood` | "II · The flood" | **the nest wide shot**: the whole farm at mid zoom, a black tide spreading through red tunnels. This is the money shot; hold it 16 s |
   | `tunnels` | "III · Fighting in the dark" | chokepoint duels, a gang-up, a nurse with an egg |
   | `stores` | "IV · The larder" | black ants with pellets heading out |
   | `turn` | "V · The colony turns" | our ants push them back up; a pan following the front upward |
   | `retreat` | "VI · The retreat" | the tube |
   | `dead` | "The dead are carried out" | a follow on one ant with a body, ending at the midden |
   then `after`, and the rebuild shots over the next days (T8.8).
4. **Test.**
   - Force a level 3 war. Check:
     - our deaths ≤ the cap, and ≥ the survivor floor are alive;
     - ≤ 5 chambers lost;
     - the queen chamber is untouched;
     - `foodStore` ≥ `WAR_MIN_FOOD`;
     - every underground body ends at the midden or gone;
     - no ant is left in `CARRYING_BODY` after 2 days;
     - every warrior is gone;
     - the colony is `recovered` within `WAR_RECOVERY_DAYS + 3` days.
   - Screenshots `war-flood.png` (nest wide) and `war-midden.png`.
   - Perf at the flood's peak must hold the frame cap.
   - Soak.

**Done when:** a level 3 war fills the nest with the enemy, ends with our ants carrying the
dead up to the midden, and the colony recovers on its own.

---

## T8.10 [S] Level 4: devastation, and the queen attacked

**Files:** `damage.js` (cave-ins, reconnect), `world.js` (a `reconnect` project kind),
`queen.js` (hit flash, guards), `army.js`, `campaign.js`, `ladder.js`, `tests/smoke.mjs`.

1. **Tunnel cave-ins.**
   - `collapseTunnel(sim, tiles)` takes 4–10 connected TUNNEL tiles on a route, and turns
     them into rubble the way `wreckChamber` does (ants moved off, `nav.closed`, dust,
     spread over time).
   - Pick `WAR_LEVELS[4].tunnels` (3–6) segments where the fighting is. Never pick:
     - the top `WAR_SHAFT_KEEP` (6) rows of the entrance shaft;
     - a segment whose loss would cut the queen chamber off from the entrance (guarantee
       3). Before closing, check with a BFS from the entrance that treats the segment as
       closed (`world._bfs`); skip the segment if the queen's room becomes unreachable.
   - Chambers *can* be cut off. That is the point.
2. **Cut-off pockets.**
   - Ants inside a pocket the entrance can't reach just stay put. Check their behaviour
     with `nav.entrance().dist === FAR`: no NaN, no stuck loops that burn CPU. If an ant
     state assumes a finite distance, make it idle instead.
   - Eggs in a pocket wait; the nurses there keep tending them.
3. **`reconnect(sim)`**, run when the war ends and once a game hour after that until
   nothing is cut off.
   - For each built chamber with `nav.entrance().dist[tile] === FAR`, plan a project with
     kind `'reconnect'`. Its path is `_soilPath` from the soil around the chamber to any
     tile with entrance dist < FAR (not `_touchesNest`; see "What the nest code already
     gives us").
   - Rubble is cheap to dig, so `_soilPath` usually re-digs the old route. Now and then a
     shorter way through fresh soil wins: a **re-route**. Log the two differently: "The
     old tunnel is cleared" or "A new tunnel goes round the collapse".
   - Treat `'reconnect'` like `'link'` in `_completeProject`, with crew `cap: 6`, and give
     it priority like `'rebuild'`.
4. **The queen attacked.**
   - Level 4 has one more target: the queen chamber. Raiders who reach it fight her
     guard. Her guard is every ant in the chamber, plus the 20 nearest, recruited.
   - Each guard picks a spot on a ring round her, so the defence reads as a ring.
   - A raider touching her bites: `queen.health -= WAR_QUEEN_BITE`, with a red hit flash
     and her pose flinching. The floor is `queenHealthFloor`; the queen code already
     clamps to it. Add a check in `guard` too.
   - She is never carried off and never moves (except at level 5).
   - The guard always drives them out in the end. Once her health reaches the floor,
     `guard` forces the next act.
   - Her health recovers on its own afterwards. Her laying slows while she is hurt (it
     already depends on health), which makes the recovery slow and real.
   - Variety: the guard either holds the chamber door (a **last stand**, all the fighting
     in the doorway) or fights round her (`rand < 0.5`).
5. **Level 4's script:** `march`, `flood`, `tunnels`, then:
   | act | caption | shot |
   |---|---|---|
   | `collapse` | "IV · The tunnels fall" | the nest wide shot as segments cave in one after another |
   | `queen` | "V · The queen's chamber" | close on the queen and her ring of guards; the bites; the long hold |
   | `stand` | "VI · The last stand" | the doorway duel, or the ring |
   then `turn`, `retreat`, `dead`, `after` ("The ruins", a slow pan over the whole nest),
   and the rebuild and reconnect shots for days after.
6. **Test.**
   - Force a level 4 war. Check:
     - the queen is alive with health ≥ the floor and was bitten;
     - her chamber is untouched and connected throughout (check every 60 ticks);
     - ≥ the survivor floor are alive;
     - ≥ 1 segment caved in;
     - every cut-off chamber gets a `'reconnect'` project;
     - after 4 game days nothing is cut off (every built chamber has a finite entrance
       distance);
     - no NaN anywhere;
     - nav to the queen works.
   - Run it 10 times with different seeds, and check at least one re-route happens.
   - Screenshots `war-queen.png`, `war-collapse.png`, `war-ruins.png`.
   - Soak with levels 1–4 cycling, 60 days.

**Done when:** the rarest wars wreck the nest for real, the queen is attacked and lives,
and over the following days the colony clears or re-routes every tunnel and re-digs every
chamber.

---

## T8.11 [S] Level 5 (suggested): the exodus

**Files:** `campaign.js`, `ladder.js`, `world.js` (moving `queenRoom`), `queen.js`
(walking), `ants.js` (escort), `damage.js`, `saveLoad.js`, `tests/smoke.mjs`.

Confirm this level with the user before building it. Real colonies whose nest is ruined
move house: they dig a new home, carry the brood across, and walk the queen there with an
escort.

1. **The roll.** During a level 4 war, once the queen has been bitten, `ladder` rolls level
   5 with the odds `0.2 / (0.8 + 0.2)` (only if its gates pass). If it hits, the script
   switches to level 5's tail.
2. **The new home.**
   - When the raiders have gone, pick a site with `_pickSite`, at least
     `WAR_EXODUS_DIST` (40) tiles from the old queen chamber and preferably deeper.
   - Plan a gallery there with `ROOM.QUEEN`, kind `'rebuild'`, so diggers rush it.
3. **Moving the brood.** When the new chamber is built, every nurse carries eggs to it
   (the T8.7 evacuation with a fixed destination) until none are left in the old one.
4. **The procession.**
   - The queen walks there. Add a walking mode to `queen.js`: she steps down
     `nav.room(newId)` at `WAR_QUEEN_WALK` (0.02 tiles/tick, slow and grand). An escort of
     12–20 ants walks with her, placed ahead, beside and behind her.
   - When she arrives, set `world.queenRoom` to the new chamber and call
     `_roomsChanged()`. The old queen chamber becomes `ROOM.GENERIC`, and gets a
     `wreckChamber(…, 0.9)`, so it is left to collapse.
   - Saved: `queenRoom` and the queen's x/y already are. A save mid-walk puts her
     straight into the new chamber on load.
5. **Script tail:**
   | act | caption | shot |
   |---|---|---|
   | `decide` | "VII · The colony decides" | the nest wide; diggers converge on the new site |
   | `brood` | "VIII · The brood is carried" | nurses in a line with eggs |
   | `exodus` | "IX · The exodus" | follow the queen and her escort the whole way, at close zoom; no cuts |
   | `home` | "A new home" | the queen settling, then a slow pull-back to the whole nest |
6. **Test.**
   - Force a level 5. Check:
     - `queenRoom` has changed;
     - the queen is in it;
     - every egg is in a reachable nursery;
     - the old queen chamber is rubble;
     - the queen keeps laying (eggs rise over the next day);
     - a save and reload mid-procession works.
   - Screenshot `war-exodus.png`.
   - Soak with all five levels cycling.

---

## T8.12 [S] The days after (the recovery arc)

**Files:** `director.js`, `stats.js`, `renderWar.js`, the dashboard (if it has a history
line).

The rebuild is half the drama. Make sure it is seen.

1. **Rebuild shots.** For `WAR_RECOVERY_DAYS` after a level 2+ war (×2 for level 4–5), the
   director weights these shots up:
   - `rebuild` (T8.8);
   - `reroute` (follow the head of a `'reconnect'` project);
   - `midden` (a slow hold on the midden at dusk);
   - `queen` (if she was bitten, her recovering).
2. **Scars.** Rubble that hasn't been dug yet is the visible scar. Add a gentle dust haze
   over rubble tiles for the first game day after a cave-in, draw-only.
3. **Milestones in the news:**
   - "The nursery is dug out again";
   - "The cut-off chambers are reached";
   - "The queen is laying again" (her health back above 60);
   - "The colony is whole again" (`stats.recovered`).
4. **Test.** After a forced level 3, the director filmed `rebuild` within 1 game day, and
   "whole again" is logged.

---

## T8.13 [S] The sound of war

**Files:** `src/audio/audio.js`, `src/audio/mix.js`, `config.js`. Follow the sound rules
in `CLAUDE.md`: no files, everything through `playSfx` and the mix, numbers in `AUDIO_*`.

1. **SFX:**
   - `march`: a soft patter, short filtered-noise ticks at about 9 a second, randomised.
     Played while the column is in the tube and the camera is on it.
   - `clash`: a dry click pair, with a duel's start throttled to 4 a second at most.
   - `fall`: a tiny low tick.
   - `cavein`: a muffled, low rumble with soil-noise trickle, for T8.8/T8.10.
   - `queen`: a single low, held tone when the queen's chamber is reached.
2. **Mix layer `war`:**
   - A low drum: a sine at 55 Hz, a quick pitch drop, and a noise transient on the beat,
     at 72 bpm, rising to 84 at levels 3+.
   - Its level follows `sim.war.intensity` (duels + gang-ups, smoothed) and is ducked when
     the camera is far (`AUDIO_CLOSE_ZOOM`).
   - It fades out over the `after` act, so the field is silent but for the wind.
   - If T2.15's music exists, the drum takes the music's tempo and the music goes to a
     minor key for the rebuild days; otherwise the drum is free.
3. **Test.** The `sound` check already reads `audioGraph()`. Force a war and check `war`
   rises above 0 during `clash` and falls back after; peak level ≤ the existing ceiling.

---

## T8.14 [S] Nature war: the marauders (army-ant sweep)

**Files:** new `src/simulation/moments/marauders.js`, `army.js` (tribe `army`),
`creatures.js` (flee), `world.js` (plug/unplug helpers), `tests/smoke.mjs`.

The most dramatic real event on the meadow. An army-ant raid crosses as a broad, flowing
front, and everything flees. Real colonies plug their entrances with soil to keep it out.

1. **The moment** "The marauders": weight 1, gapDays 15. `can`: daylight, clear, no war
   running.
   - A swarm of `MOMENT_ARMY_ANTS` (90) `army` warriors enters from the right edge,
     behind the frame where visitors come in.
   - It is a fan-shaped front about 30 tiles wide that thins to a column at the back. Each
     ant follows the front's centre with noise, so the carpet ripples.
   - It crosses at 0.06 tiles/tick and leaves at the left glass. It never stops and never
     retreats.
2. **Everything flees.**
   - Visitor creatures on the surface turn and run (`vx` away from the front, at 1.6×
     speed).
   - Our surface ants go home (`RETURNING`) when the front is within 60 tiles.
   - The neighbours, if any, close their tube mouth: a brass flap drawn shut.
3. **Plug the gate.**
   - When the front is 40 tiles away, the colony plugs its entrance.
   - Add `world.plugEntrance()`, which sets the 1–2 open tiles at the top of the entrance
     shaft to SOIL with `world.set`, and calls `world.nav.closed(i)` for each.
   - Then add `world.unplugEntrance()`, which reopens them with `finishDig` once the
     swarm has passed. `finishDig` stitches nav itself.
   - Our ants underground simply can't leave for a minute. Check no state breaks while
     the entrance field is FAR.
   - Draw the plug as darker, freshly packed soil (T8.8's rubble look works), with a few
     ants visibly pushing pellets into it in the minute before the front arrives.
4. **Casualties.**
   - In Zen, any of our ants still caught outside is carried off: removed with the
     `death` cause `'marauders'`, at most 3, then the front ignores the rest.
   - In Survival, every ant caught outside is carried off.
5. **Shots.**
   - A wide pan holding the front in frame.
   - A close shot on the plugged entrance ("The colony shuts its gate").
   - The front leaving.
   - Letterbox on (`director.cinematic`).
6. **Test.** Force it and check:
   - the entrance is SOIL while the front is within 20 tiles of it;
   - it reopens afterwards;
   - nav to the queen works after;
   - no army warriors are left;
   - deaths ≤ 3.

   Screenshot `nature-marauders.png`. Run the soak (the nest changed).

---

## T8.15 [S] Nature war: the aphid ranch and the ladybug

**Files:** new `src/simulation/moments/aphids.js`, `world.js` (a plant on the meadow),
`ants.js` (tending, via a small new target kind), `renderMoments.js`, save extras.

Real mutualism and a real war over it: ants farm aphids for honeydew and fight off the
ladybugs that eat them.

1. **The plant.**
   - The first time this moment runs, a stem grows at a meadow spot 25–60 tiles from
     `COLONY_X`. It takes 1 day: a 1-tile-wide stem, 10–16 tall, and 3–5 leaves.
   - It is drawn over the sky, not tiles, and saved as an extra `{x, h, leaves, aphids}`.
   - It stays for good. Later moments reuse it.
2. **Aphids.** 6–14 pale green blobs on the stem, slowly multiplying to 20.
   - Foragers sometimes visit: a new surface errand, "tend", that walks to the stem, climbs
     it for a few seconds and comes back with honeydew.
   - Honeydew adds `APHID_HONEYDEW` food to `world.foodStore` on arrival.
   - Keep the ants.js change small: reuse the forager errand that goes to surface food,
     with the stem as the target.
3. **The ladybug** (moment "A ladybug among the aphids", weight 2, gapDays 5, `can`: the
   plant has ≥ 6 aphids, daylight, clear).
   - A ladybug (red with black spots, `#d02818`, 5 px at close zoom) flies in, lands on
     the stem and eats an aphid every 300 ticks.
   - Our ants rush it: `recruit` with the ladybug as a WarSystem-owned target. hp is high,
     and it doesn't fight back.
   - When 3 ants are on it, it lifts off and flies away, wing cases opening.
4. **Shots.**
   - Close on the stem.
   - A follow on a tending ant.
   - The ladybug's departure, held.
5. **Test.** Force the plant and a ladybug. Check that aphids drop, and that the ladybug
   leaves within `MOMENT_LADYBUG_TICKS` once ants arrive. The plant survives a reload.
   Screenshot `nature-ladybug.png`.

---

## T8.16 [S] Small wars of nature

**Files:** one moment file each in `src/simulation/moments/`; `renderMoments.js`,
`config.js`, `tests/smoke.mjs`. Each is spectacle only: no tiles change, at most one ant
lost.

1. **The antlion pit** ("A trap in the sand"; weight 2, gapDays 6). A small conical pit
   appears in the meadow 15+ tiles from the mound. It is drawn as a shaded V, with sand
   grains trickling in; the surface tiles are not changed.
   - A forager walking past slips in and struggles. Jaws flick sand up at it.
   - Two nestmates come and pull it out by the legs: the real rescue behaviour of desert
     ants.
   - In Zen the rescue always works. In Survival there is a 40% chance it fails, and the
     ant is lost.
   - The pit fills in at dusk.
2. **The spider wasp** ("A spider wasp hunts"; weight 1, gapDays 8; `can`: a spider visitor
   is on the surface, or spawn one).
   - A slim black-and-orange wasp flies in and circles. It strikes: a 2 s duel with a flash.
   - The spider goes still. The wasp drags it backwards across the meadow and off the
     edge.
   - Use the existing spider drawing for the victim.
3. **Dragonflies at the wedding flight** (no moment row: a hook in `startNuptialFlight`).
   - In a flight with ≥ 6 alates, 1–2 dragonflies (iridescent, 4-wing flicker) dart in.
   - Each snatches 1–3 alates in the sky and leaves.
   - Use the alates already "lost in the sky", so nothing changes in the colony.
   - The director's flight shot catches it.
4. **The mantis** ("A mantis waits"; weight 1, gapDays 10; `can`: the T8.15 plant exists).
   - A green mantis sits on the stem, swaying.
   - When a cricket visitor passes, it strikes. The cricket is taken, its corpse is
     dropped later, and our ants feast on it (it becomes a creature corpse).
   - The mantis never touches ants in Zen.
5. **Test.** Add one `force` per moment to the `moments` check. Each ends, changes no
   tiles, and loses at most the allowed ants. One screenshot each.

---

## T8.17 [S] Our turn: the counter-raid

**Files:** `campaign.js`, `army.js`, `ants.js` (an `away` flag), `rivalFarm.js`.

Now and then the story runs the other way. Our colony, when it is much bigger than the
neighbours, sends a war party through the tube.

1. **The moment** "The colony marches" (weight 1, gapDays 18). `can`: our population ≥
   1.3× theirs, `wars` is `natural`, daylight, clear, `stats.recovered`.
2. **The war party.**
   - Pick `min(30, population × 0.06)` foragers and workers on the surface or near the
     entrance. They gather at the mound for 20 s ("the colony gathers"), then walk into
     the tube mouth.
   - As each enters the tube, set `ant.away = true`. AntSystem skips away ants in update
     and render (grep both loops), and they don't count as idle. WarSystem spawns a `red`
     warrior proxy carrying `antId`.
3. **In their farm.**
   - Proxies cross the tube and fight a ritual tournament against the neighbours' crowd
     on their meadow, using the T8.4 duel rules. The black side spawns warriors from
     their mound as needed.
   - The camera follows them in: the first time the director films inside the
     neighbours' farm.
4. **Home.**
   - After the level's `maxTicks`, or when morale breaks either way, the proxies return
     through the tube. Each surviving proxy clears `away` on its ant and puts it at the
     tube mouth, `RETURNING`.
   - A proxy that fell kills its ant (`_kill` with cause `'war'`, within `lossCap`).
   - Winning brings home booty: food (`world.foodStore += WAR_BOOTY`).
5. **Save safety.** An `away` ant must never be lost to a save mid-raid. On save, write
   away ants as if home at the tube mouth, and drop proxies. Test it: save during the raid,
   reload, and the population is the same.
6. **Test.** Force it. Check:
   - every away ant comes back or dies within `lossCap`;
   - none stays `away` after the moment;
   - population is consistent before and after (minus deaths);
   - the save mid-raid is safe.

   Screenshot `war-counter.png` inside their farm.

---

## T8.18 [H] The chronicle of the shelf

**Files:** the Stories dialog (T2.14) if it exists, otherwise the pause menu; `stats`.

A short, readable history, one line each, for example:
- "Day 18 — a skirmish on the meadow. 11 of theirs fell, 2 of ours."
- "Day 64 — **the flood**. The nest was overrun; 5 chambers fell, 140 ants were lost. The
  colony was whole again by day 70."
- "Day 31 — the marauders passed; the gate held."

It comes from `stats.wars` (with `level`) plus a `stats.nature` list that T8.14–T8.16 push
to. Show the last 12, newest first, with a small level badge (I–V) and the tribe colours
as small dots. Saved with the stats.

---

## T8.19 [S] Stability and performance pass for wars

1. `npm test`, with `rivals`, `war` (every level) and the nature moments passing 5 runs in
   a row (fix flakes, as T2.9 did for the beetle).
2. `npm run soak -- --mode screensaver --days 60 --wars` (levels cycling 1→5) passes.
   Also check:
   - population never goes below the survivor floor;
   - the queen never dies;
   - every war's rebuilds finish.
3. `npm run perf` with a war forced at its peak:
   - level 1–2 ratios stay within 10% of a quiet farm;
   - levels 3–5 hold the frame cap.

   If not, look first at the far LOD, the cached rival canvas and the `nav.war()` rebuild
   rate.
4. A real-time run, `npm run soak -- --realtime --hours 2` with wars forced every 20 min
   (add `--wars` to real-time mode), holds the frame cap.

---

## Survival: suggested tickets (need M5 T5.1–T5.6)

The same shelf and the same ladder, with the guarantees off. These hook into the threats
framework (T5.3), the dawn cards (T5.4) and the alerts (T5.6), so build them after those.

### T8.20 [S] The neighbours are hostile

- Survival's mode row turns on `rivals: true` and
  `war: { maxLevel: 5, survivorFloor: 0, ritual: 0.15, alwaysWithdraw: false, guarantees: false }`
  (`queenHealthFloor` is already 0).
- The neighbours arrive on day 2.
- The generic "Raiders" threat in T5.3 becomes the **raid**.
- In Survival the level is not random. It climbs with the day and the difficulty: day 3
  can bring level 2, day 6 level 3, day 9 level 4. The dawn warning names it, so the
  player can prepare:
  - "Scouts were seen at the tube" for level 1–2;
  - "The neighbours are massing" for 3;
  - "Their whole colony is on the move" for 4.
- With the guarantees off:
  - raiders can reach the queen and kill her, and that is game over, as it already is;
  - the last nursery can fall;
  - tunnels can cut the queen off.

### T8.21 [H] War tools and cards

These are player choices that cost something:
- **Seal the tube** (1 supply token): a brass flap blocks the tube until the next dawn.
  It's safe, but no counter-raids or booty while it's shut.
- **Rally** (1 token): `alarmLevel` goes to 1 for a minute, and every ant defends.
- **Tribute** (food): leave food at the tube mouth. The next raid drops a level.
- **Evacuate** (free): nurses start carrying brood deeper at once (the T8.7 evacuation on
  demand).

Dawn upgrade cards (T5.4):
- **Major workers**: 1 in 10 new ants is a big-headed soldier with 3× hp and 2× damage,
  drawn bigger.
- **Formic acid**: duels end faster in our favour.
- **Gatekeepers**: the entrance is plugged every night (reuse T8.14's plug).
- **Shored tunnels**: cave-ins need twice the fighting.
- **Pit traps**: digging a dead-end beside the entrance slows raiders.

### T8.22 [S] Counter-raid and conquest

- The T8.17 counter-raid as a player action (a button, with a cooldown). Winning steals
  their food and brood: their brood becomes our eggs, and booty becomes food.
- Killing their queen is a victory, recorded in the daily history (T5.5).
- New scenarios (T5.8):
  - **Siege**: survive 5 raids.
  - **Take the shelf**: kill the neighbours' queen by day 20.
  - **The long peace**: reach day 15 without a single war loss, using tribute and the
    seal.
  - **From the ashes**: start right after a level 4 war, with the nest in ruins, and
    rebuild to 300 ants.

### T8.23 [H] Nature as threats

Each of these is a `THREATS` entry using the T8.14–T8.16 moments with Survival rules:
- **Marauders**: plug the gate in time or lose everyone outside.
- **Antlion field**: 3 pits on the foraging route, where the rescue can fail.
- **Mantis season**: foragers can be taken.
- **Ladybug plague**: the aphid ranch, if built, loses its honeydew unless defended.

Score lines for the daily history: raids repelled, enemies fallen, brood saved, brood
lost, chambers rebuilt.

---

## Suggested order

1. **T8.1 → T8.6** make a complete, watchable level 1 war in Zen, with the ladder in place.
   Stop there and ship if needed.
2. **T8.7 → T8.8** add level 2 (the breach and the rebuild).
3. **T8.12** (the days after) and **T8.13** (sound) make levels 1–2 feel finished.
4. **T8.9 → T8.11** are the rare levels 3–5. Each one lands on its own.
5. **T8.14 → T8.18** are the wars of nature and the depth.
6. **T8.19** is the pass before merging.
7. The Survival tickets wait for M5.
