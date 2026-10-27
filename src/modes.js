import { GameState } from './gameState.js';

// Everything that differs between ways of playing, read with rules().
// A new mode is a new row here — never test GameState.mode in the simulation or the UI.
export const MODES = {
  screensaver: {
    label: 'Screensaver', badge: 'SCREENSAVER', cls: '',   // what the player sees; cls styles the badge
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
    gameOver: false,          // the run ends when the queen dies or the colony is gone
    pregrow: true,            // a new colony is grown into a busy nest before the first frame
    catchUp: true,            // a resumed colony lives on through the time the player was away
    fpsCap: 30,               // frames per second the farm is drawn at, until the player picks a cap
    intro: null,              // news line shown when the farm starts
  },
  survival: {
    label: 'Survival', badge: 'SURVIVAL', cls: 'survival',
    lifespanMult: 1, noStarvation: false, queenHealthFloor: 0, freeEggs: false,
    digSpeed: 3, floors: null, stress: true, foodSpawnTicks: null,
    foodScalesWithColony: false, dewScalesWithColony: false, autoTour: false, gameOver: true,
    pregrow: false, catchUp: false, fpsCap: 60,
    intro: 'Survival — keep the queen alive',
  },
};

export const rules = () => MODES[GameState.mode] || MODES.screensaver;
