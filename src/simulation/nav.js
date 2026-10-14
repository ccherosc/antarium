import { CONFIG } from '../config.js';

// Flow fields: for each destination the colony cares about (the entrance, a chamber,
// the nearest food, a dig face…) a walking distance from every tile. An ant that
// wants to get somewhere just keeps stepping onto a neighbour with a smaller number,
// which is what turns the nest's traffic into streams.

export const FAR = 0xFFFF;

const MIN_REBUILD = 20;   // ticks between rebuilds when only the destination moved
const REFRESH = 120;      // a patched field is rebuilt after this long, to pick up short-cuts
const MAX_FIELDS = 140;

class Field {
  constructor(dist) {
    this.dist = dist;
    this.ver = -1;
    this.built = -1e9;
    this.used = 0;
    this.need = true;     // has to be rebuilt before it can be trusted
    this.stale = false;   // still correct, but a shorter way may have opened
  }
}

export class Nav {
  constructor(world) {
    this.world = world;
    world.nav = this;
    this.fields = new Map();
    this._pool = [];
    this._q = new Int32Array(world.size);
    this._src = [];
    this._arg = null;
    this._fEnt = this._fEnt.bind(this);
    this._fRoom = this._fRoom.bind(this);
    this._fFood = this._fFood.bind(this);
    this._fWater = this._fWater.bind(this);
    this._fDig = this._fDig.bind(this);
    this._fPoint = this._fPoint.bind(this);
  }

  reset() {
    for (const f of this.fields.values()) this._pool.push(f.dist);
    this.fields.clear();
  }

  drop(key) {
    const f = this.fields.get(key);
    if (!f) return;
    this._pool.push(f.dist);
    this.fields.delete(key);
  }

  // Ask for a field to be recomputed the next time somebody needs it
  invalidate(key) {
    const f = this.fields.get(key);
    if (f) f.need = true;
  }

  // A tile became walkable: stitch it into every field so nobody has to wait for a rebuild
  opened(i) {
    const W = this.world.width;
    for (const f of this.fields.values()) {
      const D = f.dist;
      let m = D[i - 1];
      if (D[i + 1] < m) m = D[i + 1];
      if (D[i - W] < m) m = D[i - W];
      if (D[i + W] < m) m = D[i + W];
      D[i] = m === FAR ? FAR : m + 1;
      f.stale = true;
    }
  }

  // A tile was blocked (the mound grew over it): routes through it are no longer valid
  closed(i) {
    for (const f of this.fields.values()) {
      f.dist[i] = FAR;
      f.need = true;
    }
  }

  // ── Destinations ─────────────────────────────────────────────────────────

  entrance() { return this._get('ent', 0, this._fEnt); }

  room(id) {
    this._arg = id;
    return this._get('r' + id, 0, this._fRoom);
  }

  food() { return this._get('food', this.world.foodVersion, this._fFood); }

  water() { return this._get('water', this.world.waterVersion, this._fWater); }

  // The working face of a dig project
  dig(project) {
    this._arg = project;
    return this._get('d' + project.id, project.fver, this._fDig);
  }

  point(i) {
    this._arg = i;
    return this._get('p' + i, 0, this._fPoint);
  }

  _fEnt(src) {
    const W = this.world.width, y = CONFIG.SURFACE_ROW - 1;
    src.push(y * W + CONFIG.COLONY_X, y * W + CONFIG.COLONY_X + 1);
  }

  _fRoom(src) {
    const ch = this.world.chambers[this._arg];
    if (ch) for (const i of ch.tiles) src.push(i);
  }

  _fFood(src) { for (const i of this.world.foodTiles) src.push(i); }

  _fWater(src) { for (const i of this.world.waterTiles) src.push(i); }

  _fDig(src) {
    const W = this.world.width, P = this.world.passable;
    for (const i of this._arg.frontier) {
      if (P[i - 1]) src.push(i - 1);
      if (P[i + 1]) src.push(i + 1);
      if (P[i - W]) src.push(i - W);
      if (P[i + W]) src.push(i + W);
    }
  }

  _fPoint(src) { src.push(this._arg); }

  // ── Internals ────────────────────────────────────────────────────────────

  _get(key, ver, fill) {
    const t = this.world.tick;
    let f = this.fields.get(key);
    if (!f) {
      if (this.fields.size >= MAX_FIELDS) this._evict();
      f = new Field(this._pool.pop() || new Uint16Array(this.world.size));
      this.fields.set(key, f);
    }
    f.used = t;
    const age = t - f.built;
    if (f.need ? age >= 3 : (f.ver !== ver && age >= MIN_REBUILD) || (f.stale && age >= REFRESH)) {
      this._build(f, fill);
      f.ver = ver;
      f.built = t;
      f.need = false;
      f.stale = false;
    }
    return f;
  }

  // Forget the fields nobody has asked about for the longest
  _evict() {
    const all = [...this.fields.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let k = 0; k < 12 && k < all.length; k++) this.drop(all[k][0]);
  }

  // Breadth-first flood from the destination tiles. Border tiles are never walkable,
  // so the four neighbours of a walkable tile are always inside the grid.
  _build(f, fill) {
    const w = this.world, W = w.width, P = w.passable, D = f.dist, q = this._q;
    const src = this._src;
    src.length = 0;
    fill(src);
    D.fill(FAR);
    let head = 0, tail = 0;
    for (let k = 0; k < src.length; k++) {
      const s = src[k];
      if (P[s] && D[s] !== 0) { D[s] = 0; q[tail++] = s; }
    }
    while (head < tail) {
      const i = q[head++], nd = D[i] + 1;
      let j = i - 1; if (P[j] && D[j] === FAR) { D[j] = nd; q[tail++] = j; }
      j = i + 1;     if (P[j] && D[j] === FAR) { D[j] = nd; q[tail++] = j; }
      j = i - W;     if (P[j] && D[j] === FAR) { D[j] = nd; q[tail++] = j; }
      j = i + W;     if (P[j] && D[j] === FAR) { D[j] = nd; q[tail++] = j; }
    }
  }
}
