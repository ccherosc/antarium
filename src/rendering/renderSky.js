import { CONFIG } from '../config.js';

// Everything above the ground line: the sky through the day, sun, moon, stars and
// clouds, then the mound, the grass and whatever is lying on the surface.

const TS = CONFIG.TILE_SIZE;
const GT = CONFIG.GLASS_THICKNESS;
const SR = CONFIG.SURFACE_ROW;
const CX = CONFIG.COLONY_X;

// Sky colours through the day: phase, then top / middle / horizon
const KEYS = [
  [0.00, [5, 7, 24],     [10, 14, 40],    [20, 26, 60]],
  [0.18, [7, 9, 30],     [16, 20, 52],    [36, 36, 76]],
  [0.235, [36, 44, 98],  [146, 98, 126],  [250, 152, 92]],   // dawn
  [0.30, [66, 128, 202], [138, 186, 228], [250, 218, 166]],
  [0.50, [46, 118, 206], [106, 172, 232], [188, 222, 244]],  // noon
  [0.70, [58, 124, 202], [128, 180, 226], [242, 222, 172]],
  [0.775, [48, 58, 122], [192, 102, 104], [255, 140, 62]],   // sunset
  [0.83, [15, 17, 50],   [50, 36, 82],    [122, 62, 72]],
  [0.90, [7, 9, 30],     [13, 17, 46],    [26, 30, 66]],
  [1.00, [5, 7, 24],     [10, 14, 40],    [20, 26, 60]],
];

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

// Repeatable 0–1 noise, so nothing flickers from frame to frame
export function hash(n) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const STARS = Array.from({ length: 110 }, (_, i) => ({
  x: hash(i * 5 + 1), y: hash(i * 5 + 2), r: 0.6 + hash(i * 5 + 3) * 0.9,
  f: 0.6 + hash(i * 5 + 4) * 2.2, p: hash(i * 5 + 5) * 6.28,
}));

const CLOUDS = Array.from({ length: 10 }, (_, i) => ({
  x: hash(i * 7 + 101), y: 0.12 + hash(i * 7 + 102) * 0.5, w: 9 + hash(i * 7 + 103) * 14,
  v: 0.35 + hash(i * 7 + 104) * 0.65, n: 3 + ((hash(i * 7 + 105) * 3) | 0), fair: i < 4,
}));

const NIGHT = [9, 13, 42];
const FLOWERS = [[244, 240, 224], [248, 208, 72], [232, 122, 160], [176, 136, 232]];
const GREENS = [[74, 122, 34], [100, 142, 46], [58, 106, 32]];

// A soft round glow in the given colour, painted once and reused. Drawn with the
// 'lighter' blend it adds light to whatever is underneath.
const _glows = new Map();
export function glowSprite(r, g, b) {
  const key = (r << 16) | (g << 8) | b;
  let c = _glows.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
  gr.addColorStop(0.25, `rgba(${r},${g},${b},0.4)`);
  gr.addColorStop(0.6, `rgba(${r},${g},${b},0.1)`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr;
  x.fillRect(0, 0, 64, 64);
  _glows.set(key, c);
  return c;
}
const sunGlow = () => glowSprite(255, 255, 255);

export function skyPalette(sky) {
  const p = sky.phase;
  let k = 1;
  while (k < KEYS.length - 1 && KEYS[k][0] < p) k++;
  const a = KEYS[k - 1], b = KEYS[k];
  const t = (p - a[0]) / (b[0] - a[0]);
  const s = t * t * (3 - 2 * t);
  let top = mix3(a[1], b[1], s), mid = mix3(a[2], b[2], s), low = mix3(a[3], b[3], s);
  if (sky.overcast > 0) {
    const grey = mix3([14, 16, 24], [122, 130, 144], sky.light), o = sky.overcast * 0.82;
    top = mix3(top, grey, o);
    mid = mix3(mid, mix3(grey, [150, 156, 166], 0.15 * sky.light), o);
    low = mix3(low, mix3(grey, [170, 172, 176], 0.3 * sky.light), o * 0.9);
  }
  return { top, mid, low };
}

function drawCloud(ctx, x, y, w, h, n, seed) {
  ctx.beginPath();
  for (let k = 0; k < n; k++) {
    const f = n === 1 ? 0.5 : k / (n - 1);
    const r = (w / n) * (0.72 + 0.4 * Math.sin(f * Math.PI));
    const cx = x + (f - 0.5) * w * 0.8, cy = y - Math.sin(f * Math.PI) * h * 0.4;
    ctx.moveTo(cx + r, cy);
    ctx.ellipse(cx, cy, r, h * (0.5 + 0.35 * hash(seed + k)), 0, 0, Math.PI * 2);
  }
  ctx.fill();
}

// t: seconds of real time (twinkle), drift: how far the clouds have blown
export function drawSky(ctx, camera, world, sky, t, drift) {
  const [x0, y0] = camera.worldToScreen(GT * TS, GT * TS);
  const [x1, y1] = camera.worldToScreen((world.width - GT) * TS, SR * TS);
  if (x1 <= 0 || x0 >= camera.cw || y1 <= 0 || y0 >= camera.ch) return;
  const w = x1 - x0, h = y1 - y0, u = TS * camera.zoom;
  const pal = skyPalette(sky);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, w, h);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;   // glows are soft; only the tile canvas is drawn pixel-sharp

  const g = ctx.createLinearGradient(0, y0, 0, y1);
  g.addColorStop(0, css(pal.top));
  g.addColorStop(0.55, css(pal.mid));
  g.addColorStop(1, css(pal.low));
  ctx.fillStyle = g;
  ctx.fillRect(x0, y0, w, h);

  // Stars come out as the light goes
  const dark = Math.pow(1 - sky.light, 1.6) * (1 - sky.overcast);
  if (dark > 0.02) {
    ctx.fillStyle = '#fff';
    for (const s of STARS) {
      const a = dark * (0.5 + 0.5 * Math.sin(t * s.f + s.p)) * (1 - s.y * 0.55);
      if (a < 0.04) continue;
      ctx.globalAlpha = a;
      const r = Math.max(1, Math.min(3, s.r * u * 0.28));
      ctx.fillRect(x0 + s.x * w, y0 + s.y * h * 0.92, r, r);
    }
    ctx.globalAlpha = 1;
  }

  const clear = 1 - sky.overcast * 0.85;

  // The moon: over the top during the night, a little further through its cycle each day
  const tm = ((sky.phase + 1 - 0.775) % 1) / 0.45;
  if (tm > -0.02 && tm < 1.02) {
    const r = 1.9 * u;
    const mx = x0 + w * (0.08 + 0.84 * tm), my = y1 + r * 1.2 - Math.sin(Math.PI * tm) * (h * 0.84 + r);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.28 * clear;
    ctx.drawImage(sunGlow(), mx - r * 4, my - r * 4, r * 8, r * 8);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = clear;
    ctx.fillStyle = '#e6ebf8';
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,164,200,0.5)';
    ctx.beginPath(); ctx.arc(mx - r * 0.3, my - r * 0.2, r * 0.22, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(mx + r * 0.25, my + r * 0.3, r * 0.16, 0, Math.PI * 2); ctx.fill();
    // the dark of the moon
    const ph = Math.cos((sky.day % 8) / 8 * Math.PI * 2);
    if (Math.abs(ph) < 0.97) {
      ctx.save();
      ctx.beginPath(); ctx.arc(mx, my, r + 0.5, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = css(mix3(pal.top, pal.mid, Math.max(0, Math.min(1, (my - y0) / (h * 0.55)))));
      ctx.beginPath(); ctx.arc(mx + ph * r * 1.9, my, r * 1.25, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // The sun: up on the left, down on the right
  const tsun = (sky.phase - 0.215) / 0.58;
  if (tsun > -0.03 && tsun < 1.03) {
    const r = 2.3 * u, up = Math.max(0, Math.sin(Math.PI * tsun));
    const sx = x0 + w * (0.06 + 0.88 * tsun), sy = y1 + r * 1.1 - up * (h * 0.86 + r);
    const col = mix3([255, 118, 48], [255, 246, 206], Math.pow(up, 0.55));
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.5 + 0.2 * (1 - up)) * clear;
    ctx.drawImage(sunGlow(), sx - r * 7, sy - r * 7, r * 14, r * 14);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = clear;
    ctx.fillStyle = css(col);
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
    // white-hot overhead, a plain orange disc on the horizon
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.75 * clear * up;
    ctx.drawImage(sunGlow(), sx - r * 2.6, sy - r * 2.6, r * 5.2, r * 5.2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // Clouds: a few in fair weather, a full grey lid when rain is on the way
  let col = mix3([30, 34, 58], [252, 252, 255], sky.light);
  col = mix3(col, pal.low, 0.3);
  col = mix3(col, mix3([18, 20, 30], [98, 104, 118], sky.light), sky.overcast * 0.8);
  ctx.fillStyle = css(col);
  for (let i = 0; i < CLOUDS.length; i++) {
    const c = CLOUDS[i];
    const a = c.fair ? 0.62 + 0.3 * sky.overcast : sky.overcast;
    if (a < 0.02) continue;
    const size = 1 + sky.overcast * 0.7;
    const cx = x0 + (((c.x + drift * c.v * 0.004) % 1.3) - 0.15) * w;
    const cw = c.w * u * size;
    if (cx + cw < x0 || cx - cw > x1) continue;
    ctx.globalAlpha = a * (0.55 + 0.45 * sky.light);
    drawCloud(ctx, cx, y0 + c.y * h, cw, u * 2.6 * size, c.n, i * 11);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

// The mound, the grass and anything lying on the ground
export function drawSurface(ctx, camera, world, sky, t) {
  const u = TS * camera.zoom, W = world.width, H = world.hillH;
  const [ox, oy] = camera.worldToScreen(0, SR * TS);
  if (oy < -u * 2 || oy - u * 12 > camera.ch) return;
  const X = x => ox + x * u;
  const dim = 1 - sky.light;
  const shade = (c, a = 1) => css(mix3(c, NIGHT, 0.74 * dim), a);
  const xa = Math.max(GT, Math.floor(-ox / u) - 2);          // the renderer clips at the glass
  const xb = Math.min(W - GT - 1, Math.ceil((camera.cw - ox) / u) + 2);

  // ── Mound: one smooth dune either side of the entrance ──
  const lo = Math.max(GT + 1, CX - CONFIG.HILL_SPREAD - 3), hi = Math.min(W - GT - 2, CX + CONFIG.HILL_SPREAD + 4);
  let tall = 0;
  for (let x = lo; x <= hi; x++) if (H[x] > tall) tall = H[x];
  if (tall > 0 && xb >= lo && xa <= hi) {
    const hill = new Path2D(), edge = new Path2D();
    let px = X(lo + 0.5), py = oy;
    hill.moveTo(px, py);
    edge.moveTo(px, py);
    for (let x = lo + 1; x <= hi; x++) {
      const nx = X(x + 0.5), ny = oy - H[x] * u;
      hill.quadraticCurveTo(px, py, (px + nx) / 2, (py + ny) / 2);
      edge.quadraticCurveTo(px, py, (px + nx) / 2, (py + ny) / 2);
      px = nx; py = ny;
    }
    hill.lineTo(px, py);
    hill.lineTo(px, oy);
    hill.closePath();
    edge.lineTo(px, py);

    const g = ctx.createLinearGradient(0, oy - (tall + 0.5) * u, 0, oy);
    g.addColorStop(0, '#bd8f55');
    g.addColorStop(1, '#8c6034');
    ctx.fillStyle = g;
    ctx.fill(hill);

    ctx.save();
    ctx.clip(hill);
    if (u >= 2.5) {
      const gs = Math.max(1, u * 0.3);
      for (let x = Math.max(lo, xa); x <= Math.min(hi, xb); x++) {
        for (let k = 0; k < H[x]; k++) {
          const n = hash(x * 131 + k * 17);
          if (n > 0.62) continue;
          ctx.fillStyle = n < 0.3 ? 'rgba(58,34,12,0.34)' : 'rgba(244,208,150,0.36)';
          ctx.fillRect(X(x + hash(x * 57 + k * 5 + 1)), oy - (k + hash(x * 23 + k * 3 + 2)) * u, gs, gs);
        }
      }
    }
    if (dim > 0.02) { ctx.fillStyle = css(NIGHT, 0.7 * dim); ctx.fill(hill); }
    ctx.restore();

    ctx.strokeStyle = `rgba(255,228,172,${0.1 + 0.5 * sky.light})`;
    ctx.lineWidth = Math.max(1, u * 0.2);
    ctx.stroke(edge);
  }

  // ── The way in ──
  {
    const ex = X(CX + 1), hw = u * 1.5, hh = u * 0.6;
    ctx.fillStyle = 'rgba(8,4,0,0.8)';
    ctx.beginPath(); ctx.ellipse(ex, oy, hw, hh, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.95)';
    ctx.beginPath(); ctx.ellipse(ex, oy, hw * 0.62, hh * 0.6, 0, 0, Math.PI * 2); ctx.fill();
  }

  // ── Turf along the ground line ──
  const bare = x => H[x] > 0 || (x >= CX - 1 && x <= CX + 2);
  ctx.fillStyle = shade([66, 108, 32]);
  for (let x = xa; x <= xb; x++) {
    if (bare(x)) continue;
    let e = x;
    while (e < xb && !bare(e + 1)) e++;
    ctx.fillRect(X(x), oy - 0.5, (e - x + 1) * u + 0.5, Math.max(1.5, u * 0.34));
    x = e;
  }

  // ── Crumbs and puddles on the ground ──
  const lying = (i, food) => {
    const x = i % W, y = (i / W) | 0;
    if (y >= SR || x < xa || x > xb) return;
    const gx = X(x + 0.5), gy = oy - Math.max(H[x], SR - 1 - y) * u;
    if (food) {
      const s = Math.max(0.7, u * (0.34 + Math.min(1, world.foodAmount[i] / 100) * 0.26));
      ctx.fillStyle = shade([176, 124, 20]);
      ctx.fillRect(gx - s * 1.5, gy - s, s * 3, s);
      ctx.fillStyle = shade([232, 184, 32]);
      ctx.fillRect(gx - s, gy - s * 1.9, s * 1.9, s);
      ctx.fillStyle = shade([250, 220, 96]);
      ctx.fillRect(gx - s * 0.4, gy - s * 2.6, s, s * 0.8);
    } else {
      const s = 0.55 + Math.min(1, world.waterAmount[i] / 100) * 0.45;
      ctx.fillStyle = shade([52, 136, 216], 0.9);
      ctx.beginPath(); ctx.ellipse(gx, gy - u * 0.12, Math.max(1.5, u * 0.95 * s), Math.max(1, u * 0.26), 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = `rgba(214,238,255,${0.35 + 0.4 * sky.light})`;
      ctx.fillRect(gx - u * 0.45 * s, gy - u * 0.24, u * 0.5 * s, Math.max(1, u * 0.09));
    }
  };
  for (const i of world.foodTiles) lying(i, true);
  for (const i of world.waterTiles) lying(i, false);

  if (u < 1.6) return;

  // ── Grass, bending in the wind ──
  const wind = 0.13 + sky.rain * 0.3;
  const lw = Math.max(1, u * 0.2);
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  for (let gi = 0; gi < 3; gi++) {
    ctx.beginPath();
    for (let x = xa; x <= xb; x++) {
      if (H[x] || (x >= CX - 1 && x <= CX + 2)) continue;
      for (let b = 0; b < 3; b++) {
        const n = hash(x * 3 + b);
        if (((n * 97) | 0) % 3 !== gi) continue;
        const bx = x + 0.16 + b * 0.32 + (n - 0.5) * 0.2;
        const bh = 0.35 + hash(x * 13 + b * 5 + 2) * 0.95;
        const sway = Math.sin(t * 1.6 + x * 0.4 + b) * wind * bh + (n - 0.5) * 0.3;
        ctx.moveTo(X(bx), oy);
        ctx.quadraticCurveTo(X(bx), oy - bh * u * 0.6, X(bx + sway), oy - bh * u);
      }
    }
    ctx.strokeStyle = shade(GREENS[gi]);
    ctx.stroke();
  }

  // ── A flower here and there ──
  for (let x = xa; x <= xb; x++) {
    const f = hash(x * 53 + 11);
    if (f > 0.075 || H[x] || (x >= CX - 3 && x <= CX + 4)) continue;
    const bh = 1.15 + hash(x * 7 + 3) * 0.8;
    const sway = Math.sin(t * 1.3 + x * 0.4) * wind * bh * 0.7;
    const fx = X(x + 0.5 + sway), fy = oy - bh * u;
    ctx.strokeStyle = shade(GREENS[2]);
    ctx.beginPath();
    ctx.moveTo(X(x + 0.5), oy);
    ctx.quadraticCurveTo(X(x + 0.5), oy - bh * u * 0.6, fx, fy);
    ctx.stroke();
    const s = Math.max(2, u * 0.5);
    ctx.fillStyle = shade(FLOWERS[((f * 997) | 0) % 4]);
    ctx.fillRect(fx - s, fy - s * 0.5, s * 2, s);
    ctx.fillRect(fx - s * 0.5, fy - s, s, s * 2);
    ctx.fillStyle = shade([250, 190, 40]);
    ctx.fillRect(fx - s * 0.4, fy - s * 0.4, s * 0.8, s * 0.8);
  }
  ctx.lineCap = 'butt';
}
