import { ROLE, STATE, CONFIG } from '../config.js';
import { hash } from './renderSky.js';

const C = CONFIG;
const TS = C.TILE_SIZE, SR = C.SURFACE_ROW, GT = C.GLASS_THICKNESS;

// What an ant holds, by CARRY id: nothing, food, water, dirt, brood
const LOAD = [null, '#f8d040', '#58a8f0', '#8a6a44', '#f6f0dc'];
const LANE = 0.22;   // tiles each ant keeps to the right of the middle of a tunnel

// Ants are drawn about two tiles long at every zoom, so they always fit their tunnels.
// Each sprite below is laid out in its own pixels and scaled to that length.

// ── Far zoom: single-pixel dots ──────────────────────────────────────────────
function drawAntFar(ctx, sx, sy, isQueen, load) {
  const x = Math.round(sx), y = Math.round(sy);
  if (isQueen) {
    ctx.fillStyle = '#c03010';
    ctx.fillRect(x - 2, y - 1, 4, 3);
    ctx.fillStyle = '#ffd040';
    ctx.fillRect(x, y - 3, 1, 1);
  } else {
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(x - 1, y, 2, 1);
    if (load) { ctx.fillStyle = load; ctx.fillRect(x, y - 1, 1, 1); }
  }
}

// ── Tiny zoom: proportional 3-part silhouette ────────────────────────────────
function drawAntTiny(ctx, sx, sy, angle, zoom, isQueen, load) {
  const s = Math.max(0.45, zoom * 0.8) * (isQueen ? 1.6 : 1);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.scale(s, s);

  if (isQueen) {
    ctx.fillStyle = '#c03010';
    ctx.fillRect(-7, -2, 5, 4);  // gaster
    ctx.fillStyle = '#ffd040';
    ctx.fillRect(-6, -1, 1, 2);  // gold mark
    ctx.fillStyle = '#c03010';
    ctx.fillRect(-2, -1, 3, 3);  // thorax
    ctx.fillStyle = '#d84028';
    ctx.fillRect( 1, -2, 3, 3);  // head
  } else {
    ctx.fillStyle = '#1e1008';
    ctx.fillRect(-6, -1.5, 4, 3);  // gaster
    ctx.fillRect(-2, -1, 3, 2);    // thorax
    ctx.fillStyle = '#2a1c0c';
    ctx.fillRect( 1, -1, 3, 2);    // head
    if (load) {
      ctx.fillStyle = load;
      ctx.fillRect(4, -1.5, 3, 3);
    }
  }
  ctx.restore();
}

// ── Mid zoom: pixel ant ──────────────────────────────────────────────────────
function drawAntMid(ctx, sx, sy, angle, zoom, isQueen, load, frame) {
  const s = zoom / (isQueen ? 1.25 : 1.5);
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.scale(s, s);

  if (isQueen) {
    // Queen mid-zoom: distinctive large gaster + wing stubs
    // Gaster — wide oval
    ctx.fillStyle = '#c83020';
    ctx.fillRect(-11, -3, 10, 6);
    ctx.fillStyle = '#e04030'; // top highlight
    ctx.fillRect(-11, -3, 10, 1);
    ctx.fillStyle = '#8a1c0c'; // bottom shadow
    ctx.fillRect(-11,  2, 10, 1);
    // Gold spot on gaster
    ctx.fillStyle = '#ffd040';
    ctx.fillRect(-8, -1, 2, 2);
    ctx.fillRect(-5, -1, 2, 2);
    // Petiole
    ctx.fillStyle = '#1a0c04';
    ctx.fillRect(-1, -1, 2, 2);
    // Thorax
    ctx.fillStyle = '#c83018';
    ctx.fillRect( 1, -2, 4, 4);
    // Wing stubs
    ctx.fillStyle = '#e04830';
    ctx.fillRect( 1, -4, 3, 2); // top stub
    ctx.fillRect( 1,  2, 3, 2); // bottom stub
    // Head
    ctx.fillStyle = '#d84028';
    ctx.fillRect( 5, -2, 4, 4);
    // Compound eyes
    ctx.fillStyle = '#ff9020';
    ctx.fillRect( 8, -2, 1, 1);
    ctx.fillRect( 8,  1, 1, 1);
    // Mandibles
    ctx.fillStyle = '#c83018';
    ctx.fillRect( 9, -1, 2, 1);
    ctx.fillRect( 9,  0, 2, 1);
    // Legs
    ctx.fillStyle = '#1a0c04';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(-1 + i * 2, -4, 1, 3);
      ctx.fillRect(-1 + i * 2,  2, 1, 3);
    }
  } else {
    // Worker mid-zoom
    const bc = '#1e1008', hc = '#2a1c0c', lc = '#0e0804';
    const lo = frame === 1 ? 0.6 : frame === 2 ? -0.6 : 0;
    ctx.fillStyle = lc;
    ctx.fillRect(-4, -3.5 - lo, 1, 3);
    ctx.fillRect(-2, -3.5,      1, 3);
    ctx.fillRect( 0, -3.5 + lo, 1, 3);
    ctx.fillRect(-4,  0.5 + lo, 1, 3);
    ctx.fillRect(-2,  0.5,      1, 3);
    ctx.fillRect( 0,  0.5 - lo, 1, 3);
    ctx.fillStyle = bc;
    ctx.fillRect(-5, -2, 4, 4); // abdomen
    ctx.fillRect(-1, -1, 2, 2); // petiole
    ctx.fillRect( 1, -2, 3, 4); // thorax
    ctx.fillStyle = hc;
    ctx.fillRect( 4, -1.5, 3, 3); // head
    if (load) {
      ctx.fillStyle = load;
      ctx.fillRect(7, -1.5, 3, 3);
    }
  }

  ctx.restore();
}

// ── Close zoom: queen ────────────────────────────────────────────────────────
// All coordinates are in sprite-pixels. Anatomy: gaster(←) · petiole · thorax ·
// head(→), ant faces right (+x).
function drawQueenClose(ctx, sx, sy, angle, zoom, animFrame) {
  const s = zoom / 1.45;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.scale(s, s);

  const lo = animFrame === 1 ? 1 : 0; // leg animation offset

  // ── Gaster — queen's defining trait: massive, swollen abdomen ─────────────
  // Oval built from horizontal bands (widest in middle, narrow caps at top/bottom)
  const bands = [
    [-10, -5,  7, '#d04828'],  // top cap, highlight
    [-12, -4, 10, '#e05030'],  // upper highlight band
    [-13, -3, 12, '#cc3020'],  // main body upper
    [-14, -2, 13, '#c02c1c'],  // widest row
    [-14, -1, 13, '#b82818'],  // center
    [-14,  0, 13, '#b02414'],  // center lower
    [-13,  1, 12, '#a02010'],  // main body lower
    [-12,  2, 10, '#8e1c0c'],  // lower shadow
    [-10,  3,  7, '#7a1408'],  // bottom cap shadow
  ];
  for (const [x, y, w, c] of bands) { ctx.fillStyle = c; ctx.fillRect(x, y, w, 1.05); }

  // Dorsal stripe — segmentation between gaster sections
  ctx.fillStyle = '#9a1e0e';
  ctx.fillRect(-13, -1, 12, 1);
  ctx.fillRect(-13,  1, 12, 1);

  // Royal gold crown spots — three oval marks on the gaster
  const spots = [[-11, -1], [-8, -1], [-5, -1]];
  for (const [x, y] of spots) {
    ctx.fillStyle = '#ffd040';
    ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = '#fff080'; // inner shine
    ctx.fillRect(x, y, 1, 1);
  }

  // ── Petiole (narrow waist node) ───────────────────────────────────────────
  ctx.fillStyle = '#1e0e06';
  ctx.fillRect(-2, -1, 2, 2);
  ctx.fillStyle = '#2e1808';
  ctx.fillRect(-2, -1, 2, 1); // top highlight

  // ── Thorax ────────────────────────────────────────────────────────────────
  ctx.fillStyle = '#c83018';
  ctx.fillRect(0, -2, 5, 5);
  ctx.fillStyle = '#e04030'; // top highlight
  ctx.fillRect(0, -2, 5, 1);
  ctx.fillStyle = '#9a2010'; // bottom shadow
  ctx.fillRect(0,  2, 5, 1);
  ctx.fillStyle = '#b02818'; // right shadow
  ctx.fillRect(4, -2, 1, 4);

  // Wing stubs — queens that have shed their wings carry distinctive scars
  ctx.fillStyle = '#c04828'; // stub body
  ctx.fillRect(0, -4, 4, 2); // dorsal stub
  ctx.fillRect(0,  3, 4, 2); // ventral stub
  ctx.fillStyle = '#e06040'; // stub top highlight
  ctx.fillRect(0, -4, 4, 1);
  ctx.fillRect(0,  4, 4, 1);
  ctx.fillStyle = '#f08060'; // stub vein
  ctx.fillRect(1, -4, 2, 1);

  // ── Head (larger than worker, majestic) ───────────────────────────────────
  ctx.fillStyle = '#d84028';
  ctx.fillRect(5, -3, 5, 6);
  ctx.fillStyle = '#f05038'; // top + left highlights
  ctx.fillRect(5, -3, 5, 1);
  ctx.fillRect(5, -3, 1, 6);
  ctx.fillStyle = '#a82c1c'; // right + bottom shadow
  ctx.fillRect(9, -3, 1, 6);
  ctx.fillStyle = '#c03020';
  ctx.fillRect(5,  2, 5, 1);

  // Compound eyes — 2×2, two of them (upper and lower)
  for (const ey of [-3, 1]) {
    ctx.fillStyle = '#ff9020';
    ctx.fillRect(7, ey, 2, 2);
    ctx.fillStyle = '#ffcc50'; // shine
    ctx.fillRect(7, ey, 1, 1);
    ctx.fillStyle = '#1a0000'; // pupil
    ctx.fillRect(8, ey + 1, 1, 1);
  }

  // ── Antennae (long, elegantly curved) ────────────────────────────────────
  ctx.fillStyle = '#2a1408';
  // Upper antenna
  ctx.fillRect(5, -4, 1, 2);  // base segment
  ctx.fillRect(6, -5, 1, 1);  // elbow
  ctx.fillRect(7, -6, 3, 1);  // shaft
  ctx.fillRect(9, -7, 2, 1);  // tip
  // Lower antenna (offset slightly)
  ctx.fillRect(6, -4, 1, 2);
  ctx.fillRect(7, -5, 1, 1);
  ctx.fillRect(8, -6, 3, 1);
  ctx.fillRect(10,-7, 2, 1);

  // ── Mandibles (powerful, prominent) ──────────────────────────────────────
  ctx.fillStyle = '#d84028';
  ctx.fillRect(10, -2, 2, 1);
  ctx.fillRect(10,  1, 2, 1);
  ctx.fillStyle = '#f05840'; // mandible tips
  ctx.fillRect(11, -2, 1, 1);
  ctx.fillRect(11,  1, 1, 1);

  // ── Legs — 3 pairs, animated ──────────────────────────────────────────────
  ctx.fillStyle = '#200e06';
  // Pair 1 (thorax front)
  ctx.fillRect(3, -2 - lo, 1, 4);
  ctx.fillRect(3,  2 + lo, 1, 4);
  // Pair 2 (thorax mid)
  ctx.fillRect(1, -2,      1, 4);
  ctx.fillRect(1,  2,      1, 4);
  // Pair 3 (thorax rear)
  ctx.fillRect(-1, -2 + lo, 1, 4);
  ctx.fillRect(-1,  2 - lo, 1, 4);
  // Leg tips (small horizontal segment at end of each leg)
  ctx.fillRect( 4, -5 - lo, 2, 1);
  ctx.fillRect( 4,  5 + lo, 2, 1);
  ctx.fillRect( 2, -5,      2, 1);
  ctx.fillRect( 2,  5,      2, 1);
  ctx.fillRect( 0, -5 + lo, 2, 1);
  ctx.fillRect( 0,  5 - lo, 2, 1);

  ctx.restore();
}

// ── Close zoom: worker/digger/etc ────────────────────────────────────────────
function drawAntClose(ctx, sx, sy, angle, zoom, role, load, animFrame) {
  const isExplorer = role === ROLE.EXPLORER;
  const isRogue    = role === ROLE.ROGUE;
  const isAlate    = role === ROLE.ALATE;
  const scale = (zoom / 2.25) * (isRogue ? 1.3 : isAlate ? 1.15 : 1);
  const bc = isRogue ? '#8a4e10' : isAlate ? '#3c1a0a' : isExplorer ? '#3a3028' : '#1e1008';
  const hc = isRogue ? '#c06820' : isAlate ? '#54240e' : isExplorer ? '#4a4038' : '#2a1c0a';
  const ac = isRogue ? '#a05818' : isAlate ? '#5a2a10' : isExplorer ? '#4e4840' : '#2e200c';
  const lc = '#100a04';

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  // Legs — 3 pairs, stepping in turn
  const lo = animFrame === 1 ? 1 : animFrame === 2 ? -1 : 0;
  ctx.fillStyle = lc;
  ctx.fillRect(-4 - lo, -5, 1, 4);
  ctx.fillRect(-1 + lo, -5, 1, 4);
  ctx.fillRect( 2 - lo, -5, 1, 4);
  ctx.fillRect(-4 + lo,  1, 1, 4);
  ctx.fillRect(-1 - lo,  1, 1, 4);
  ctx.fillRect( 2 + lo,  1, 1, 4);

  // Abdomen (oval)
  ctx.fillStyle = ac;
  ctx.fillRect(-9, -3, 6, 6);
  ctx.fillStyle = bc;
  ctx.fillRect(-8, -2, 5, 4);
  ctx.fillStyle = 'rgba(255,220,170,0.16)';   // sheen
  ctx.fillRect(-8, -3, 4, 1);

  // Petiole
  ctx.fillStyle = lc;
  ctx.fillRect(-3, -1, 2, 2);

  // Thorax
  ctx.fillStyle = bc;
  ctx.fillRect(-1, -2, 4, 4);

  // Head
  ctx.fillStyle = hc;
  ctx.fillRect(3, -2, 4, 4);

  // Eyes
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(6, -2, 1, 1);
  ctx.fillRect(6,  1, 1, 1);

  // Antennae
  ctx.fillStyle = lc;
  ctx.fillRect(6, -4, 1, 2);
  ctx.fillRect(7, -5, 3, 1);
  ctx.fillRect(6,  2, 1, 2);
  ctx.fillRect(7,  4, 3, 1);

  // Mandibles
  ctx.fillStyle = hc;
  ctx.fillRect(7, -1.5, 2, 1);
  ctx.fillRect(7,  0.5, 2, 1);

  // Whatever is held in the mandibles
  if (load) {
    ctx.fillStyle = load;
    ctx.fillRect(8, -2, 4, 4);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(9, -2, 2, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(8, 1, 4, 1);
  }

  // Rogue amber stripe — battle-scarred warrior marking
  if (isRogue) {
    ctx.fillStyle = '#f0a030';
    ctx.fillRect(-7, -0.5, 14, 1); // amber racing stripe across the body
    ctx.fillStyle = '#ff6020';
    ctx.fillRect( 6, -2,  1, 1);   // glowing eyes
    ctx.fillRect( 6,  1,  1, 1);
  }

  ctx.restore();
}

// ── Wings (alates) ───────────────────────────────────────────────────────────
// s: screen pixels per close-sprite pixel; spread: how far each wing swings out
function drawWings(ctx, sx, sy, angle, s, spread) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.scale(s, s);
  for (let side = -1; side <= 1; side += 2) {
    ctx.save();
    ctx.rotate(-side * spread);   // hinged at the thorax
    ctx.fillStyle = 'rgba(226,238,255,0.5)';
    ctx.beginPath();
    ctx.ellipse(-6.5, side * 1.2, 7, 2.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(-11, side * 1.2 - 0.3, 9, 0.6);   // vein
    ctx.restore();
  }
  ctx.restore();
}

// ── Brood: egg → larva → pupa ────────────────────────────────────────────────
// u: screen pixels per tile; prog: 0 just laid → 1 about to hatch
function drawBrood(ctx, sx, sy, u, prog, seed, t) {
  if (u < 1.8) {   // far away: a pale speck
    ctx.fillStyle = prog < 0.7 ? '#f0e8c8' : '#d8b888';
    ctx.fillRect(sx, sy, 1, 1);
    return;
  }
  const rot = hash(seed | 0) * Math.PI;
  ctx.beginPath();
  if (prog < 0.3) {
    ctx.fillStyle = '#f8f2e0';
    ctx.ellipse(sx, sy, Math.max(0.9, u * 0.19), Math.max(1.2, u * 0.29), rot, 0, Math.PI * 2);
    ctx.fill();
  } else if (prog < 0.7) {
    // larvae fatten as they are fed, and squirm
    const g = (prog - 0.3) / 0.4;
    const rx = u * (0.24 + 0.1 * g), ry = u * (0.38 + 0.2 * g);
    const a = rot + Math.sin(t * 2.2 + seed) * 0.3;
    ctx.fillStyle = '#f2e2b6';
    ctx.ellipse(sx, sy, rx, ry, a, 0, Math.PI * 2);
    ctx.fill();
    if (u >= 5) {
      const hx = sx - Math.sin(a) * ry * 0.72, hy = sy + Math.cos(a) * ry * 0.72;
      const hs = Math.max(1, u * 0.16);
      ctx.fillStyle = '#c0884a';
      ctx.fillRect(hx - hs / 2, hy - hs / 2, hs, hs);
    }
  } else {
    // a cocoon, twitching as the ant inside gets ready to come out
    const jx = prog > 0.93 ? Math.sin(t * 45 + seed) * u * 0.07 : 0;
    ctx.fillStyle = '#b89060';
    ctx.ellipse(sx + jx, sy, u * 0.36, u * 0.62, rot, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#e4c690';
    ctx.ellipse(sx + jx - u * 0.05, sy - u * 0.06, u * 0.25, u * 0.48, rot, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Main render ──────────────────────────────────────────────────────────────
// alpha: how far this frame falls between two simulation ticks; t: seconds of real time
export function renderAnts(ctx, antSystem, queen, camera, alpha = 1, t = 0) {
  const zoom = camera.zoom;
  const lod  = camera.lodLevel;
  const u    = TS * zoom;
  const [ox, oy] = camera.worldToScreen(0, 0);
  const cw = camera.cw, ch = camera.ch;

  // Brood (behind the ants). An egg being carried is drawn as its carrier's load.
  const pad = u + 4;
  for (const egg of antSystem.eggs) {
    if (egg.carried) continue;
    const sx = ox + egg.x * u, sy = oy + egg.y * u;
    if (sx < -pad || sx > cw + pad || sy < -pad || sy > ch + pad) continue;
    const prog = Math.max(0, Math.min(1, 1 - egg.hatchTimer / egg.total));
    drawBrood(ctx, sx, sy, u, prog, egg.x * 7.31 + egg.y * 131.7, t);
  }

  // Worker ants
  const m = u * 3 + 8;
  for (const ant of antSystem.ants) {
    let x = ant.px === undefined ? ant.x : ant.px + (ant.x - ant.px) * alpha;
    let y = ant.py === undefined ? ant.y : ant.py + (ant.y - ant.py) * alpha;
    const a = ant.angle;
    const alate = ant.role === ROLE.ALATE;
    const air = alate && ant.sub === 2;

    if (!air) {
      // keep right: two lanes of traffic in every tunnel
      const lane = LANE * Math.max(0, Math.min(1, y - SR + 1));
      if (lane > 0) { x -= Math.sin(a) * lane; y += Math.cos(a) * lane; }
      if (ant.state === STATE.DIGGING) {   // worrying at the soil face
        const j = 0.12 * Math.sin(t * 14 + ant.id);
        x += Math.cos(a) * j;
        y += Math.sin(a) * j;
      }
    }

    const sx = ox + x * u, sy = oy + y * u;
    if (sx < -m || sx > cw + m || sy < -m || sy > ch + m) continue;

    const load = LOAD[ant.carry] || null;
    // alates fade into the sky as they leave the farm
    const fade = air ? Math.max(0, Math.min(1, (y - GT - 0.5) / 4)) : 1;
    if (fade <= 0) continue;
    if (fade < 1) ctx.globalAlpha = fade;

    if      (lod === 'far')   drawAntFar(ctx, sx, sy, false, alate ? '#e8f0ff' : load);
    else if (lod === 'tiny')  drawAntTiny(ctx, sx, sy, a, zoom, false, load);
    else if (lod === 'mid')   drawAntMid(ctx, sx, sy, a, zoom, false, load, ant.animFrame);
    else                      drawAntClose(ctx, sx, sy, a, zoom, ant.role, load, ant.animFrame);

    if (alate && lod !== 'far') {
      const spread = !air ? 0.14 : ant.pause > 0 ? 0.55 : 0.95 + 0.45 * Math.sin(t * 38 + ant.id);
      drawWings(ctx, sx, sy, a, zoom / 2.25 * 1.15, spread);
    }
    if (fade < 1) ctx.globalAlpha = 1;
  }

  // Queen
  const qsx = ox + queen.x * u, qsy = oy + queen.y * u;
  if (qsx > -80 - m && qsx < cw + 80 + m && qsy > -80 - m && qsy < ch + 80 + m) {
    if      (lod === 'far')   drawAntFar(ctx, qsx, qsy, true, null);
    else if (lod === 'tiny')  drawAntTiny(ctx, qsx, qsy, queen.angle, zoom, true, null);
    else if (lod === 'mid')   drawAntMid(ctx, qsx, qsy, queen.angle, zoom, true, null, 0);
    else                      drawQueenClose(ctx, qsx, qsy, queen.angle, zoom, queen.animFrame);
  }
}
