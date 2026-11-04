import { CONFIG, TILE } from '../../config.js';
import { logEvent } from '../../events.js';
import { FAR } from '../nav.js';

const { SOIL, TUNNEL, CHAMBER, EGG } = TILE;

// May the beetle dig tile (x, y)? Plain soil only, below the turf it leaves over its hole (so the
// farm keeps its one entrance), not planned for a room, and clear of rooms and eggs.
function diggable(world, x, y) {
  const W = world.width, GT = CONFIG.GLASS_THICKNESS;
  if (x <= GT || x >= W - GT - 1 || y < CONFIG.SURFACE_ROW + CONFIG.MOMENT_BEETLE_CAP || y >= world.height - GT - 1) return false;
  const i = y * W + x;
  if (world.tiles[i] !== SOIL || world.planRoom[i]) return false;
  return !near(world, x, y, 2);
}

function near(world, x, y, r) {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const t = world.get(x + dx, y + dy);
      if (t === CHAMBER || t === EGG) return true;
    }
  }
  return false;
}

// Can tile i be walked to from the entrance? (Not every tunnel can: an earlier beetle that gave up
// left a dead end.) The entrance field is patched the moment a tile opens (nav.opened).
const linked = (world, i) => world.nav.entrance().dist[i] < FAR;

// The nest's tunnel tiles shallow enough for the beetle to reach and clear enough of rooms to break into
function tunnels(world) {
  const W = world.width, top = CONFIG.SURFACE_ROW + CONFIG.MOMENT_BEETLE_CAP;
  const bottom = Math.min(world.height - 1, top + CONFIG.MOMENT_BEETLE_REACH);
  const ent = world.nav.entrance().dist, out = [];
  for (let y = top; y <= bottom; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (world.tiles[i] === TUNNEL && ent[i] < FAR && !near(world, x, y, 3)) out.push({ x, y });
    }
  }
  return out;
}

// The closest of those tunnel tiles that column x can reach, or null; null too when it is so close
// that there would be next to nothing to dig
function target(list, x) {
  const R = CONFIG.MOMENT_BEETLE_REACH, top = CONFIG.SURFACE_ROW + CONFIG.MOMENT_BEETLE_CAP;
  let best = null, bd = R + 1;
  for (const t of list) {
    const d = Math.abs(t.x - x) + (t.y - top);
    if (d < bd) { bd = d; best = t; }
  }
  return bd >= CONFIG.MOMENT_BEETLE_MIN_TILES ? best : null;
}

// The next tile toward the target: down or sideways, mostly the way there is more to go, now and then
// the other way for a wander; when that tile is not allowed, the other way; null when neither is
function nextTile(world, m) {
  const dx = Math.sign(m.tx - m.cx), dy = Math.sign(m.ty - m.cy);
  const ax = Math.abs(m.tx - m.cx), ay = Math.abs(m.ty - m.cy);
  const steps = [];
  if (dx) steps.push([dx, 0]);
  if (dy) steps.push([0, dy]);
  if (steps.length === 2 && Math.random() < (ay + 1) / (ax + ay + 2) * 1.2) steps.reverse();
  if (!dx) steps.push([Math.random() < 0.5 ? 1 : -1, 0]);   // straight above it: a step aside
  for (const [sx, sy] of steps) {
    const x = m.cx + sx, y = m.cy + sy;
    if (world.get(x, y) === TUNNEL || diggable(world, x, y)) return { x, y };
  }
  return null;
}

// A beetle lands far from the nest and burrows down to the nearest tunnel. It *does* change the world:
// the tiles it digs are dug the way the ants dig them (world.finishDig), and the tunnel stays.
export default {
  id: 'beetle',
  title: 'A beetle is burrowing in',
  weight: 2,
  gapDays: 6,
  shot: { tall: 34, dur: 30 },

  can(sim) {
    const { sky } = sim;
    return !sky.isNight && sky.weather === 'clear' && sky.rain === 0;
  },

  start(sim) {
    const { world } = sim, W = world.width, GT = CONFIG.GLASS_THICKNESS, CX = CONFIG.COLONY_X;
    const far = CONFIG.MOMENT_BEETLE_FAR, top = CONFIG.SURFACE_ROW + CONFIG.MOMENT_BEETLE_CAP;
    // every column far enough from the nest that has a tunnel within reach; one of them at random
    const list = tunnels(world), spots = [];
    for (let x = GT + 3; x < W - GT - 3; x++) {
      if (Math.abs(x - CX) < far || !diggable(world, x, top)) continue;
      const t = target(list, x);
      if (t) spots.push([x, t]);
    }
    if (!spots.length) return null;
    const [x, t] = spots[Math.floor(Math.random() * spots.length)];
    const gy = world.groundY(x + 0.5);
    return {
      x: x + 0.5, y: gy, ang: Math.PI / 2,
      phase: 'in', t: 0, cx: x, cy: top - 1, tx: t.x, ty: t.y,
      next: { x, y: top },
      path: [[x + 0.5, gy - 1.5], [x + 0.5, gy], [x + 0.5, top - 0.5]],   // where it has been, for the way out
      dug: 0, broke: false, fade: 0,
    };
  },

  tick(m, sim) {
    const { world } = sim;
    m.t++;
    if (m.phase === 'in') {
      // down from the sky onto the grass, then in under the turf
      const u = m.t / CONFIG.MOMENT_BEETLE_DIG_TICKS;
      along(m, m.path, Math.min(1, u));
      m.fade = Math.min(1, m.t / 30);
      if (u >= 1) { m.phase = 'dig'; m.t = 0; }
      return true;
    }
    if (m.phase === 'dig') {
      const n = m.next, u = Math.min(1, m.t / CONFIG.MOMENT_BEETLE_DIG_TICKS);
      m.x = m.cx + 0.5 + (n.x - m.cx) * u;
      m.y = m.cy + 0.5 + (n.y - m.cy) * u;
      m.ang = Math.atan2(n.y - m.cy, n.x - m.cx);
      if (u < 1) return true;

      const i = n.y * world.width + n.x;
      if (world.tiles[i] === SOIL) { world.finishDig(i); m.dug++; }
      else if (world.tiles[i] !== TUNNEL) { m.phase = 'out'; m.t = 0; return true; }   // something else got there first
      m.cx = n.x; m.cy = n.y;
      m.path.push([n.x + 0.5, n.y + 0.5]);
      m.t = 0;
      if (linked(world, i)) {
        m.broke = true;
        logEvent('The beetle broke into the tunnels');
      }
      const next = m.broke || m.dug >= CONFIG.MOMENT_BEETLE_MAX_TILES ? null : nextTile(world, m);
      if (next) m.next = next;
      else m.phase = 'out';
      return true;
    }
    // out: back the way it came, and off into the sky
    const u = Math.min(1, m.t / CONFIG.MOMENT_BEETLE_OUT_TICKS);
    along(m, m.path, 1 - u);
    m.ang += Math.PI;
    m.fade = Math.min(1, (CONFIG.MOMENT_BEETLE_OUT_TICKS - m.t) / 30);
    return u < 1;
  },

  subject(m) { return { x: m.x, y: m.y }; },
};

// Puts the beetle a fraction u of the way along the polyline, facing along it
function along(m, path, u) {
  const segs = path.length - 1;
  const f = Math.max(0, Math.min(segs, u * segs)), k = Math.min(segs - 1, Math.floor(f)), r = f - k;
  const [x0, y0] = path[k], [x1, y1] = path[k + 1];
  m.x = x0 + (x1 - x0) * r;
  m.y = y0 + (y1 - y0) * r;
  if (x1 !== x0 || y1 !== y0) m.ang = Math.atan2(y1 - y0, x1 - x0);
}
