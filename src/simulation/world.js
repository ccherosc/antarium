import { TILE, CONFIG, ROOM } from '../config.js';
import { logEvent } from '../events.js';
import { GameState } from '../gameState.js';

const { AIR, SURFACE, SOIL, TUNNEL, CHAMBER, GLASS, FOOD, WATER, EGG, ANTHILL, ROCK } = TILE;

// Tiles ants can stand in underground / tiles that count as solid ground
const OPEN = new Uint8Array(16);
OPEN[TUNNEL] = OPEN[CHAMBER] = OPEN[FOOD] = OPEN[WATER] = OPEN[EGG] = 1;
const GROUND = new Uint8Array(16);
GROUND[SURFACE] = GROUND[SOIL] = GROUND[ANTHILL] = GROUND[ROCK] = 1;

const FAR = 0xFFFF;
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const ROOM_EVENT = {
  [ROOM.NURSERY]: 'A new nursery has been hollowed out',
  [ROOM.FOOD]:    'A new food store has been hollowed out',
  [ROOM.DEEP]:    'A new gallery has been hollowed out',
  [ROOM.GENERIC]: 'A new chamber has been hollowed out',
};

// Run-length pack a byte array into a short string for the save file, and back
function pack(a) {
  const out = [];
  for (let i = 0; i < a.length;) {
    const v = a[i];
    let n = 1;
    while (n < 255 && i + n < a.length && a[i + n] === v) n++;
    out.push(n, v);
    i += n;
  }
  let s = '';
  for (let i = 0; i < out.length; i += 8192) s += String.fromCharCode.apply(null, out.slice(i, i + 8192));
  return btoa(s);
}

function unpack(s, a) {
  const b = atob(s);
  let o = 0;
  for (let i = 0; i + 1 < b.length; i += 2) {
    const n = b.charCodeAt(i);
    a.fill(b.charCodeAt(i + 1), o, o + n);
    o += n;
  }
  if (o !== a.length) throw new Error('save data is the wrong size');
}

export class World {
  constructor() {
    const { WORLD_WIDTH: W, WORLD_HEIGHT: H } = CONFIG;
    const N = W * H;
    this.width = W;
    this.height = H;
    this.size = N;
    this.tiles = new Uint8Array(N);
    this.hardness = new Uint8Array(N);
    this.digProgress = new Float32Array(N);
    this.foodAmount = new Float32Array(N);
    this.waterAmount = new Float32Array(N);
    this.pheromoneFood = new Float32Array(N);
    this.pheromoneHome = new Float32Array(N);
    this.organics = new Float32Array(N);       // 0–1, organic density in soil
    // 0=generic  1=queen chamber  2=egg/nursery  3=food store  4=deep gallery
    this.chamberType = new Uint8Array(N);
    this.roomId = new Uint8Array(N);           // chamber index + 1 for excavated chamber tiles
    this.planRoom = new Uint8Array(N);         // chamber index + 1 for tiles a dig project will turn into a chamber
    this.under = new Uint8Array(N);            // what a FOOD / WATER tile turns back into when it is used up
    this.passable = new Uint8Array(N);         // 1 where an ant can stand — tunnels, chambers and the ground line
    this.hillH = new Uint8Array(W);            // anthill height per column, in tiles
    this._hillAcc = new Float32Array(W);       // fractional dirt waiting to become a tile
    this.hillTotal = 0;
    this.alarmLevel = 0; // 0=calm → 1=full war; decays each tick

    this.dirty = true;
    this.dirtyTiles = new Set();

    this.foodStore = 300;
    this.waterStore = 300;
    this.foodCap = CONFIG.FOOD_STORE_MAX;
    this.waterCap = CONFIG.WATER_STORE_MAX;
    this.tunnelCount = 0;
    this.openCount = 0;       // excavated tiles below the surface
    this.soilTotal = 1;       // everything below the surface crust that could be dug
    this.stress = 0;          // 0 = calm, 1 = critical — updated each tick
    this.tick = 0;

    // Version counters let the path fields know when they have gone stale
    this.topoVersion = 0;
    this.foodVersion = 0;
    this.waterVersion = 0;
    this.roomVersion = 0;
    this.digVersion = 0;

    this.foodTiles = new Set();
    this.waterTiles = new Set();
    this.chambers = [];       // { id, cx, cy, rx, ry, type, built, tiles, floor, cap, qd, brood }
    this.stores = [];         // built food stores, nearest the queen first
    this.nurseries = [];      // built nurseries, nearest the queen first
    this.projects = [];       // active dig projects
    this.projectById = new Map();
    this.deposits = [];       // buried organic matter: { x, y, r, found }
    this._nextProjectId = 1;
    this.digCrew = new Map();     // tile → diggers working it this tick
    this.digCrewPrev = new Map(); // …and last tick
    this.fx = [];             // one-shot visual events for the renderer: { t, x, y }
    this.lastDig = null;      // { x, y, tick } — where the colony last broke through

    this.nav = null;          // set by Nav
    this.sky = null;          // set by main
    this._planTimer = 40;
    this._foodTimer = 300;
    this._digRate = 1 / (CONFIG.DIG_TICKS * 1.5);
    this._brood = 0;          // last known brood / population, for choosing what to dig next
    this._pop = 40;
    this._bulk = false;

    this.nurseryPos = null;      // set in _generate
    this.foodStorePos = null;    // set in _generate
    this.queenChamberPos = null; // set in _generate
    this.queenRoom = 0;

    // Scratch buffers for flood fills and path searches
    this._q = new Int32Array(N);
    this._bd = new Uint16Array(N);
    this._near = new Uint8Array(N);
    this._pc = new Float32Array(N);
    this._pp = new Int32Array(N);
    this._pv = new Int32Array(N);
    this._hi = new Int32Array(N * 4);
    this._hc = new Float32Array(N * 4);
    this._hn = 0;
    this._kf = Math.pow(CONFIG.PHER_FOOD_DECAY, 8);
    this._kh = Math.pow(CONFIG.PHER_HOME_DECAY, 8);

    this._generate();
  }

  idx(x, y) {
    return y * this.width + x;
  }

  get(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return GLASS;
    return this.tiles[y * this.width + x];
  }

  set(x, y, type) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const W = this.width, i = y * W + x;
    const old = this.tiles[i];
    if (old === type) return;
    this.tiles[i] = type;
    if (this._bulk) return;

    if (old === FOOD) { this.foodTiles.delete(i); this.foodVersion++; }
    else if (old === WATER) { this.waterTiles.delete(i); this.waterVersion++; }
    if (type === FOOD) { this.foodTiles.add(i); this.foodVersion++; }
    else if (type === WATER) { this.waterTiles.add(i); this.waterVersion++; }

    if (old === TUNNEL) this.tunnelCount--;
    if (type === TUNNEL) this.tunnelCount++;
    const SR = CONFIG.SURFACE_ROW;
    if (y >= SR) this.openCount += OPEN[type] - OPEN[old];

    // The tile and its neighbours need repainting (edges and shadows depend on them)
    const D = this.dirtyTiles;
    D.add(i);
    if (x > 0) D.add(i - 1);
    if (x < W - 1) D.add(i + 1);
    if (y > 0) D.add(i - W);
    if (y < this.height - 1) D.add(i + W);
    this.dirty = true;

    this._refreshPassable(x, y);
    if (y <= SR) {
      // the ground line follows whatever is piled up or dug away here
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny >= SR || ny < 1) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx || dy) this._refreshPassable(x + dx, ny);
        }
      }
    }
  }

  isOpen(x, y) {
    return OPEN[this.get(x, y)] === 1;
  }

  isPassable(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
    return this.passable[y * this.width + x] === 1;
  }

  isDiggable(x, y) {
    return this.get(x, y) === SOIL;
  }

  hasOpenNeighbor(x, y) {
    return this.isOpen(x - 1, y) || this.isOpen(x + 1, y) ||
           this.isOpen(x, y - 1) || this.isOpen(x, y + 1);
  }

  getOpenNeighbors(x, y) {
    const result = [];
    const dirs = [[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dx, dy] of dirs) {
      if (this.isPassable(x + dx, y + dy)) result.push([x + dx, y + dy]);
    }
    return result;
  }

  // Excavated chambers the colony is actually using
  get chamberCount() {
    let n = 0;
    for (const ch of this.chambers) if (ch.built) n++;
    return n;
  }

  get openFraction() {
    return this.openCount / this.soilTotal;
  }

  // ── Passability ──────────────────────────────────────────────────────────

  _calcPassable(x, y) {
    const W = this.width;
    if (x < 1 || y < 1 || x >= W - 1 || y >= this.height - 1) return 0;
    const T = this.tiles, i = y * W + x, t = T[i];
    if (OPEN[t]) return 1;
    if (t !== AIR || y >= CONFIG.SURFACE_ROW) return 0;
    // open air counts only where there is ground to cling to
    return (GROUND[T[i + W]] || GROUND[T[i - 1]] || GROUND[T[i + 1]] ||
            GROUND[T[i + W - 1]] || GROUND[T[i + W + 1]] ||
            GROUND[T[i - W]] || GROUND[T[i - W - 1]] || GROUND[T[i - W + 1]]) ? 1 : 0;
  }

  _refreshPassable(x, y) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = y * this.width + x;
    const v = this._calcPassable(x, y);
    if (v === this.passable[i]) return;
    this.passable[i] = v;
    this.topoVersion++;
    if (this.nav) { if (v) this.nav.opened(i); else this.nav.closed(i); }
  }

  // Recompute everything that is derived from the tile arrays (after generation or loading a save)
  rebuildDerived() {
    const W = this.width, H = this.height, T = this.tiles, SR = CONFIG.SURFACE_ROW;
    this._bulk = false;
    this.foodTiles.clear();
    this.waterTiles.clear();
    this.tunnelCount = 0;
    this.openCount = 0;
    let soil = 0;
    for (const ch of this.chambers) ch.tiles = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x, t = T[i];
        this.passable[i] = this._calcPassable(x, y);
        if (t === FOOD) this.foodTiles.add(i);
        else if (t === WATER) this.waterTiles.add(i);
        if (t === TUNNEL) this.tunnelCount++;
        if (y >= SR) {
          if (OPEN[t]) this.openCount++;
          if (y > SR + 1 && t !== GLASS) soil++;
        }
        const r = this.roomId[i];
        if (r && OPEN[t] && this.chambers[r - 1]) this.chambers[r - 1].tiles.push(i);
      }
    }
    this.soilTotal = Math.max(1, soil);
    this.hillTotal = 0;
    for (let x = 0; x < W; x++) this.hillTotal += this.hillH[x];
    this.projectById.clear();
    for (const p of this.projects) {
      this.projectById.set(p.id, p);
      p.frontier = []; p.crew = 0; p.fver = 0; p.cap = 3;
    }
    this.topoVersion++; this.foodVersion++; this.waterVersion++; this.digVersion++;
    if (this.nav) this.nav.reset();
    this._roomsChanged();
    this._refreshProjects();
    this.dirtyTiles.clear();
    this.dirty = true;
  }

  // ── Saving ───────────────────────────────────────────────────────────────

  save() {
    const food = [], water = [];
    for (const i of this.foodTiles) food.push(i, Math.round(this.foodAmount[i]));
    for (const i of this.waterTiles) water.push(i, Math.round(this.waterAmount[i]));
    const org = new Uint8Array(this.size);
    for (let i = 0; i < this.size; i++) org[i] = Math.round(this.organics[i] * 255);
    return {
      tiles: pack(this.tiles),
      hardness: pack(this.hardness),
      organics: pack(org),
      chamberType: pack(this.chamberType),
      roomId: pack(this.roomId),
      planRoom: pack(this.planRoom),
      under: pack(this.under),
      hill: Array.from(this.hillH),
      food, water,
      chambers: this.chambers.map(c => [c.cx, c.cy, c.rx, c.ry, c.type, c.built ? 1 : 0]),
      projects: this.projects.map(p => ({ id: p.id, kind: p.kind, path: Array.from(p.path), pi: p.pi,
                                          room: p.room, plan: Array.from(p.plan), dep: p.dep })),
      deposits: this.deposits,
      nextProjectId: this._nextProjectId,
      queenRoom: this.queenRoom,
      foodStore: this.foodStore,
      waterStore: this.waterStore,
      tick: this.tick,
    };
  }

  load(d) {
    unpack(d.tiles, this.tiles);
    unpack(d.hardness, this.hardness);
    unpack(d.chamberType, this.chamberType);
    unpack(d.roomId, this.roomId);
    unpack(d.planRoom, this.planRoom);
    unpack(d.under, this.under);
    const org = new Uint8Array(this.size);
    unpack(d.organics, org);
    for (let i = 0; i < this.size; i++) this.organics[i] = org[i] / 255;

    this.digProgress.fill(0);
    this.foodAmount.fill(0);
    this.waterAmount.fill(0);
    this.pheromoneFood.fill(0);
    this.pheromoneHome.fill(0);
    for (let k = 0; k < d.food.length; k += 2) this.foodAmount[d.food[k]] = d.food[k + 1];
    for (let k = 0; k < d.water.length; k += 2) this.waterAmount[d.water[k]] = d.water[k + 1];
    this.hillH.set(d.hill);
    this._hillAcc.fill(0);

    this.chambers = d.chambers.map((c, id) => ({
      id, cx: c[0], cy: c[1], rx: c[2], ry: c[3], type: c[4], built: !!c[5],
      tiles: [], floor: [], cap: 0, qd: 0, brood: 0, held: 0, care: 0 }));
    this.projects = d.projects.map(p => ({ ...p, frontier: [], crew: 0, cap: 3, fver: 0 }));
    this.deposits = d.deposits;
    this._nextProjectId = d.nextProjectId;
    this.queenRoom = d.queenRoom;
    const q = this.chambers[this.queenRoom];
    this.queenChamberPos = { x: q.cx, y: q.cy };
    this.foodStore = d.foodStore;
    this.waterStore = d.waterStore;
    this.tick = d.tick;
    this.alarmLevel = 0;
    this.digCrew.clear();
    this.digCrewPrev.clear();
    this.fx.length = 0;
    this.lastDig = null;
    this.rebuildDerived();
  }

  // ── Generation ───────────────────────────────────────────────────────────

  _generate() {
    const W = this.width, H = this.height, T = this.tiles;
    const SR = CONFIG.SURFACE_ROW;
    const CX = CONFIG.COLONY_X;
    const GT = CONFIG.GLASS_THICKNESS;
    this._bulk = true;

    T.fill(SOIL);
    this._genHardness();

    // Air above surface
    for (let y = 0; y < SR; y++) {
      for (let x = 0; x < W; x++) {
        T[y * W + x] = AIR;
        this.hardness[y * W + x] = 0;
      }
    }
    for (let x = 0; x < W; x++) {
      T[SR * W + x] = SURFACE;
      T[(SR + 1) * W + x] = SURFACE;
    }

    // Glass border
    for (let y = 0; y < H; y++) {
      for (let gx = 0; gx < GT; gx++) {
        T[y * W + gx] = GLASS;
        T[y * W + W - 1 - gx] = GLASS;
      }
    }
    for (let x = 0; x < W; x++) {
      for (let gy = 0; gy < GT; gy++) {
        T[gy * W + x] = GLASS;
        T[(H - 1 - gy) * W + x] = GLASS;
      }
    }

    this._genRocks();

    // ── Procedural colony layout — unique each run ───────────────────────────
    const clX  = x => Math.max(GT + 8,  Math.min(W - GT - 9,  x));
    const clY  = y => Math.max(SR + 18, Math.min(H - GT - 8,  y));

    const place = (cx, cy, rx, ry, type) => {
      let ox = clX(Math.round(cx)), oy = clY(Math.round(cy));
      // nudge apart chambers that would land on top of each other
      for (let k = 0; k < 8 && this._overlapsChamber(ox, oy, rx, ry); k++) {
        ox = clX(Math.round(cx) + rnd(-12, 12));
        oy = clY(Math.round(cy) + rnd(-7, 7));
      }
      const ch = this._addChamber(ox, oy, rx, ry, type);
      this._carveChamber(ch);
      return ch;
    };

    // ── Entrance shaft — two tiles wide so traffic can pass both ways ────────
    const FY = SR + 15;
    for (let y = SR; y <= FY + 1; y++) { this._carve(CX, y); this._carve(CX + 1, y); }
    this._carveChamber(this._addChamber(CX, FY, 3, 1, ROOM.GENERIC));

    // ── Queen chamber — slightly offset every run ────────────────────────────
    const QX = clX(CX + rnd(-12, 12));
    const QY = clY(SR + rnd(44, 52));
    for (let y = FY + 1; y <= QY - 5; y++) { this._carve(CX, y); this._carve(CX + 1, y); }
    if (Math.abs(QX - CX) > 2) {
      for (let x = Math.min(CX, QX); x <= Math.max(CX, QX) + 1; x++) {
        this._carve(x, QY - 6);
        this._carve(x, QY - 5);
      }
      for (let y = QY - 5; y <= QY - 1; y++) { this._carve(QX, y); this._carve(QX + 1, y); }
    }
    const Q = this._addChamber(QX, QY, 7, 5, ROOM.QUEEN);
    this._carveChamber(Q);
    this.queenChamberPos = { x: QX, y: QY };
    this.queenRoom = Q.id;

    // ── Upper galleries (wide arms from the foyer, 2–4 per run) ─────────────
    const arms = rnd(2, 4);
    for (let i = 0; i < arms; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const dist = rnd(28, 52) + Math.floor(i / 2) * rnd(8, 18);
      const ch   = place(clX(CX + side * dist + rnd(-6, 6)),
                         clY(FY + rnd(14, 24)),
                         rnd(3, 6), rnd(2, 3), side < 0 ? ROOM.NURSERY : ROOM.FOOD);
      this._diagonal(side < 0 ? CX - 1 : CX + 2, FY + 2, ch.cx, ch.cy - ch.ry - 1);
    }

    // ── Nursery and food storage flanking the queen ──────────────────────────
    const NUR = place(clX(QX - rnd(22, 42)), clY(QY + rnd(14, 26)),
                      rnd(4, 6), rnd(2, 4), ROOM.NURSERY);
    this._diagonal(QX - 6, QY + 5, NUR.cx + NUR.rx + 1, NUR.cy);

    const FS  = place(clX(QX + rnd(22, 42)), clY(QY + rnd(14, 26)),
                      rnd(4, 6), rnd(2, 4), ROOM.FOOD);
    this._diagonal(QX + 6, QY + 5, FS.cx - FS.rx - 1, FS.cy);

    this.nurseryPos   = { x: NUR.cx, y: NUR.cy };
    this.foodStorePos = { x: FS.cx,  y: FS.cy  };

    // ── Deep gallery rows — the first three levels are ready-made; everything
    //    below and between them is left for the colony to dig for itself ──────
    const rowDefs = [
      { baseY: QY + rnd(26, 36), half: rnd(56, 72), n: rnd(3, 5) },
      { baseY: QY + rnd(44, 56), half: rnd(70, 86), n: rnd(4, 5) },
      { baseY: QY + rnd(62, 76), half: rnd(78, 94), n: rnd(4, 5) },
    ];

    const rows = [[Q, NUR, FS]]; // row 0 = queen level
    for (const { baseY, half, n } of rowDefs) {
      const row = [];
      for (let i = 0; i < n; i++) {
        const frac = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2; // −1 to +1
        const cx   = clX(CX + Math.round(frac * half) + rnd(-8, 8));
        const cy   = clY(baseY + rnd(-4, 4));
        // a second nursery and a few more larders to begin with; the rest are living
        // quarters and fungus gardens
        const pick = Math.random();
        const type = cx < CX - 15 ? (rows.length === 1 && i === 0 ? ROOM.NURSERY : pick < 0.5 ? ROOM.GENERIC : ROOM.DEEP)
                   : cx > CX + 15 ? (pick < 0.45 ? ROOM.FOOD : pick < 0.75 ? ROOM.GENERIC : ROOM.DEEP)
                   : (pick < 0.5 ? ROOM.DEEP : ROOM.GENERIC);
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
        if (bestD > 110) continue; // too far — _connectAll finds it a route instead
        const fy = parent.cy + parent.ry + 1;
        const ty = lo.cy - lo.ry - 1;
        if (ty > fy) this._diagonal(parent.cx, fy, lo.cx, ty);
      }
    }

    // Organic deposits — clusters of dark organic matter in the soil
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
          const i = ty * W + tx;
          this.organics[i] = Math.min(1, this.organics[i] + (1 - d / or) * (0.5 + Math.random() * 0.5));
        }
      }
      this.deposits.push({ x: ocx, y: ocy, r: or, found: false });
    }

    // Every chamber must be reachable on foot from the entrance
    this._connectAll();
    this._roughen();

    this.rebuildDerived();
    for (const d of this.deposits) if (OPEN[T[d.y * W + d.x]]) d.found = true;

    // Surface food
    for (let i = 0; i < 3; i++) this._spawnSurfaceFood(true);

    this.dirtyTiles.clear();
    this.dirty = true;
  }

  // Lumpy soil: bands of loose and compacted earth that tunnels prefer to wind through
  _genHardness() {
    const W = this.width, H = this.height, G = 9;
    const gw = Math.ceil(W / G) + 2, gh = Math.ceil(H / G) + 2;
    const g = new Float32Array(gw * gh);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    for (let y = 0; y < H; y++) {
      const fy = y / G, y0 = fy | 0, ty = fy - y0, sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < W; x++) {
        const fx = x / G, x0 = fx | 0, tx = fx - x0, sx = tx * tx * (3 - 2 * tx);
        const a = g[y0 * gw + x0], b = g[y0 * gw + x0 + 1];
        const c = g[(y0 + 1) * gw + x0], d = g[(y0 + 1) * gw + x0 + 1];
        const n = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
        this.hardness[y * W + x] = 40 + (n * 0.75 + Math.random() * 0.25) * 60;
      }
    }
  }

  // A scattering of buried stones
  _genRocks() {
    const W = this.width, H = this.height, T = this.tiles;
    const SR = CONFIG.SURFACE_ROW, GT = CONFIG.GLASS_THICKNESS, CX = CONFIG.COLONY_X;
    for (let k = 0; k < 18; k++) {
      const rx = rnd(1, 3), ry = rnd(1, 2);
      const cx = rnd(GT + 5, W - GT - 6), cy = rnd(SR + 9, H - GT - 5);
      if (Math.abs(cx - CX) < 9 && cy < SR + 62) continue; // keep the main shaft clear
      const rxi = rx + 0.4 + Math.random() * 0.4, ryi = ry + 0.4 + Math.random() * 0.4;
      for (let dy = -ry; dy <= ry; dy++) {
        for (let dx = -rx; dx <= rx; dx++) {
          if ((dx / rxi) ** 2 + (dy / ryi) ** 2 > 1) continue;
          const i = (cy + dy) * W + cx + dx;
          if (T[i] === SOIL) { T[i] = ROCK; this.hardness[i] = 255; }
        }
      }
    }
  }

  _inSoilBounds(x, y) {
    const GT = CONFIG.GLASS_THICKNESS;
    return x > GT && x < this.width - GT - 1 && y >= CONFIG.SURFACE_ROW && y < this.height - GT - 1;
  }

  // Generation only: open a tile without disturbing chambers
  _carve(x, y, type = TUNNEL) {
    if (!this._inSoilBounds(x, y)) return;
    const i = y * this.width + x, t = this.tiles[i];
    if (t === SOIL || t === ROCK || t === SURFACE) this.tiles[i] = type;
  }

  // Diagonal tunnel — stair-stepped, so every tile shares an edge with the next
  _diagonal(x1, y1, x2, y2, type = TUNNEL) {
    let x = x1, y = y1;
    this._carve(x, y, type);
    while (x !== x2 || y !== y2) {
      if (x !== x2) { x += x < x2 ? 1 : -1; this._carve(x, y, type); }
      if (y !== y2) { y += y < y2 ? 1 : -1; this._carve(x, y, type); }
    }
  }

  // A soil tile beside i that a tunnel could spread into, or -1
  _sideTile(i) {
    const W = this.width;
    const j = i + (Math.random() < 0.5 ? (Math.random() < 0.5 ? 1 : -1) : (Math.random() < 0.5 ? W : -W));
    const y = (j / W) | 0;
    if (this.tiles[j] !== SOIL || this.planRoom[j] || y < CONFIG.SURFACE_ROW + 4) return -1;
    return this._inSoilBounds(j % W, y) ? j : -1;
  }

  // Generation only: nibble at the tunnel walls so no two stretches are quite alike
  _roughen() {
    const T = this.tiles, add = [];
    for (let i = 0; i < this.size; i++) {
      if (T[i] !== TUNNEL || Math.random() > 0.5) continue;
      const j = this._sideTile(i);
      if (j >= 0) add.push(j);
    }
    for (const j of add) T[j] = TUNNEL;
  }

  // Tile indices inside an oval (rx = half-width, ry = half-height)
  _ovalTiles(cx, cy, rx, ry) {
    const out = [];
    const rxi = rx + 0.5, ryi = ry + 0.5;
    for (let dy = -ry; dy <= ry; dy++) {
      for (let dx = -rx; dx <= rx; dx++) {
        if ((dx / rxi) * (dx / rxi) + (dy / ryi) * (dy / ryi) > 1.0) continue;
        if (this._inSoilBounds(cx + dx, cy + dy)) out.push((cy + dy) * this.width + cx + dx);
      }
    }
    return out;
  }

  _addChamber(cx, cy, rx, ry, type) {
    const ch = { id: this.chambers.length, cx, cy, rx, ry, type, built: false,
                 tiles: [], floor: [], cap: 0, qd: 0, brood: 0, held: 0, care: 0 };
    this.chambers.push(ch);
    return ch;
  }

  _carveChamber(ch) {
    for (const i of this._ovalTiles(ch.cx, ch.cy, ch.rx, ch.ry)) {
      this.tiles[i] = CHAMBER;
      this.roomId[i] = ch.id + 1;
      this.chamberType[i] = ch.type;
    }
    ch.built = true;
  }

  _overlapsChamber(cx, cy, rx, ry) {
    for (const c of this.chambers) {
      if (Math.abs(c.cx - cx) < c.rx + rx + 3 && Math.abs(c.cy - cy) < c.ry + ry + 3) return true;
    }
    return false;
  }

  // Join every open pocket to the entrance with the cheapest tunnel through the soil
  _connectAll() {
    const W = this.width, T = this.tiles, N = this.size;
    const seen = new Uint8Array(N), q = this._q;
    const start = CONFIG.SURFACE_ROW * W + CONFIG.COLONY_X;
    for (let pass = 0; pass < 60; pass++) {
      seen.fill(0);
      let head = 0, tail = 0;
      seen[start] = 1; q[tail++] = start;
      while (head < tail) {
        const i = q[head++];
        for (const j of [i - 1, i + 1, i - W, i + W]) {
          if (!seen[j] && OPEN[T[j]]) { seen[j] = 1; q[tail++] = j; }
        }
      }
      let cut = false;
      for (let i = 0; i < N; i++) if (OPEN[T[i]] && !seen[i]) { cut = true; break; }
      if (!cut) return;
      const sources = [];
      for (let k = 0; k < tail; k++) sources.push(q[k]);
      const stray = j => OPEN[T[j]] && !seen[j];
      const path = this._soilPath(sources,
        i => stray(i - 1) || stray(i + 1) || stray(i - W) || stray(i + W), { minY: CONFIG.SURFACE_ROW + 3 });
      if (!path) return;
      for (const i of path) T[i] = TUNNEL;
    }
  }

  // ── Path search through soil ─────────────────────────────────────────────

  _heapPush(i, c) {
    const hi = this._hi, hc = this._hc;
    if (this._hn >= hi.length) return;
    let n = this._hn++;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (hc[p] <= c) break;
      hi[n] = hi[p]; hc[n] = hc[p];
      n = p;
    }
    hi[n] = i; hc[n] = c;
  }

  _heapPop() {
    const hi = this._hi, hc = this._hc;
    const top = hi[0];
    const n = --this._hn;
    if (n > 0) {
      const li = hi[n], lc = hc[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && hc[c + 1] < hc[c]) c++;
        if (hc[c] >= lc) break;
        hi[k] = hi[c]; hc[k] = hc[c];
        k = c;
      }
      hi[k] = li; hc[k] = lc;
    }
    return top;
  }

  // Cheapest route through diggable soil from any source tile to the first soil tile
  // that satisfies isGoal. Loose soil is cheap, compacted soil dear, and running
  // alongside existing tunnels is discouraged so new ones strike out on their own.
  // Slanting costs less than going round the corner, so routes head straight for
  // where they are going and wander with the grain of the soil on the way.
  // Returns the soil tiles of the route, goal end first — or null.
  _soilPath(sources, isGoal, opts = {}) {
    const W = this.width, T = this.tiles, GT = CONFIG.GLASS_THICKNESS;
    const cost = this._pc, prev = this._pp, via = this._pv, hard = this.hardness;
    const minY = opts.minY ?? CONFIG.SURFACE_ROW + 4;
    const maxY = this.height - GT - 2, minX = GT + 1, maxX = W - GT - 2;
    const near = opts.near || null;
    const limit = opts.limit ?? Infinity;
    cost.fill(Infinity);
    this._hn = 0;
    for (const s of sources) {
      if (cost[s] === 0) continue;
      cost[s] = 0; prev[s] = -1; via[s] = -1;
      this._heapPush(s, 0);
    }
    // what it takes to break into tile j
    const dig = j => {
      const h = (hard[j] - 40) / 60;
      return 1 + (h > 0 ? h * 1.6 : 0) + Math.random() * 0.3 + (near && near[j] <= 2 ? 5 : 0);
    };
    while (this._hn > 0) {
      const c = this._hc[0];
      const i = this._heapPop();
      if (c > cost[i]) continue;
      if (T[i] === SOIL && isGoal(i)) {
        const path = [];
        for (let k = i; k >= 0; k = prev[k]) {
          if (T[k] === SOIL) path.push(k);
          if (via[k] >= 0) path.push(via[k]);
        }
        return path;
      }
      if (c > limit) return null;
      const x = i % W, y = (i - x) / W;
      for (let n = 0; n < 8; n++) {
        const dx = n < 3 ? -1 : n < 5 ? 0 : 1;
        const dy = n === 0 || n === 3 || n === 5 ? -1 : n === 1 || n === 6 ? 0 : 1;
        const nx = x + dx, ny = y + dy;
        if (nx < minX || nx > maxX || ny < minY || ny > maxY) continue;
        const j = ny * W + nx;
        if (T[j] !== SOIL) continue;
        let step = dig(j), mid = -1;
        if (dx && dy) {
          // a slant is dug as a stair: one tile sideways, one up or down
          mid = y * W + nx;
          if (T[mid] !== SOIL) { mid = ny * W + x; if (T[mid] !== SOIL) continue; }
          step = (step + dig(mid)) * 0.7071;
        }
        const nc = c + step;
        if (nc < cost[j]) { cost[j] = nc; prev[j] = i; via[j] = mid; this._heapPush(j, nc); }
      }
    }
    return null;
  }

  // Steps through solid ground to the nearest opening, planned room or wall of the farm (capped at 255)
  _distToOpen() {
    const W = this.width, N = this.size, T = this.tiles, d = this._near, q = this._q;
    let head = 0, tail = 0;
    for (let i = 0; i < N; i++) {
      const t = T[i];
      if ((t === SOIL && !this.planRoom[i]) || t === ROCK) d[i] = 255;
      else { d[i] = 0; q[tail++] = i; }
    }
    for (const p of this.projects) {
      for (const i of p.path) if (d[i]) { d[i] = 0; q[tail++] = i; }
    }
    while (head < tail) {
      const i = q[head++], nd = d[i] + 1;
      if (nd >= 255) continue;
      const x = i % W;
      if (x > 0 && d[i - 1] > nd) { d[i - 1] = nd; q[tail++] = i - 1; }
      if (x < W - 1 && d[i + 1] > nd) { d[i + 1] = nd; q[tail++] = i + 1; }
      if (i >= W && d[i - W] > nd) { d[i - W] = nd; q[tail++] = i - W; }
      if (i < N - W && d[i + W] > nd) { d[i + W] = nd; q[tail++] = i + W; }
    }
    return d;
  }

  // Walking distance from a set of tiles to everywhere else
  _bfs(sources) {
    const W = this.width, d = this._bd, q = this._q, P = this.passable;
    d.fill(FAR);
    let head = 0, tail = 0;
    for (const s of sources) if (P[s] && d[s] !== 0) { d[s] = 0; q[tail++] = s; }
    while (head < tail) {
      const i = q[head++], nd = d[i] + 1;
      let j = i - 1; if (P[j] && d[j] === FAR) { d[j] = nd; q[tail++] = j; }
      j = i + 1;     if (P[j] && d[j] === FAR) { d[j] = nd; q[tail++] = j; }
      j = i - W;     if (P[j] && d[j] === FAR) { d[j] = nd; q[tail++] = j; }
      j = i + W;     if (P[j] && d[j] === FAR) { d[j] = nd; q[tail++] = j; }
    }
    return d;
  }

  // ── Rooms ────────────────────────────────────────────────────────────────

  // Called whenever a chamber is finished: work out what the nest can hold and
  // how far each room is from the queen.
  _roomsChanged() {
    const W = this.width;
    this.roomVersion++;
    const q = this.chambers[this.queenRoom];
    const d = this._bfs(q && q.tiles.length ? q.tiles : []);
    const stores = [], nurseries = [];
    let cap = 0;
    for (const ch of this.chambers) {
      if (ch.tiles.length < 4) ch.built = false;
      if (!ch.built) continue;
      let qd = FAR;
      for (const i of ch.tiles) if (d[i] < qd) qd = d[i];
      ch.qd = qd;
      // bottom of the room first, middle before the edges — piles build up from here
      const cx = ch.cx;
      ch.floor = ch.tiles.slice().sort((a, b) => {
        const ay = (a / W) | 0, by = (b / W) | 0;
        return by - ay || Math.abs(a % W - cx) - Math.abs(b % W - cx);
      });
      if (ch.type === ROOM.FOOD) {
        ch.cap = ch.tiles.length * CONFIG.STORE_PER_TILE;
        cap += ch.cap;
        stores.push(ch);
      } else if (ch.type === ROOM.NURSERY) {
        ch.cap = Math.max(4, Math.floor(ch.tiles.length * 0.6));
        nurseries.push(ch);
      }
    }
    stores.sort((a, b) => a.qd - b.qd);
    nurseries.sort((a, b) => a.qd - b.qd);
    this.stores = stores;
    this.nurseries = nurseries;
    this.foodCap = Math.max(400, cap);
    this.waterCap = this.foodCap;
    this._fillStores();
  }

  // The larder is a single number; share it out over the store chambers by size so
  // each one can show its own pile.
  _fillStores() {
    let cap = 0;
    for (const ch of this.stores) cap += ch.cap;
    const f = cap > 0 ? Math.min(1, this.foodStore / cap) : 0;
    for (const ch of this.stores) ch.held = ch.cap * f;
  }

  // ── Dig projects ─────────────────────────────────────────────────────────
  // The colony digs with intent: each project is a tunnel driven from the open
  // nest to a destination, then (for galleries) a chamber hollowed out at the end.

  _addProject(kind, path, room, plan, dep = -1) {
    plan = plan || [];
    // once the tunnel is through, its walls get nibbled back here and there
    const taken = new Set(path);
    for (const i of plan) taken.add(i);
    for (const i of path) {
      if (Math.random() > 0.45) continue;
      const j = this._sideTile(i);
      if (j >= 0 && !taken.has(j)) { taken.add(j); plan.push(j); }
    }
    const p = { id: this._nextProjectId++, kind, path, pi: 0, room, plan, dep,
                frontier: [], crew: 0, cap: 3, fver: 0 };
    this.projects.push(p);
    this.projectById.set(p.id, p);
    this._refreshFrontier(p);
    return p;
  }

  _touchesNest(i) {
    const W = this.width, P = this.passable, SR2 = (CONFIG.SURFACE_ROW + 2) * W;
    return (P[i - 1] && i - 1 >= SR2) || (P[i + 1] && i + 1 >= SR2) ||
           (P[i - W] && i - W >= SR2) || (P[i + W] && i + W >= SR2);
  }

  _hasPassableNeighbor(i) {
    const W = this.width, P = this.passable;
    return P[i - 1] || P[i + 1] || P[i - W] || P[i + W];
  }

  // Work out which tiles of a project can be dug right now. Returns false when it is finished.
  _refreshFrontier(p) {
    const T = this.tiles;
    const f = [];
    while (p.pi < p.path.length && T[p.path[p.pi]] !== SOIL) p.pi++;
    if (p.pi < p.path.length) {
      const i = p.path[p.pi];
      if (this._hasPassableNeighbor(i)) f.push(i);
      p.cap = 3;
    } else {
      for (const i of p.plan) if (T[i] === SOIL && this._hasPassableNeighbor(i)) f.push(i);
      p.cap = Math.max(3, Math.min(12, f.length + 2));
    }
    const old = p.frontier;
    let same = old.length === f.length;
    for (let k = 0; same && k < f.length; k++) if (old[k] !== f[k]) same = false;
    if (!same) { p.frontier = f; p.fver++; }
    return f.length > 0;
  }

  _refreshProjects() {
    for (let k = this.projects.length - 1; k >= 0; k--) {
      const p = this.projects[k];
      if (this._refreshFrontier(p)) continue;
      this.projects.splice(k, 1);
      this.projectById.delete(p.id);
      this._completeProject(p);
    }
  }

  _completeProject(p) {
    for (const i of p.plan) this.planRoom[i] = 0;
    if (this.nav) this.nav.drop('d' + p.id);
    if (p.kind === 'gallery' && p.room >= 0) {
      const ch = this.chambers[p.room];
      ch.built = ch.tiles.length >= 4;
      this._roomsChanged();
      if (ch.built) logEvent(ROOM_EVENT[ch.type] || ROOM_EVENT[ROOM.GENERIC]);
    } else if (p.kind === 'link') {
      this._roomsChanged();
      logEvent('A new tunnel links two parts of the nest');
    } else if (p.kind === 'prospect' && this.deposits[p.dep]) {
      this.deposits[p.dep].found = true;
    }
  }

  // Decide whether to start something new. Runs every second or two.
  _updateProjects(sim) {
    const ants = sim && sim.antSystem;
    let diggers = 6;
    if (ants) {
      diggers = ants.roleCounts.digger;
      this._pop = ants.population;
      this._brood = ants.eggCount;
    }
    let digs = 0, prospect = false;
    for (const p of this.projects) { if (p.kind === 'prospect') prospect = true; else digs++; }

    const room = this.openFraction < CONFIG.MAX_OPEN_FRACTION && this.chambers.length < 240;
    const want = Math.max(2, Math.min(8, Math.ceil(diggers / 4)));
    if (room && digs < want) {
      // mostly new galleries, now and then a short-cut between existing ones
      if (!(Math.random() < 0.2 && this._planLink())) this._planGallery();
    }
    if (!prospect && room && Math.random() < 0.35) this._planProspect();
  }

  _pickSite(near, rx, ry) {
    const W = this.width, GT = CONFIG.GLASS_THICKNESS, SR = CONFIG.SURFACE_ROW;
    const need = Math.max(rx, ry) + 4;
    const pref = need + rnd(0, 16);   // some rooms hug the nest, some strike out further
    let best = -1, bestS = -Infinity;
    for (let k = 0; k < 70; k++) {
      const x = rnd(GT + 3 + rx, W - GT - 4 - rx);
      const y = rnd(SR + 7 + ry, this.height - GT - 4 - ry);
      const i = y * W + x;
      if (this.tiles[i] !== SOIL) continue;
      const d = near[i];
      if (d < need) continue;
      const s = -Math.abs(d - pref) + Math.random() * 3;
      if (s > bestS) { bestS = s; best = i; }
    }
    return best;
  }

  // What the colony is shortest of; otherwise follow the layout's habit of
  // nurseries to the left, stores to the right and living quarters in the middle.
  _nextRoomType(cx) {
    let broodCap = 0;
    for (const n of this.nurseries) broodCap += n.cap;
    for (const p of this.projects) {
      const ch = p.room >= 0 ? this.chambers[p.room] : null;
      if (ch && ch.type === ROOM.NURSERY) broodCap += 20;
    }
    if (this._brood > broodCap * 0.6) return ROOM.NURSERY;
    if (this.foodCap < 300 + this._pop * 7) return ROOM.FOOD;
    // otherwise somewhere to live: sleeping quarters, and a fungus garden now and then
    const r = Math.random();
    if (r < 0.12 && cx > CONFIG.COLONY_X) return ROOM.FOOD;
    return r < 0.5 ? ROOM.DEEP : ROOM.GENERIC;
  }

  _planGallery() {
    const W = this.width;
    const near = this._distToOpen();
    let rx = rnd(3, 6), ry = rnd(2, 4);
    let site = this._pickSite(near, rx, ry);
    if (site < 0) { rx = 3; ry = 2; site = this._pickSite(near, rx, ry); }
    if (site < 0) return null;
    const path = this._soilPath([site], i => this._touchesNest(i), { near, limit: 420 });
    if (!path || path.length > 110) return null;
    const cx = site % W, cy = (site / W) | 0;
    const ch = this._addChamber(cx, cy, rx, ry, this._nextRoomType(cx));
    const plan = [];
    for (const i of this._ovalTiles(cx, cy, rx, ry)) {
      if (this.tiles[i] !== SOIL) continue;
      this.planRoom[i] = ch.id + 1;
      plan.push(i);
    }
    return this._addProject('gallery', path, ch.id, plan);
  }

  // A short-cut between two chambers that are close together but a long walk apart
  _planLink() {
    const W = this.width, T = this.tiles;
    const built = this.chambers.filter(c => c.built && c.tiles.length);
    if (built.length < 5) return null;
    const A = built[rnd(0, built.length - 1)];
    const d = this._bfs(A.tiles);
    let B = null, bestR = 2.4, bestE = 0;
    for (const c of built) {
      if (c === A) continue;
      const e = Math.hypot(c.cx - A.cx, c.cy - A.cy);
      if (e < 14 || e > 60) continue;
      const pd = d[c.tiles[0]];
      if (pd === FAR) continue;
      const r = pd / (e + 12);
      if (r > bestR) { bestR = r; B = c; bestE = e; }
    }
    if (!B) return null;
    const near = this._distToOpen();
    const src = [];
    for (const i of A.tiles) {
      for (const j of [i - 1, i + 1, i - W, i + W]) if (T[j] === SOIL && !this.planRoom[j]) src.push(j);
    }
    if (!src.length) return null;
    const R = this.roomId, g = B.id + 1;
    const path = this._soilPath(src,
      i => R[i - 1] === g || R[i + 1] === g || R[i - W] === g || R[i + W] === g,
      { near, limit: bestE * 9 + 60 });
    if (!path || path.length < 4 || path.length > bestE * 2 + 14) return null;
    return this._addProject('link', path, -1, null);
  }

  // Drive a tunnel towards the nearest patch of buried organic matter
  _planProspect() {
    const W = this.width, T = this.tiles;
    const near = this._distToOpen();
    let best = -1, bd = 60;
    for (let k = 0; k < this.deposits.length; k++) {
      const dp = this.deposits[k];
      if (dp.found) continue;
      const i = dp.y * W + dp.x;
      if (T[i] !== SOIL) { if (OPEN[T[i]]) dp.found = true; continue; }
      if (near[i] < bd) { bd = near[i]; best = k; }
    }
    if (best < 0) return null;
    const dp = this.deposits[best];
    const path = this._soilPath([dp.y * W + dp.x], i => this._touchesNest(i), { near, limit: 420 });
    if (!path || path.length > 110) { dp.found = true; return null; }
    const plan = [];
    for (let dy = -dp.r; dy <= dp.r; dy++) {
      for (let dx = -dp.r; dx <= dp.r; dx++) {
        const x = dp.x + dx, y = dp.y + dy;
        if (!this._inSoilBounds(x, y) || y < CONFIG.SURFACE_ROW + 4) continue;
        const i = y * W + x;
        if (T[i] === SOIL && this.organics[i] > 0.30 && !this.planRoom[i]) plan.push(i);
      }
    }
    return this._addProject('prospect', path, -1, plan, best);
  }

  // One digger-tick of work on a tile. Returns true when it gives way.
  digTick(i) {
    const before = this.digProgress[i];
    const after = before + this._digRate * (70 / (30 + this.hardness[i]));
    this.digProgress[i] = after;
    if (((after * 4) | 0) !== ((before * 4) | 0)) { this.dirtyTiles.add(i); this.dirty = true; } // cracks spread
    return after >= 1;
  }

  // A tile has been dug through
  finishDig(i) {
    if (this.tiles[i] !== SOIL) return;
    const W = this.width, x = i % W, y = (i - x) / W;
    this.digProgress[i] = 0;
    const pr = this.planRoom[i];
    let base = TUNNEL;
    if (pr && this.chambers[pr - 1]) {
      const ch = this.chambers[pr - 1];
      this.planRoom[i] = 0;
      this.roomId[i] = pr;
      this.chamberType[i] = ch.type;
      ch.tiles.push(i);
      base = CHAMBER;
    }
    if (this.organics[i] > 0.30) {
      // rich organic matter — the tile itself becomes food
      this.under[i] = base;
      this.foodAmount[i] = 70 + this.organics[i] * 130;
      this.organics[i] = 0;
      this.set(x, y, FOOD);
      for (const d of this.deposits) {
        if (d.found || Math.abs(d.x - x) > d.r + 1 || Math.abs(d.y - y) > d.r + 1) continue;
        d.found = true;
        logEvent('Underground food deposit discovered!');
        break;
      }
    } else {
      this.set(x, y, base);
    }
    this.digVersion++;
    this.lastDig = { x, y, tick: this.tick };
    this.fx.push({ t: 'dust', x: x + 0.5, y: y + 0.5 });
    this._refreshProjects();
  }

  // ── The surface ──────────────────────────────────────────────────────────

  // Row an ant stands in when it walks over column x
  groundRow(x) {
    return CONFIG.SURFACE_ROW - 1 - this.hillH[x];
  }

  // Smoothed standing height for anything crossing the surface at a fractional x
  groundY(xf) {
    const f = Math.max(0, Math.min(this.width - 1, xf - 0.5));   // level beyond either end
    const x0 = Math.floor(f), t = f - x0;
    const x1 = Math.min(this.width - 1, x0 + 1);
    const h = this.hillH[x0] * (1 - t) + this.hillH[x1] * t;
    return CONFIG.SURFACE_ROW - 0.5 - h;
  }

  // Where a dirt-carrier should empty its jaws: near the crater rim, further out as the mound grows
  pickDumpColumn() {
    const CX = CONFIG.COLONY_X;
    const reach = 3 + Math.min(CONFIG.HILL_SPREAD - 4, Math.sqrt(this.hillTotal) * 1.5);
    const d = 1 + Math.floor(Math.random() * Math.random() * reach);
    return Math.random() < 0.5 ? CX - 1 - d : CX + 2 + d;
  }

  // Excavated soil dropped on the mound. Several loads make one tile.
  depositDirt(col) {
    const GT = CONFIG.GLASS_THICKNESS;
    col = Math.max(GT + 2, Math.min(this.width - GT - 3, col));
    this._hillAcc[col] += CONFIG.DIRT_GRAIN;
    if (this._hillAcc[col] < 1) return;
    this._hillAcc[col] -= 1;
    this._dropGrain(col);
  }

  // Let a grain tumble until it finds a spot that keeps the slope walkable. The two
  // columns of the shaft and one either side stay clear, so the mound forms a crater.
  _dropGrain(c) {
    const W = this.width, CX = CONFIG.COLONY_X, SR = CONFIG.SURFACE_ROW, Hh = this.hillH;
    const lo = CX - 1, hi = CX + 2;
    for (let n = 0; n < 80; n++) {
      const d = c < lo ? lo - c : c > hi ? c - hi : 0;
      if (d > CONFIG.HILL_SPREAD) return;              // blown away on the wind
      const out = c < CX + 0.5 ? -1 : 1;
      const h = Hh[c];
      if (d === 0 || h >= Math.min(d, CONFIG.HILL_MAX)) { c += out; continue; }
      if (h > Hh[c + out]) { c += out; continue; }     // roll down the outside
      if (d > 1 && h > Hh[c - out]) { c -= out; continue; } // roll back towards the rim
      const y = SR - 1 - h;
      if (this.tiles[y * W + c] !== AIR) { c += out; continue; } // something is lying here
      Hh[c] = h + 1;
      this.hillTotal++;
      this.set(c, y, ANTHILL);
      return;
    }
  }

  // Rain washes the peaks off the mound
  erodeHill() {
    const W = this.width, CX = CONFIG.COLONY_X, SR = CONFIG.SURFACE_ROW, Hh = this.hillH;
    for (let n = 0; n < 12; n++) {
      const c = CX + rnd(-CONFIG.HILL_SPREAD, CONFIG.HILL_SPREAD + 1);
      const h = Hh[c];
      if (h < 2 || h < Hh[c - 1] || h < Hh[c + 1]) continue;
      if (this.tiles[(SR - 1 - h) * W + c] !== AIR) continue;
      Hh[c] = h - 1;
      this.hillTotal--;
      this.set(c, SR - h, AIR);
      return true;
    }
    return false;
  }

  // Tile a dropped item ends up in: the open tile that was clicked, or else the
  // ground at the top of that column.
  _dropTarget(x, y) {
    const GT = CONFIG.GLASS_THICKNESS, W = this.width;
    if (x <= GT || x >= W - GT - 1) return -1;
    if (y >= CONFIG.SURFACE_ROW && y < this.height) {
      const t = this.tiles[y * W + x];
      if (OPEN[t]) return y * W + x;
    }
    return this.groundRow(x) * W + x;
  }

  _placeItem(x, y, amount, type, amounts) {
    const i = this._dropTarget(x, y);
    if (i < 0) return false;
    const W = this.width, t = this.tiles[i];
    if (t === type) { amounts[i] = Math.min(160, amounts[i] + amount); this.dirtyTiles.add(i); this.dirty = true; return true; }
    if (t !== AIR && t !== TUNNEL && t !== CHAMBER) return false;
    this.under[i] = t;
    amounts[i] = Math.min(100, amount);
    this.set(i % W, (i / W) | 0, type);
    return true;
  }

  placeFood(x, y, amount) {
    return this._placeItem(x, y, amount, FOOD, this.foodAmount);
  }

  placeWater(x, y, amount) {
    return this._placeItem(x, y, amount, WATER, this.waterAmount);
  }

  // A food or water tile has been used up
  clearItem(i) {
    const W = this.width, y = (i / W) | 0;
    const t = this.tiles[i];
    if (t !== FOOD && t !== WATER) return;
    this.foodAmount[i] = 0;
    this.waterAmount[i] = 0;
    let u = this.under[i];
    if (u !== TUNNEL && u !== CHAMBER) u = y < CONFIG.SURFACE_ROW ? AIR : TUNNEL;
    this.set(i % W, y, u);
  }

  // Seeds, crumbs and fallen fruit: a little cluster somewhere out on the lawn
  _spawnSurfaceFood(quiet) {
    const GT = CONFIG.GLASS_THICKNESS, CX = CONFIG.COLONY_X, W = this.width;
    for (let attempt = 0; attempt < 30; attempt++) {
      const fx = GT + 4 + Math.floor(Math.random() * (W - GT * 2 - 10));
      if (Math.abs(fx - CX) < 12 || this.hillH[fx] || this.hillH[fx + 3]) continue;
      const n = rnd(2, 4);
      let placed = 0;
      for (let k = 0; k < n; k++) {
        const x = fx + k, i = this.groundRow(x) * W + x;
        if (this.tiles[i] !== AIR) continue;
        if (this.placeFood(x, 0, 60 + Math.random() * 40)) placed++;
      }
      if (placed) { if (!quiet) logEvent('Food appeared on the surface'); return true; }
    }
    return false;
  }

  // Rain collects in the grass
  addPuddle(amount = 55 + Math.random() * 40) {
    const GT = CONFIG.GLASS_THICKNESS, CX = CONFIG.COLONY_X, W = this.width, SR = CONFIG.SURFACE_ROW;
    let n = 0;
    for (const i of this.waterTiles) if (i < SR * W) n++;
    if (n >= 9) return false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const x = GT + 4 + Math.floor(Math.random() * (W - GT * 2 - 9));
      if (Math.abs(x - CX) < 8 || this.hillH[x]) continue;
      if (this.tiles[(SR - 1) * W + x] !== AIR) continue;
      return this.placeWater(x, 0, amount);
    }
    return false;
  }

  // ── Per-tick upkeep ──────────────────────────────────────────────────────

  update(deltaMs, sim) {
    const t = ++this.tick;
    const screensaver = GameState.mode === 'screensaver';
    this._digRate = 1 / (CONFIG.DIG_TICKS * (screensaver ? 1.5 : 3));

    // Alarm decays when no active threats — ants settle back to normal
    if (this.alarmLevel > 0) this.alarmLevel = Math.max(0, this.alarmLevel - 0.0015);

    this._fadePheromones(t);
    if ((t & 15) === 0) { this._tickItems(deltaMs * 16); this._fillStores(); }

    if (--this._planTimer <= 0) {
      this._planTimer = 90;
      this._updateProjects(sim);
    }
    if (--this._foodTimer <= 0) this._tickFoodSpawn(sim, screensaver);
    if (this.fx.length > 90) this.fx.splice(0, this.fx.length - 90);

    if (this.foodStore > this.foodCap) this.foodStore = this.foodCap;
    if (this.waterStore > this.waterCap) this.waterStore = this.waterCap;

    // Screensaver: the colony forages for real, but can never actually starve
    if (screensaver) {
      if (this.foodStore < 200) this.foodStore = 200;
      if (this.waterStore < 250) this.waterStore = 250;
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

  // Fade pheromones — an eighth of the rows each tick, so trails are meaningful, not permanent
  _fadePheromones(t) {
    const W = this.width, pf = this.pheromoneFood, ph = this.pheromoneHome;
    const kf = this._kf, kh = this._kh;
    for (let y = t & 7; y < this.height; y += 8) {
      for (let i = y * W, e = i + W; i < e; i++) {
        const a = pf[i];
        if (a !== 0) pf[i] = a > 0.004 ? a * kf : 0;
        const b = ph[i];
        if (b !== 0) ph[i] = b > 0.004 ? b * kh : 0;
      }
    }
  }

  // Food slowly spoils; water soaks away — puddles go quickly once the sun is on them
  _tickItems(ms) {
    const W = this.width, skyEnd = CONFIG.SURFACE_ROW * W;
    const decay = CONFIG.FOOD_DECAY_RATE * ms * 0.001;
    const evap = CONFIG.WATER_EVAP_RATE * ms * 0.001;
    const sun = this.sky ? this.sky.light * (1 - this.sky.rain) : 1;
    let gone = null;
    for (const i of this.foodTiles) {
      if ((this.foodAmount[i] -= decay) <= 0) (gone || (gone = [])).push(i);
    }
    for (const i of this.waterTiles) {
      const rate = i < skyEnd ? evap + sun * 0.05 : evap;
      if ((this.waterAmount[i] -= rate) <= 0) (gone || (gone = [])).push(i);
    }
    if (gone) for (const i of gone) this.clearItem(i);
  }

  _tickFoodSpawn(sim, screensaver) {
    const W = this.width, skyEnd = CONFIG.SURFACE_ROW * W;
    // more frequent and abundant in screensaver
    this._foodTimer = screensaver ? 420 : CONFIG.FOOD_RESPAWN_INTERVAL * 2;
    const sky = this.sky;
    if (sky && (sky.light < 0.5 || sky.rain > 0.2)) return;   // nothing falls at night or in the rain
    let tiles = 0, amount = 0;
    for (const i of this.foodTiles) if (i < skyEnd) { tiles++; amount += this.foodAmount[i]; }
    if (tiles >= 14) return;
    if (screensaver) {
      // keep roughly a morning's foraging lying about, scaled to the colony
      const pop = sim && sim.antSystem ? sim.antSystem.population : 40;
      if (amount > 150 + pop * 2.5) return;
    }
    this._spawnSurfaceFood(false);
  }
}
