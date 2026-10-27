import { TILE, ROLE, STATE, CARRY, ROOM, CONFIG } from '../config.js';
import { logEvent } from '../events.js';
import { rules } from '../modes.js';
import { Nav, FAR } from './nav.js';

let nextId = 1;

const W = CONFIG.WORLD_WIDTH, H = CONFIG.WORLD_HEIGHT;
const SR = CONFIG.SURFACE_ROW, GT = CONFIG.GLASS_THICKNESS, CX = CONFIG.COLONY_X;
const SKY = SR * W;           // tile indices below this are above ground
const NEST = (SR + 2) * W;    // …and from here on down is the nest proper
const TAU = Math.PI * 2;

// The eight neighbours of a tile — sides first, then corners
const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NY = [0, 0, 1, -1, 1, -1, 1, -1];
const NO = NX.map((dx, n) => dx + NY[n] * W);
const NL = NX.map((dx, n) => Math.hypot(dx, NY[n]));
const NA = NX.map((dx, n) => Math.atan2(NY[n], dx));
const PICK = new Float32Array(8);

const BOOST = [1, 2, 4];      // hatch-weight multiplier for each nudge level
const ROLE_NAME = {
  [ROLE.FORAGER]: 'forager', [ROLE.DIGGER]: 'digger', [ROLE.WORKER]: 'worker',
  [ROLE.NURSE]: 'nurse', [ROLE.EXPLORER]: 'explorer',
};
// Share of each caste that keeps working through the night
const NIGHT_OWLS = {
  [ROLE.WORKER]: 0.2, [ROLE.DIGGER]: 0.35, [ROLE.FORAGER]: 0.05,
  [ROLE.NURSE]: 0.5, [ROLE.EXPLORER]: 0.2, [ROLE.ROGUE]: 1, [ROLE.ALATE]: 1,
};

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function randLifespan(role) {
  const base = rand(CONFIG.ANT_LIFESPAN_MIN, CONFIG.ANT_LIFESPAN_MAX);
  return Math.floor(base * rules().lifespanMult * (role === ROLE.ROGUE ? 2.5 : 1));
}

export function makeAnt(role, x, y) {
  const heading = Math.random() * TAU - Math.PI;
  return {
    id: nextId++,
    role,
    state: STATE.IDLE,
    x, y,
    px: x, py: y,            // where it was a tick ago — the renderer glides between the two
    wx: x, wy: y,            // the point it is walking to
    heading,                 // direction of travel
    angle: heading,          // where the body points; swings round to follow the heading
    jx: rand(-0.2, 0.2),     // each ant keeps to its own line within a tile
    jy: rand(-0.2, 0.2),
    speedMul: rand(0.85, 1.15),
    carry: CARRY.NONE,
    load: 0,
    hunger: Math.random() * 15,
    hp: 100,                 // reduced by creature attacks; death at 0
    age: 0,
    lifespan: randLifespan(role),
    starvationTicks: 0,
    animFrame: randInt(0, 2),
    animTimer: randInt(0, 4),
    moving: false,
    home: -1,                // chamber it sleeps in
    homeVer: -1,
    owl: Math.random() < (NIGHT_OWLS[role] ?? 0.2),
    lag: Math.floor(Math.random() * (role === ROLE.FORAGER ? 200 : 900)), // how long after dawn it gets up
    room: -1,                // chamber it is heading for…
    spot: -1,                // …and the tile within it
    timer: 0,
    pause: 0,                // ticks left standing still
    fail: 0,
    sub: 0,                  // step within the current state
    project: 0,              // id of the dig project it is working on
    digIdx: -1,              // tile it is digging
    dumpX: 0,
    dir: 1,
    egg: null,               // egg being fetched or carried
    defenseTarget: null,     // creature being fought or butchered
    vx: 0, vy: 0,            // flight velocity (alates)
  };
}

export class AntSystem {
  constructor(world) {
    this.world = world;
    this.nav = world.nav || new Nav(world);
    this.ants = [];
    this.eggs = [];
    this.deaths = 0;        // total lifetime deaths
    this.recentDeaths = 0;  // deaths in last 500 ticks (for dashboard)
    this.rescues = 0;       // ants lifted out of a tile that closed over them
    this.lastHatch = null;  // { x, y, tick } — for the camera
    this.roleBoosts = { forager: 0, digger: 0, worker: 0, nurse: 0, explorer: 0 };
    this._deathResetTimer = 0;
    this._hatchCount = 0;
    this._rogueTimer = 0;
    this._roles = { forager: 0, digger: 0, worker: 0, nurse: 0, explorer: 0, rogue: 0 };
    this._alates = 0;
    this._attending = 0;
    this._loose = 0;        // eggs lying in the queen's chamber, waiting for a nurse
    this._faceSeen = false;
    this._queen = null;
    this._creatures = null;
    this._spawn();
    this._census();
  }

  get population() {
    return this.ants.length - this._alates;
  }

  get eggCount() {
    return this.eggs.length;
  }

  get roleCounts() {
    return this._roles;
  }

  _spawn() {
    const w = this.world;
    const add = (role, n) => {
      for (let k = 0; k < n; k++) {
        const ant = makeAnt(role, 0, 0);
        this._pickHome(ant);
        const ch = w.chambers[ant.home];
        const t = ch.tiles[(Math.random() * ch.tiles.length) | 0];
        this._place(ant, t % W, (t / W) | 0);
        ant.age = Math.floor(Math.random() * ant.lifespan * 0.5);
        this.ants.push(ant);
      }
    };
    add(ROLE.WORKER, CONFIG.INITIAL_WORKERS);
    add(ROLE.DIGGER, CONFIG.INITIAL_DIGGERS);
    add(ROLE.FORAGER, CONFIG.INITIAL_FORAGERS);
    add(ROLE.NURSE, CONFIG.INITIAL_NURSES);
    add(ROLE.EXPLORER, CONFIG.INITIAL_EXPLORERS);

    const nursery = w.nurseries[0];
    for (let k = 0; nursery && k < CONFIG.INITIAL_EGGS; k++) {
      const t = this._spotBrood(nursery);
      const e = this.addEgg(t % W + rand(0.2, 0.8), ((t / W) | 0) + rand(0.3, 0.8), true, nursery.id);
      e.hatchTimer = rand(200, e.total * 0.6);
      nursery.brood++;
    }
  }

  addEgg(x, y, placed = false, room = -1) {
    const total = CONFIG.EGG_HATCH_TICKS * rand(0.85, 1.15);
    const egg = { x, y, hatchTimer: total, total, placed, carried: false, claimed: false, room, done: false };
    this.eggs.push(egg);
    return egg;
  }

  // ── Per-tick ─────────────────────────────────────────────────────────────

  update(deltaMs, queen, opts = {}) {
    const w = this.world;
    this._queen = queen;
    this._creatures = opts.creatures || null; // creature system ref for DEFENDING/FEASTING

    // who is digging where: last tick's tally is what newcomers go by
    const crew = w.digCrewPrev;
    w.digCrewPrev = w.digCrew;
    w.digCrew = crew;
    crew.clear();

    this._census();
    for (const ch of w.nurseries) ch.care *= 0.9985;

    // ── Rogue ant rare spontaneous spawn ────────────────────────────────────
    if (++this._rogueTimer >= 1600) {
      this._rogueTimer = 0;
      if (this._roles.rogue < 2 && Math.random() < 0.14) {
        const foyer = w.chambers[0];
        const t = foyer.tiles[(Math.random() * foyer.tiles.length) | 0];
        const rogue = makeAnt(ROLE.ROGUE, 0, 0);
        this._place(rogue, t % W, (t / W) | 0);
        this.ants.push(rogue);
        logEvent('A rogue ant emerges — chaos incoming!');
      }
    }

    // ── Recent-deaths window reset ──────────────────────────────────────────
    if (++this._deathResetTimer > 500) { this.recentDeaths = 0; this._deathResetTimer = 0; }

    this._tickEggs();

    // ── Update + age + kill ants ─────────────────────────────────────────────
    const ants = this.ants;
    const hungerRate = CONFIG.ANT_HUNGER_RATE * (1 + w.stress * 0.4);
    const noStarvation = rules().noStarvation;
    for (let k = ants.length - 1; k >= 0; k--) {
      const ant = ants[k];
      ant.px = ant.x;
      ant.py = ant.y;

      if (ant.role === ROLE.ALATE) {
        if (!this._tickAlate(ant)) this._remove(k);
        continue;
      }

      if (++ant.age >= ant.lifespan) { this._kill(k, 'age'); continue; }
      if (ant.hp <= 0) { this._kill(k, 'fight'); continue; }

      // Hunger: ants eat from the colony store wherever they are
      ant.hunger += hungerRate;
      if (ant.hunger > 70 && w.foodStore > 0) this._eat(ant);
      if (ant.hunger >= 100) {
        ant.hunger = 100;
        if (!noStarvation && ++ant.starvationTicks > CONFIG.ANT_STARVATION_TICKS) {
          this._kill(k, 'starved');
          continue;
        }
      } else {
        ant.starvationTicks = 0;
      }

      this._step(ant);
    }
  }

  // Head-count: castes, dig crews, the queen's retinue and unclaimed brood
  _census() {
    const w = this.world, r = this._roles;
    r.forager = r.digger = r.worker = r.nurse = r.explorer = r.rogue = 0;
    for (const p of w.projects) p.crew = 0;
    let attending = 0, alates = 0;
    for (const ant of this.ants) {
      switch (ant.role) {
        case ROLE.FORAGER:  r.forager++; break;
        case ROLE.DIGGER:   r.digger++; break;
        case ROLE.WORKER:   r.worker++; break;
        case ROLE.NURSE:    r.nurse++; break;
        case ROLE.EXPLORER: r.explorer++; break;
        case ROLE.ROGUE:    r.rogue++; break;
        case ROLE.ALATE:    alates++; break;
      }
      if (ant.state === STATE.ATTENDING) attending++;
      if (ant.project) {
        const p = w.projectById.get(ant.project);
        if (p) p.crew++; else ant.project = 0;
      }
    }
    this._attending = attending;
    this._alates = alates;

    let loose = 0;
    for (const e of this.eggs) if (!e.placed && !e.claimed) loose++;
    this._loose = loose;

    if ((w.tick & 31) === 0) {
      for (const ch of w.chambers) ch.brood = 0;
      for (const e of this.eggs) {
        const ch = e.room >= 0 ? w.chambers[e.room] : null;
        if (ch) ch.brood++;
      }
    }
  }

  _tickEggs() {
    const w = this.world, eggs = this.eggs;
    for (let k = eggs.length - 1; k >= 0; k--) {
      const e = eggs[k];
      if (e.carried) continue;
      // brood left lying in the queen's chamber develops slowly; a tended nursery speeds it up
      let rate = 0.3;
      if (e.placed) {
        const ch = w.chambers[e.room];
        rate = 1 + (ch ? ch.care : 0) * 0.4;
      }
      e.hatchTimer -= rate;
      if (e.hatchTimer > 0) continue;
      e.done = true;
      eggs[k] = eggs[eggs.length - 1];
      eggs.pop();
      const ch = e.room >= 0 ? w.chambers[e.room] : null;
      if (ch && ch.brood > 0) ch.brood--;
      this._hatch(e);
    }
  }

  _hatch(e) {
    const w = this.world, b = this.roleBoosts;
    const wf = 30 * BOOST[b.forager];
    const wd = 25 * BOOST[b.digger];
    const ww = 25 * BOOST[b.worker];
    const wn = 20 * BOOST[b.nurse];
    const we = 10 * BOOST[b.explorer];
    const rv = Math.random() * (wf + wd + ww + wn + we);
    const role = rv < wf                ? ROLE.FORAGER
               : rv < wf + wd           ? ROLE.DIGGER
               : rv < wf + wd + ww      ? ROLE.WORKER
               : rv < wf + wd + ww + wn ? ROLE.NURSE
               :                          ROLE.EXPLORER;
    const ant = makeAnt(role, e.x, e.y);
    ant.pause = randInt(40, 100);   // a moment to find its feet
    this.ants.push(ant);
    this._hatchCount++;
    this.lastHatch = { x: e.x, y: e.y, tick: w.tick };
    w.fx.push({ t: 'hatch', x: e.x, y: e.y });
    if (this._hatchCount % 4 === 1) logEvent(`Egg hatched — new ${ROLE_NAME[role]}`);
  }

  _eat(ant) {
    const w = this.world;
    const eat = Math.min(0.8, w.foodStore);
    w.foodStore -= eat;
    ant.hunger = Math.max(0, ant.hunger - eat * 35);
    if (w.waterStore > 0) w.waterStore = Math.max(0, w.waterStore - eat * 0.4);
  }

  _remove(k) {
    const ants = this.ants;
    if (ants[k].role === ROLE.ALATE) this._alates--;
    ants[k] = ants[ants.length - 1];
    ants.pop();
  }

  _kill(k, cause) {
    const ant = this.ants[k];
    this._dropTask(ant);
    this._remove(k);
    this.deaths++;
    this.recentDeaths++;
    this.world.fx.push({ t: 'death', x: ant.x, y: ant.y });
    if (cause === 'starved') logEvent('An ant died of starvation');
    else if (cause === 'fight') logEvent('An ant fell defending the colony');
  }

  // Let go of whatever the ant had in hand, so somebody else can pick it up
  _dropTask(ant) {
    const e = ant.egg;
    if (e) {
      if (e.carried) {
        // set it down where somebody can get at it again
        const on = this.world.passable[(ant.y | 0) * W + (ant.x | 0)];
        e.carried = false;
        e.x = on ? ant.x : ant.wx;
        e.y = on ? ant.y : ant.wy;
      }
      if (!e.placed) {
        const ch = e.room >= 0 ? this.world.chambers[e.room] : null;
        if (ch && ch.brood > 0) ch.brood--;
        e.claimed = false;
        e.room = -1;
      }
      ant.egg = null;
    }
    ant.project = 0;
    ant.digIdx = -1;
    ant.defenseTarget = null;
  }

  // Called by the creature system: drop everything and see off the intruder
  recruit(ant, creature) {
    this._dropTask(ant);
    ant.carry = CARRY.NONE;
    ant.load = 0;
    ant.pause = 0;
    this._go(ant, STATE.DEFENDING);
    ant.defenseTarget = creature;
    ant.timer = this.world.tick + 1500;   // give up the chase after this
  }

  // On a warm afternoon the colony sends its winged ants out through the entrance
  startNuptialFlight(n) {
    const w = this.world;
    const rooms = w.chambers.filter(c => c.built && c.tiles.length && c.cy < SR + 46);
    if (!rooms.length) return;
    for (let k = 0; k < n; k++) {
      const ch = rooms[(Math.random() * rooms.length) | 0];
      const t = ch.tiles[(Math.random() * ch.tiles.length) | 0];
      const ant = makeAnt(ROLE.ALATE, 0, 0);
      this._place(ant, t % W, (t / W) | 0);
      ant.state = STATE.FLYING;
      ant.pause = randInt(0, 700);          // they leave in a trickle, not all at once
      ant.dir = Math.random() < 0.5 ? -1 : 1;
      this.ants.push(ant);
      this._alates++;
    }
  }

  // ── Movement ─────────────────────────────────────────────────────────────

  // Walking target: the middle of a tile underground, down on the ground line above it
  _way(ant, tx, ty) {
    ant.wx = tx + 0.5 + ant.jx;
    ant.wy = ty < SR ? ty + 0.72 + ant.jy * 0.3 : ty + 0.5 + ant.jy;
  }

  _wayI(ant, i) {
    this._way(ant, i % W, (i / W) | 0);
  }

  _place(ant, tx, ty) {
    this._way(ant, tx, ty);
    ant.x = ant.px = ant.wx;
    ant.y = ant.py = ant.wy;
  }

  // Step towards the waypoint. Returns −1 while still on the way, otherwise the
  // part of the step that was left over on arrival.
  _walk(ant, speed) {
    const dx = ant.wx - ant.x, dy = ant.wy - ant.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > speed) {
      ant.x += dx / d * speed;
      ant.y += dy / d * speed;
      ant.heading = Math.atan2(dy, dx);
      return -1;
    }
    if (d > 0.001) ant.heading = Math.atan2(dy, dx);
    ant.x = ant.wx;
    ant.y = ant.wy;
    return speed - d;
  }

  _step(ant) {
    const w = this.world;
    if (ant.pause > 0) {
      ant.pause--;
    } else {
      let speed = CONFIG.ANT_SPEED * ant.speedMul * (1 + w.alarmLevel * 0.25);
      if (ant.carry) speed *= 0.8;
      if (ant.state === STATE.DEFENDING) speed *= 1.5;
      else if (ant.y < SR && w.sky.rain > 0.3) speed *= 1.3;   // nobody dawdles in the rain

      const left = this._walk(ant, speed);
      if (left >= 0) {
        // standing on its waypoint: time to decide what comes next
        const i = (ant.y | 0) * W + (ant.x | 0);
        if (!w.passable[i]) {
          this._rescue(ant);
        } else {
          this._scent(ant, i);
          this._act(ant, i);
          if (ant.pause === 0 && left > 0.001) this._walk(ant, left);
        }
      }
    }
    if (ant.egg && ant.egg.carried) { ant.egg.x = ant.x; ant.egg.y = ant.y; }

    ant.moving = ant.x !== ant.px || ant.y !== ant.py;
    if (ant.moving && ++ant.animTimer >= 4) { ant.animTimer = 0; ant.animFrame = (ant.animFrame + 1) % 3; }
    this._turn(ant);
  }

  // Swing the body round towards the direction of travel
  _turn(ant) {
    let da = ant.heading - ant.angle;
    if (da > Math.PI) da -= TAU; else if (da < -Math.PI) da += TAU;
    const R = CONFIG.ANT_TURN_RATE;
    ant.angle += da > R ? R : da < -R ? -R : da;
    if (ant.angle > Math.PI) ant.angle -= TAU; else if (ant.angle < -Math.PI) ant.angle += TAU;
  }

  // Pheromone: a strong food trail from laden ants, a faint one from those heading out
  _scent(ant, i) {
    const w = this.world, s = ant.state;
    if (s === STATE.CARRYING_FOOD) {
      const v = w.pheromoneFood[i] + CONFIG.PHER_CARRY_DEPOSIT;
      w.pheromoneFood[i] = v > 1 ? 1 : v;
    } else if (s === STATE.SEEKING_FOOD || s === STATE.SEEKING_WATER || s === STATE.SCOUTING) {
      const v = w.pheromoneHome[i] + CONFIG.PHER_OUT_DEPOSIT;
      w.pheromoneHome[i] = v > 1 ? 1 : v;
    }
  }

  // The tile under the ant has filled in (the mound grew, a save was loaded oddly…)
  _rescue(ant) {
    const w = this.world, P = w.passable;
    const x = Math.max(GT + 1, Math.min(W - GT - 2, ant.x | 0)), y = ant.y | 0;
    this.rescues++;
    if (y < SR + 2) {
      // on the surface: simply stand on top of whatever landed here
      this._place(ant, x, w.groundRow(x));
      return;
    }
    this._dropTask(ant);
    ant.carry = CARRY.NONE;
    this._go(ant, STATE.IDLE);
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 1 || ny < 1 || nx >= W - 1 || ny >= H - 1) continue;
          if (P[ny * W + nx]) { this._place(ant, nx, ny); return; }
        }
      }
    }
    const q = w.queenChamberPos;
    this._place(ant, q.x, q.y);
  }

  // Follow a distance field one tile downhill. 0 = arrived, 1 = stepping, −1 = no way.
  // Among the tiles that lead closer, the ant favours the one most in line with the
  // way it is already walking, which is what keeps the streams smooth.
  _follow(ant, i, field) {
    const D = field.dist, d = D[i];
    if (d === 0) return 0;
    if (d === FAR) return -1;
    const P = this.world.passable, h = ant.heading;
    let best = -1, bs = -1e9;
    for (let n = 0; n < 8; n++) {
      const j = i + NO[n];
      const g = d - D[j];
      if (g <= 0 || !P[j]) continue;
      if (n > 3 && !P[i + NX[n]] && !P[i + NY[n] * W]) continue;   // no squeezing between two solid corners
      let s = g / NL[n] + Math.cos(NA[n] - h) * 0.3 + Math.random() * 0.25;
      if (j < SKY && P[j + W]) s -= 0.6;                            // keep feet on the ground up top
      if (s > bs) { bs = s; best = j; }
    }
    if (best < 0) return -1;
    this._wayI(ant, best);
    return 1;
  }

  // Straight-line step across a chamber. 0 = arrived, 1 = stepping, −1 = blocked.
  _toward(ant, i, ti) {
    if (i === ti) return 0;
    const P = this.world.passable;
    const ox = ti % W - i % W, oy = ((ti / W) | 0) - ((i / W) | 0);
    let best = -1, bd = ox * ox + oy * oy;
    for (let n = 0; n < 8; n++) {
      const j = i + NO[n];
      if (!P[j]) continue;
      if (n > 3 && !P[i + NX[n]] && !P[i + NY[n] * W]) continue;
      const dx = ox - NX[n], dy = oy - NY[n];
      const d = dx * dx + dy * dy + Math.random() * 0.4;
      if (d < bd) { bd = d; best = j; }
    }
    if (best < 0) return -1;
    this._wayI(ant, best);
    return 1;
  }

  // Head for a particular tile: along the path field to its chamber, then straight across
  _approach(ant, i, ti) {
    if (i === ti) return 0;
    const R = this.world.roomId, r = R[ti];
    if (r === 0) return this._follow(ant, i, this.nav.point(ti));
    if (R[i] !== r) return this._follow(ant, i, this.nav.room(r - 1));
    return this._toward(ant, i, ti);
  }

  // Head for a spot in a chamber, choosing the spot on the first call
  _goRoom(ant, i, ch, pick) {
    const R = this.world.roomId, id = ch.id + 1;
    if (ant.spot < 0 || R[ant.spot] !== id) {
      ant.spot = ch.tiles.length ? pick.call(this, ch) : -1;
      if (!(ant.spot >= 0)) { ant.spot = -1; return R[i] === id ? 0 : -1; }
    }
    const r = this._approach(ant, i, ant.spot);
    return r < 0 && R[i] === id ? 0 : r;   // can't get any closer, but it is in the room: good enough
  }

  // One step along the ground. False at the edge of the farm.
  _surfaceStep(ant, ix, dir) {
    const nx = ix + dir;
    if (nx < GT + 1 || nx > W - GT - 2) return false;
    this._way(ant, nx, this.world.groundRow(nx));
    return true;
  }

  // One ambling step: mostly onward, sometimes veering, hardly ever doubling back
  _wanderStep(ant, i) {
    const P = this.world.passable, h = ant.heading;
    let tot = 0;
    for (let n = 0; n < 8; n++) {
      const j = i + NO[n];
      PICK[n] = 0;
      if (j < NEST || !P[j]) continue;
      if (n > 3 && !P[i + NX[n]] && !P[i + NY[n] * W]) continue;
      let da = Math.abs(NA[n] - h);
      if (da > Math.PI) da = TAU - da;
      tot += PICK[n] = da < 0.4 ? 10 : da < 1.2 ? 5 : da < 2.0 ? 1.2 : da < 2.75 ? 0.25 : 0.05;
    }
    if (tot === 0) return false;
    let r = Math.random() * tot;
    for (let n = 0; n < 8; n++) {
      if ((r -= PICK[n]) < 0) { this._wayI(ant, i + NO[n]); return true; }
    }
    return false;
  }

  // The way is blocked (a path field may be mid-repair): wait a little before giving up
  _wait(ant) {
    if (ant.fail++ >= 4) return false;
    ant.pause = randInt(5, 12);
    return true;
  }

  _go(ant, state) {
    ant.state = state;
    ant.spot = -1;
    ant.room = -1;
    ant.sub = 0;
    ant.fail = 0;
    ant.timer = 0;
  }

  // ── Places ───────────────────────────────────────────────────────────────

  // Each ant sleeps in a chamber that suits its caste
  _pickHome(ant) {
    const w = this.world, role = ant.role;
    let tot = 0, pick = w.queenRoom;
    for (const ch of w.chambers) {
      if (!ch.built || ch.id === 0 || !ch.tiles.length) continue;   // nobody beds down in the entrance hall
      let f;
      if (role === ROLE.NURSE) {
        f = ch.type === ROOM.NURSERY ? 6 : ch.type === ROOM.QUEEN ? 2 : 0.5;
      } else if (role === ROLE.FORAGER || role === ROLE.EXPLORER) {
        const k = 1 / (1 + (ch.cy - SR) / 30);                      // close to the way out
        f = k * k;
      } else {
        f = ch.type === ROOM.DEEP ? 2 : ch.type === ROOM.GENERIC ? 1 : ch.type === ROOM.QUEEN ? 0.5 : 0.7;
      }
      const wt = ch.tiles.length * f;
      tot += wt;
      if (Math.random() * tot < wt) pick = ch.id;
    }
    ant.home = pick;
    ant.homeVer = w.roomVersion;
  }

  _spotAny(ch) {
    return ch.tiles[(Math.random() * ch.tiles.length) | 0];
  }

  // Towards the bottom of the room, where sleepers pile up
  _spotFloor(ch) {
    const f = ch.floor;
    return f.length ? f[(Math.random() * Math.random() * f.length) | 0] : this._spotAny(ch);
  }

  // At the edge of the food pile
  _spotPile(ch) {
    const f = ch.floor;
    if (!f.length) return this._spotAny(ch);
    const top = Math.ceil(ch.held / CONFIG.STORE_PER_TILE) + randInt(-2, 2);
    return f[Math.max(0, Math.min(f.length - 1, top))];
  }

  // Among the brood, which is laid out from the bottom of the nursery up
  _spotBrood(ch) {
    const f = ch.floor;
    if (!f.length) return this._spotAny(ch);
    return f[Math.min(f.length - 1, (Math.random() * Math.min(f.length, ch.brood + 6)) | 0)];
  }

  // Within reach of the queen
  _spotQueen(ch) {
    const w = this.world, q = this._queen, id = ch.id + 1;
    for (let k = 0; q && k < 8; k++) {
      const a = Math.random() * TAU, r = rand(1.6, 3.6);
      const j = Math.floor(q.y + Math.sin(a) * r * 0.7) * W + Math.floor(q.x + Math.cos(a) * r * 1.3);
      if (w.roomId[j] === id && w.passable[j]) return j;
    }
    return this._spotAny(ch);
  }

  // Somewhere to stroll to: usually the nearer of two chambers picked at random
  _anyRoom(ant) {
    const cs = this.world.chambers;
    let a = null, b = null;
    for (let t = 0; t < 14 && !b; t++) {
      const c = cs[(Math.random() * cs.length) | 0];
      if (!c.built || !c.tiles.length) continue;
      if (!a) a = c; else if (c !== a) b = c;
    }
    if (!a) return this.world.queenRoom;
    if (!b) return a.id;
    const da = (a.cx - ant.x) ** 2 + (a.cy - ant.y) ** 2;
    const db = (b.cx - ant.x) ** 2 + (b.cy - ant.y) ** 2;
    const near = da < db ? a : b, far = da < db ? b : a;
    return (Math.random() < 0.7 ? near : far).id;
  }

  // A nursery with brood in it, the fuller the likelier
  _broodRoom() {
    let pick = null, tot = 0;
    for (const ch of this.world.nurseries) {
      if (ch.brood <= 0) continue;
      tot += ch.brood;
      if (Math.random() * tot < ch.brood) pick = ch;
    }
    return pick;
  }

  // Where a load of food goes: any of the stores, the big ones more often
  _anyStore() {
    let pick = null, tot = 0;
    for (const ch of this.world.stores) {
      tot += ch.cap;
      if (Math.random() * tot < ch.cap) pick = ch;
    }
    return pick;
  }

  // A store with something on the shelves
  _stockedStore() {
    let pick = null, n = 0;
    for (const ch of this.world.stores) {
      if (ch.held > 8 && Math.random() * ++n < 1) pick = ch;
    }
    return pick;
  }

  // ── Deciding what to do ──────────────────────────────────────────────────

  _act(ant, i) {
    switch (ant.state) {
      case STATE.IDLE:           this._idle(ant, i); break;
      case STATE.WANDERING:      this._wander(ant, i); break;
      case STATE.DIGGING:        this._dig(ant, i); break;
      case STATE.SEEKING_FOOD:   this._seek(ant, i, false); break;
      case STATE.SEEKING_WATER:  this._seek(ant, i, true); break;
      case STATE.CARRYING_FOOD:  this._deliver(ant, i); break;
      case STATE.NURSING:        this._tend(ant, i); break;
      case STATE.RESTING:        this._rest(ant); break;
      case STATE.RETURNING:      this._return(ant, i); break;
      case STATE.DUMPING_DIRT:   this._dump(ant, i); break;
      case STATE.DEFENDING:      this._defend(ant, i); break;
      case STATE.FEASTING:       this._feast(ant, i); break;
      case STATE.GOING_TO_DIG:   this._toDig(ant, i); break;
      case STATE.FETCHING_BROOD: this._fetch(ant, i); break;
      case STATE.CARRYING_BROOD: this._carryBrood(ant, i); break;
      case STATE.PATROLLING:     this._patrol(ant, i); break;
      case STATE.ATTENDING:      this._attend(ant, i); break;
      case STATE.GOING_TO_REST:  this._toBed(ant, i); break;
      case STATE.SCOUTING:       this._scout(ant, i); break;
      case STATE.FLYING:         this._emerge(ant, i); break;
      case STATE.HAULING:        this._haul(ant, i); break;
      default:                   this._go(ant, STATE.IDLE);
    }
  }

  _idle(ant, i) {
    if (ant.role === ROLE.ROGUE) { this._rogue(ant, i); return; }
    if (this.world.sky.isNight && !ant.owl) { this._go(ant, STATE.GOING_TO_REST); return; }
    switch (ant.role) {
      case ROLE.FORAGER:  this._forage(ant, i); break;
      case ROLE.DIGGER:   if (!this._joinDig(ant, null)) this._loiter(ant, i); break;
      case ROLE.NURSE:    this._nurse(ant, i); break;
      case ROLE.EXPLORER: this._explore(ant, i); break;
      default:            this._work(ant, i);
    }
  }

  _forage(ant, i) {
    const w = this.world, nav = this.nav;
    if (w.sky.rain < 0.3) {
      if (w.waterStore < w.waterCap * 0.6 && Math.random() < 0.5 && nav.water().dist[i] !== FAR) {
        this._go(ant, STATE.SEEKING_WATER);
        return;
      }
      if (w.foodStore < w.foodCap * 0.97) {
        const c = this._creatures && this._creatures.corpse();
        if (c && Math.random() < 0.4) {
          this._go(ant, STATE.FEASTING);
          ant.defenseTarget = c;
          return;
        }
        if (nav.food().dist[i] !== FAR) { this._go(ant, STATE.SEEKING_FOOD); return; }
        if (Math.random() < 0.5) { this._go(ant, STATE.SCOUTING); return; }
      } else if (Math.random() < 0.06) {
        this._go(ant, STATE.SCOUTING);   // the larder is full, but somebody always goes for a look
        return;
      }
    }
    this._loiter(ant, i);
  }

  // Sign on to a dig. Diggers spread themselves over the projects that are short-handed.
  _joinDig(ant, kind) {
    let pick = null, tot = 0;
    for (const p of this.world.projects) {
      if (kind && p.kind !== kind) continue;
      const free = p.cap - p.crew;
      if (free <= 0 || !p.frontier.length) continue;
      tot += free;
      if (Math.random() * tot < free) pick = p;
    }
    if (!pick) return false;
    this._go(ant, STATE.GOING_TO_DIG);
    ant.project = pick.id;
    pick.crew++;
    return true;
  }

  _nurse(ant, i) {
    if (this._loose > 0 && this._fetchBrood(ant)) return;
    const r = Math.random();
    if (r < 0.6) {
      const ch = this._broodRoom();
      if (ch) { this._go(ant, STATE.NURSING); ant.room = ch.id; return; }
    }
    if (r < 0.85 && this._attendQueen(ant)) return;
    this._loiter(ant, i);
  }

  _work(ant, i) {
    if (this._loose > 2 && Math.random() < 0.5 && this._fetchBrood(ant)) return;
    const r = Math.random();
    if (r < 0.25) {
      const ch = this._stockedStore();
      if (ch) { this._go(ant, STATE.HAULING); ant.room = ch.id; return; }
    } else if (r < 0.40) {
      if (this._attendQueen(ant)) return;
    } else if (r < 0.60) {
      if (this._joinDig(ant, null)) return;
    } else if (r < 0.70) {
      const c = this._creatures && this._creatures.corpse();
      if (c && this.world.sky.rain < 0.3) { this._go(ant, STATE.FEASTING); ant.defenseTarget = c; return; }
    }
    this._loiter(ant, i);
  }

  _explore(ant, i) {
    if (this._joinDig(ant, 'prospect')) return;
    const sky = this.world.sky, r = Math.random();
    if (r < 0.45 && sky.rain < 0.3 && !sky.isNight) { this._go(ant, STATE.SCOUTING); return; }
    if (r < 0.75 && this._joinDig(ant, null)) return;
    this._loiter(ant, i);
  }

  // Rogues keep no hours and take no orders
  _rogue(ant, i) {
    const r = Math.random();
    if (r < 0.4) { this._go(ant, STATE.SCOUTING); return; }
    const ps = this.world.projects;
    if (r < 0.7 && ps.length) {
      this._go(ant, STATE.GOING_TO_DIG);
      ant.project = ps[(Math.random() * ps.length) | 0].id;
      return;
    }
    this._go(ant, STATE.WANDERING);
    ant.timer = randInt(60, 200);
  }

  _attendQueen(ant) {
    if (this._attending >= Math.min(14, 5 + this.population / 40)) return false;
    this._go(ant, STATE.ATTENDING);
    this._attending++;
    return true;
  }

  // Claim an egg from the queen's chamber and a place for it in a nursery
  _fetchBrood(ant) {
    let room = null;
    // brood is kept together: the nursery nearest the queen fills up before the next
    // one is started, with a little floor left clear in each
    for (const ch of this.world.nurseries) {
      if (ch.brood < ch.cap * 0.8) { room = ch; break; }
    }
    if (!room) {
      for (const ch of this.world.nurseries) if (ch.brood < ch.cap) { room = ch; break; }
    }
    if (!room) return false;
    const now = this.world.tick;
    for (const e of this.eggs) {
      if (e.placed || e.claimed || e.miss > now) continue;
      e.claimed = true;
      e.room = room.id;
      room.brood++;
      this._loose--;
      this._go(ant, STATE.FETCHING_BROOD);
      ant.egg = e;
      return true;
    }
    return false;
  }

  // Nothing pressing: eat, stroll, potter about or doze
  _loiter(ant, i) {
    const r = Math.random();
    if (ant.hunger > 45 && r < 0.5) {
      const ch = this._stockedStore();
      if (ch) { this._go(ant, STATE.PATROLLING); ant.room = ch.id; ant.sub = 1; return; }
    }
    if (r < 0.55) {
      this._go(ant, STATE.PATROLLING);
      ant.room = this._anyRoom(ant);
    } else if (r < 0.8 && i >= NEST) {
      this._go(ant, STATE.WANDERING);
      ant.timer = randInt(8, 32);
    } else {
      this._go(ant, STATE.GOING_TO_REST);
      ant.timer = randInt(300, 900);   // a nap, not a night's sleep
    }
  }

  // ── States ───────────────────────────────────────────────────────────────

  _wander(ant, i) {
    if (ant.timer-- <= 0 || !this._wanderStep(ant, i)) { this._go(ant, STATE.IDLE); return; }
    if (Math.random() < 0.05) ant.pause = randInt(6, 36);
  }

  // Out to the nearest food or water, and pick up a load
  _seek(ant, i, water) {
    const w = this.world, sky = w.sky;
    if (sky.rain > 0.3 || (sky.isNight && !ant.owl)) { this._go(ant, STATE.RETURNING); return; }
    const r = this._follow(ant, i, water ? this.nav.water() : this.nav.food());
    if (r === 1) return;
    if (r < 0) {
      if (this._wait(ant)) return;
      // nothing left to fetch: those already outside keep looking
      this._go(ant, i < SKY ? STATE.SCOUTING : STATE.IDLE);
      return;
    }
    const type = water ? TILE.WATER : TILE.FOOD;
    if (w.tiles[i] !== type) {
      // somebody got here first and the field has not caught up yet
      this.nav.invalidate(water ? 'water' : 'food');
      ant.pause = 4;
      return;
    }
    const amounts = water ? w.waterAmount : w.foodAmount;
    const take = Math.min(water ? CONFIG.WATER_PER_TRIP : CONFIG.FOOD_PER_TRIP, amounts[i]);
    amounts[i] -= take;
    if (amounts[i] <= 0.5) w.clearItem(i);
    else { w.dirtyTiles.add(i); w.dirty = true; }
    this._go(ant, STATE.CARRYING_FOOD);
    ant.carry = water ? CARRY.WATER : CARRY.FOOD;
    ant.load = take;
    ant.pause = 12;
  }

  // Home with a load: food to whichever store is being filled, water to queen and brood
  _deliver(ant, i) {
    const w = this.world;
    let ch = ant.room >= 0 ? w.chambers[ant.room] : null;
    if (ant.carry === CARRY.WATER) {
      if (!ch) {
        const n = this._broodRoom();
        ch = n && Math.random() < 0.5 ? n : w.chambers[w.queenRoom];
      }
    } else if (!ch || ch.type !== ROOM.FOOD) {
      ch = this._anyStore() || w.chambers[w.queenRoom];
    }
    if (ant.room !== ch.id) { ant.room = ch.id; ant.spot = -1; }

    const r = this._goRoom(ant, i, ch, ch.type === ROOM.FOOD ? this._spotPile : this._spotAny);
    if (r === 1) return;
    if (r < 0 && this._wait(ant)) return;
    if (ant.carry === CARRY.WATER) w.waterStore = Math.min(w.waterCap, w.waterStore + ant.load);
    else w.foodStore = Math.min(w.foodCap, w.foodStore + ant.load);
    this._go(ant, STATE.IDLE);
    ant.carry = CARRY.NONE;
    ant.load = 0;
    ant.pause = randInt(10, 22);
  }

  // Roam the lawn looking for something to eat
  _scout(ant, i) {
    const w = this.world, sky = w.sky;
    if (ant.role !== ROLE.ROGUE && (sky.rain > 0.3 || (sky.isNight && !ant.owl))) {
      this._go(ant, STATE.RETURNING);
      return;
    }
    if (ant.sub === 0) {
      if (i >= SKY) {
        const r = this._follow(ant, i, this.nav.entrance());
        if (r === 1) return;
        if (r < 0) { if (!this._wait(ant)) this._go(ant, STATE.IDLE); return; }
      }
      ant.sub = 1;
      ant.dir = Math.random() < 0.5 ? -1 : 1;
      ant.timer = randInt(20, 100);
    }
    if (ant.role === ROLE.FORAGER && this.nav.food().dist[i] !== FAR) {
      this._go(ant, STATE.SEEKING_FOOD);
      return;
    }
    if (ant.timer-- <= 0 || !this._surfaceStep(ant, i % W, ant.dir)) {
      // far enough: try the other direction once, then head home
      if (ant.fail++ < 1 && Math.random() < 0.5) { ant.dir = -ant.dir; ant.timer = randInt(20, 70); }
      else this._go(ant, STATE.RETURNING);
      return;
    }
    if (Math.random() < 0.04) ant.pause = randInt(10, 45);   // stop and taste the air
  }

  // Back below ground
  _return(ant, i) {
    if (i >= (SR + 4) * W) { this._go(ant, STATE.IDLE); return; }
    const r = this._follow(ant, i, this.nav.room(0));
    if (r === 1) return;
    if (r < 0 && this._wait(ant)) return;
    this._go(ant, STATE.IDLE);
  }

  // Walk to the working face of the project
  _toDig(ant, i) {
    const w = this.world, p = w.projectById.get(ant.project);
    if (!p) { ant.project = 0; this._go(ant, STATE.IDLE); return; }
    const r = this._follow(ant, i, this.nav.dig(p));
    if (r === 1) return;
    if (r === 0) {
      const j = this._pickFace(i, p);
      if (j >= 0) {
        ant.digIdx = j;
        ant.state = STATE.DIGGING;
        ant.heading = Math.atan2(((j / W) | 0) - ((i / W) | 0), j % W - i % W);
        return;
      }
      if (!this._faceSeen) this.nav.invalidate('d' + p.id);   // the face has moved on
    }
    // crowded out, or no way through yet: hang about, then look for other work
    if (ant.fail++ < 8) {
      if (!(r === 0 && Math.random() < 0.6 && this._wanderStep(ant, i))) ant.pause = randInt(8, 26);
      return;
    }
    ant.project = 0;
    this._go(ant, STATE.IDLE);
  }

  // A soil tile of the project next to this one that has room for another digger
  _pickFace(i, p) {
    const w = this.world, T = w.tiles, a = w.digCrew, b = w.digCrewPrev;
    let best = -1, bn = 2;
    this._faceSeen = false;
    for (let n = 0; n < 4; n++) {
      const j = i + NO[n];
      if (T[j] !== TILE.SOIL || !p.frontier.includes(j)) continue;
      this._faceSeen = true;
      const c = Math.max(a.get(j) || 0, b.get(j) || 0);
      if (c < bn) { bn = c; best = j; }
    }
    return best;
  }

  _dig(ant, i) {
    const w = this.world, j = ant.digIdx;
    if (j < 0 || w.tiles[j] !== TILE.SOIL) { this._afterDig(ant, j < 0 ? i : j); return; }   // a workmate broke through
    if (!w.projectById.has(ant.project)) { ant.digIdx = -1; ant.project = 0; this._go(ant, STATE.IDLE); return; }
    const n = w.digCrew.get(j) || 0;
    if (n >= 2) {
      // two is company at one tile
      ant.digIdx = -1;
      ant.state = STATE.GOING_TO_DIG;
      ant.pause = randInt(10, 30);
      return;
    }
    w.digCrew.set(j, n + 1);
    if (++ant.animTimer >= 4) { ant.animTimer = 0; ant.animFrame = (ant.animFrame + 1) % 3; }
    if (w.digTick(j)) {
      w.finishDig(j);
      this._afterDig(ant, j);
    }
  }

  // The tile is through. Some of the spoil is packed into the walls; the rest is
  // carried up to the mound — less often from deep down, where it is a long walk.
  _afterDig(ant, j) {
    const depth = ((j / W) | 0) - SR;
    ant.digIdx = -1;
    if (Math.random() < Math.max(0.35, Math.min(0.7, 0.75 - depth / 260))) {
      this._go(ant, STATE.DUMPING_DIRT);
      ant.project = 0;
      ant.carry = CARRY.DIRT;
      ant.pause = 6;
    } else {
      this._go(ant, STATE.GOING_TO_DIG);
    }
  }

  // Up the shaft with a jawful of soil and out onto the mound
  _dump(ant, i) {
    const w = this.world;
    if (ant.sub === 0) {
      const r = this._follow(ant, i, this.nav.entrance());
      if (r === 1) return;
      if (r < 0) {
        if (this._wait(ant)) return;
        ant.carry = CARRY.NONE;
        this._go(ant, STATE.IDLE);
        return;
      }
      ant.dumpX = w.pickDumpColumn();
      ant.sub = 1;
    }
    const ix = i % W;
    if (ix !== ant.dumpX && this._surfaceStep(ant, ix, ant.dumpX > ix ? 1 : -1)) return;
    w.depositDirt(ix);
    w.fx.push({ t: 'drop', x: ant.x, y: ant.y });
    this._go(ant, STATE.IDLE);
    ant.carry = CARRY.NONE;
    ant.pause = randInt(6, 14);
  }

  // To a loose egg…
  _fetch(ant, i) {
    const e = ant.egg;
    if (!e || e.done || e.placed) { this._dropTask(ant); this._go(ant, STATE.IDLE); return; }
    const r = this._approach(ant, i, (e.y | 0) * W + (e.x | 0));
    if (r === 1) return;
    if (r < 0) {
      if (this._wait(ant)) return;
      e.miss = this.world.tick + 1500;   // out of reach for now: leave it be for a while
      this._dropTask(ant);
      this._go(ant, STATE.IDLE);
      return;
    }
    e.carried = true;
    this._go(ant, STATE.CARRYING_BROOD);
    ant.carry = CARRY.EGG;
    ant.pause = 10;
  }

  // …and off to the nursery with it
  _carryBrood(ant, i) {
    const w = this.world, e = ant.egg;
    const ch = e ? w.chambers[e.room] : null;
    if (!e || e.done || !ch) { this._dropTask(ant); ant.carry = CARRY.NONE; this._go(ant, STATE.IDLE); return; }
    const r = this._goRoom(ant, i, ch, this._spotBrood);
    if (r === 1) return;
    if (r < 0) {
      if (this._wait(ant)) return;
      this._dropTask(ant);
    } else {
      e.carried = false;
      e.claimed = false;
      e.placed = true;
      e.x = (ant.x | 0) + rand(0.15, 0.85);
      e.y = (ant.y | 0) + rand(0.3, 0.85);
      ant.egg = null;
    }
    this._go(ant, STATE.IDLE);
    ant.carry = CARRY.NONE;
    ant.pause = randInt(12, 24);
  }

  // Lick, turn and feed the brood: tended nurseries hatch sooner
  _tend(ant, i) {
    const ch = this.world.chambers[ant.room];
    if (!ch || ch.brood <= 0) { this._go(ant, STATE.IDLE); return; }
    if (ant.sub === 0) {
      const r = this._goRoom(ant, i, ch, this._spotBrood);
      if (r === 1) return;
      if (r < 0 && this._wait(ant)) return;
      ch.care = Math.min(2.5, ch.care + 0.35);
      ant.sub = 1;
      ant.pause = randInt(40, 90);
      return;
    }
    if (Math.random() < 0.5) { ant.sub = 0; ant.spot = -1; ant.fail = 0; }   // on to the next one
    else this._go(ant, STATE.IDLE);
  }

  // Wait on the queen
  _attend(ant, i) {
    const w = this.world, q = this._queen;
    if (ant.sub === 0) {
      const r = this._goRoom(ant, i, w.chambers[w.queenRoom], this._spotQueen);
      if (r === 1) return;
      if (r < 0 && this._wait(ant)) return;
      ant.heading = Math.atan2(q.y - ant.y, q.x - ant.x);
      ant.sub = 1;
      ant.pause = randInt(60, 200);
      return;
    }
    this._go(ant, STATE.IDLE);
  }

  // Stroll to another chamber — or to the larder for a meal
  _patrol(ant, i) {
    const w = this.world, ch = w.chambers[ant.room];
    if (!ch || !ch.built || ant.sub === 2) { this._go(ant, STATE.IDLE); return; }
    const r = this._goRoom(ant, i, ch, ant.sub === 1 ? this._spotPile : this._spotAny);
    if (r === 1) return;
    if (r < 0 && this._wait(ant)) return;
    if (ant.sub === 1 && w.foodStore > 1) this._eat(ant);
    ant.sub = 2;
    ant.pause = randInt(20, 90);
  }

  // Carry food from the store to the queen or the brood
  _haul(ant, i) {
    const w = this.world, ch = w.chambers[ant.room];
    if (!ch || ant.sub === 2) { ant.carry = CARRY.NONE; this._go(ant, STATE.IDLE); return; }
    if (ant.sub === 0) {
      if (ch.held < 4) { this._go(ant, STATE.IDLE); return; }
      const r = this._goRoom(ant, i, ch, this._spotPile);
      if (r === 1) return;
      if (r < 0 && this._wait(ant)) return;
      const n = this._broodRoom();
      ant.room = n && Math.random() < 0.6 ? n.id : w.queenRoom;
      ant.spot = -1;
      ant.fail = 0;
      ant.sub = 1;
      ant.carry = CARRY.FOOD;
      ant.pause = 15;
      return;
    }
    const r = this._goRoom(ant, i, ch, ch.type === ROOM.QUEEN ? this._spotQueen : this._spotBrood);
    if (r === 1) return;
    if (r < 0 && this._wait(ant)) return;
    if (ch.type === ROOM.NURSERY) ch.care = Math.min(2.5, ch.care + 0.2);
    ant.carry = CARRY.NONE;
    ant.sub = 2;
    ant.pause = randInt(20, 40);
  }

  // Home to sleep. ant.timer > 0 means a nap of that many ticks; 0 means until morning.
  _toBed(ant, i) {
    const w = this.world;
    let ch = w.chambers[ant.home];
    if (!ch || !ch.built || (ant.homeVer !== w.roomVersion && Math.random() < 0.5)) {
      this._pickHome(ant);            // new rooms have been dug: maybe move in
      ch = w.chambers[ant.home];
    }
    ant.homeVer = w.roomVersion;
    const r = this._goRoom(ant, i, ch, this._spotFloor);
    if (r === 1) return;
    if (r < 0 && this._wait(ant)) return;
    ant.state = STATE.RESTING;
    ant.pause = randInt(20, 40);
  }

  _rest(ant) {
    const sky = this.world.sky;
    if (ant.timer > 0) {
      ant.timer -= 30;
      if (ant.timer <= 0) { this._go(ant, STATE.IDLE); return; }
    } else if (sky.isNight ? ant.owl : sky.sinceDawn >= ant.lag) {
      this._go(ant, STATE.IDLE);
      return;
    }
    ant.pause = 30;
  }

  // Charge a creature on the surface and bite it
  _defend(ant, i) {
    const c = ant.defenseTarget, cs = this._creatures;
    if (!c || !cs || c.gone || this.world.tick > ant.timer) {
      ant.defenseTarget = null;
      this._go(ant, STATE.RETURNING);
      return;
    }
    if (c.dead) {
      // it's down: butcher it
      if (c.foodChunks > 0) { this._go(ant, STATE.FEASTING); ant.defenseTarget = c; }
      else { ant.defenseTarget = null; this._go(ant, STATE.RETURNING); }
      return;
    }
    if (i >= SKY) {
      const r = this._follow(ant, i, this.nav.entrance());
      if (r < 0 && !this._wait(ant)) { ant.defenseTarget = null; this._go(ant, STATE.IDLE); }
      return;
    }
    const dx = c.x - ant.x;
    if (Math.abs(dx) < 1.3) {
      cs.damage(c, ant.role === ROLE.ROGUE ? 3 : 1);
      ant.heading = dx < 0 ? Math.PI : 0;
      ant.pause = 10;
      return;
    }
    if (!this._surfaceStep(ant, i % W, dx > 0 ? 1 : -1)) { ant.defenseTarget = null; this._go(ant, STATE.RETURNING); }
  }

  // Cut a piece off a dead creature and carry it home
  _feast(ant, i) {
    const c = ant.defenseTarget;
    if (!c || c.gone || c.foodChunks <= 0) {
      ant.defenseTarget = null;
      this._go(ant, STATE.RETURNING);
      return;
    }
    if (i >= SKY) {
      const r = this._follow(ant, i, this.nav.entrance());
      if (r < 0 && !this._wait(ant)) { ant.defenseTarget = null; this._go(ant, STATE.IDLE); }
      return;
    }
    const dx = c.x - ant.x;
    if (Math.abs(dx) < 1.3) {
      c.foodChunks--;
      this._go(ant, STATE.CARRYING_FOOD);
      ant.defenseTarget = null;
      ant.carry = CARRY.FOOD;
      ant.load = 12;
      ant.pause = 15;
      return;
    }
    if (!this._surfaceStep(ant, i % W, dx > 0 ? 1 : -1)) { ant.defenseTarget = null; this._go(ant, STATE.RETURNING); }
  }

  // ── Alates ───────────────────────────────────────────────────────────────

  // A winged ant climbs out of the nest and a little way up the mound
  _emerge(ant, i) {
    if (ant.sub === 0) {
      if (i >= SKY) {
        const r = this._follow(ant, i, this.nav.entrance());
        if (r === 1) return;
        if (r < 0 && this._wait(ant)) return;
      }
      ant.sub = 1;
      ant.timer = randInt(2, 11);
      return;
    }
    if (ant.timer-- > 0 && i < SKY && this._surfaceStep(ant, i % W, ant.dir)) return;
    // …spreads its wings, and is away
    ant.sub = 2;
    ant.pause = randInt(15, 130);
    ant.timer = randInt(260, 700);            // time spent swarming over the mound
    ant.wx = CX + 0.5 + rand(-16, 16);
    ant.wy = SR - rand(7, 14);
    ant.vx = ant.dir * rand(0.02, 0.07);
    ant.vy = -rand(0.04, 0.09);
  }

  // Returns false once the alate has flown out of the farm
  _tickAlate(ant) {
    if (ant.sub !== 2) { this._step(ant); return true; }
    if (ant.pause > 0) { ant.pause--; ant.moving = false; return true; }
    // circle a point above the mound for a while, then climb away
    if (--ant.timer === 0) { ant.wy = -14; ant.wx += rand(-30, 30); }
    ant.vx = (ant.vx + (ant.wx - ant.x) * 0.0025 + rand(-0.016, 0.016)) * 0.985;
    ant.vy = (ant.vy + (ant.wy - ant.y) * 0.0025 + rand(-0.016, 0.016)) * 0.985;
    const v = Math.hypot(ant.vx, ant.vy);
    if (v > 0.2) { ant.vx *= 0.2 / v; ant.vy *= 0.2 / v; }
    ant.x += ant.vx;
    ant.y += ant.vy;
    if (ant.timer > 0) {
      const floor = this.world.groundY(Math.max(1, Math.min(W - 1, ant.x))) - 1.2;
      if (ant.y > floor) { ant.y = floor; ant.vy = -Math.abs(ant.vy); }
    }
    ant.heading = Math.atan2(ant.vy, ant.vx);
    ant.moving = true;
    if (++ant.animTimer >= 2) { ant.animTimer = 0; ant.animFrame = (ant.animFrame + 1) % 3; }
    this._turn(ant);
    return ant.y > GT + 0.5 && ant.x > GT + 0.5 && ant.x < W - GT - 0.5;
  }

  // ── Saving ───────────────────────────────────────────────────────────────
  // Only what makes an ant that ant is kept; on loading everybody starts the
  // moment afresh from where they stood.

  save() {
    const r1 = v => Math.round(v * 10) / 10;
    return {
      ants: this.ants.filter(a => a.role !== ROLE.ALATE).map(a =>
        [a.role, r1(a.x), r1(a.y), Math.round(a.hunger), Math.round(a.hp), a.age, a.lifespan,
         a.owl ? 1 : 0, a.lag, a.home]),
      eggs: this.eggs.map(e =>
        [r1(e.x), r1(e.y), Math.round(e.hatchTimer), Math.round(e.total), e.placed ? 1 : 0, e.placed ? e.room : -1]),
      deaths: this.deaths,
      hatchCount: this._hatchCount,
      roleBoosts: this.roleBoosts,
    };
  }

  load(d) {
    this.ants = [];
    this.eggs = [];
    for (const a of d.ants) {
      const ant = makeAnt(a[0], a[1], a[2]);
      ant.hunger = a[3];
      ant.hp = a[4];
      ant.age = a[5];
      ant.lifespan = a[6];
      ant.owl = !!a[7];
      ant.lag = a[8];
      ant.home = a[9];
      this.ants.push(ant);
    }
    for (const e of d.eggs) {
      const egg = this.addEgg(e[0], e[1], !!e[4], e[5]);
      egg.hatchTimer = e[2];
      egg.total = e[3];
    }
    this.deaths = d.deaths || 0;
    this.recentDeaths = 0;
    this._hatchCount = d.hatchCount || 0;
    Object.assign(this.roleBoosts, d.roleBoosts);
    this._census();
    const w = this.world;
    for (const ch of w.chambers) ch.brood = 0;
    for (const e of this.eggs) {
      const ch = e.room >= 0 ? w.chambers[e.room] : null;
      if (ch) ch.brood++;
    }
  }
}
