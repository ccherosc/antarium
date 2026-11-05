# M8 — Wars of nature

The next phase of Zen. One morning the keeper sets a second ant farm on the shelf, joined
to yours by a clear connector tube. From then on the camera can pull back to show the whole
shelf: two glass farms, two mounds, two tribes. Every couple of weeks the neighbours march
through the tube and the meadow becomes a battlefield. Between wars, smaller wars of nature
play out on the surface: an army-ant sweep, a ladybug among the colony's aphids, an antlion
pit, a spider wasp. Survival gets the same machinery with real stakes (last section).

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
- **War in Zen is a spectacle, not a threat.** It is based on the real pavement-ant
  "tournament": hundreds of ants grappling in pairs on open ground, lots of pushing and
  wrestling, very few deaths. In Zen:
  - the raiders never get deeper than the gate;
  - our losses are capped per war (`war.lossCap` in the mode row);
  - the neighbours always withdraw in the end.

  Survival turns all three off.
- **Wars happen in daylight and dry weather**, like real ant wars. Never at night or in
  rain. In Zen a war is rare: `gapDays` about 12, with a scouts moment one or two days
  before it.
- **The cinematic language**, used by every war and nature-war ticket:
  - letterbox bars ease in;
  - each act of the war gets a chapter caption ("I · The scouts", "II · The march", …);
  - the camera holds long shots and pans slowly along the front line;
  - it cuts to the longest-running duel for close-ups;
  - a low drum layer comes in under the soundscape;
  - the aftermath is always a quiet, slow shot.

  Nothing shakes the screen. With reduced motion on, the bars appear without easing.
- **A player who wants a calm farm can switch wars off.** It's a setting called `wars`, on
  by default, with its own row in the settings dialog.
- **Performance budget.** At most `WAR_MAX_WARRIORS` (80) rival agents at once in Zen.
  `npm run perf` at the peak of a forced war must stay within 10% of a quiet farm's
  ratios. Far zoom draws the war as two-colour dots (that is how it reads from the shelf
  wide shot anyway).

---

## How the pieces fit

```
src/simulation/war/
  tribes.js     TRIBES table (palette, size, temper, style)
  rivalFarm.js  RivalFarm: tiles, nest growth, population, crowd   (T8.1, T8.2)
  army.js       WarSystem: warriors, tube travel, fights, morale   (T8.3, T8.4)
  campaign.js   the war as acts; emits 'warAct' for the director   (T8.5, T8.6)
src/simulation/moments/
  scouts.js, marauders.js, aphids.js, antlion.js, spiderWasp.js, dragonflies.js
src/rendering/
  renderRivals.js   the neighbours' farm + tube (cached canvas)    (T8.1, T8.3)
  renderWar.js      warriors, duels, fallen, spray, dust           (T8.4)
```

`sim.rival` (a `RivalFarm`) and `sim.war` (a `WarSystem`) are created in `createSim()` in
`src/main.js` when `rules().rivals` is true. Both are saved as save extras (follow the save
rules in `src/saveLoad.js`: bump `VERSION`, add a migration that seeds a fresh neighbour
for older saves). Coordinates are **our world's tile coordinates**: the neighbours' farm
lives at negative x (`RIVAL_X0` to `RIVAL_X0 + RIVAL_W`), so the camera, the director and
`worldToScreen` work unchanged.

Our ants fight with the code they already have. `antSystem.recruit(ant, target)` and
`_defend` in `ants.js` work on "anything with `x`, `y`, `hp`, `dead`, `gone`,
`foodChunks`". Today `_defend` calls `cs.damage(c, dmg)` on the creature system. T8.3
changes that one call to `(c.owner ?? cs).damage(c, dmg)`, so a warrior (whose `owner` is
the `WarSystem`) takes the hit through `WarSystem.damage`. `_feast` works on fallen
warriors the same way: ants eat their enemies.

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
2. **Mode row.** Add `rivals: true` to `screensaver` and `rivals: false` to `survival` (T8.13
   turns it on).
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
   - `population = 20 + chambers * RIVAL_POP_PER_CHAMBER`, capped so it is never more than
     1.2 × ours.
   - `save()` / `load()`: the seed, the growth count and the random's state. Tiles are
     **not** saved; they are regrown from the seed on load (faster than storing them, and
     always the same). Store it as a save extra.
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
     LOD the same way `renderAnts` does. `pose` is `'walk' | 'grapple' | 'fallen'`; 'fallen'
     draws the ant on its back with the legs curled up. Our colony's screenshots must not
     change: compare `screensaver.png` before and after.
3. **The crowd.**
   - `RivalFarm` keeps up to `RIVAL_CROWD` (40) cheap walkers: `{x, y, dir, t}` on the
     farm's TUNNEL and CHAMBER tiles and its surface strip.
   - Every 2 ticks each walker steps to a random open neighbour, preferring the way it was
     going. A few walk the surface and back into the mound.
   - Their number is `min(RIVAL_CROWD, population / 4)`.
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
     {id, tribe, x, y, ang, hp, maxHp, state, foe, t, path, inTube, owner: this,
      dead, gone, foodChunks}
     ```
   - `state` is one of `march | wander | fight | grapple | carry | flee | home | fallen`.
   - `update(sim)`:
     - **Tube:** move along the tube centre line at `WAR_MARCH_SPEED` (0.12 tiles/tick)
       with a little sideways jostle. Warriors queue rather than overlap: keep 0.8 tiles
       to the one ahead.
     - **Our meadow:** walk the surface like a creature does (`y` eases to `groundY`).
     - **Inside the neighbours' farm:** follow the crowd tiles to the mound and the tube.
   - `damage(w, dmg)` sets `hp`, `hitFlash`, and on 0 makes it `fallen` with
     `foodChunks = 1`. A fallen warrior lies still for `WAR_FALLEN_TICKS` (1800), then is
     `gone`.
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
     - one side lets go and backs off: the **ritual** ending, the usual one in Zen;
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
   - Our foragers carry fallen enemies home as food (`_feast` already does this).
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

1. **The campaign is a moment row** (`id: 'war'`, title "War on the shelf", weight 1,
   `gapDays: WAR_GAP_DAYS` (12); `can`: a neighbour exists, the `wars` setting is on,
   daylight before noon, clear, scouts came within the last 3 days). The moments engine
   then guarantees one at a time and no clash with floods. It ticks through these acts, and
   each act emits `warAct`:
   ```
   emit('warAct', { act, title, x, y, tall, dur, subject })
   ```
   | act | caption | what happens | shot |
   |---|---|---|---|
   | `march` | "I · The march" | the army (`min(WAR_MAX_WARRIORS, rival.population × 0.3)`) pours out of the neighbours' mound and through the tube | `shelf` wide, held, then a slow track along the tube with the head of the column |
   | `clash` | "II · The clash" | the front meets our defenders near the tube mouth; duels and gang-ups | a slow pan along the front, then a cut to the longest-running duel, then the biggest gang-up |
   | `gate` | "III · At the gate" | (only if warriors reach our mound) defenders pour out of the entrance; in Zen warriors go no deeper than `war.maxDepth` rows (2) | close on the entrance |
   | `retreat` | "IV · The retreat" | morale breaks (alive / started < `WAR_MORALE_BREAK` 0.45, or `WAR_MAX_TICKS` passed); warriors turn `home`, carrying their dead | the tube, watching them go |
   | `after` | "The field" | bodies lie, our foragers carry the enemy dead in; quiet | one long, slow pan across the meadow (`dur` 20) |
2. **Director.**
   - `on('warAct', …)` queues the shot as **urgent** news: it skips `DIRECTOR_NEWS_HOLD`
     and replaces whatever news is waiting.
   - While a war runs (`director.cinematic = true`) the tour picks no other shots. Between
     acts it may fill with `follow` shots of a defender (`ant.state === STATE.DEFENDING`).
   - Pick the "longest-running duel" and the "biggest gang-up" from WarSystem getters, not
     by scanning in the director.
3. **Letterbox.**
   - While `director.cinematic` is true, the renderer draws a black bar top and bottom,
     each 7% of the screen height, eased in over 1.2 s (instant with reduced motion).
   - Captions sit just above the bottom bar.
   - The bars are drawn last, over everything, and not into photo mode (T2.4) captures.
4. **Log.** Each act gets one `logEvent`. The last one reads "The neighbours withdrew.
   N of theirs fell, M of ours." Record it in `stats` (`stats.wars` push
   `{day, theirs, ours}`) so later tickets can show it.
5. **Test.** In `war`, `force('war')` and drive it with the `finish()` helper from the
   moments check (speed 0, tick the engine), then check:
   - all five acts fired in order (`gate` may be skipped);
   - every warrior is gone at the end;
   - `stats.wars` has one entry;
   - the director filmed `march` and `clash` (watch `director.shot.kind`).

   Screenshots `war-march.png` and `war-clash.png` with the letterbox.

**Done when:** a forced war plays as a short film from march to field, in letterbox, and
ends with nothing left over.

---

## T8.6 [S] Zen war rules, the setting, and stories

**Files:** `modes.js`, `settings.js`, `index.html` (`#settings` row), `army.js`,
`campaign.js`, `tests/smoke.mjs`.

1. **Mode row `war`:**
   ```js
   war: { lossCap: 6, maxDepth: 2, ritual: 0.7, alwaysWithdraw: true }
   ```
   - `lossCap`: our ants killed in one war at most. After that, damage to our ants is
     floored at hp 1, and those ants retreat home to heal. Grep how `hp` recovers; if it
     never does, add a slow regen in the nest, a CONFIG number.
   - `maxDepth`: rows below `SURFACE_ROW` a warrior may go.
   - `ritual`: the chance a duel ends with a let-go.
   - `alwaysWithdraw`: the neighbours always retreat in the end.

   Survival gets `war: null` until T8.13.
2. **Setting `wars`** (default `true`), with a checkbox row "Ant wars" in `#settings`
   (`data-setting="wars"`), read by the campaign's `can`. The `settingsmenu` check will
   want the row to work: turning it off stops a running war at its next act (go straight
   to `retreat`).
3. **Stories.** If T2.13's story keeper exists, a defender that fought in a war gets the
   beat "fought the neighbours on day N", and one that fell gets "fell defending the gate
   on day N". If T2.13 doesn't exist yet, leave a `// T2.13:` comment where it plugs in.
4. **Fair growth.** After a war the neighbours' population drops by the warriors that
   fell, and grows back over the next days (fewer growth steps until it has).
5. **Test.**
   - Force 3 wars back to back. Check our deaths per war are ≤ `lossCap`, no warrior is
     ever below `SURFACE_ROW + maxDepth`, the queen is untouched, and nav to the queen
     still works.
   - With `wars` off, `force('war')` returns null and the campaign's `can` is false.
6. **Soak.** Add `--wars` to `tests/soak.mjs` (day mode): it forces a war every 2 days.
   Run `npm run soak -- --mode screensaver --days 30 --wars`; heap and ms/tick must pass
   as they do now.

**Done when:** Zen wars are frequent enough to delight, never cost more than a handful of
ants, can be switched off, and a 30-day soak with wars passes.

---

## T8.7 [S] The sound of war

**Files:** `src/audio/audio.js`, `src/audio/mix.js`, `config.js`. Follow the sound rules
in `CLAUDE.md`: no files, everything through `playSfx` and the mix, numbers in `AUDIO_*`.

1. **SFX:**
   - `march`: a soft patter, short filtered-noise ticks at about 9 a second, randomised.
     Played while the column is in the tube and the camera is on it.
   - `clash`: a dry click pair, with a duel's start throttled to 4 a second at most.
   - `fall`: a tiny low tick.
2. **Mix layer `war`:**
   - A low drum: a sine at 55 Hz, a quick pitch drop, and a noise transient on the beat,
     at 72 bpm.
   - Its level follows `sim.war.intensity` (duels + gang-ups, smoothed) and is ducked when
     the camera is far (`AUDIO_CLOSE_ZOOM`).
   - It fades out over the `after` act, so the field is silent but for the wind.
   - If T2.15's music exists, the drum takes the music's tempo; otherwise it is free.
3. **Test.** The `sound` check already reads `audioGraph()`. Force a war and check `war`
   rises above 0 during `clash` and falls back after; peak level ≤ the existing ceiling.

---

## T8.8 [S] Nature war: the marauders (army-ant sweep)

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
     shaft to SOIL with `world.set`.
   - Then add `world.unplugEntrance()`, which reopens them with `finishDig` once the
     swarm has passed.
   - **Careful with nav:** `nav.opened` patches newly opened tiles, but a tile that
     *closes* leaves stale fields. Read `nav.js` and call `nav.drop` for every cached key
     after plugging, and again after unplugging. Our ants underground simply can't leave
     for a minute.
   - Draw the plug as darker, freshly packed soil, with a few ants visibly pushing pellets
     into it in the minute before the front arrives. Those are workers on a
     `STATE.DIGGING`-like animation at the shaft; a visual is fine.
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

## T8.9 [S] Nature war: the aphid ranch and the ladybug

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

## T8.10 [S] Small wars of nature

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
4. **The mantis** ("A mantis waits"; weight 1, gapDays 10; `can`: the T8.9 plant exists).
   - A green mantis sits on the stem, swaying.
   - When a cricket visitor passes, it strikes. The cricket is taken, its corpse is
     dropped later, and our ants feast on it (it becomes a creature corpse).
   - The mantis never touches ants in Zen.
5. **Test.** Add one `force` per moment to the `moments` check. Each ends, changes no
   tiles, and loses at most the allowed ants. One screenshot each.

---

## T8.11 [S] Our turn: the counter-raid

**Files:** `campaign.js`, `army.js`, `ants.js` (an `away` flag), `rivalFarm.js`.

Now and then the story runs the other way. Our colony, when it is much bigger than the
neighbours, sends a war party through the tube.

1. **The moment** "The colony marches" (weight 1, gapDays 18). `can`: our population ≥
   1.3× theirs, `wars` on, daylight, clear.
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
   - After `WAR_MAX_TICKS`, or when morale breaks either way, the proxies return through
     the tube. Each surviving proxy clears `away` on its ant and puts it at the tube
     mouth, `RETURNING`.
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

## T8.12 [H] The chronicle of the shelf

**Files:** the Stories dialog (T2.14) if it exists, otherwise the pause menu; `stats`.

A short, readable history: "Day 18 — the neighbours marched. 11 of theirs fell, 2 of ours.
Day 31 — the marauders passed; the gate held." It comes from `stats.wars` plus a
`stats.nature` list that T8.8–T8.10 push to. Show the last 12, newest first, one line
each, with the tribe colours as small dots. Saved with the stats.

---

## T8.13 [S] Stability and performance pass for wars

1. `npm test`, with `rivals`, `war` and the nature moments passing 5 runs in a row (fix
   flakes, as T2.9 did for the beetle).
2. `npm run soak -- --mode screensaver --days 60 --wars` passes.
3. `npm run perf` with a war forced at `clash`: the ratios stay within 10% of a quiet farm.
   If not, the far LOD and the cached rival canvas are where to look first.
4. A real-time run, `npm run soak -- --realtime --hours 2` with wars forced every 20 min
   (add `--wars` to real-time mode), holds the frame cap.

---

## Survival: suggested tickets (need M5 T5.1–T5.6)

The same shelf, with the safety off. These hook into the threats framework (T5.3), the
dawn cards (T5.4) and the alerts (T5.6), so build them after those.

### T8.14 [S] The neighbours are hostile

- Survival's mode row turns on `rivals: true` and
  `war: { lossCap: null, maxDepth: null, ritual: 0.15, alwaysWithdraw: false }`.
- The neighbours arrive on day 2.
- The generic "Raiders" threat in T5.3 becomes the **raid**: warned at dawn ("Scouts were
  seen at the tube"), and the army marches at noon.
- The raid's size grows with the day and the difficulty.
- Raiders go into the tunnels, so `_defend` needs to chase underground: use
  `nav.point(targetTile)` for an underground target instead of only `_surfaceStep`.
- They steal brood: a warrior that reaches an egg tile carries the egg home (remove it,
  the way hatching does), which is real slave-maker behaviour.
- They can reach the queen. If the queen dies, that is game over, as it already is.

### T8.15 [H] War tools and cards

These are player choices that cost something:
- **Seal the tube** (1 supply token): a brass flap blocks the tube until the next dawn.
  It's safe, but no counter-raids or booty while it's shut.
- **Rally** (1 token): `alarmLevel` goes to 1 for a minute, and every ant defends.
- **Tribute** (food): leave food at the tube mouth. The next raid is smaller, or skipped.

Dawn upgrade cards (T5.4):
- **Major workers**: 1 in 10 new ants is a big-headed soldier with 3× hp and 2× damage,
  drawn bigger.
- **Formic acid**: duels end faster in our favour.
- **Gatekeepers**: the entrance is plugged every night (reuse T8.8's plug).
- **Pit traps**: digging a dead-end beside the entrance slows raiders.

### T8.16 [S] Counter-raid and conquest

- The T8.11 counter-raid as a player action (a button, with a cooldown). Winning steals
  their food and brood: their brood becomes our eggs, and booty becomes food.
- Killing their queen is a victory, recorded in the daily history (T5.5).
- New scenarios (T5.8):
  - **Siege**: survive 5 raids.
  - **Take the shelf**: kill the neighbours' queen by day 20.
  - **The long peace**: reach day 15 without a single war loss, using tribute and the
    seal.

### T8.17 [H] Nature as threats

Each of these is a `THREATS` entry using the T8.8–T8.10 moments with Survival rules:
- **Marauders**: plug the gate in time or lose everyone outside.
- **Antlion field**: 3 pits on the foraging route, where the rescue can fail.
- **Mantis season**: foragers can be taken.
- **Ladybug plague**: the aphid ranch, if built, loses its honeydew unless defended.

Score lines for the daily history: raids repelled, enemies fallen, brood saved, brood
lost.

---

## Suggested order

T8.1 → T8.2 → T8.3 → T8.4 → T8.5 → T8.6 is the core. Together they make a complete,
watchable war in Zen; stop there and ship it if needed. T8.7 (sound) and T8.8 (marauders)
are the biggest wins after that. T8.9–T8.12 are depth. T8.13 is the pass before merging.
Survival tickets wait for M5.
