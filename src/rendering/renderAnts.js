import { ROLE, STATE, CONFIG } from '../config.js';

const C = CONFIG;

// ── Far zoom: 2×1 dot ───────────────────────────────────────────────────────
function drawAntFar(ctx, sx, sy, isQueen) {
  ctx.fillStyle = isQueen ? '#c03010' : '#1a1008';
  if (isQueen) {
    ctx.fillRect(Math.round(sx) - 1, Math.round(sy) - 1, 3, 2);
  } else {
    ctx.fillRect(Math.round(sx), Math.round(sy), 2, 1);
  }
}

// ── Mid zoom: 8-px pixel ant ─────────────────────────────────────────────────
function drawAntMid(ctx, sx, sy, angle, isQueen, carryFood) {
  const s  = isQueen ? 1.6 : 1.0;
  const bc = isQueen ? '#b03010' : '#1e1008';
  const hc = isQueen ? '#d04018' : '#2a1c0c';
  const lc = '#0e0804';

  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(angle);

  // Abdomen
  ctx.fillStyle = bc;
  ctx.fillRect(-5 * s, -1.5 * s | 0, 4 * s | 0, 3 * s | 0);
  // Petiole
  ctx.fillRect(-1 * s, -1 * s | 0, 2 * s | 0, 2 * s | 0);
  // Thorax
  ctx.fillRect(1 * s | 0, -1.5 * s | 0, 3 * s | 0, 3 * s | 0);
  // Head
  ctx.fillStyle = hc;
  ctx.fillRect(4 * s | 0, -1.5 * s | 0, 3 * s | 0, 3 * s | 0);
  // Legs (3 pairs, static at mid)
  ctx.fillStyle = lc;
  for (let i = -2; i <= 0; i++) {
    ctx.fillRect(i * 2 * s | 0, -2.5 * s | 0, 1, 2 * s | 0);
    ctx.fillRect(i * 2 * s | 0,  1.5 * s | 0, 1, 2 * s | 0);
  }
  // Carried food
  if (carryFood) {
    ctx.fillStyle = '#f8d040';
    ctx.fillRect(5 * s | 0, -2 * s | 0, 2 * s | 0, 2 * s | 0);
  }

  ctx.restore();
}

// ── Close zoom: detailed pixel ant ──────────────────────────────────────────
function drawAntClose(ctx, sx, sy, angle, role, carryFood, animFrame) {
  const isQueen = role === ROLE.QUEEN;
  const scale   = isQueen ? 2.2 : 1.0;
  const bc = isQueen ? '#b03010' : '#1e1008';
  const hc = isQueen ? '#d04018' : '#2a1c0a';
  const ac = isQueen ? '#e05020' : '#2e200c'; // abdomen highlight
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

  // Queen crown markings
  if (isQueen) {
    ctx.fillStyle = '#ffd040';
    ctx.fillRect(-7, -5, 2, 1);
    ctx.fillRect(-3, -4, 2, 1);
    ctx.fillRect( 1, -3, 2, 1);
  }

  ctx.restore();
}

// ── Egg ──────────────────────────────────────────────────────────────────────
function drawEgg(ctx, sx, sy, zoom, hatchProgress) {
  const r = zoom < C.LOD_FAR ? 1.2 : zoom < C.LOD_MID ? 2.5 : 5;
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

    if      (lod === 'far')  drawAntFar(ctx, sx, sy, false);
    else if (lod === 'mid')  drawAntMid(ctx, sx, sy, ant.angle, false, ant.carryFood);
    else                     drawAntClose(ctx, sx, sy, ant.angle, ant.role, ant.carryFood, ant.animFrame);
  }

  // Queen
  const [qsx, qsy] = camera.worldToScreen(queen.x * ts, queen.y * ts);
  if (qsx > -30 && qsx < camera.cw + 30 && qsy > -30 && qsy < camera.ch + 30) {
    if      (lod === 'far')  drawAntFar(ctx, qsx, qsy, true);
    else if (lod === 'mid')  drawAntMid(ctx, qsx, qsy, queen.angle, true, false);
    else                     drawAntClose(ctx, qsx, qsy, queen.angle, ROLE.QUEEN, false, queen.animFrame);

    // Crown indicator at non-close zoom
    if (lod !== 'close') {
      ctx.fillStyle = '#ffd040';
      const sz = lod === 'far' ? 1 : 3;
      ctx.fillRect(qsx - sz, qsy - (lod === 'far' ? 3 : 7), sz * 2 + 1, 1);
    }
  }
}
