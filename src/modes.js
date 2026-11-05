import { GameState } from './gameState.js';

// Everything that differs between ways of playing, read with rules().
// A new mode is a new row here — never test GameState.mode in the simulation or the UI.
export const MODES = {
  screensaver: {
    label: 'Zen', badge: 'ZEN', cls: '',   // what the player sees; cls styles the badge
    lifespanMult: 1.5,        // ants live this many times longer
    noStarvation: true,       // ants never starve to death
    queenHealthFloor: 5,      // the queen's health never drops below this
    freeEggs: true,           // laying doesn't depend on the food store
    digSpeed: 1.5,            // dig time multiplier (smaller = faster)
    floors: { food: 200, water: 250 },   // the stores never drop below these (null = no floor)
    stress: false,            // colony stress stays at 0
    foodSpawnTicks: 420,      // ticks between food drops on the surface (null = CONFIG.FOOD_RESPAWN_INTERVAL * 2)
    foodScalesWithColony: true,   // surface food is capped by colony size, not a flat count
    dewScalesWithColony: true,    // the dawn dew grows with the colony
    autoTour: true,           // the director's camera tour starts switched on
    moments: true,            // rare scenes now and then: fireflies, … (src/simulation/moments/)
    showConditions: false,    // the panel's dig-speed and birthrate sliders (developer knobs) are shown
    gameOver: false,          // the run ends when the queen dies or the colony is gone
    pregrow: true,            // a new colony is grown into a busy nest before the first frame
    catchUp: true,            // a resumed colony lives on through the time the player was away
    fpsCap: 30,               // frames per second the farm is drawn at, until the player picks a cap
    world: { w: 240, h: 160, surface: 20, colonyX: 120 },   // tiles; set into CONFIG once at boot (src/main.js)
    frame: 'glass',           // 'glass': a farm in its case on the shelf; 'open': open land, filled edge to edge
    intro: null,              // news line shown when the farm starts
  },
  biome: {
    label: 'Biome', badge: 'BIOME', cls: 'biome',
    lifespanMult: 1.5, noStarvation: true, queenHealthFloor: 5, freeEggs: true,
    digSpeed: 1.5, floors: { food: 200, water: 250 }, stress: false, foodSpawnTicks: 420,
    foodScalesWithColony: true, dewScalesWithColony: true, autoTour: true, moments: true, showConditions: false, gameOver: false,
    pregrow: true, catchUp: true, fpsCap: 30,
    world: { w: 720, h: 180, surface: 30, colonyX: 360 },
    frame: 'open',
    intro: null,
  },
  survival: {
    label: 'Survival', badge: 'SURVIVAL', cls: 'survival',
    lifespanMult: 1, noStarvation: false, queenHealthFloor: 0, freeEggs: false,
    digSpeed: 3, floors: null, stress: true, foodSpawnTicks: null,
    foodScalesWithColony: false, dewScalesWithColony: false, autoTour: false, moments: false, showConditions: true, gameOver: true,
    pregrow: false, catchUp: false, fpsCap: 60,
    world: { w: 240, h: 160, surface: 20, colonyX: 120 },
    frame: 'glass',
    intro: 'Survival — keep the queen alive',
  },
};

export const rules = () => MODES[GameState.mode] || MODES.screensaver;
