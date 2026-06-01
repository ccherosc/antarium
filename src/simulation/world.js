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
    this.organics = new Float32Array(W * H);       // 0–1, organic density in soil
    // 0=generic  1=queen chamber  2=egg/nursery  3=food store  4=deep gallery
    this.chamberType = new Uint8Array(W * H);
    this.alarmLevel = 0; // 0=calm → 1=full war; decays each tick

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
    this._chamberSeeds = new Set(); // band keys for chambers already planned
    this._plannedChamberSet = new Set(); // idx of tiles queued as chamber interior
    this._chamberTypeMap = {};           // idx → chamberType for planned oval tiles
    this.nurseryPos = null;              // set in _generate
    this.foodStorePos = null;            // set in _generate
    this.queenChamberPos = null;         // set in _generate

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

  // Register all tiles in a planned oval so convertToTunnel upgrades them to CHAMBER
  _registerPlannedOval(cx, cy, rx, ry, type) {
    const rxi = rx + 0.5, ryi = ry + 0.5;
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx / rxi) ** 2 + (dy / ryi) ** 2 > 1.0) continue;
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) continue;
        const i = this.idx(tx, ty);
        this._plannedChamberSet.add(i);
        this._chamberTypeMap[i] = type;
      }
    }
  }

  // Mark every tile in an oval with a chamberType id (for rendering only)
  _markChamberType(cx, cy, rx, ry, type) {
    const rxi = rx + 0.5, ryi = ry + 0.5;
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx / rxi) ** 2 + (dy / ryi) ** 2 > 1.0) continue;
        const tx = cx + dx, ty = cy + dy;
        if (tx < 0 || tx >= this.width || ty < 0 || ty >= this.height) continue;
        this.chamberType[this.idx(tx, ty)] = type;
      }
    }
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

    // ── Procedural colony layout — unique each run ───────────────────────────
    const rnd  = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
    const clX  = x => Math.max(GT + 8,  Math.min(W - GT - 9,  x));
    const clY  = y => Math.max(SR + 18, Math.min(H - GT - 8,  y));

    const place = (cx, cy, rx, ry, type) => {
      const ox = clX(Math.round(cx)), oy = clY(Math.round(cy));
      this._oval(ox, oy, rx, ry, TILE.CHAMBER);
      this._markChamberType(ox, oy, rx, ry, type);
      return { cx: ox, cy: oy, rx, ry };
    };

    // ── Entrance shaft ───────────────────────────────────────────────────────
    this._shaft(CX, SR + 2, SR + 13);
    const FY = SR + 15;
    this._oval(CX, FY, 2, 1, TILE.CHAMBER);

    // ── Queen chamber — slightly offset every run ────────────────────────────
    const QX = clX(CX + rnd(-12, 12));
    const QY = clY(SR + rnd(44, 52));
    this._shaft(CX, FY + 2, QY - 5);
    if (Math.abs(QX - CX) > 2) {
      this._shaftH(Math.min(CX, QX), Math.max(CX, QX), QY - 5);
      this._shaft(QX, QY - 5, QY - 1);
    }
    const Q = place(QX, QY, 7, 5, 1);
    this.queenChamberPos = { x: QX, y: QY };

    // ── Upper galleries (wide arms from the foyer, 2–4 per run) ─────────────
    for (let i = 0; i < rnd(2, 4); i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const dist = rnd(28, 52) + Math.floor(i / 2) * rnd(8, 18);
      const ch   = place(clX(CX + side * dist + rnd(-6, 6)),
                         clY(FY + rnd(14, 24)),
                         rnd(3, 6), rnd(2, 3), side < 0 ? 2 : 3);
      this._diagonal(CX + (side < 0 ? -1 : 1), FY + 2, ch.cx, ch.cy - ch.ry - 1);
    }

    // ── Nursery and food storage flanking the queen ──────────────────────────
    const NUR = place(clX(QX - rnd(22, 42)), clY(QY + rnd(14, 26)),
                      rnd(4, 6), rnd(2, 4), 2);
    this._diagonal(QX - 6, QY + 5, NUR.cx + NUR.rx + 1, NUR.cy);

    const FS  = place(clX(QX + rnd(22, 42)), clY(QY + rnd(14, 26)),
                      rnd(4, 6), rnd(2, 4), 3);
    this._diagonal(QX + 6, QY + 5, FS.cx - FS.rx - 1, FS.cy);

    this.nurseryPos   = { x: NUR.cx, y: NUR.cy };
    this.foodStorePos = { x: FS.cx,  y: FS.cy  };

    // ── Deep gallery rows — 5 levels spreading progressively wider ───────────
    // Spread grows from ±60 near the top to ±100 at the bottom,
    // filling ~80% of the world width and nearly all available depth.
    const rowDefs = [
      { baseY: QY + rnd(26, 36),  half: rnd(56, 72),  n: rnd(3, 5) },
      { baseY: QY + rnd(44, 56),  half: rnd(70, 86),  n: rnd(4, 5) },
      { baseY: QY + rnd(62, 76),  half: rnd(78, 94),  n: rnd(4, 5) },
      { baseY: QY + rnd(80, 94),  half: rnd(82, 100), n: rnd(3, 4) },
      { baseY: QY + rnd(96, 112), half: rnd(74, 92),  n: rnd(2, 3) },
    ];

    const rows = [[Q, NUR, FS]]; // row 0 = queen level
    for (const { baseY, half, n } of rowDefs) {
      const row = [];
      for (let i = 0; i < n; i++) {
        const frac = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2; // −1 to +1
        const cx   = clX(CX + Math.round(frac * half) + rnd(-8, 8));
        const cy   = clY(baseY + rnd(-4, 4));
        const type = cx < CX - 15 ? 2 : cx > CX + 15 ? 3 : 4;
        row.push(place(cx, cy, rnd(3, 6), rnd(2, 4), type));
      }
      rows.push(row);
    }

    // ── Connections — each chamber tunnels diagonally to nearest chamber above
    for (let r = 1; r < rows.length; r++) {
      for (const lo of rows[r]) {
        let parent = rows[r - 1][0], bestD = Infinity;
        for (const up of rows[r - 1]) {
          const d = Math.abs(up.cx - lo.cx);
          if (d < bestD) { bestD = d; parent = up; }
        }
        if (bestD > 110) continue; // isolated — will be connected by live dig
        const fy = parent.cy + parent.ry + 1;
        const ty = lo.cy - lo.ry - 1;
        if (ty > fy) this._diagonal(parent.cx, fy, lo.cx, ty);
      }
    }

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

  // ── Ant-brain nest planner ────────────────────────────────────────────────
  // Strict 1-tile arms → oval chamber (with spacing) → one branch per chamber.
  // Chambers require 20-tile clearance from all neighbours; arms are 12-20 tiles.
  _updateDigPlan() {
    if (this._digQueue.length > 28) return;

    const SR = CONFIG.SURFACE_ROW;
    const GT = CONFIG.GLASS_THICKNESS;

    // ── 1. True tunnel tips (exactly 1 open cardinal neighbour, soil below) ─
    const tips = [];
    for (let y = SR + 3; y < this.height - GT - 3; y++) {
      for (let x = GT + 2; x < this.width - GT - 2; x++) {
        if (!this.isOpen(x, y)) continue;
        let openCard = 0;
        for (const [dx, dy] of [[0,1],[-1,0],[1,0],[0,-1]]) {
          if (this.isOpen(x + dx, y + dy)) openCard++;
        }
        if (openCard === 1 && this.get(x, y + 1) === TILE.SOIL) tips.push([x, y]);
      }
    }

    // ── 2. Chamber perimeter edges (soil adjacent to a CHAMBER tile) ─────
    const chamberEdges = [];
    for (let y = SR + 5; y < this.height - GT - 3; y++) {
      for (let x = GT + 3; x < this.width - GT - 3; x++) {
        if (this.get(x, y) !== TILE.CHAMBER) continue;
        for (const [dx, dy] of [[0,1],[-1,0],[1,0]]) {
          if (this.get(x + dx, y + dy) === TILE.SOIL)
            chamberEdges.push([x, y, dx, dy]);
        }
      }
    }

    if (!tips.length && !chamberEdges.length) return;

    // ── 3. Extend tips downward ────────────────────────────────────────────
    const chosen = [...tips].sort(() => Math.random() - 0.5).slice(0, 4);

    for (const [tx, ty] of chosen) {
      const depth   = ty - SR;
      // Chamber checkpoint every 16 tiles of depth; band prevents double-planning
      const band    = Math.round(depth / 16) * 16;
      const key     = `${tx}_${band}`;
      const atCheck = depth > 12 && !this._chamberSeeds.has(key) &&
                      Math.abs(depth - band) <= 4;

      if (atCheck) {
        // ── CHAMBER: plan an oval room — only if clear of existing chambers ─
        const rx = 3 + Math.floor(Math.random() * 4); // 3–6 half-width
        const ry = 2 + Math.floor(Math.random() * 3); // 2–4 half-height
        const cy = ty + ry + 2;                        // center below tip with gap
        if (!this._hasChamberNear(tx, cy, 12)) {       // 12-tile minimum spacing
          this._chamberSeeds.add(key);
          // Assign type by x-position: left branch = nursery, right = food, center = deep
          const newType = tx < CONFIG.COLONY_X - 8 ? 2
                        : tx > CONFIG.COLONY_X + 8 ? 3 : 4;
          // Bridge the gap between tip and chamber top
          for (let b = ty + 1; b < cy - ry; b++) {
            if (this.get(tx, b) === TILE.SOIL && !this._wouldMerge(tx, b, tx, b - 1))
              this._digQueue.push([tx, b]);
          }
          this._queueOvalOrdered(tx, cy, rx, ry, newType);
          // Seed an exit shaft from below the chamber
          const exitY = cy + ry + 1;
          if (exitY < this.height - GT - 2 && this.get(tx, exitY) === TILE.SOIL)
            this._digQueue.push([tx, exitY]);
        } else {
          // Too close to another chamber — just extend the shaft instead
          this._queueStrictShaft(tx, ty, 0, 1, 8 + Math.floor(Math.random() * 8));
        }
      } else {
        // ── SHAFT: long arms so tunnels reach far across the world ────────
        const len = 18 + Math.floor(Math.random() * 14); // 18–31 tiles
        this._queueStrictShaft(tx, ty, 0, 1, len);
      }
    }

    // ── 4. Up to 2 lateral branches per cycle — fills the world sideways ────
    const branchPool = chamberEdges.slice().sort(() => Math.random() - 0.5)
                                   .slice(0, Math.min(chamberEdges.length, 12));
    let branchesMade = 0;
    for (const [bx, by, dx, dy] of branchPool) {
      if (branchesMade >= 2) break;
      if (Math.random() > 0.65) continue;
      const startX = bx + dx, startY = by + dy;
      if (!this._hasChamberNear(startX + dx * 6, startY + dy * 6, 12)) {
        this._queueStrictShaft(startX, startY, dx, dy, 16 + Math.floor(Math.random() * 14));
        branchesMade++;
      }
    }
  }

  // True if any CHAMBER tile exists within radius tiles of (x, y).
  // Used to enforce spacing so planned chambers don't cluster.
  _hasChamberNear(x, y, radius) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius) continue;
        if (this.get(x + dx, y + dy) === TILE.CHAMBER) return true;
      }
    }
    return false;
  }

  // Returns true if digging (x, y) would touch an existing open tile OTHER than (fromX, fromY).
  // Prevents tunnels from merging and blobing.
  _wouldMerge(x, y, fromX, fromY) {
    for (const [dx, dy] of [[0,1],[-1,0],[1,0],[0,-1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx === fromX && ny === fromY) continue;
      if (this.isOpen(nx, ny)) return true;
    }
    return false;
  }

  // Queue a strict 1-tile-wide shaft; stops when it would merge with another tunnel.
  _queueStrictShaft(startX, startY, dx, dy, len) {
    const GT = CONFIG.GLASS_THICKNESS;
    const SR = CONFIG.SURFACE_ROW;
    let x = startX, y = startY;
    for (let i = 0; i < len; i++) {
      x += dx; y += dy;
      if (x < GT + 1 || x >= this.width - GT - 1) break;
      if (y < SR + 3  || y >= this.height - GT - 1) break;
      if (this.get(x, y) !== TILE.SOIL) break;
      // Stop if connecting here would merge two path segments
      if (this._wouldMerge(x, y, x - dx, y - dy)) break;
      this._digQueue.push([x, y]);
    }
  }

  // Queue oval chamber tiles ordered center-first so ants carve from inside out.
  // type: 0=generic 1=queen 2=nursery 3=food 4=deep gallery
  _queueOvalOrdered(cx, cy, rx, ry, type = 0) {
    const GT = CONFIG.GLASS_THICKNESS;
    const SR = CONFIG.SURFACE_ROW;
    const rxi = rx + 0.5, ryi = ry + 0.5;
    const tiles = [];
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx / rxi) ** 2 + (dy / ryi) ** 2 > 1.0) continue;
        const tx = cx + dx, ty = cy + dy;
        if (tx < GT + 1 || tx >= this.width - GT - 1) continue;
        if (ty < SR + 3  || ty >= this.height - GT - 1) continue;
        if (this.get(tx, ty) === TILE.SOIL)
          tiles.push([tx, ty, dx * dx + dy * dy]);
      }
    }
    tiles.sort((a, b) => a[2] - b[2]); // center first
    this._registerPlannedOval(cx, cy, rx, ry, type); // mark so convertToTunnel upgrades to CHAMBER
    this._digQueue.push(...tiles.map(([x, y]) => [x, y]));
  }

  convertToTunnel(x, y) {
    if (this.get(x, y) !== TILE.SOIL) return;
    const i = this.idx(x, y);
    if (this._plannedChamberSet.has(i)) {
      // Part of a planned oval — become a true chamber tile
      this.set(x, y, TILE.CHAMBER);
      this.chamberType[i] = this._chamberTypeMap[i] || 0;
      this.chamberCount++;
    } else {
      this.set(x, y, TILE.TUNNEL);
      this.tunnelCount++;
    }
    this.digProgress[i] = 0;
  }

  _checkChamber(_cx, _cy) {
    // Intentionally disabled — chamber identity comes from _plannedChamberSet only.
    // The old neighbor-density auto-upgrade caused tunnels to blob into giant cavities.
  }

  _countOpenNear(x, y, radius) {
    let count = 0;
    for (let dy = -radius; dy <= radius; dy++)
      for (let dx = -radius; dx <= radius; dx++)
        if (this.isOpen(x + dx, y + dy)) count++;
    return count;
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

    if (++this._digPlanTimer >= 60) {
      this._digPlanTimer = 0;
      this._updateDigPlan();
    }

    // Alarm decays when no active threats — ants settle back to normal
    if (this.alarmLevel > 0) this.alarmLevel = Math.max(0, this.alarmLevel - 0.0015);

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
    // Evict stale queue entries (already dug or no longer accessible)
    for (let i = this._digQueue.length - 1; i >= 0; i--) {
      const [qx, qy] = this._digQueue[i];
      if (this.get(qx, qy) !== TILE.SOIL || !this.hasOpenNeighbor(qx, qy)) {
        this._digQueue.splice(i, 1);
      }
    }

    // Prefer tiles near the FRONT of the queue — this is the current active arm.
    // Ants cluster at the arm tip rather than scatter across the whole plan.
    const FRONT = Math.min(14, this._digQueue.length);
    let best = null, bestIdx = -1, bestDist = 30;

    for (let i = 0; i < FRONT; i++) {
      const [qx, qy] = this._digQueue[i];
      const d = Math.abs(ax - qx) + Math.abs(ay - qy);
      if (d < bestDist) { bestDist = d; best = [qx, qy]; bestIdx = i; }
    }

    // If front of queue is too far, also scan the rest (might be a closer chamber tile)
    if (!best) {
      for (let i = FRONT; i < this._digQueue.length; i++) {
        const [qx, qy] = this._digQueue[i];
        const d = Math.abs(ax - qx) + Math.abs(ay - qy);
        if (d < bestDist) { bestDist = d; best = [qx, qy]; bestIdx = i; }
      }
    }

    if (best) {
      this._digQueue.splice(bestIdx, 1);
      return best;
    }

    // Fallback: ONLY adjacent cardinal tiles that won't merge two tunnels.
    // No diagonal, no long-range — this prevents ants from free-roam blobing.
    const ix = Math.floor(ax), iy = Math.floor(ay);
    const dirs = [[0,1],[-1,0],[1,0],[0,-1]];
    for (const [dx, dy] of [...dirs].sort(() => Math.random() - 0.5)) {
      const tx = ix + dx, ty = iy + dy;
      if (this.get(tx, ty) !== TILE.SOIL) continue;
      if (!this.hasOpenNeighbor(tx, ty)) continue;
      if (this._wouldMerge(tx, ty, ix, iy)) continue;
      // Anti-blob: skip if digging here would widen an already-open area
      if (this._countOpenNear(tx, ty, 2) > 8) continue;
      return [tx, ty];
    }
    return null;
  }
}
