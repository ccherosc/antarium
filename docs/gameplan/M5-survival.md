# M5 — Survival game

"Keep them alive." Limited supplies arrive each dawn, threats are announced a little
ahead, and every dawn you pick one upgrade from three. A run ends when the queen dies or
the last ant is gone. Score = days survived × 100 + peak population. Replayable like a
small roguelite.

Needs M0. The architecture rule for this milestone: **the simulation reads multipliers
from `world.mods`; threats, cards and difficulty only change multipliers.** Sonnet builds
that layer once (T5.1); after that, new threats and cards are table entries Haiku can add.

---

## T5.1 [S] Run state + the modifiers layer

**1. `world.mods`** — add in the `World` constructor:
```js
// Multipliers the survival run (difficulty, threats, upgrade cards) sets each dawn.
// 1 = normal. The sim only ever reads these; src/survival/run.js writes them.
this.mods = { ...MOD_DEFAULTS };
```
with `MOD_DEFAULTS` exported from `src/config.js`, and read each one in exactly one place:

| Mod | Read in | Effect |
|---|---|---|
| `evap` | `world._tickItems` | water evaporation rate × |
| `rain` | `sky._weather` (when scheduling `_nextRain`: divide the interval) | rain frequency × (0 = no rain) |
| `dew` | `sky._dawn` | dew amount × (0 = none) |
| `foodSpawn` | `world._tickFoodSpawn` (divide `_foodTimer`) | surface food frequency × |
| `foodDecay` | `world._tickItems` | food spoiling × |
| `antSpeed` | `ants.js` `_walk` | walking speed × |
| `hunger` | where ant hunger rises (grep `hunger +=` in `ants.js`) and `CONFIG.QUEEN_HUNGER_RATE` use in `queen.js` | hunger rate × |
| `lay` | `queen.js` laying rate | egg rate × |
| `queenRegen` | `queen.js` health recovery | recovery × |
| `creatureRate` | `creatures.js` `_trySpawn` chance | creature spawns × |
| `creatureDmg` | where creatures damage ants | damage to ants × |
| `dig` | `world.update` `_digRate` | dig speed × |
| `tokens` | `run.js` | extra supply tokens per dawn (additive, default 0) |

Not saved in `world.save()` — `run.js` recomputes them on load.

**2. `src/survival/run.js`:**
```js
export const DIFFICULTY = {
  gentle: { name: 'Gentle', tokens: { food: 4, water: 3 }, threatChance: 0.25, mods: { hunger: 0.8 } },
  normal: { name: 'Normal', tokens: { food: 3, water: 2 }, threatChance: 0.45, mods: {} },
  hard:   { name: 'Hard',   tokens: { food: 2, water: 1 }, threatChance: 0.7,  mods: { hunger: 1.2, creatureRate: 1.5 } },
};
export class Run {
  constructor(difficulty = 'normal') { this.difficulty; this.tokens = { food: 0, water: 0 }; this.cards = []; this.threats = []; /* {id, until} */ this.history = []; this.over = false; }
  dawn(sim)        // refill tokens (cap at 2× per-dawn amount), expire/roll threats (T5.3), push history (T5.5), offer cards (T5.4), then applyMods
  applyMods(world) // world.mods = defaults × difficulty.mods × each card's mods × each active threat's mods
  save() / load(d)
}
```
- `createSim()` adds `run: new Run(difficulty)` only when `GameState.mode === 'survival'`
  — better: `rules().survivalRun` true for Survival; saved via the T0.5 `EXTRAS`.
- `on('dawn', () => sim.run.dawn(sim))` in `main.js`; call `applyMods` once after load
  and after a new run starts.
- Difficulty picker: when starting a new Survival colony, a dialog Gentle / Normal / Hard
  (copy the mode-card style).

**Done when:** with `?debug`, setting `__pa.sim.world.mods.antSpeed = 0.3` visibly slows
ants; `__pa.sim.run.applyMods(__pa.sim.world)` resets it; a 10-day survival soak still
passes; save/reload keeps difficulty, tokens and cards.

---

## T5.2 [H] Supply tokens

**Files:** `src/ui/controls.js` (`handleTileClick`), the food/water buttons (tray slots
if T4.3 is done, otherwise the side-panel `.tool-btn`s), `styles/main.css`.

1. In Survival, dropping food costs 1 `run.tokens.food`, water 1 `run.tokens.water`. With
   none left: don't place, toast "No food drops left — more arrive at dawn".
2. Show the count as a badge on each button ("🍯 Food ×3"), updated whenever it changes.
3. At dawn, toast "Supplies arrived: 3 food, 2 water" (`run.dawn` can return what it
   added).
4. Zen and Keeper are unaffected (`if (sim.run)` guard).

**Done when:** in Survival you can drop exactly as many as your tokens; dawn refills.

---

## T5.3 [S] Threats framework + first three threats

**Create `src/survival/threats.js`:**
```js
// Add a threat = add an entry. mods are multiplied into world.mods while it lasts.
export const THREATS = [
  { id: 'drought', name: 'Drought', icon: '☀', days: 2, minDay: 2,
    warn: 'A dry spell is coming — no rain or dew for two days.',
    mods: { rain: 0, dew: 0, evap: 2 } },
  { id: 'cold', name: 'Cold snap', icon: '❄', days: 2, minDay: 4,
    warn: 'A cold snap — the colony will slow down and the queen will rest.',
    mods: { antSpeed: 0.6, lay: 0.3, hunger: 0.8 } },
  { id: 'raiders', name: 'Raiders', icon: '⚔', days: 1, minDay: 3,
    warn: 'Raiders have been seen near the nest!',
    mods: { creatureRate: 3, creatureDmg: 1.3 } },
];
```
1. `run.dawn`: drop threats whose `until` passed; with probability
   `DIFFICULTY.threatChance`, pick one eligible threat (`day >= minDay`, not already
   active, not the same as yesterday) and start it **at noon**, not immediately: at dawn
   show the warning (big caption + `logEvent`), at noon it becomes active
   (`threats.push({ id, until: day + days })`, `applyMods`). Use `sky.phase` checks in
   a small `run.update(sim)` called every ~60 ticks.
2. Show active and incoming threats as pills top-centre (icon + name + days left).
3. Visuals: drought → `renderSky` warmer/hazier sky; cold → bluish tint over the farm
   (a translucent rect in `renderer.js`); raiders → nothing extra (the creatures are the
   visual).
4. Emit `threatStart` / `threatEnd` on the bus (director T5.6 and sound can use them).

Later threats for Haiku, each just an entry (+ maybe one new mod): **Heat wave**
(evap ×3, hunger ×1.3), **Mold** (foodDecay ×4), **Mites** (hunger ×1.5, lay ×0.7),
**Famine** (foodSpawn ×0.2). Threats that need new simulation (flooded tunnels, cave-ins)
are Sonnet tickets.

**Done when:** over a 10-day survival soak at Normal, the log shows warnings followed by
threats starting at noon and ending on time; mods return to normal afterwards.

---

## T5.4 [H] Dawn upgrade cards

**Create `src/survival/cards.js`:**
```js
// Add a card = add an entry. mods multiply world.mods for the rest of the run;
// once() runs one time when picked.
export const CARDS = [
  { id: 'dew_collector', name: 'Dew Collector', desc: 'Twice the morning dew.',            mods: { dew: 2 } },
  { id: 'deep_well',     name: 'Deep Well',     desc: 'Water evaporates 40% slower.',      mods: { evap: 0.6 } },
  { id: 'royal_jelly',   name: 'Royal Jelly',   desc: 'The queen recovers twice as fast.', mods: { queenRegen: 2 } },
  { id: 'fertile',       name: 'Fertile Queen', desc: '+25% eggs.',                        mods: { lay: 1.25 } },
  { id: 'guards',        name: 'Guard Ants',    desc: 'Raiders do 40% less harm.',         mods: { creatureDmg: 0.6 } },
  { id: 'diggers',       name: 'Strong Jaws',   desc: 'Dig 30% faster.',                   mods: { dig: 1.3 } },
  { id: 'thrifty',       name: 'Thrifty',       desc: 'Ants get hungry 15% slower.',       mods: { hunger: 0.85 } },
  { id: 'supply',        name: 'Supply Line',   desc: '+1 food drop every dawn.',          mods: { tokens: 1 } },
  { id: 'rations',       name: 'Emergency Rations', desc: '+300 food now.',  once: sim => { sim.world.foodStore += 300; } },
  { id: 'spring',        name: 'Hidden Spring', desc: 'Three puddles now.',  once: sim => { for (let i = 0; i < 3; i++) sim.world.addPuddle(); } },
];
```
1. In `run.dawn` from day 2: pause the game (remember speed, set 0), show a dialog with 3
   random cards the run doesn't already have (`once` cards may repeat), big and
   clickable, keys 1–3. Picking: `cards.push(id)`, run `once`, `applyMods`, resume.
2. The pause menu lists cards taken this run.
3. Note: `tokens` is additive, not a multiplier — `applyMods` must sum it.

**Done when:** each dawn offers 3 cards, choosing one changes the game (check
`world.mods`), cards persist through save/reload.

---

## T5.5 [H] Daily history, score, high scores, better game over

1. `run.dawn` pushes `{ day, population, food: Math.round(world.foodStore), water,
   queenHealth, deaths: antSystem.deaths }` to `run.history`.
2. Score: `days × 100 + peakPopulation`. Show the live score in the dashboard in
   Survival.
3. High scores: localStorage `pixelants_scores` → `{ gentle: [], normal: [], hard: [] }`,
   top 5 each `{ score, days, peak, date }`.
4. Game over (`triggerGameOver` in `main.js`, `#gameover` in `index.html`): cause, days,
   score, "New best!" if it is, top 5 for the difficulty, a 300×80 canvas sparkline of
   population from `run.history`, the cards taken, buttons **Try again** (same
   difficulty, new colony) and **Main menu**.

**Done when:** losing shows the full summary; scores persist; Try again starts a fresh
run at the same difficulty.

---

## T5.6 [S] Alerts + director cuts to trouble

1. Alert pills (next to threat pills): **Food low** (`foodStore` < 15% of cap), **Water
   low**, **Queen weak** (health < 50), **Under attack** (`world.alarmLevel` > 0.5).
   Pulsing; click → camera goes to the relevant place (queen chamber, store chamber,
   surface above the nest).
2. Director (if the tour is on in Survival): when queen health first drops below 40 or
   an attack starts, cut there with a caption. Max once per 30 s.
3. Soft warning sound (T1.3) on a new alert.

**Done when:** starving a colony in debug (`__pa.sim.world.foodStore = 0`) shows the pill
within seconds and clicking it shows the problem.

---

## T5.7 [S] Balance pass with a bot player

1. `tests/soak.mjs --mode survival --bot --difficulty normal --runs 5 --maxDays 40`:
   the bot, at each dawn, spends all tokens dropping food/water on the surface near the
   nest entrance (use `world.groundY`), and picks a random card. Run until game over or
   `maxDays`; record days survived and cause per run.
2. Targets (median days): **Gentle ≥ 25**, **Normal 12–20**, **Hard 6–10**. A colony left
   with no player input at Normal should die in about 4–8 days.
3. Tune only the `DIFFICULTY` table and threat/card numbers, not the core simulation.
   Record the final results table in the commit message.

---

## T5.8 [S] Scenarios with star ratings

**Create `src/survival/scenarios.js`:**
```js
export const SCENARIOS = [
  { id: 'endless', name: 'Endless', desc: 'Survive as long as you can.', difficulty: 'normal' },
  { id: 'one_queen', name: 'One Queen', desc: 'Start with the queen and three workers. Reach 100 ants.',
    start: { workers: 3 }, goal: { population: 100 }, stars: [20, 14, 10] },  // days to reach goal for 1/2/3 stars
  { id: 'dry_summer', name: 'Dry Summer', desc: 'Drought every third day. Survive 15 days.',
    forced: [{ every: 3, threat: 'drought' }], goal: { days: 15 } },
  { id: 'siege', name: 'Under Siege', desc: 'Raiders every night. Survive 10 days.',
    forced: [{ every: 1, threat: 'raiders' }], goal: { days: 10 } },
  { id: 'long_winter', name: 'The Long Winter', desc: 'A cold snap that lasts five days, starting day 3.',
    forced: [{ day: 3, threat: 'cold', days: 5 }], goal: { days: 12 } },
];
```
- Survival card on the title screen opens a scenario list showing best stars per
  scenario (localStorage).
- `start.workers` needs `AntSystem` to spawn a custom number of starting workers (find
  `_spawn()`), and `start.food/water` sets initial stores.
- Goals checked at each dawn; reaching one shows a "Scenario complete ★★☆" screen with
  Continue (keep playing endlessly) / Main menu.

**Done when:** each scenario can be won and lost; stars save.
