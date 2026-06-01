import { ROLE, STATE, CONFIG } from '../config.js';

const C = CONFIG;

// ── Far zoom: single-pixel dots ──────────────────────────────────────────────
function drawAntFar(ctx, sx, sy, isQueen) {
  const x = Math.round(sx), y = Math.round(sy);
  if (isQueen) {
    ctx.fillStyle = '#c03010';
    ctx.fillRect(x - 2, y - 1, 4, 3);
    ctx.fillStyle = '#ffd040';
    ctx.fillRect(x, y - 3, 1, 1);
  } else {
    ctx.fillStyle = '#1a1008';
    ctx.fillRect(x, y, 2, 1);
  }
}

// ── Tiny zoom: proportional 3-part silhouette ────────────────────────────────
// Sprite designed at native zoom=LOD_TINY (0.75); scaled proportionally below that.
// This fills the gap between dots and the full mid-zoom sprite.
function drawAntTiny(ctx, sx, sy, angle, zoom, isQueen, carryFood) {
  // Scale so ant is always ~1.5 tiles long regardless of zoom
  const s = Math.max(0.15, zoom / C.LOD_TINY); // 1.0 at LOD_TINY, shrinks below
  ctx.save();
  ctx.translate(Math.round(sx), Math.round(sy));
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
    const bc = '#1e1008';
    ctx.fillStyle = bc;
    ctx.fillRect(-6, -1, 4, 3);  // gaster
    ctx.fillRect(-2, -1, 3, 2);  // thorax
    ctx.fillStyle = '#2a1c0c';
    ctx.fillRect( 1, -1, 3, 2);  // head
    if (carryFood) {
      ctx.fillStyle = '#f8d040';
      ctx.fillRect(4, -1, 2, 2);
    }
  }
  ctx.restore();
}

// ── Mid zoom: pixel ant, proportionally scaled ───────────────────────────────
// Sprite designed at LOD_MID (zoom 1.8); ctx.scale keeps it world-proportional
// at any zoom in the tiny→mid range so ants never look oversized.
function drawAntMid(ctx, sx, sy, angle, zoom, isQueen, carryFood) {
  const s = zoom / C.LOD_MID; // 1.0 at LOD_MID boundary, shrinks with zoom
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
    ctx.fillStyle = bc;
    ctx.fillRect(-5, -2, 4, 4); // abdomen
    ctx.fillRect(-1, -1, 2, 2); // petiole
    ctx.fillRect( 1, -2, 3, 4); // thorax
    ctx.fillStyle = hc;
    ctx.fillRect( 4, -2, 3, 3); // head
    ctx.fillStyle = lc;
    for (let i = -2; i <= 0; i++) {
      ctx.fillRect(i * 2, -3, 1, 3);
      ctx.fillRect(i * 2,  2, 1, 3);
    }
    if (carryFood) {
      ctx.fillStyle = '#f8d040';
      ctx.fillRect(6, -2, 2, 2);
    }
  }

  ctx.restore();
}

// ── Close zoom: queen ────────────────────────────────────────────────────────
// Drawn at scale 2.0 — all coordinates are in sprite-pixels (×2 on screen).
// Anatomy: gaster(←) · petiole · thorax · head(→), ant faces right (+x).
function drawQueenClose(ctx, sx, sy, angle, animFrame) {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.scale(2.0, 2.0);

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
  for (const [x, y, w, c] of bands) { ctx.fillStyle = c; ctx.fillRect(x, y, w, 1); }

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
  const eyes = [[-3, 2], [1, 2]]; // [dy, dx from head-right-corner]
  for (const [ey, ex] of eyes) {
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
function drawAntClose(ctx, sx, sy, angle, role, carryFood, animFrame, carryDirt) {
  const isQueen    = role === ROLE.QUEEN;
  const isExplorer = role === ROLE.EXPLORER;
  const isRogue    = role === ROLE.ROGUE;
  const scale   = isQueen ? 2.2 : isRogue ? 1.3 : 1.0;
  const bc = isQueen ? '#b03010' : isRogue ? '#8a4e10' : isExplorer ? '#3a3028' : '#1e1008';
  const hc = isQueen ? '#d04018' : isRogue ? '#c06820' : isExplorer ? '#4a4038' : '#2a1c0a';
  const ac = isQueen ? '#e05020' : isRogue ? '#a05818' : isExplorer ? '#4e4840' : '#2e200c';
  const lc = '#100a04';

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);
  ctx.scale(scale, scale);

  // Abdomen (oval)
  ctx.fillStyle = ac;
  ctx.fillRect(-9, -3, 6, 5);
  ctx.fillStyle = bc;
  ctx.fillRect(-8, -2, 5, 4);

  // Petiole
  ctx.fillStyle = lc;
  ctx.fillRect(-3, -1, 2, 2);

  // Thorax
  ctx.fillStyle = bc;
  ctx.fillRect(-1, -2, 4, 4);

  // Head
  ctx.fillStyle = hc;
  ctx.fillRect(3, -2, 4, 3);

  // Eye
  ctx.fillStyle = '#ff8800';
  ctx.fillRect(6, -2, 1, 1);

  // Antennae
  ctx.fillStyle = lc;
  ctx.fillRect(4, -3, 1, 2);
  ctx.fillRect(5, -4, 3, 1);
  ctx.fillRect(6, -3, 1, 1);

  // Mandibles
  ctx.fillStyle = hc;
  ctx.fillRect(7, -1, 2, 1);
  ctx.fillRect(7,  1, 2, 1);

  // Legs — 3 pairs, animated by frame
  const lo = animFrame === 1 ? 1 : 0;
  ctx.fillStyle = lc;
  ctx.fillRect(-6, -3 - lo, 1, 3);
  ctx.fillRect(-3, -3,      1, 3);
  ctx.fillRect( 0, -3 + lo, 1, 3);
  ctx.fillRect(-6,  1 + lo, 1, 3);
  ctx.fillRect(-3,  1,      1, 3);
  ctx.fillRect( 0,  1 - lo, 1, 3);

  // Carrying food
  if (carryFood) {
    ctx.fillStyle = '#f8d040';
    ctx.fillRect(7, -3, 3, 3);
    ctx.fillStyle = 'rgba(255,255,180,0.6)';
    ctx.fillRect(8, -3, 1, 1);
  }

  // Carrying dirt (heading to anthill)
  if (carryDirt) {
    ctx.fillStyle = '#7a6040';
    ctx.fillRect(7, -3, 3, 3);
    ctx.fillStyle = '#9a7850';
    ctx.fillRect(8, -3, 1, 1);
  }

  // Queen crown markings
  if (isQueen) {
    ctx.fillStyle = '#ffd040';
    ctx.fillRect(-7, -5, 2, 1);
    ctx.fillRect(-3, -4, 2, 1);
    ctx.fillRect( 1, -3, 2, 1);
  }

  // Rogue amber stripe — battle-scarred warrior marking
  if (isRogue) {
    ctx.fillStyle = '#f0a030';
    ctx.fillRect(-7, -1, 14, 1); // amber racing stripe across the body
    ctx.fillStyle = '#ff6020';
    ctx.fillRect( 6, -2,  2, 1); // glowing eye
  }

  ctx.restore();
}

// ── Egg ──────────────────────────────────────────────────────────────────────
function drawEgg(ctx, sx, sy, zoom, hatchProgress) {
  const r = zoom < C.LOD_FAR ? 1.2 : zoom < C.LOD_TINY ? 1.8 : zoom < C.LOD_MID ? 2.5 : 5;
  const alpha = 0.5 + hatchProgress * 0.5;
  ctx.fillStyle = `rgba(240,232,192,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 0.65, r, 0, 0, Math.PI * 2);
  ctx.fill();
  if (hatchProgress > 0.55) {
    ctx.fillStyle = `rgba(255,215,90,${alpha * 0.5})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, r * 0.3, r * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Main render ──────────────────────────────────────────────────────────────
export function renderAnts(ctx, antSystem, queen, camera) {
  const zoom = camera.zoom;
  const ts   = C.TILE_SIZE;
  const lod  = camera.lodLevel;

  // Eggs (behind ants)
  for (const egg of antSystem.eggs) {
    const [sx, sy] = camera.worldToScreen(egg.x * ts, egg.y * ts);
    if (sx < -10 || sx > camera.cw + 10 || sy < -10 || sy > camera.ch + 10) continue;
    const prog = Math.max(0, Math.min(1, 1 - egg.hatchTimer / C.EGG_HATCH_TICKS));
    drawEgg(ctx, sx, sy, zoom, prog);
  }

  // Worker ants
  for (const ant of antSystem.ants) {
    const [sx, sy] = camera.worldToScreen(ant.x * ts, ant.y * ts);
    if (sx < -20 || sx > camera.cw + 20 || sy < -20 || sy > camera.ch + 20) continue;

    if      (lod === 'far')   drawAntFar(ctx, sx, sy, false);
    else if (lod === 'tiny')  drawAntTiny(ctx, sx, sy, ant.angle, zoom, false, ant.carryFood || ant.carryDirt);
    else if (lod === 'mid')   drawAntMid(ctx, sx, sy, ant.angle, zoom, false, ant.carryFood || ant.carryDirt);
    else                      drawAntClose(ctx, sx, sy, ant.angle, ant.role, ant.carryFood, ant.animFrame, ant.carryDirt);
  }

  // Queen
  const [qsx, qsy] = camera.worldToScreen(queen.x * ts, queen.y * ts);
  if (qsx > -50 && qsx < camera.cw + 50 && qsy > -50 && qsy < camera.ch + 50) {
    if      (lod === 'far')   drawAntFar(ctx, qsx, qsy, true);
    else if (lod === 'tiny')  drawAntTiny(ctx, qsx, qsy, queen.angle, zoom, true, false);
    else if (lod === 'mid')   drawAntMid(ctx, qsx, qsy, queen.angle, zoom, true, false);
    else                      drawQueenClose(ctx, qsx, qsy, queen.angle, queen.animFrame);

    if (lod === 'far') {
      ctx.fillStyle = '#ffd040';
      ctx.fillRect(Math.round(qsx), Math.round(qsy) - 5, 1, 1);
    }
  }
}
