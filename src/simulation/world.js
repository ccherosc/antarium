import { TILE, CONFIG } from '../config.js';
import { logEvent } from '../events.js';
import { GameState } from '../gameState.js';

export class World {
  constructor() {
    const { WORLD_WIDTH: W, WORLD_HEIGHT: H } = CONFIG;
    this.width = W;
    this.height = H;
    this.tiles = new Uint8Array(W * H);
    this.hardness = new Uint8Array(W * H);
    this.digProgress = new Float32Array(W * H);
    this.foodAmount = new Float32Array(W * H);
    this.waterAmount = new Float32Array(W * H);
    this.pheromoneFood = new Float32Array(W * H);
    this.pheromoneHome = new Float32Array(W * H);
    this.organics = new Float32Array(W * H); // 0–1, organic density in soil

    this.dirty = true;
    this.dirtyTiles = new Set();

    this.foodStore = 200;
    this.waterStore = 200;
    this.tunnelCount = 0;
    this.chamberCount = 0;
    this.stress = 0;          // 0 = calm, 1 = critical — updated each tick
    this._foodRespawnTimer = 0;
    this._digQueue = [];
    this._digPlanTimer = 0;

    this._generate();
  }

  idx(x, y) {
    return y * this.width + x;
  }

  get(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return TILE.GLASS;
    return this.tiles[this.idx(x, y)];
  }

  set(x, y, type) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = this.idx(x, y);
    const old = this.tiles[i];
    this.tiles[i] = type;
    if (old !== type) {
      this.dirtyTiles.add(i);
      this.dirty = true;
    }
  }

  isOpen(x, y) {
    const t = this.get(x, y);
    return t === TILE.TUNNEL || t === TILE.CHAMBER || t === TILE.SURFACE ||
           t === TILE.FOOD || t === TILE.WATER || t === TILE.EGG;
  }

  isDiggable(x, y) {
    return this.get(x, y) === TILE.SOIL;
  }

  hasOpenNeighbor(x, y) {
    return this.isOpen(x - 1, y) || this.isOpen(x + 1, y) ||
           this.isOpen(x, y - 1) || this.isOpen(x, y + 1);
  }

  _fill(type) {
    this.tiles.fill(type);
  }

  _rect(x, y, w, h, type) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.set(x + dx, y + dy, type);
      }
    }
  }

  _tunnel(x1, y1, x2, y2) {
    let x = x1, y = y1;
    while (x !== x2 || y !== y2) {
      this.set(x, y, TILE.TUNNEL);
      if (x !== x2) x += x < x2 ? 1 : -1;
      else y += y < y2 ? 1 : -1;
    }
    this.set(x2, y2, TILE.TUNNEL);
  }

  _chamber(cx, cy, w, h) {
    for (let dy = -Math.floor(h / 2); dy <= Math.floor(h / 2); dy++) {
      for (let dx = -Math.floor(w / 2); dx <= Math.floor(w / 2); dx++) {
        this.set(cx + dx, cy + dy, TILE.CHAMBER);
      }
    }
  }

  // Oval-shaped chamber (rx = half-width, ry = half-height)
  _oval(cx, cy, rx, ry, type) {
    const rxi = rx + 0.5, ryi = ry + 0.5;
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx / rxi) * (dx / rxi) + (dy / ryi) * (dy / ryi) <= 1.0) {
          this.set(cx + dx, cy + dy, type);
        }
      }
    }
  }

  // Vertical shaft
  _shaft(x, y1, y2, type = TILE.TUNNEL) {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) this.set(x, y, type);
  }

  // Horizontal shaft
  _shaftH(x1, x2, y, type = TILE.TUNNEL) {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) this.set(x, y, type);
  }

  // Diagonal tunnel — steps x and y simultaneously until both reach target
  _diagonal(x1, y1, x2, y2, type = TILE.TUNNEL) {
    let x = x1, y = y1;
    while (x !== x2 || y !== y2) {
      this.set(x, y, type);
      if (x !== x2) x += x < x2 ? 1 : -1;
      if (y !== y2) y += y < y2 ? 1 : -1;
    }
    this.set(x2, y2, type);
  }

  _generate() {
    const W = this.width, H = this.height;
    const SR = CONFIG.SURFACE_ROW;
    const CX = CONFIG.COLONY_X;
    const CY = CONFIG.COLONY_Y;
    const GT = CONFIG.GLASS_THICKNESS;

    this._fill(TILE.SOIL);
    for (let i = 0; i < this.hardness.length; i++) {
      this.hardness[i] = 40 + Math.random() * 60;
    }

    // Air above surface
    for (let y = 0; y < SR; y++) {
      for (let x = 0; x < W; x++) {
        this.tiles[this.idx(x, y)] = TILE.AIR;
        this.hardness[this.idx(x, y)] = 0;
      }
    }
    for (let x = 0; x < W; x++) {
      this.tiles[this.idx(x, SR)]     = TILE.SURFACE;
      this.tiles[this.idx(x, SR + 1)] = TILE.SURFACE;
    }

    // Glass border
    for (let y = 0; y < H; y++) {
      for (let gx = 0; gx < GT; gx++) {
        this.set(gx, y, TILE.GLASS);
        this.set(W - 1 - gx, y, TILE.GLASS);
      }
    }
    for (let x = 0; x < W; x++) {
      for (let gy = 0; gy < GT; gy++) {
        this.set(x, gy, TILE.GLASS);
        this.set(x, H - 1 - gy, TILE.GLASS);
      }
    }

    // ── Entrance shaft — narrow 1-tile drop from surface ──────────────────
    this._shaft(CX, SR + 2, SR + 12);

    // ── Foyer — small junction chamber just below the surface ─────────────
    //    Ant farm hallmark: ants spill out here when food arrives
    const FOYER_Y = SR + 14;                           // y = 28
    this._oval(CX, FOYER_Y, 3, 2, TILE.CHAMBER);

    // ── Upper-left arm — diagonal branch to nursery area ──────────────────
    const UL_X = CX - 22, UL_Y = FOYER_Y + 21;       // (98, 49)
    this._diagonal(CX - 1, FOYER_Y + 3, UL_X, UL_Y);
    this._oval(UL_X, UL_Y, 4, 3, TILE.CHAMBER);       // upper-left chamber

    // ── Upper-right arm — diagonal branch to food cache ───────────────────
    const UR_X = CX + 22, UR_Y = FOYER_Y + 21;       // (142, 49)
    this._diagonal(CX + 1, FOYER_Y + 3, UR_X, UR_Y);
    this._oval(UR_X, UR_Y, 4, 3, TILE.CHAMBER);       // upper-right chamber

    // ── Center shaft — straight drop from foyer to queen ──────────────────
    this._shaft(CX, FOYER_Y + 3, CY - 5);

    // ── Queen chamber — large oval, heart of the colony ───────────────────
    this._oval(CX, CY, 6, 4, TILE.CHAMBER);

    // ── Nursery wing — lower-left, near nurse/egg spawn point ─────────────
    //    ants.js spawns nurses at (CX-14, CY+8) = (106,73), so keep it close
    const NUR_X = CX - 20, NUR_Y = CY + 13;          // (100, 78)
    this._diagonal(CX - 5, CY + 5, NUR_X, NUR_Y);
    this._oval(NUR_X, NUR_Y, 5, 3, TILE.CHAMBER);     // nursery

    // ── Food store wing — lower-right, mirror of nursery ──────────────────
    const FS_X = CX + 20, FS_Y = CY + 13;            // (140, 78)
    this._diagonal(CX + 5, CY + 5, FS_X, FS_Y);
    this._oval(FS_X, FS_Y, 5, 3, TILE.CHAMBER);       // food storage

    // ── Deep central shaft + gallery ──────────────────────────────────────
    this._shaft(CX, CY + 5, CY + 25);
    this._oval(CX, CY + 28, 5, 3, TILE.CHAMBER);      // deep gallery (120, 93)

    // Horizontal gallery connecting nursery → center shaft → food store
    this._shaftH(NUR_X + 5, FS_X - 5, NUR_Y);

    // Organic deposits — clusters of dark organic matter in the soil
    // Explorers seek these out and convert them to underground food deposits
    for (let c = 0; c < 14; c++) {
      const ocx = GT + 6 + Math.floor(Math.random() * (W - GT * 2 - 12));
      const ocy = SR + 6 + Math.floor(Math.random() * (H - SR - GT - 10));
      const or  = 3 + Math.floor(Math.random() * 4);
      for (let dy = -or; dy <= or; dy++) {
        for (let dx = -or; dx <= or; dx++) {
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > or) continue;
          const tx = ocx + dx, ty = ocy + dy;
          if (tx < GT + 1 || tx >= W - GT - 1 || ty <= SR + 1 || ty >= H - GT - 1) continue;
          const i = this.idx(tx, ty);
          this.organics[i] = Math.min(1, this.organics[i] + (1 - d / or) * (0.5 + Math.random() * 0.5));
        }
      }
    }

    // Surface food
    for (let i = 0; i < 8; i++) {
      const fx = GT + 4 + Math.floor(Math.random() * (W - GT * 2 - 8));
      this.set(fx, SR, TILE.FOOD);
      this.foodAmount[this.idx(fx, SR)] = 60 + Math.random() * 40;
    }

    this._recalcStats();
    this._updateDigPlan();                             // seed initial dig plan
    this.dirtyTiles.clear();
    this.dirty = true;
  }

  _recalcStats() {
    let t = 0, c = 0;
    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] === TILE.TUNNEL) t++;
      if (this.tiles[i] === TILE.CHAMBER) c++;
    }
    this.tunnelCount = t;
    this.chamberCount = Math.round(c / 9);
  }

  // Populate the dig queue with structured work: shafts, angled arms, and oval chambers.
  // Diggers consume one tile at a time; this runs periodically so the queue stays fresh.
  _updateDigPlan() {
    if (this._digQueue.length > 28) return;

    const GT = CONFIG.GLASS_THICKNESS;
    const SR = CONFIG.SURFACE_ROW;

    // Find frontier tiles: open cells with soil on at least 2 cardinal sides
    const tips = [];
    for (let y = SR + 4; y < this.height - GT - 4; y++) {
      for (let x = GT + 3; x < this.width - GT - 3; x++) {
        if (!this.isOpen(x, y)) continue;
        let soilAdj = 0;
        if (this.get(x,   y + 1) === TILE.SOIL) soilAdj++;
        if (this.get(x,   y - 1) === TILE.SOIL) soilAdj++;
        if (this.get(x - 1, y)   === TILE.SOIL) soilAdj++;
        if (this.get(x + 1, y)   === TILE.SOIL) soilAdj++;
        if (soilAdj >= 2) tips.push([x, y]);
      }
    }
    if (!tips.length) return;

    // Pick a handful of random frontier tiles and plan work from them
    const chosen = tips.sort(() => Math.random() - 0.5).slice(0, 4);
    for (const [tx, ty] of chosen) {
      const r = Math.random();

      if (r < 0.42) {
        // ── Straight-down shaft: the backbone of every ant farm ──────────
        const len = 5 + Math.floor(Math.random() * 9);
        for (let i = 1; i <= len; i++) {
          const ny = ty + i;
          if (ny >= this.height - GT - 2) break;
          if (this.get(tx, ny) === TILE.SOIL) this._digQueue.push([tx, ny]);
          else if (!this.isOpen(tx, ny)) break;
        }

      } else if (r < 0.72) {
        // ── Angled tunnel: zigzag drift creating diagonal corridors ──────
        const sx = Math.random() < 0.5 ? -1 : 1;
        const len = 5 + Math.floor(Math.random() * 9);
        let x = tx, y = ty;
        for (let i = 0; i < len; i++) {
          // Alternate: one step straight down, one step diagonal
          y += 1;
          if (i % 2 === 1) x += sx;
          if (x < GT + 2 || x >= this.width - GT - 2 || y >= this.height - GT - 2) break;
          if (this.get(x, y) === TILE.SOIL) this._digQueue.push([x, y]);
        }

      } else {
        // ── Oval chamber: widen the tunnel into a room ───────────────────
        const offX = (Math.random() < 0.5 ? -1 : 1) * Math.floor(1 + Math.random() * 3);
        const cx = tx + offX;
        const cy = ty + 3 + Math.floor(Math.random() * 4);
        const rx = 3 + Math.floor(Math.random() * 3); // half-width 3–5
        const ry = 2 + Math.floor(Math.random() * 2); // half-height 2–3
        const rxi = rx + 0.5, ryi = ry + 0.5;
        for (let dy = -ry; dy <= ry; dy++) {
          for (let dx = -rx; dx <= rx; dx++) {
            if ((dx / rxi) * (dx / rxi) + (dy / ryi) * (dy / ryi) > 1.0) continue;
            const qx = cx + dx, qy = cy + dy;
            if (qx < GT + 2 || qx >= this.width - GT - 2) continue;
            if (qy < SR + 4  || qy >= this.height - GT - 2) continue;
            if (this.get(qx, qy) === TILE.SOIL) this._digQueue.push([qx, qy]);
          }
        }
      }
    }
  }

  convertToTunnel(x, y) {
    if (this.get(x, y) !== TILE.SOIL) return;
    this.set(x, y, TILE.TUNNEL);
    this.tunnelCount++;
    this.digProgress[this.idx(x, y)] = 0;
    this._checkChamber(x, y);
  }

  _checkChamber(cx, cy) {
    // If 9+ adjacent tunnel tiles in a 3×3 area, upgrade to chamber
    let count = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const t = this.get(cx + dx, cy + dy);
        if (t === TILE.TUNNEL || t === TILE.CHAMBER) count++;
      }
    }
    if (count >= 7) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const t = this.get(cx + dx, cy + dy);
          if (t === TILE.TUNNEL) {
            this.set(cx + dx, cy + dy, TILE.CHAMBER);
            this.tunnelCount--;
            this.chamberCount++;
          }
        }
      }
    }
  }

  placeFood(x, y, amount) {
    const t = this.get(x, y);
    if (t === TILE.AIR || t === TILE.GLASS) return false;
    const i = this.idx(x, y);
    if (t === TILE.SURFACE || t === TILE.TUNNEL || t === TILE.CHAMBER) {
      this.set(x, y, TILE.FOOD);
      this.foodAmount[i] = Math.min(100, (this.foodAmount[i] || 0) + amount);
      return true;
    }
    if (t === TILE.FOOD) {
      this.foodAmount[i] = Math.min(100, this.foodAmount[i] + amount);
      return true;
    }
    return false;
  }

  placeWater(x, y, amount) {
    const t = this.get(x, y);
    if (t === TILE.AIR || t === TILE.GLASS) return false;
    const i = this.idx(x, y);
    if (t === TILE.SURFACE || t === TILE.TUNNEL || t === TILE.CHAMBER) {
      this.set(x, y, TILE.WATER);
      this.waterAmount[i] = Math.min(100, (this.waterAmount[i] || 0) + amount);
      return true;
    }
    if (t === TILE.WATER) {
      this.waterAmount[i] = Math.min(100, this.waterAmount[i] + amount);
      return true;
    }
    return false;
  }

  update(deltaMs, sim) {
    const decay = CONFIG.FOOD_DECAY_RATE * deltaMs * 0.001;
    const evap = CONFIG.WATER_EVAP_RATE * deltaMs * 0.001;

    if (++this._digPlanTimer >= 80) {
      this._digPlanTimer = 0;
      this._updateDigPlan();
    }

    for (let i = 0; i < this.tiles.length; i++) {
      if (this.tiles[i] === TILE.FOOD) {
        this.foodAmount[i] -= decay;
        if (this.foodAmount[i] <= 0) {
          this.tiles[i] = TILE.TUNNEL;
          this.foodAmount[i] = 0;
          this.dirty = true;
          this.dirtyTiles.add(i);
        }
      }
      if (this.tiles[i] === TILE.WATER) {
        this.waterAmount[i] -= evap;
        if (this.waterAmount[i] <= 0) {
          this.tiles[i] = TILE.TUNNEL;
          this.waterAmount[i] = 0;
          this.dirty = true;
          this.dirtyTiles.add(i);
        }
      }
      // Fade pheromones — faster decay so trails are meaningful, not permanent
      if (this.pheromoneFood[i] > 0.001) this.pheromoneFood[i] *= CONFIG.PHER_FOOD_DECAY;
      else this.pheromoneFood[i] = 0;
      if (this.pheromoneHome[i] > 0.001) this.pheromoneHome[i] *= CONFIG.PHER_HOME_DECAY;
      else this.pheromoneHome[i] = 0;
    }

    // Surface food respawn — more frequent and abundant in screensaver
    const screensaver = GameState.mode === 'screensaver';
    const respawnInterval = screensaver
      ? Math.ceil(CONFIG.FOOD_RESPAWN_INTERVAL * 0.28) // ~3.5× more often
      : CONFIG.FOOD_RESPAWN_INTERVAL;
    const respawnCount = screensaver
      ? CONFIG.FOOD_RESPAWN_COUNT + 5
      : CONFIG.FOOD_RESPAWN_COUNT;
    this._foodRespawnTimer++;
    if (this._foodRespawnTimer >= respawnInterval) {
      this._foodRespawnTimer = 0;
      this._spawnSurfaceFood(respawnCount);
    }

    // Screensaver: guarantee abundant resources and zero stress so colony always grows
    if (screensaver) {
      this.foodStore  = Math.min(CONFIG.FOOD_STORE_MAX, this.foodStore  + 18);
      this.waterStore = Math.min(CONFIG.WATER_STORE_MAX, this.waterStore + 10);
      this.stress = 0;
      return;
    }

    // Update colony stress level
    const fs = Math.max(0, 1 - this.foodStore  / CONFIG.STRESS_FOOD_LOW);
    const ws = Math.max(0, 1 - this.waterStore / CONFIG.STRESS_WATER_LOW);
    const targetStress = Math.min(1, Math.max(fs, ws * 0.6));
    // Smooth it so it doesn't spike instantly
    this.stress += (targetStress - this.stress) * 0.02;
  }

  _spawnSurfaceFood(count) {
    const SR = CONFIG.SURFACE_ROW;
    const GT = CONFIG.GLASS_THICKNESS;
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 50) {
      attempts++;
      const fx = GT + 2 + Math.floor(Math.random() * (this.width - GT * 2 - 4));
      if (this.placeFood(fx, SR, 50 + Math.random() * 40)) placed++;
    }
    if (placed > 0) logEvent('Food appeared on the surface');
  }

  getOpenNeighbors(x, y) {
    const result = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dx, dy] of dirs) {
      if (this.isOpen(x + dx, y + dy)) result.push([x + dx, y + dy]);
    }
    return result;
  }

  // Place one displaced-soil tile above the surface entrance (anthill growth)
  _depositAnthill() {
    const CX = CONFIG.COLONY_X;
    const SR = CONFIG.SURFACE_ROW;
    const GT = CONFIG.GLASS_THICKNESS;
    // Bell-curve spread: sum of 3 uniforms → triangular distribution centred on entrance
    const dx = Math.floor((Math.random() + Math.random() + Math.random() - 1.5) * 5);
    const tx = Math.max(GT + 1, Math.min(this.width - GT - 2, CX + dx));
    // Stack upward from just above surface — find the bottom-most AIR tile
    for (let y = SR - 1; y >= GT + 1; y--) {
      if (this.get(tx, y) === TILE.AIR) {
        this.set(tx, y, TILE.ANTHILL);
        return;
      }
    }
  }

  // Explorer-only: if tile has high organics → food deposit, otherwise normal tunnel
  convertToDeposit(x, y) {
    const i = this.idx(x, y);
    if (this.organics[i] > 0.30) {
      this.set(x, y, TILE.FOOD);
      this.foodAmount[i] = 70 + this.organics[i] * 130;
      this.organics[i] = 0;
      this.digProgress[i] = 0;
      this.tunnelCount++;
      logEvent('Underground food deposit discovered!');
    } else {
      this.convertToTunnel(x, y);
    }
  }

  // Find the highest-organic soil tile adjacent to (ax,ay); fall back to any adjacent soil
  findOrganicTarget(ax, ay) {
    const ix = Math.floor(ax), iy = Math.floor(ay);
    const dirs = [[-1,0],[1,0],[0,1],[0,-1],[-1,1],[1,1],[-1,-1],[1,-1]];
    let best = null, bestScore = 0;
    for (const [dx, dy] of dirs) {
      const tx = ix + dx, ty = iy + dy;
      if (this.get(tx, ty) !== TILE.SOIL || !this.hasOpenNeighbor(tx, ty)) continue;
      const score = this.organics[this.idx(tx, ty)];
      if (score > bestScore) { bestScore = score; best = [tx, ty]; }
    }
    // Always return something so explorers keep tunnelling even without organics nearby
    if (!best) {
      const shuffled = [...dirs].sort(() => Math.random() - 0.5);
      for (const [dx, dy] of shuffled) {
        const tx = ix + dx, ty = iy + dy;
        if (this.get(tx, ty) === TILE.SOIL && this.hasOpenNeighbor(tx, ty)) return [tx, ty];
      }
    }
    return best;
  }

  findNearestFood(x, y, radius) {
    let best = null, bestDist = Infinity;
    const r = Math.min(radius, 40);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) continue;
        if (this.get(tx, ty) === TILE.FOOD) {
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; best = [tx, ty]; }
        }
      }
    }
    return best;
  }

  findNearestWater(x, y, radius) {
    let best = null, bestDist = Infinity;
    const r = Math.min(radius, 40);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) continue;
        if (this.get(tx, ty) === TILE.WATER) {
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; best = [tx, ty]; }
        }
      }
    }
    return best;
  }

  findDigTarget(ax, ay) {
    // Evict stale queue entries
    for (let i = this._digQueue.length - 1; i >= 0; i--) {
      const [qx, qy] = this._digQueue[i];
      if (this.get(qx, qy) !== TILE.SOIL || !this.hasOpenNeighbor(qx, qy)) {
        this._digQueue.splice(i, 1);
      }
    }

    // Pick the nearest planned site within reach, biased toward deeper targets
    let best = null, bestScore = -Infinity;
    for (const [qx, qy] of this._digQueue) {
      const d = Math.abs(ax - qx) + Math.abs(ay - qy);
      if (d > 35) continue;
      const score = -d + Math.max(0, qy - ay) * 0.7;
      if (score > bestScore) { bestScore = score; best = [qx, qy]; }
    }

    if (best) {
      const idx = this._digQueue.findIndex(([x, y]) => x === best[0] && y === best[1]);
      if (idx >= 0) this._digQueue.splice(idx, 1);
      return best;
    }

    // Fallback: any adjacent diggable tile, weighted downward
    const dirs = [[0,1],[0,1],[-1,1],[1,1],[-1,0],[1,0],[0,-1]];
    for (const [dx, dy] of [...dirs].sort(() => Math.random() - 0.38)) {
      const tx = Math.floor(ax) + dx, ty = Math.floor(ay) + dy;
      if (this.get(tx, ty) === TILE.SOIL && this.hasOpenNeighbor(tx, ty)) return [tx, ty];
    }
    return null;
  }
}
