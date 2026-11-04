import { CONFIG } from '../../config.js';

const rand = (a, b) => a + Math.random() * (b - a);

// A swarm of fireflies over the grass on a clear night. Nothing but state: the world is not touched.
export default {
  id: 'fireflies',
  title: 'Fireflies',
  weight: 3,
  gapDays: 2,
  shot: { tall: 40, dur: 18 },

  can(sim) {
    const { sky } = sim;
    return sky.isNight && sky.weather === 'clear' && sky.rain === 0;
  },

  start(sim) {
    const W = sim.world.width, SR = CONFIG.SURFACE_ROW, span = CONFIG.MOMENT_FIREFLY_SPAN;
    const edge = CONFIG.GLASS_THICKNESS + 4;
    const cx = rand(edge + span / 2, W - edge - span / 2);
    const n = Math.round(rand(...CONFIG.MOMENT_FIREFLIES));
    const flies = [];
    for (let i = 0; i < n; i++) {
      flies.push({
        hx: cx + rand(-span / 2, span / 2), hy: SR - rand(2, 14),   // where it hovers about
        phase: Math.random() * 100,   // where it is in its drift, and when it blinks (src/rendering/renderMoments.js)
        speed: rand(0.6, 1.4),
      });
    }
    return { x: cx, y: SR - 6, flies, age: 0, len: Math.round(CONFIG.DAY_TICKS * CONFIG.MOMENT_FIREFLY_DAYS), fade: 0 };
  },

  tick(m) {
    const u = ++m.age / m.len;
    m.fade = Math.max(0, Math.min(1, u / 0.1, (1 - u) / 0.1));   // in over the first tenth, out over the last
    return m.age < m.len;
  },
};
