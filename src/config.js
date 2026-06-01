export const TILE = {
  AIR: 0,
  SURFACE: 1,
  SOIL: 2,
  TUNNEL: 3,
  CHAMBER: 4,
  GLASS: 5,
  FOOD: 6,
  WATER: 7,
  EGG: 8,
  ANTHILL: 9,   // displaced soil piled above surface by dirt-carrying ants
};

export const ROLE = {
  QUEEN: 0,
  WORKER: 1,
  DIGGER: 2,
  FORAGER: 3,
  NURSE: 4,
  EXPLORER: 5,  // seeks organics in soil, converts deposits to underground food
  ROGUE: 6,     // rare chaos ant — ignores rules, digs deep, fights hard
};

export const STATE = {
  IDLE: 0,
  WANDERING: 1,
  DIGGING: 2,
  SEEKING_FOOD: 3,
  CARRYING_FOOD: 4,
  SEEKING_WATER: 5,
  NURSING: 6,
  RESTING: 7,
  RETURNING: 8,
  DUMPING_DIRT: 9, // carrying excavated soil up to the surface anthill
  DEFENDING:   10, // rushing a surface creature and attacking it
  FEASTING:    11, // collecting food chunks from a defeated creature corpse
};

export const CONFIG = {
  WORLD_WIDTH: 240,
  WORLD_HEIGHT: 160,
  TILE_SIZE: 4,

  SURFACE_ROW: 20,       // was 14; extra sky rows show anthill and sky gradient
  GLASS_THICKNESS: 2,

  COLONY_X: 120,
  COLONY_Y: 71,          // shifted with surface (+6) so relative depth is unchanged

  INITIAL_WORKERS: 12,
  INITIAL_DIGGERS: 6,
  INITIAL_FORAGERS: 8,
  INITIAL_NURSES: 4,
  INITIAL_EXPLORERS: 4,
  INITIAL_EGGS: 6,

  ANT_MOVE_TICKS: 4,
  DIG_TICKS: 220,
  EGG_HATCH_TICKS: 900,
  QUEEN_EGG_INTERVAL: 500,
  QUEEN_REST_INTERVAL: 80,

  // ── Aging & death ────────────────────────────────────────────────────────
  ANT_LIFESPAN_MIN: 4500,      // ticks — ~2 min real at speed 2
  ANT_LIFESPAN_MAX: 10000,     // ticks — ~4.5 min real at speed 2
  ANT_STARVATION_TICKS: 320,   // ticks at max hunger with no food before death

  // ── Food / water ─────────────────────────────────────────────────────────
  FOOD_STORE_MAX: 1000,
  WATER_STORE_MAX: 1000,
  FOOD_DECAY_RATE: 0.03,
  WATER_EVAP_RATE: 0.015,
  ANT_HUNGER_RATE: 0.008,
  ANT_ENERGY_RATE: 0.012,
  QUEEN_HUNGER_RATE: 0.005,

  // ── Pheromones ───────────────────────────────────────────────────────────
  PHER_FOOD_DECAY:   0.9988,   // trail fades in ~800 ticks without reinforcement
  PHER_HOME_DECAY:   0.9982,   // home trail fades slightly faster
  PHER_CARRY_DEPOSIT: 0.10,    // strong pulse each step when carrying food home
  PHER_OUT_DEPOSIT:   0.018,   // lighter pulse going out
  PHER_TRAIL_WEIGHT:  8.0,     // how hard ants follow food trail when seeking
  PHER_HOME_WEIGHT:   6.0,     // how hard carrying ants follow home trail
  FORAGER_TIMEOUT:    700,     // ticks before a forager gives up the search

  // ── Colony stress ────────────────────────────────────────────────────────
  STRESS_FOOD_LOW:   280,      // food below this triggers mild stress
  STRESS_FOOD_CRIT:  80,       // food below this = critical
  STRESS_WATER_LOW:  140,
  STRESS_WATER_CRIT: 40,

  TICKS_PER_DAY: 600,
  FOOD_RESPAWN_INTERVAL: 700,
  FOOD_RESPAWN_COUNT: 3,

  MIN_ZOOM: 0.18,
  MAX_ZOOM: 10,

  LOD_FAR: 0.55,
  LOD_MID: 1.8,

  // Tile colors
  C_AIR: '#080504',
  C_SURFACE: '#1e1208',
  C_SURFACE2: '#241508',
  C_SOIL: '#3d2b18',
  C_SOIL2: '#4a3320',
  C_SOIL3: '#352515',
  C_TUNNEL: '#7a5a30',
  C_TUNNEL2: '#8a6838',
  C_TUNNEL_FLOOR: '#6a4e28',
  C_CHAMBER: '#8c6a3a',
  C_CHAMBER2: '#a07840',
  C_CHAMBER_CEIL: '#c09050',
  C_GLASS: '#5a9ec0',
  C_GLASS_EDGE: '#3a7ea0',
  C_GLASS_SHINE: '#8aced8',
  C_FOOD: '#e8b420',
  C_FOOD2: '#f8d040',
  C_WATER: '#2468c8',
  C_WATER2: '#4090e8',
  C_EGG: '#f0e8c0',
  C_EGG2: '#e0d8b0',

  // Ant colors
  C_QUEEN_BODY: '#b83818',
  C_QUEEN_HEAD: '#d04020',
  C_QUEEN_LEGS: '#8c2810',
  C_WORKER_BODY: '#1e1408',
  C_WORKER_HEAD: '#2a1c0c',
  C_WORKER_LEGS: '#140e04',
  C_DIGGER_BODY: '#161008',
  C_FORAGER_BODY: '#241808',
  C_NURSE_BODY: '#201408',
  C_CARRY_DOT: '#f8d040',

  // Pheromone
  C_PHEROMONE_FOOD: 'rgba(255,210,50,0.06)',
  C_PHEROMONE_HOME: 'rgba(100,200,255,0.04)',
};
