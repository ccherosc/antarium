import { CONFIG, ROOM, STATE, CARRY } from '../config.js';
import { HOME } from './camera.js';

const TS = CONFIG.TILE_SIZE;
const W = CONFIG.WORLD_WIDTH, H = CONFIG.WORLD_HEIGHT;
const SR = CONFIG.SURFACE_ROW, CX = CONFIG.COLONY_X;

const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[(Math.random() * a.length) | 0];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const smooth = u => u * u * (3 - 2 * u);

const REACH = 1;     // screenfuls the picture may slide in one move before the camera pulls back
const STEPS = 48;    // samples along a move

// Log of the zoom a fraction u of the way into a shot's move: eased from where the
// camera was to where the shot wants it, less the pull-back (dip ≤ 0) in the middle
function logZoom(s, u, dip = s.dip) {
  const k = Math.sin(Math.PI * u);
  return s.lz0 + (s.lz1 - s.lz0) * smooth(u) + dip * k * k;
}

function best(list, score) {
  let top = null, s = 0;
  for (const c of list) {
    const v = score(c);
    if (v > s) { s = v; top = c; }
  }
  return top;
}

// What an ant worth following is up to
const ERRANDS = {
  [STATE.CARRYING_FOOD]:  'Bringing food home',
  [STATE.DUMPING_DIRT]:   'Carrying soil to the surface',
  [STATE.CARRYING_BROOD]: 'A nurse carries an egg',
  [STATE.SEEKING_FOOD]:   'A forager sets out',
  [STATE.SCOUTING]:       'A scout in the meadow',
  [STATE.HAULING]:        'Fetching food from the granary',
};

// The screensaver's camera operator. Left alone for a while it tours the farm: a look
// at the whole nest, then a slow move in on whatever is going on — the dig face, a
// hatching, a visitor at the entrance, the queen — and back out again.
//
// Every held shot sits at a zoom where a tile is a whole number of pixels, so the
// picture stays crisp while it moves. Getting from one to the next it pulls back,
// travels and pushes in again, the further the journey the further back.
export class Director {
  constructor(camera, sim) {
    this.camera = camera;
    this.sim = sim;

    this.auto = true;       // take over once nobody has touched anything for a while
    this.idleAfter = 20;    // seconds
    this.idle = 0;
    this.active = false;
    this.shot = null;

    this.blocked = null;    // () => true while a dialog is up
    this.speed = null;      // () => how fast the simulation is running
    this.onChange = null;   // (active) => …
    this.onShot = null;     // (shot) => …

    this._vx = 0;
    this._vy = 0;
    this._closeRun = 0;     // close-ups since the last look at the whole farm
    this._recent = [];
    this._seenVisitor = null;
    this._seenFlight = 0;
    this._seenRain = false;
  }

  // Somebody touched something
  poke() {
    this.idle = 0;
    if (this.active) this.stop();
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.camera.fitted = false;
    this._vx = this._vy = 0;
    this._closeRun = 0;
    this._recent.length = 0;
    this._set(this._wide(7));
    this.onChange?.(true);
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    this.idle = 0;
    // handed back during a look at the whole farm: leave it showing the whole farm
    if (this.shot.kind === 'wide' && this.shot.age > this.shot.zt * 0.5) this.camera.fitWorld(false);
    this.shot = null;
    this.onChange?.(false);
  }

  toggle() {
    if (this.active) this.stop(); else this.start();
  }

  // dt: seconds of real time
  update(dt) {
    if (this.blocked?.()) {
      this.idle = 0;
      if (this.active) this.stop();
      return;
    }
    if (!this.active) {
      this.idle += dt;
      if (this.auto && this.idle >= this.idleAfter) this.start();
      return;
    }
    const s = this.shot;
    s.age += dt;
    // news breaks in, though not before the camera has got to where it was going
    if (s.age >= s.dur || (s.age > Math.max(6, s.zt + 2) && this._breaking())) this._set(this._choose());
    this._drive(dt);
  }

  // ── Camera movement ─────────────────────────────────────────────────────────

  _drive(dt) {
    const s = this.shot, cam = this.camera;

    if (s.subject) {
      const p = s.subject();
      if (p && Number.isFinite(p.x + p.y)) { s.x = p.x; s.y = p.y + (s.oy || 0); }
      else if (!s.lost) { s.lost = true; s.dur = Math.min(s.dur, s.age + 2.5); } // gone: linger, then move on
    }
    let tx = s.x, ty = s.y;
    if (s.x2 !== undefined) {
      const u = smooth(clamp((s.age - 2) / (s.dur - 4), 0, 1));
      tx += (s.x2 - s.x) * u;
      ty += (s.y2 - s.y) * u;
    }

    // Keep the view on the farm
    if (!s.free) {
      const vw = cam.cw / (s.z * TS), vh = cam.ch / (s.z * TS);
      tx = vw >= W + 2 ? W / 2 : clamp(tx, vw / 2 - 1, W - vw / 2 + 1);
      ty = vh >= H + 2 ? H / 2 : clamp(ty, vh / 2 - 1, H - vh / 2 + 1);
    }

    // Zoom runs on rails so it lands exactly on its mark, pulling back on the way
    // if there is far to go; the aim point travels over in the same time
    const u = Math.min(1, s.age / s.zt);
    if (u < 1) {
      const f = u * STEPS, i = f | 0, e = s.path[i] + (s.path[i + 1] - s.path[i]) * (f - i);
      cam.zoom = Math.max(CONFIG.MIN_ZOOM, Math.exp(logZoom(s, u)));
      tx = s.sx + (tx - s.sx) * e;
      ty = s.sy + (ty - s.sy) * e;
    } else {
      cam.zoom = s.z;
    }

    // The position follows on a critically damped spring, so it eases in and out
    // and can keep up with a subject that moves
    const k = u < 1 ? Math.max(s.w, 3.2) : s.w, gx = tx * TS, gy = ty * TS;
    this._vx += (k * k * (gx - cam.x) - 2 * k * this._vx) * dt;
    this._vy += (k * k * (gy - cam.y) - 2 * k * this._vy) * dt;
    cam.x += this._vx * dt;
    cam.y += this._vy * dt;
  }

  _set(s) {
    const cam = this.camera;
    if (!Number.isFinite(s.x + s.y + s.z)) s = this._wide(8);   // nowhere to point: look at it all
    s.age = 0;
    s.lz0 = Math.log(cam.zoom);
    s.sx = cam.x / TS;
    s.sy = cam.y / TS;
    s.lz1 = Math.log(s.z);

    // How far there is to go, in screenfuls. A long way is covered from further
    // back, so that no more than a screen or so ever has to slide by — but never
    // from further back than the whole farm.
    const far = Math.hypot(s.x - s.sx, s.y - s.sy) * TS * Math.sqrt(s.z * cam.zoom) / Math.min(cam.cw, cam.ch);
    s.dip = 0;
    if (far > REACH) {
      const floor = Math.log(cam.fitZoom(0));
      s.dip = Math.log(REACH / far);
      for (let i = 1; i < STEPS; i++) {
        const u = i / STEPS, k = Math.sin(Math.PI * u);
        s.dip = Math.max(s.dip, Math.min(0, (floor - logZoom(s, u, 0)) / (k * k)));
      }
    }

    // Time for the zoom to get there, for pulling back and pushing in, and for the trip
    s.zt = clamp(2 + 2.2 * (Math.abs(s.lz1 - s.lz0) - 2 * s.dip + far * Math.exp(s.dip)), 3, 11);
    s.dur = Math.max(s.dur, s.zt + 6);

    // The trip is shared out so that the picture slides by at an even pace:
    // slowly while close in, faster from far back
    const path = s.path = new Float32Array(STEPS + 1);
    let sum = 0;
    for (let i = 1; i <= STEPS; i++) {
      const u = (i - 0.5) / STEPS;
      sum += u * (1 - u) / Math.exp(logZoom(s, u));
      path[i] = sum;
    }
    for (let i = 1; i <= STEPS; i++) path[i] /= sum;

    this.shot = s;
    this._recent.push(s.kind);
    if (this._recent.length > 3) this._recent.shift();
    this.onShot?.(s);
  }

  // A zoom at which one tile is a whole number of screen pixels
  _snap(z, up = false) {
    const u = z * TS;
    return clamp(Math.max(2, up ? Math.ceil(u - 0.01) : Math.round(u)) / TS, 0.5, CONFIG.MAX_ZOOM);
  }

  // Close enough that `tall` tiles fill the height of the screen
  _closeZ(tall) {
    const cam = this.camera;
    return this._snap(Math.min(cam.ch / (tall * TS), cam.cw / (tall * 1.4 * TS)));
  }

  // ── Shots ───────────────────────────────────────────────────────────────────

  _wide(dur) {
    return { kind: 'wide', title: 'The ant farm', x: HOME.x / TS, y: HOME.y / TS, z: this.camera.fitZoom(0),
             dur, w: 1.1, free: true };
  }

  _close(kind, title, x, y, tall, o = {}) {
    return { kind, title, x, y, z: this._closeZ(tall), dur: o.dur ?? rnd(13, 17), w: o.w ?? 1.3,
             subject: o.subject, oy: o.oy, x2: o.x2, y2: o.y2 };
  }

  // A slow pass over the whole farm, a little closer than the wide shot
  _sweep() {
    const cam = this.camera;
    const cover = Math.max(cam.cw / (W * TS), cam.ch / (H * TS));
    const z = this._snap(Math.max(cover, cam.fitZoom(0) * 1.3), true);
    const vw = cam.cw / (z * TS), vh = cam.ch / (z * TS);
    const top = Math.min(H / 2, vh / 2 - 1), bottom = Math.max(H / 2, H - vh / 2 + 1);
    const left = Math.min(W / 2, vw / 2 - 1), right = Math.max(W / 2, W - vw / 2 + 1);
    const flip = Math.random() < 0.4;
    if (bottom - top >= right - left) {
      const x = clamp(CX + rnd(-10, 10), left, right);
      return { kind: 'sweep', title: flip ? 'Up to the light' : 'Into the earth', z, w: 1.3,
               x, y: flip ? bottom : top, x2: x, y2: flip ? top : bottom, dur: clamp((bottom - top) * 0.9, 18, 34) };
    }
    return { kind: 'sweep', title: 'Across the farm', z, w: 1.3,
             x: flip ? right : left, y: H / 2, x2: flip ? left : right, y2: H / 2, dur: clamp((right - left) * 0.9, 18, 34) };
  }

  _meadow() {
    const { sky } = this.sim;
    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? rnd(46, 70) : W - rnd(46, 70);
    const title = sky.rain > 0.4 ? 'Rain on the meadow' : sky.isNight ? 'Fireflies over the meadow' : 'The meadow';
    return this._close('meadow', title, x, SR - 6, 34, { x2: x + (fromLeft ? 44 : -44), y2: SR - 6, dur: 28 });
  }

  _descent() {
    const { queen } = this.sim;
    return this._close('shaft', 'Down the main shaft', CX + 1, SR + 6, 44, { x2: queen.x, y2: queen.y, dur: 26 });
  }

  _follow(ant) {
    const ants = this.sim.antSystem.ants;
    return this._close('follow', ERRANDS[ant.state] || 'One ant and her errand', ant.x, ant.y, 42, {
      dur: rnd(15, 20), w: 2.2 * clamp(this.speed?.() ?? 1, 1, 4),
      subject: () => ants.includes(ant) ? ant : null,
    });
  }

  // An ant in the middle of doing something
  _someone() {
    let found = null, n = 0;
    for (const a of this.sim.antSystem.ants) {
      if (!ERRANDS[a.state]) continue;
      if (a.state === STATE.DUMPING_DIRT && a.carry !== CARRY.DIRT) continue;
      // one egg-carrier counts for four of anyone else
      const weight = a.state === STATE.CARRYING_BROOD ? 4 : 1;
      n += weight;
      if (Math.random() * n < weight) found = a;
    }
    return found;
  }

  _visitor() {
    return this.sim.creatures.creatures.find(c => !c.dead && c.x > 10 && c.x < W - 10);
  }

  // Something that will not wait for the current shot to finish
  _breaking() {
    const { sky } = this.sim;
    if (sky.flightUntil > sky.time && this._seenFlight !== sky.flightUntil) return true;
    const v = this._visitor();
    return !!v && v !== this._seenVisitor;
  }

  _choose() {
    const { world, sky, antSystem, queen, creatures } = this.sim;
    const night = sky.isNight;

    // First, the things that only happen now and then
    if (sky.flightUntil > sky.time && this._seenFlight !== sky.flightUntil) {
      this._seenFlight = sky.flightUntil;
      return this._close('flight', 'The nuptial flight', CX + 1, SR - 8, 46, { dur: 24 });
    }
    const v = this._visitor();
    if (v && v !== this._seenVisitor) {
      this._seenVisitor = v;
      return this._close('visitor', `${/^[AEIOU]/.test(v.sp.label) ? 'An' : 'A'} ${v.sp.label.toLowerCase()} at the gates`, v.x, v.y - 5, 36, {
        dur: 20, w: 2, oy: -5,
        subject: () => creatures.creatures.includes(v) ? v : null,
      });
    }
    const raining = sky.rain > 0.5;
    if (raining && !this._seenRain) {
      this._seenRain = true;
      return this._close('rain', 'Rain', CX + 1, SR + 4, 44, { dur: 16 });
    }
    if (!raining) this._seenRain = false;

    // Every third shot, step back
    if (this._closeRun >= 2) {
      this._closeRun = 0;
      return Math.random() < 0.45 ? this._wide(rnd(10, 14)) : this._sweep();
    }
    this._closeRun++;

    // Otherwise go and look at something
    const opts = [];
    const add = (weight, kind, make) => {
      if (!this._recent.includes(kind)) opts.push({ weight, make });
    };

    add(3, 'queen', () => this._close('queen', "The queen's chamber", queen.x, queen.y, 30,
      { subject: () => queen }));

    const nursery = best(world.nurseries, c => c.brood);
    if (nursery) add(3, 'nursery', () => this._close('nursery', 'The nursery', nursery.cx + 0.5, nursery.cy + 0.5, 30));

    const store = best(world.stores, c => c.held);
    if (store) add(2, 'store', () => this._close('store', 'The granary', store.cx + 0.5, store.cy + 0.5, 32));

    const gardens = world.chambers.filter(c => c.built && c.type === ROOM.DEEP);
    if (gardens.length) add(night ? 3 : 1.5, 'garden', () => {
      const g = pick(gardens);
      return this._close('garden', 'A fungus garden', g.cx + 0.5, g.cy + 0.5, 32);
    });

    let dig = null;
    for (const p of world.projects) {
      if (p.frontier.length && p.crew > 0 && (!dig || p.crew > dig.crew)) dig = p;
    }
    if (dig) add(night ? 1.5 : 3, 'dig', () => {
      const i = dig.frontier[0];
      return this._close('dig', 'At the dig face', (i % W) + 0.5, ((i / W) | 0) + 0.5, 30);
    });

    if (night) {
      // where most of them have bedded down
      const beds = new Map();
      for (const a of antSystem.ants) {
        if (a.state === STATE.RESTING && a.home >= 0) beds.set(a.home, (beds.get(a.home) || 0) + 1);
      }
      let room = null, most = 3;
      for (const [id, n] of beds) {
        if (n > most && world.chambers[id]) { most = n; room = world.chambers[id]; }
      }
      if (room) add(4, 'sleep', () => this._close('sleep', 'Sleeping quarters', room.cx + 0.5, room.cy + 0.5, 30));
    }

    const title = raining ? 'Sheltering from the rain'
      : night ? 'The entrance by night'
      : sky.phase < 0.32 ? 'First light at the entrance'
      : sky.phase > 0.7 ? 'Dusk at the entrance' : 'The entrance';
    add(night ? 1 : 2.5, 'mound', () => this._close('mound', title, CX + 1, SR - 4, 34));

    add(night ? 1.5 : 2, 'meadow', () => this._meadow());
    add(1.5, 'shaft', () => this._descent());

    // run any faster than this and there is no keeping up with one ant
    const ant = (this.speed?.() ?? 1) <= 4 ? this._someone() : null;
    if (ant) add(3.5, 'follow', () => this._follow(ant));

    const hatch = antSystem.lastHatch;
    if (hatch && world.tick - hatch.tick < 300) {
      add(5, 'hatch', () => this._close('hatch', 'A new ant', hatch.x, hatch.y, 28, { dur: 12 }));
    }

    const spoils = creatures.creatures.find(c => c.dead && c.foodChunks > 0);
    if (spoils) add(4, 'spoils', () => this._close('spoils', 'The spoils', spoils.x, spoils.y - 4, 34));

    let total = 0;
    for (const o of opts) total += o.weight;
    let r = Math.random() * total;
    for (const o of opts) {
      r -= o.weight;
      if (r <= 0) return o.make();
    }
    return this._wide(12);
  }
}
