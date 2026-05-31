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

    this.dirty = true;
    this.dirtyTiles = new Set();

    this.foodStore = 200;
    this.waterStore = 200;
    this.tunnelCount = 0;
    this.chamberCount = 0;
    this.stress = 0;          // 0 = calm, 1 = critical — updated each tick
    this._foodRespawnTimer = 0;

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

  _generate() {
    const W = this.width, H = this.height;
    const SR = CONFIG.SURFACE_ROW;
    const CX = CONFIG.COLONY_X;
    const CY = CONFIG.COLONY_Y;

    // Fill with soil
    this._fill(TILE.SOIL);

    // Randomize hardness
    for (let i = 0; i < this.hardness.length; i++) {
      this.hardness[i] = 40 + Math.random() * 60;
    }

    // Top rows: air
    for (let y = 0; y < SR; y++) {
      for (let x = 0; x < W; x++) {
        this.tiles[this.idx(x, y)] = TILE.AIR;
        this.hardness[this.idx(x, y)] = 0;
      }
    }

    // Surface row
    for (let x = 0; x < W; x++) {
      this.tiles[this.idx(x, SR)] = TILE.SURFACE;
      this.tiles[this.idx(x, SR + 1)] = TILE.SURFACE;
    }

    // Glass border
    const GT = CONFIG.GLASS_THICKNESS;
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

    // Center shaft — surface down through main corridor into queen chamber
    const entryX = CX;
    for (let y = SR + 2; y <= CY - 3; y++) {   // y16 → y62 (queen chamber top)
      this.set(entryX, y, TILE.TUNNEL);
    }

    // Side shafts — surface through upper chambers all the way to nursery/food storage
    for (let y = SR + 2; y <= CY + 5; y++) {   // y16 → y70 (nursery/food chamber top)
      this.set(CX - 15, y, TILE.TUNNEL);
      this.set(CX + 15, y, TILE.TUNNEL);
    }

    // Main horizontal corridor
    this._rect(CX - 18, CY - 10, 36, 2, TILE.TUNNEL);

    // Queen chamber (heart of colony)
    this._chamber(CX, CY, 10, 7);

    // Nursery chamber (left-down)
    this._chamber(CX - 14, CY + 8, 9, 6);
    this._tunnel(CX - 5, CY + 3, CX - 10, CY + 8);

    // Food storage chamber (right-down)
    this._chamber(CX + 14, CY + 8, 9, 6);
    this._tunnel(CX + 5, CY + 3, CX + 10, CY + 8);

    // Rest chamber (upper-left)
    this._chamber(CX - 16, CY - 16, 7, 5);
    this._tunnel(CX - 14, CY - 9, CX - 13, CY - 14);

    // Exploration chamber (upper-right)
    this._chamber(CX + 16, CY - 16, 7, 5);
    this._tunnel(CX + 14, CY - 9, CX + 13, CY - 14);

    // Left branch of main corridor extends further
    this._rect(CX - 30, CY - 7, 12, 2, TILE.TUNNEL);

    // Right branch
    this._rect(CX + 18, CY - 7, 12, 2, TILE.TUNNEL);

    // Secondary tunnels going deeper
    this._tunnel(CX - 8, CY + 5, CX - 8, CY + 18);
    this._tunnel(CX + 8, CY + 5, CX + 8, CY + 18);
    this._tunnel(CX - 8, CY + 18, CX + 8, CY + 18);
    this._chamber(CX, CY + 22, 8, 5);
    this._tunnel(CX, CY + 18, CX, CY + 20);

    // Some scattered food on surface
    for (let i = 0; i < 8; i++) {
      const fx = GT + 4 + Math.floor(Math.random() * (W - GT * 2 - 8));
      this.set(fx, SR, TILE.FOOD);
      this.foodAmount[this.idx(fx, SR)] = 60 + Math.random() * 40;
    }

    // Count tunnels and chambers
    this._recalcStats();
    this.dirtyTiles.clear(); // force full redraw on first render (soil was set via _fill, not set())
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

  findDigTarget(x, y) {
    const dirs = [[-1,0],[1,0],[0,1],[0,-1],[-1,1],[1,1],[-1,-1],[1,-1]];
    // Prefer downward digging
    const shuffled = [...dirs].sort(() => Math.random() - 0.4);
    for (const [dx, dy] of shuffled) {
      const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy;
      if (this.get(tx, ty) === TILE.SOIL && this.hasOpenNeighbor(tx, ty)) {
        return [tx, ty];
      }
    }
    return null;
  }
}
