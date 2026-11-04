import { CONFIG } from '../config.js';
import { settings } from '../settings.js';
import { drawBeetle } from './renderCreatures.js';

const TS = CONFIG.TILE_SIZE;

// What the moment playing now looks like (src/simulation/moments/). One function a moment, given the
// moment's state and `t`, the renderer's clock in real seconds: what only shows (a blink, a drift) runs
// on real time, so it does not race at 8×.
const DRAW = {
  fireflies(ctx, camera, m, t) {
    const u = TS * camera.zoom;                        // screen pixels to a tile
    const slow = settings.get('reducedMotion') ? 0.5 : 1;
    const core = Math.max(1, u * 0.22), halo = Math.max(4, u * 1.4);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of m.flies) {
      const d = t * f.speed * slow + f.phase;
      const x = f.hx + Math.sin(d * 0.37) * 3 + Math.sin(d * 0.11) * 4;
      const y = f.hy + Math.sin(d * 0.53 + 1) * 1.5;
      const [sx, sy] = camera.worldToScreen(x * TS, y * TS);
      if (sx < -halo || sy < -halo || sx > camera.cw + halo || sy > camera.ch + halo) continue;

      // a blink of 0.3 s or so every two to four seconds, and a faint glow between
      const period = 2 + (f.phase % 2), at = (t + f.phase * 7) % period;
      const blink = at < 0.45 ? Math.sin(Math.PI * at / 0.45) : 0;
      const a = m.fade * (0.08 + 0.92 * blink);
      if (a < 0.01) continue;

      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, halo);
      g.addColorStop(0, `rgba(210,255,120,${0.45 * a})`);
      g.addColorStop(1, 'rgba(210,255,120,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - halo, sy - halo, halo * 2, halo * 2);
      ctx.fillStyle = `rgba(240,255,190,${a})`;
      ctx.fillRect(sx - core / 2, sy - core / 2, core, core);
    }
    ctx.restore();
  },

  earthworm(ctx, camera, m) {
    const u = TS * camera.zoom, tr = m.trail, N = CONFIG.MOMENT_WORM_SEGMENTS;
    if (tr.length < 2) return;
    ctx.save();
    ctx.globalAlpha = m.fade;
    // a disc at every point of its trail, tail first so the head lies over the body; the body is N
    // segments, every third a darker ring, thinning toward the tail, the head a little thicker
    const last = tr.length - 1;
    for (let k = 0; k <= last; k++) {
      const f = (last - k) / last, s = Math.min(N - 1, Math.floor(f * N));   // 0 at the head
      const [sx, sy] = camera.worldToScreen(tr[k][0] * TS, tr[k][1] * TS);
      const r = u * (s === 0 ? 0.5 : 0.45 - 0.2 * f);
      ctx.fillStyle = s % 3 === 2 ? '#a65a5d' : '#c9787a';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },

  beetle(ctx, camera, m, t) {
    const u = TS * camera.zoom * 0.8;
    const [sx, sy] = camera.worldToScreen(m.x * TS, m.y * TS);
    const leg = Math.sin(t * 9) > 0 ? u * 0.18 : -u * 0.18;   // its legs scrabble on real time
    ctx.save();
    ctx.globalAlpha = Math.max(0, m.fade);
    drawBeetle(ctx, sx, sy, m.ang, u, leg);
    ctx.restore();
  },
};

export function drawMoments(ctx, camera, sim, t) {
  const a = sim.moments?.active;
  if (a) DRAW[a.row.id]?.(ctx, camera, a.m, t);
}
