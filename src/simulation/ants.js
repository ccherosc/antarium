import { TILE, ROLE, STATE, CONFIG } from '../config.js';
import { logEvent } from '../events.js';
import { GameState } from '../gameState.js';

let nextId = 0;

function randLifespan() {
  const base = CONFIG.ANT_LIFESPAN_MIN +
    Math.floor(Math.random() * (CONFIG.ANT_LIFESPAN_MAX - CONFIG.ANT_LIFESPAN_MIN));
  return GameState.mode === 'screensaver' ? base * 3 : base;
}

function makeAnt(role, x, y) {
  return {
    id: nextId++,
    role,
    x: x + (Math.random() - 0.5) * 0.5,
    y: y + (Math.random() - 0.5) * 0.5,
    state: STATE.WANDERING,
    hunger: Math.random() * 15,
    carryFood: false,
    carryWater: false,
    digTarget: null,
    digTicks: 0,
    restTicks: 0,
    moveTick: Math.floor(Math.random() * CONFIG.ANT_MOVE_TICKS),
    animFrame: Math.floor(Math.random() * 3),
    animTimer: Math.floor(Math.random() * 8),
    angle: Math.random() * Math.PI * 2,
    // Wander bias — refreshed periodically for organic movement
    wanderBias: { x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2 },
    wanderChangeTimer: Math.floor(Math.random() * 60),
    // Aging & death (improvement #1)
    age: 0,
    maxAge: randLifespan(),
    starvationTicks: 0,    // ticks at full hunger with no food
    // Forager search (improvement #2)
    searchTimer: 0,        // ticks spent looking for food; give up at FORAGER_TIMEOUT
  };
}

export class AntSystem {
  constructor(world) {
    this.world = world;
    this.ants = [];
    this.eggs = [];
    this.deaths = 0;       // total lifetime deaths
    this.recentDeaths = 0; // deaths in last 500 ticks (for dashboard)
    this._deathResetTimer = 0;
    this._hatchCount = 0;
    this.roleBoosts = { forager: 0, digger: 0, worker: 0, nurse: 0 };
    this._spawn();
  }

  _spawn() {
    const { COLONY_X: CX, COLONY_Y: CY } = CONFIG;
    for (let i = 0; i < CONFIG.INITIAL_WORKERS;  i++) this.ants.push(makeAnt(ROLE.WORKER,  CX + (Math.random()-0.5)*8, CY + (Math.random()-0.5)*6));
    for (let i = 0; i < CONFIG.INITIAL_DIGGERS;  i++) this.ants.push(makeAnt(ROLE.DIGGER,  CX + (Math.random()-0.5)*6, CY + (Math.random()-0.5)*4));
    for (let i = 0; i < CONFIG.INITIAL_FORAGERS; i++) this.ants.push(makeAnt(ROLE.FORAGER, CX + (Math.random()-0.5)*6, CY - 5 + Math.random()*3));
    for (let i = 0; i < CONFIG.INITIAL_NURSES;   i++) this.ants.push(makeAnt(ROLE.NURSE,   CX - 14 + (Math.random()-0.5)*4, CY + 8 + Math.random()*3));

    for (let i = 0; i < CONFIG.INITIAL_EGGS; i++) {
      this.eggs.push({
        x: CONFIG.COLONY_X - 14 + (Math.random()-0.5)*3,
        y: CONFIG.COLONY_Y + 8 + Math.random()*2,
        hatchTimer: 200 + Math.floor(Math.random() * CONFIG.EGG_HATCH_TICKS * 0.5),
        nurseBonus: 0,
      });
    }
  }

  update(deltaMs, queen) {
    const world = this.world;

    // ── Recent-deaths window reset ──────────────────────────────────────────
    this._deathResetTimer++;
    if (this._deathResetTimer > 500) { this.recentDeaths = 0; this._deathResetTimer = 0; }

    // ── Hatch eggs ──────────────────────────────────────────────────────────
    for (let i = this.eggs.length - 1; i >= 0; i--) {
      const egg = this.eggs[i];
      egg.hatchTimer -= 1 + egg.nurseBonus * 0.6;
      egg.nurseBonus = 0;
      if (egg.hatchTimer <= 0) {
        this.eggs.splice(i, 1);
        const bm = [1, 2, 4];
        const wf = 30 * bm[this.roleBoosts.forager];
        const wd = 25 * bm[this.roleBoosts.digger];
        const ww = 25 * bm[this.roleBoosts.worker];
        const wn = 20 * bm[this.roleBoosts.nurse];
        const wt = wf + wd + ww + wn;
        const rv = Math.random() * wt;
        const role = rv < wf           ? ROLE.FORAGER
                   : rv < wf + wd      ? ROLE.DIGGER
                   : rv < wf + wd + ww ? ROLE.WORKER
                   :                     ROLE.NURSE;
        this.ants.push(makeAnt(role, egg.x, egg.y));
        this._hatchCount++;
        if (this._hatchCount % 3 === 1) {
          const rn = role === ROLE.FORAGER ? 'forager' : role === ROLE.DIGGER ? 'digger'
                   : role === ROLE.WORKER  ? 'worker'  : 'nurse';
          logEvent(`Egg hatched — new ${rn}`);
        }
      }
    }

    // ── Update + age + kill ants ─────────────────────────────────────────────
    for (let i = this.ants.length - 1; i >= 0; i--) {
      const ant = this.ants[i];

      // Age every tick regardless of movement throttle
      ant.age++;

      // Natural death
      if (ant.age >= ant.maxAge) {
        this._killAnt(i); continue;
      }

      // Starvation death (disabled in screensaver — food always topped up)
      if (GameState.mode !== 'screensaver' && ant.hunger >= 99 && world.foodStore <= 0) {
        ant.starvationTicks++;
        if (ant.starvationTicks >= CONFIG.ANT_STARVATION_TICKS) {
          this._killAnt(i); continue;
        }
      } else {
        ant.starvationTicks = Math.max(0, ant.starvationTicks - 1);
      }

      this._updateAnt(ant, queen);
    }

    // ── Pheromone deposition (#2) ─────────────────────────────────────────
    // Done per-ant after movement so deposits land on the tile they just moved to
    for (const ant of this.ants) {
      const ix = Math.floor(ant.x), iy = Math.floor(ant.y);
      if (ix < 0 || ix >= world.width || iy < 0 || iy >= world.height) continue;
      const idx = world.idx(ix, iy);
      if (ant.carryFood) {
        // Strong trail on the way home — this is what other ants will follow
        world.pheromoneFood[idx] = Math.min(1, world.pheromoneFood[idx] + CONFIG.PHER_CARRY_DEPOSIT);
      } else {
        // Light trail going out
        world.pheromoneHome[idx] = Math.min(1, world.pheromoneHome[idx] + CONFIG.PHER_OUT_DEPOSIT);
      }
    }
  }

  _killAnt(index) {
    const ant = this.ants[index];
    if (ant.starvationTicks > 10) logEvent('An ant died of starvation');
    this.ants.splice(index, 1);
    this.deaths++;
    this.recentDeaths++;
  }

  _updateAnt(ant, queen) {
    const world = this.world;
    const { COLONY_X: CX, COLONY_Y: CY } = CONFIG;
    const stress = world.stress; // 0–1 colony stress (#7)

    // Animation
    ant.animTimer++;
    if (ant.animTimer >= 8) { ant.animTimer = 0; ant.animFrame = (ant.animFrame + 1) % 3; }

    // Hunger — stressed colony drains resources faster
    ant.hunger = Math.min(100, ant.hunger + CONFIG.ANT_HUNGER_RATE * (1 + stress * 0.4));

    // Feed from colony store
    if (ant.hunger > 70 && world.foodStore > 0) {
      const eat = Math.min(0.8, world.foodStore);
      world.foodStore = Math.max(0, world.foodStore - eat);
      ant.hunger     = Math.max(0, ant.hunger - eat * 35);
      if (world.waterStore > 0)
        world.waterStore = Math.max(0, world.waterStore - eat * 0.4);
    }

    // Wander bias refresh
    ant.wanderChangeTimer--;
    if (ant.wanderChangeTimer <= 0) {
      ant.wanderBias = { x: (Math.random()-0.5)*2, y: (Math.random()-0.5)*2 };
      ant.wanderChangeTimer = 30 + Math.floor(Math.random() * 60);
    }

    // Movement throttle — stress speeds movement slightly
    ant.moveTick++;
    const moveRate = stress > 0.6
      ? Math.max(1, CONFIG.ANT_MOVE_TICKS - 1)
      : CONFIG.ANT_MOVE_TICKS;
    if (ant.moveTick < moveRate) return;
    ant.moveTick = 0;

    // ── State machine ───────────────────────────────────────────────────────
    switch (ant.state) {

      // ── RESTING ──────────────────────────────────────────────────────────
      case STATE.RESTING:
        ant.restTicks--;
        // Stress cuts rest short — colony needs workers
        if (ant.restTicks <= 0 || stress > 0.5) ant.state = STATE.WANDERING;
        break;

      // ── WANDERING ────────────────────────────────────────────────────────
      case STATE.WANDERING:
        this._doWander(ant, world);

        if (ant.role === ROLE.FORAGER) {
          // Foragers seek food more urgently under stress (#7)
          const seekChance = 0.025 + stress * 0.06;
          if (Math.random() < seekChance) { ant.state = STATE.SEEKING_FOOD; ant.searchTimer = 0; }

        } else if (ant.role === ROLE.DIGGER) {
          // Diggers pause when colony is stressed — foraging takes priority
          if (stress < 0.55 && Math.random() < 0.04) {
            const dt = world.findDigTarget(ant.x, ant.y);
            if (dt) { ant.digTarget = dt; ant.state = STATE.DIGGING; ant.digTicks = 0; }
          }
          // Stressed diggers sometimes forage instead
          if (stress > 0.5 && Math.random() < 0.02) {
            ant.state = STATE.SEEKING_FOOD; ant.searchTimer = 0;
          }

        } else if (ant.role === ROLE.NURSE) {
          if (Math.random() < 0.035) ant.state = STATE.NURSING;
          // Stressed nurses also help forage
          if (stress > 0.65 && Math.random() < 0.015) {
            ant.state = STATE.SEEKING_FOOD; ant.searchTimer = 0;
          }

        } else { // ROLE.WORKER
          if (stress < 0.4 && Math.random() < 0.007) {
            const dt = world.findDigTarget(ant.x, ant.y);
            if (dt) { ant.digTarget = dt; ant.state = STATE.DIGGING; ant.digTicks = 0; }
          }
          // Workers join foraging more readily when stressed (#7)
          const workerSeek = 0.008 + stress * 0.05;
          if (Math.random() < workerSeek) { ant.state = STATE.SEEKING_FOOD; ant.searchTimer = 0; }
        }

        // Occasional surface excursion — any ant underground may decide to surface
        if (ant.y > CONFIG.SURFACE_ROW + 3 && Math.random() < 0.0018 && stress < 0.35) {
          ant.wanderBias = { x: (Math.random() - 0.5) * 0.5, y: -3.0 };
          ant.wanderChangeTimer = 80 + Math.floor(Math.random() * 100);
        }

        if (Math.random() < 0.0025 * (1 - stress)) {
          ant.state = STATE.RESTING;
          ant.restTicks = 15 + Math.floor(Math.random() * 35);
        }
        break;

      // ── SEEKING FOOD (improved pheromone trail following, #2) ─────────────
      case STATE.SEEKING_FOOD: {
        ant.searchTimer++;

        // Give up after timeout — return home, rest, try again later
        if (ant.searchTimer >= CONFIG.FORAGER_TIMEOUT) {
          ant.state = STATE.RETURNING;
          ant.carryFood = false;
          break;
        }

        // Move: follow food pheromone gradient toward food (#2)
        this._doWander(ant, world);

        // Arrived at a food tile?
        const ix = Math.floor(ant.x), iy = Math.floor(ant.y);
        if (world.get(ix, iy) === TILE.FOOD) {
          ant.carryFood = true;
          const fi = world.idx(ix, iy);
          world.foodAmount[fi] -= 22;
          if (world.foodAmount[fi] <= 0) {
            world.set(ix, iy, TILE.TUNNEL);
            world.foodAmount[fi] = 0;
          }
          ant.state = STATE.RETURNING;
          ant.searchTimer = 0;
          break;
        }

        // Also check immediate scan radius for nearby food
        const nearby = world.findNearestFood(ant.x, ant.y, 6);
        if (nearby) {
          const [fx, fy] = nearby;
          const reached = this._moveToward(ant, world, fx, fy, 1.2);
          if (reached && world.get(fx, fy) === TILE.FOOD) {
            ant.carryFood = true;
            const fi = world.idx(fx, fy);
            world.foodAmount[fi] -= 22;
            if (world.foodAmount[fi] <= 0) {
              world.set(fx, fy, TILE.TUNNEL);
              world.foodAmount[fi] = 0;
            }
            ant.state = STATE.RETURNING;
            ant.searchTimer = 0;
          }
        }
        break;
      }

      // ── RETURNING (#2 — deposit pheromone trail on the way back) ─────────
      case STATE.RETURNING: {
        // Move toward colony using home pheromone + direct heading
        this._returnToColony(ant, world, CX, CY);

        const distToColony = Math.abs(ant.x - CX) + Math.abs(ant.y - CY);
        if (distToColony < 10) {
          if (ant.carryFood) {
            world.foodStore = Math.min(CONFIG.FOOD_STORE_MAX, world.foodStore + 28);
            ant.carryFood = false;
          }
          if (ant.carryWater) {
            world.waterStore = Math.min(CONFIG.WATER_STORE_MAX, world.waterStore + 22);
            ant.carryWater = false;
          }
          ant.state = STATE.WANDERING;
        }
        break;
      }

      // ── DIGGING ──────────────────────────────────────────────────────────
      case STATE.DIGGING: {
        // Abandon dig if colony becomes stressed
        if (stress > 0.65 || !ant.digTarget) { ant.digTarget = null; ant.state = STATE.WANDERING; break; }
        const [dtx, dty] = ant.digTarget;
        if (world.get(dtx, dty) !== TILE.SOIL) { ant.digTarget = null; ant.state = STATE.WANDERING; break; }
        this._moveToward(ant, world, dtx, dty, 1.5);
        ant.digTicks += GameState.mode === 'screensaver' ? 2 : 1;
        world.digProgress[world.idx(dtx, dty)] = ant.digTicks / CONFIG.DIG_TICKS;
        if (ant.digTicks >= CONFIG.DIG_TICKS) {
          world.convertToTunnel(dtx, dty);
          ant.digTarget = null;
          ant.state = STATE.WANDERING;
        }
        break;
      }

      // ── NURSING ──────────────────────────────────────────────────────────
      case STATE.NURSING: {
        const nx = CONFIG.COLONY_X - 14, ny = CONFIG.COLONY_Y + 8;
        this._moveToward(ant, world, nx + (Math.random()-0.5)*4, ny + (Math.random()-0.5)*3, 0.45);
        for (const egg of this.eggs) {
          if (Math.abs(egg.x - ant.x) + Math.abs(egg.y - ant.y) < 6)
            egg.nurseBonus = Math.min(egg.nurseBonus + 0.35, 2.5);
        }
        if (Math.random() < 0.02 || stress > 0.6) ant.state = STATE.WANDERING;
        break;
      }

      default:
        ant.state = STATE.WANDERING;
    }
  }

  // ── Movement helpers ──────────────────────────────────────────────────────

  /**
   * General wander — behavior differs by state to implement pheromone trails (#2):
   *   carrying food  → follow HOME pheromone strongly (back to colony)
   *   seeking food   → follow FOOD pheromone strongly (toward food source)
   *   otherwise      → light pheromone bias + wander bias
   */
  _doWander(ant, world) {
    const ix = Math.floor(ant.x), iy = Math.floor(ant.y);
    const neighbors = world.getOpenNeighbors(ix, iy);
    if (!neighbors.length) { this._unstick(ant, world); return; }

    const isSeeking  = ant.state === STATE.SEEKING_FOOD;
    const isCarrying = ant.carryFood;
    const { COLONY_X: CX } = CONFIG;

    let best = null, bestScore = -Infinity;
    for (const [nx, ny] of neighbors) {
      const ni = world.idx(nx, ny);
      const pf = world.pheromoneFood[ni];
      const ph = world.pheromoneHome[ni];

      // Base randomness keeps movement organic
      let score = Math.random() * 2.0
                + ant.wanderBias.x * (nx - ix)
                + ant.wanderBias.y * (ny - iy);

      if (isCarrying) {
        // ── Carrying food home: follow HOME pheromone trail (#2) ──────────
        score += ph * CONFIG.PHER_HOME_WEIGHT;
        // Also pull toward colony center as a fallback
        const dNow = Math.abs(ix - CX) + Math.abs(iy - CONFIG.COLONY_Y);
        const dNew = Math.abs(nx - CX) + Math.abs(ny - CONFIG.COLONY_Y);
        score += (dNow - dNew) * 0.4;

      } else if (isSeeking) {
        // ── Seeking food: follow FOOD pheromone left by returning ants (#2) ─
        score += pf * CONFIG.PHER_TRAIL_WEIGHT;
        // Upward bias so ants explore toward the surface where food appears
        if (ny < iy) score += 0.6;
        // Don't drift too far sideways from colony
        score -= Math.abs(nx - CX) * 0.015;

      } else {
        // ── General wander: gentle pheromone awareness ─────────────────────
        score += (pf + ph) * 0.4;
      }

      // Surface movement: walk horizontally; carrying ants urgently head underground
      if (iy <= CONFIG.SURFACE_ROW + 1) {
        if (isCarrying) {
          if (ny > iy) score += 4.0;
        } else {
          if (ny === iy) score += 2.0;
          if (ny > iy)  score -= 0.5;
        }
      }

      if (score > bestScore) { bestScore = score; best = [nx, ny]; }
    }

    if (best) {
      ant.x += (best[0] + 0.5 - ant.x) * 0.55;
      ant.y += (best[1] + 0.5 - ant.y) * 0.55;
      const dx = best[0] + 0.5 - ant.x, dy = best[1] + 0.5 - ant.y;
      if (dx || dy) ant.angle = Math.atan2(dy, dx);
    }
  }

  /** Returning to colony: pheromone trail + direct homing (#2) */
  _returnToColony(ant, world, CX, CY) {
    const ix = Math.floor(ant.x), iy = Math.floor(ant.y);
    const neighbors = world.getOpenNeighbors(ix, iy);
    if (!neighbors.length) { this._unstick(ant, world); return; }

    let best = null, bestScore = -Infinity;
    for (const [nx, ny] of neighbors) {
      const ph = world.pheromoneHome[world.idx(nx, ny)];
      const dNow = Math.abs(ix - CX) + Math.abs(iy - CY);
      const dNew = Math.abs(nx - CX) + Math.abs(ny - CY);
      const score = Math.random() * 1.2
                  + ph * CONFIG.PHER_HOME_WEIGHT
                  + (dNow - dNew) * 0.5;
      if (score > bestScore) { bestScore = score; best = [nx, ny]; }
    }

    if (best) {
      ant.x += (best[0] + 0.5 - ant.x) * 0.55;
      ant.y += (best[1] + 0.5 - ant.y) * 0.55;
      const dx = best[0] + 0.5 - ant.x, dy = best[1] + 0.5 - ant.y;
      if (dx || dy) ant.angle = Math.atan2(dy, dx);
    }
  }

  _moveToward(ant, world, tx, ty, speed) {
    const dx = tx - ant.x, dy = ty - ant.y;
    if (Math.sqrt(dx*dx + dy*dy) < 0.8) return true;

    ant.angle = Math.atan2(dy, dx);
    const stepX = Math.sign(dx + (Math.random()-0.5)*0.5);
    const stepY = Math.sign(dy + (Math.random()-0.5)*0.5);
    const nx  = Math.floor(ant.x) + stepX, cy = Math.floor(ant.y);
    const nx2 = Math.floor(ant.x),          ny2 = Math.floor(ant.y) + stepY;

    if (Math.abs(dx) >= Math.abs(dy)) {
      if (world.isOpen(nx, cy))        ant.x += (nx  + 0.5 - ant.x) * (0.45 * speed);
      else if (world.isOpen(nx2, ny2)) ant.y += (ny2 + 0.5 - ant.y) * (0.45 * speed);
      else this._doWander(ant, world);
    } else {
      if (world.isOpen(nx2, ny2))      ant.y += (ny2 + 0.5 - ant.y) * (0.45 * speed);
      else if (world.isOpen(nx, cy))   ant.x += (nx  + 0.5 - ant.x) * (0.45 * speed);
      else this._doWander(ant, world);
    }
    return false;
  }

  _unstick(ant, world) {
    for (let r = 1; r <= 6; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (world.isOpen(Math.floor(ant.x)+dx, Math.floor(ant.y)+dy)) {
            ant.x = Math.floor(ant.x) + dx + 0.5;
            ant.y = Math.floor(ant.y) + dy + 0.5;
            return;
          }
        }
      }
    }
    ant.x = CONFIG.COLONY_X; ant.y = CONFIG.COLONY_Y;
  }

  get population() { return this.ants.length; }
  get eggCount()   { return this.eggs.length; }

  get roleCounts() {
    const c = { forager: 0, digger: 0, worker: 0, nurse: 0 };
    for (const a of this.ants) {
      if      (a.role === ROLE.FORAGER) c.forager++;
      else if (a.role === ROLE.DIGGER)  c.digger++;
      else if (a.role === ROLE.WORKER)  c.worker++;
      else if (a.role === ROLE.NURSE)   c.nurse++;
    }
    return c;
  }
}
