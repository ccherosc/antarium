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
  ROCK: 10,     // buried stone — tunnels have to route around it
};

export const ROLE = {
  QUEEN: 0,
  WORKER: 1,
  DIGGER: 2,
  FORAGER: 3,
  NURSE: 4,
  EXPLORER: 5,  // seeks organics in soil, converts deposits to underground food
  ROGUE: 6,     // rare chaos ant — ignores rules, digs deep, fights hard
  ALATE: 7,     // winged reproductive — only appears for the nuptial flight
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
  GOING_TO_DIG:   12, // walking to the face of a dig project
  FETCHING_BROOD: 13, // walking to a loose egg to pick it up
  CARRYING_BROOD: 14, // carrying an egg to a nursery
  PATROLLING:     15, // walking to another chamber
  ATTENDING:      16, // grooming / feeding the queen
  GOING_TO_REST:  17, // heading to the home chamber to sleep
  SCOUTING:       18, // roaming the surface looking for food
  FLYING:         19, // alate on its nuptial flight
  HAULING:        20, // moving food from the store to the queen / nursery
};

// What an ant holds in its mandibles
export const CARRY = { NONE: 0, FOOD: 1, WATER: 2, DIRT: 3, EGG: 4 };

// Chamber purpose — same ids world.chamberType has always used
export const ROOM = { GENERIC: 0, QUEEN: 1, NURSERY: 2, FOOD: 3, DEEP: 4 };

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

  ANT_MOVE_TICKS: 3,
  ANT_SPEED: 0.15,             // tiles per tick — ants glide between tile centres
  ANT_TURN_RATE: 0.30,         // radians per tick the body can swing round
  DIG_TICKS: 220,
  EGG_HATCH_TICKS: 6000,       // egg → larva → pupa → ant: a little under half a day
  QUEEN_EGG_INTERVAL: 500,
  QUEEN_REST_INTERVAL: 80,

  // ── Aging & death ────────────────────────────────────────────────────────
  ANT_LIFESPAN_MIN: 30000,     // ticks — about two days
  ANT_LIFESPAN_MAX: 60000,     // ticks — about four days
  ANT_STARVATION_TICKS: 320,   // ticks at max hunger with no food before death

  // ── Growth — the colony the nest can support ─────────────────────────────
  POP_BASE: 50,
  POP_PER_TILE: 0.07,          // extra ants per excavated tile
  POP_MAX: 700,
  EGG_FOOD_COST: 4,
  MAX_OPEN_FRACTION: 0.27,     // digging stops once this much soil is hollowed out

  // ── Loads ────────────────────────────────────────────────────────────────
  FOOD_PER_TRIP: 6,
  WATER_PER_TRIP: 6,
  STORE_PER_TILE: 8,           // food a store chamber holds per floor tile

  // ── Anthill ──────────────────────────────────────────────────────────────
  DIRT_GRAIN: 0.12,            // mound tiles added per load of dirt
  HILL_MAX: 7,                 // tallest the mound gets, in tiles
  HILL_SPREAD: 26,             // how far it sprawls either side of the entrance

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

  DAY_TICKS: 14400,            // one day/night cycle — just under 4 minutes at 1×
  DAY_START_PHASE: 0.30,       // new colonies start in the early morning
  FOOD_RESPAWN_INTERVAL: 700,
  FOOD_RESPAWN_COUNT: 3,

  // ── Fast-forward — run before the first frame (src/app/fastForward.js, src/main.js) ──
  FF_SLICE_MS: 12,             // ticks run this long between yields, so the page stays responsive
  FF_FADE_MS: 400,             // the "founding your colony" overlay fades out over this long
  PREGROW_POP: 45,             // a new colony is grown to this many ants (and until the sun is up, below)...
  PREGROW_DAYS: 1.5,           // ...or this many in-game days...
  PREGROW_BUDGET_MS: 8000,     // ...or this long on the clock, whichever comes first
  PREGROW_START_PHASE: 0,      // it is founded at midnight (not DAY_START_PHASE): the nest takes about half a day to grow,
  PREGROW_MIN_LIGHT: 0.9,      // so it opens around noon, and is never done until it is at least this light (0 night, 1 day)
  CATCHUP_MIN_MS: 30000,       // a resumed colony catches up only if its save is older than this
  CATCHUP_MAX_DAYS: 0.5,       // ...and then for at most this many in-game days...
  CATCHUP_BUDGET_MS: 5000,     // ...or this long on the clock

  // ── Power saving — low quality (src/rendering/renderer.js, src/main.js) ──
  LOW_QUALITY_SCALE: 0.5,      // the canvas holds this fraction of the window's pixels, each way, and the browser stretches it up

  // ── Sound — src/audio/mix.js (what the game asks for), src/audio/audio.js (how it is made) ──
  // A layer's loudness is a gain: 1 is the layer at its full level, and the player's volume comes on top of it.
  AUDIO_WIND: 0.12,            // the wind under a clear sky...
  AUDIO_WIND_OVERCAST: 0.12,   // ...and this much more under a fully overcast one
  AUDIO_WIND_BURIED: 0.3,      // the share of the wind still heard when the view is deep underground
  AUDIO_BURY_ROWS: 8,          // the view is that deep once its top edge is this many rows below the surface
  AUDIO_RAIN: 0.5,             // rain, at full rain
  AUDIO_NIGHT: 0.15,           // night insects, in full dark
  AUDIO_BIRDS: 0.18,           // dawn birds, while they sing...
  AUDIO_BIRDS_FROM: 0.2,       // ...from this time of day (0 midnight, 0.25 sunrise, 0.5 noon)...
  AUDIO_BIRDS_TO: 0.32,        // ...to this one, and only in clear weather
  AUDIO_SOIL: 0.1,             // soil clicks, while an ant in view is digging
  AUDIO_CLOSE_ZOOM: 2,         // soil clicks and hatching pops are heard at this zoom or closer
  AUDIO_SOIL_RATE: 0.6,        // soil clicks a second for each digging ant in view, at 1× speed...
  AUDIO_SOIL_MAX_RATE: 14,     // ...and never more than this many a second
  AUDIO_FADE_IN: 3,            // seconds for the sound to come up when the colony appears
  AUDIO_UPDATE_MS: 250,        // how often the layers are re-aimed
  AUDIO_GLIDE: 0.8,            // how long a layer takes to settle on a new loudness (a time constant, in seconds)
  AUDIO_SFX_GAP: 0.06,         // seconds between two of the same effect, so a burst of hatchings is not a roar
  AUDIO_TRIM: { wind: 2.5, rain: 1.5 },   // gain that brings each looped layer to a loudness (RMS) of about 0.4 at a layer gain of 1

  MIN_ZOOM: 0.18,
  MAX_ZOOM: 10,

  LOD_FAR:  0.45,   // below → 2px dot
  LOD_TINY: 0.75,   // below → proportional 3-part silhouette
  LOD_MID:  1.8,    // below → scaled mid sprite; above → full close sprite

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
