import { CONFIG, TILE } from '../../config.js';

const rand = (a, b) => a + Math.random() * (b - a);
const STEP = 0.1;      // tiles the head moves between two remembered positions
const KEEP = 60;       // remembered positions: the body is drawn along them

// An earthworm pressed against the glass, crossing part of the farm and sinking away. Nothing but
// state: it slides past tunnels and around stones and never changes a tile.
export default {
  id: 'earthworm',
  title: 'An earthworm passes the glass',
  weight: 3,
  gapDays: 3,
  shot: { tall: 30, dur: 24 },

  // any time, day or night (only one moment plays at once, so never during a flood)
  can() { return true; },

  start(sim) {
    const { world } = sim, W = world.width, SR = CONFIG.SURFACE_ROW, GT = CONFIG.GLASS_THICKNESS;
    const soil = world.height - GT - SR;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const x = dir > 0 ? GT + 0.5 : W - GT - 0.5;
    const y = SR + soil * rand(0.15, 0.7);
    return {
      x, y, dir, base: y, bend: 0, steer: 0,
      run: rand(...CONFIG.MOMENT_WORM_RUN), went: 0,
      sink: 0, fade: 1, trail: [[x, y]],
    };
  },

  tick(m, sim) {
    const { world } = sim, SR = CONFIG.SURFACE_ROW, GT = CONFIG.GLASS_THICKNESS;
    const v = CONFIG.MOMENT_WORM_SPEED;
    if (m.went < m.run) {
      m.went += v;
      m.x += m.dir * v;
      // a stone two tiles ahead: bend round it, the way it was already bending or the way that is clear
      const ahead = (dy) => world.get(Math.floor(m.x + m.dir * 2), Math.floor(m.y + dy)) === TILE.ROCK;
      if (ahead(0)) {
        if (!m.steer) m.steer = ahead(-2) && !ahead(2) ? 1 : -1;
        m.bend += m.steer * v * 1.5;
      } else {
        m.steer = 0;
      }
      m.y = m.base + Math.sin(m.went * 0.08) * 2.5 + m.bend;
    } else {
      // the run is over: it turns down into the deep and is gone
      m.sink++;
      m.x += m.dir * v * 0.3;
      m.y += v;
      m.fade = Math.max(0, 1 - m.sink / CONFIG.MOMENT_WORM_SINK_TICKS);
    }
    m.y = Math.max(SR + 2, Math.min(world.height - GT - 2, m.y));

    const [lx, ly] = m.trail[m.trail.length - 1];
    if (Math.hypot(m.x - lx, m.y - ly) >= STEP) {
      m.trail.push([m.x, m.y]);
      if (m.trail.length > KEEP) m.trail.shift();
    }
    return m.sink < CONFIG.MOMENT_WORM_SINK_TICKS;
  },

  subject(m) { return { x: m.x, y: m.y }; },
};
