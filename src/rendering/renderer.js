import { renderWorld, drawWorldToScreen, forceFullRedraw, renderPheromoneOverlay } from './renderWorld.js';
import { renderAnts } from './renderAnts.js';
import { TILE, CONFIG } from '../config.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._firstFrame = true;
  }

  render(camera, world, antSystem, queen, creatures = null) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    ctx.fillStyle = '#060402';
    ctx.fillRect(0, 0, w, h);

    if (this._firstFrame) {
      forceFullRedraw(world);
      this._firstFrame = false;
    }

    const worldCanvas = renderWorld(camera, world);
    drawWorldToScreen(ctx, worldCanvas, camera);

    this._drawSky(ctx, camera, world);
    this._drawAnthill(ctx, camera, world);

    const pherCanvas = renderPheromoneOverlay(world);
    if (pherCanvas) {
      const [sx, sy] = camera.worldToScreen(0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        pherCanvas, sx, sy,
        pherCanvas.width  * CONFIG.TILE_SIZE * camera.zoom,
        pherCanvas.height * CONFIG.TILE_SIZE * camera.zoom
      );
    }

    this._drawGlows(ctx, camera, world);
    this._drawQueenGlow(ctx, camera, queen);

    renderAnts(ctx, antSystem, queen, camera);
    if (creatures) this._drawCreatures(ctx, camera, creatures.creatures);

    this._drawFrame(camera, world);
    this._drawZoomHint(ctx, camera, w, h);
  }

  _drawSky(ctx, camera, world) {
    const ts = CONFIG.TILE_SIZE;
    const GT = CONFIG.GLASS_THICKNESS;
    const SR = CONFIG.SURFACE_ROW;

    const [x0, y0]    = camera.worldToScreen(GT * ts, GT * ts);
    // Extend gradient 4 rows below surface so sunlight bleeds into topsoil
    const [x1, ySurf] = camera.worldToScreen((world.width - GT) * ts, (SR + 4) * ts);
    if (ySurf <= y0 || x1 <= x0) return;

    const surfY = y0 + (ySurf - y0) * (SR - GT) / (SR + 4 - GT);

    const grad = ctx.createLinearGradient(0, y0, 0, ySurf);
    grad.addColorStop(0,    '#3a80c0');  // clear blue sky at top
    grad.addColorStop(0.45, '#6aaee0');  // lighter mid sky
    grad.addColorStop(0.78, '#d4a030');  // golden near surface
    grad.addColorStop(0.88, '#e8b830');  // bright sunlight at ground
    grad.addColorStop(1,    '#c8942000'); // fade out below surface
    ctx.fillStyle = grad;
    ctx.fillRect(x0, y0, x1 - x0, ySurf - y0);
  }

  _drawAnthill(ctx, camera, world) {
    const ts   = CONFIG.TILE_SIZE;
    const SR   = CONFIG.SURFACE_ROW;
    const CX   = CONFIG.COLONY_X;
    const zoom = camera.zoom;
    const sw   = ts * zoom;

    // Pre-compute column heights so we can shade the mound contour
    const colHeight = new Int16Array(world.width);
    for (let x = 0; x < world.width; x++) {
      for (let y = SR - 1; y >= 0; y--) {
        if (world.get(x, y) === TILE.ANTHILL) colHeight[x]++;
        else break;
      }
    }
    const peakHeight = Math.max(...colHeight);
    if (peakHeight === 0) return; // nothing to draw yet

    for (let x = 0; x < world.width; x++) {
      for (let y = 0; y < SR; y++) {
        if (world.get(x, y) !== TILE.ANTHILL) continue;
        const [sx, sy] = camera.worldToScreen(x * ts, y * ts);
        if (sx < -sw || sx > camera.cw || sy < -sw || sy > camera.ch) continue;

        // How deep in the pile is this tile? (0 = top surface of mound)
        const depthInPile = SR - 1 - y;
        const isTop = depthInPile === 0 || world.get(x, y - 1) !== TILE.ANTHILL;

        // Hash for stable per-tile noise
        const n = ((x * 374761393 + y * 668265263) * 1274126177 >>> 0) & 0xff;
        const j = (n / 255) * 14 - 7;

        // Colour: top of pile lighter (sunlit), base darker (shadowed)
        const topBoost = isTop ? 14 : 0;
        const r = Math.max(0, Math.min(255, 148 + j + topBoost | 0));
        const g = Math.max(0, Math.min(255, 100 + j + topBoost | 0));
        const b = Math.max(0, Math.min(255,  50 + j + topBoost | 0));
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(sx, sy, sw, sw);

        // Left-shadow gives the pile a 3-D rounded look
        ctx.fillStyle = 'rgba(0,0,0,0.20)';
        ctx.fillRect(sx, sy, sw * 0.28, sw);

        // Sunlit top edge
        if (isTop) {
          ctx.fillStyle = 'rgba(255,210,120,0.28)';
          ctx.fillRect(sx, sy, sw, sw * 0.35);
        }

        // Scattered dirt specks
        if ((n & 0x1c) === 0) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(sx + ((n & 3)) * sw * 0.25, sy + ((n >> 2) & 3) * sw * 0.25, sw * 0.22, sw * 0.22);
        }
      }
    }

    // ── Entrance tunnel mouth ──────────────────────────────────────────────
    // Draw a dark oval opening at the base of the mound where the tunnel exits.
    if (peakHeight > 0) {
      const [esx, esy] = camera.worldToScreen((CX + 0.5) * ts, SR * ts);
      const hw = sw * 1.6, hh = sw * 0.75; // half-widths of the entrance oval
      // Dark earth rim
      ctx.fillStyle = 'rgba(6,3,0,0.72)';
      ctx.beginPath();
      ctx.ellipse(esx, esy, hw, hh, 0, 0, Math.PI * 2);
      ctx.fill();
      // Inner void — the actual tunnel opening
      ctx.fillStyle = 'rgba(0,0,0,0.92)';
      ctx.beginPath();
      ctx.ellipse(esx, esy, hw * 0.58, hh * 0.58, 0, 0, Math.PI * 2);
      ctx.fill();
      // Faint amber rim light (sunlight catching the edge)
      ctx.strokeStyle = 'rgba(180,120,40,0.30)';
      ctx.lineWidth = sw * 0.18;
      ctx.beginPath();
      ctx.ellipse(esx, esy, hw, hh, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  _drawGlows(ctx, camera, world) {
    const ts   = CONFIG.TILE_SIZE;
    const zoom = camera.zoom;
    const sw   = ts * zoom;

    const [wx0, wy0] = camera.screenToWorld(-sw * 4, -sw * 4);
    const [wx1, wy1] = camera.screenToWorld(camera.cw + sw * 4, camera.ch + sw * 4);
    const tx0 = Math.max(0, Math.floor(wx0 / ts));
    const ty0 = Math.max(0, Math.floor(wy0 / ts));
    const tx1 = Math.min(world.width  - 1, Math.ceil(wx1 / ts));
    const ty1 = Math.min(world.height - 1, Math.ceil(wy1 / ts));

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = world.get(tx, ty);
        if (t !== TILE.FOOD && t !== TILE.WATER && t !== TILE.EGG) continue;

        const [sx, sy] = camera.worldToScreen((tx + 0.5) * ts, (ty + 0.5) * ts);

        if (t === TILE.FOOD) {
          ctx.fillStyle = 'rgba(255,185,20,0.22)';
          ctx.fillRect(sx - sw * 1.5, sy - sw * 1.5, sw * 3, sw * 3);
          ctx.fillStyle = 'rgba(255,185,20,0.10)';
          ctx.fillRect(sx - sw * 2.5, sy - sw * 2.5, sw * 5, sw * 5);
          ctx.fillStyle = 'rgba(255,185,20,0.04)';
          ctx.fillRect(sx - sw * 3.5, sy - sw * 3.5, sw * 7, sw * 7);
        } else if (t === TILE.WATER) {
          ctx.fillStyle = 'rgba(40,120,255,0.22)';
          ctx.fillRect(sx - sw * 1.5, sy - sw * 1.5, sw * 3, sw * 3);
          ctx.fillStyle = 'rgba(40,120,255,0.10)';
          ctx.fillRect(sx - sw * 2.5, sy - sw * 2.5, sw * 5, sw * 5);
          ctx.fillStyle = 'rgba(40,120,255,0.04)';
          ctx.fillRect(sx - sw * 3.5, sy - sw * 3.5, sw * 7, sw * 7);
        } else {
          ctx.fillStyle = 'rgba(235,215,155,0.16)';
          ctx.fillRect(sx - sw * 1.5, sy - sw * 1.5, sw * 3, sw * 3);
          ctx.fillStyle = 'rgba(235,215,155,0.07)';
          ctx.fillRect(sx - sw * 2.5, sy - sw * 2.5, sw * 5, sw * 5);
        }
      }
    }
  }

  _drawQueenGlow(ctx, camera, queen) {
    const ts       = CONFIG.TILE_SIZE;
    const [sx, sy] = camera.worldToScreen(queen.x * ts, queen.y * ts);
    const health   = queen.health / 100;

    // Slow heartbeat pulse — period ≈ 3 seconds
    const pulse  = 0.5 + 0.5 * Math.sin(Date.now() * 0.0021);
    const r0     = Math.max(22, (38 + pulse * 10) * camera.zoom);
    const r1     = Math.max(40, (65 + pulse * 18) * camera.zoom);
    const r2     = Math.max(65, (110 + pulse * 22) * camera.zoom);

    // Inner hot core — amber-white
    const g0 = ctx.createRadialGradient(sx, sy, 0, sx, sy, r0);
    g0.addColorStop(0,   `rgba(255,210,100,${(0.30 * health).toFixed(2)})`);
    g0.addColorStop(0.6, `rgba(255,160,40,${(0.18 * health).toFixed(2)})`);
    g0.addColorStop(1,   'rgba(255,120,20,0)');
    ctx.fillStyle = g0;
    ctx.fillRect(sx - r0, sy - r0, r0 * 2, r0 * 2);

    // Mid ring — deep orange halo
    const g1 = ctx.createRadialGradient(sx, sy, r0 * 0.5, sx, sy, r1);
    g1.addColorStop(0,   `rgba(255,100,10,${(0.12 * health).toFixed(2)})`);
    g1.addColorStop(0.5, `rgba(220,60,10,${(0.07 * health).toFixed(2)})`);
    g1.addColorStop(1,   'rgba(200,40,0,0)');
    ctx.fillStyle = g1;
    ctx.fillRect(sx - r1, sy - r1, r1 * 2, r1 * 2);

    // Outer atmospheric blush
    const g2 = ctx.createRadialGradient(sx, sy, r1 * 0.4, sx, sy, r2);
    g2.addColorStop(0,   `rgba(180,40,0,${(0.05 * health).toFixed(2)})`);
    g2.addColorStop(1,   'rgba(140,20,0,0)');
    ctx.fillStyle = g2;
    ctx.fillRect(sx - r2, sy - r2, r2 * 2, r2 * 2);
  }

  _drawCreatures(ctx, camera, creatures) {
    const ts   = CONFIG.TILE_SIZE;
    const zoom = camera.zoom;
    const u    = ts * zoom; // 1 tile in screen pixels

    for (const c of creatures) {
      const [sx, sy] = camera.worldToScreen(c.x * ts, c.y * ts);
      if (sx < -u * 4 || sx > camera.cw + u * 4) continue;

      ctx.save();
      ctx.translate(Math.round(sx), Math.round(sy));

      if (c.dead) {
        // Flat corpse — darkened outline
        ctx.globalAlpha = Math.max(0, 1 - c.corpseTimer / 300);
        ctx.fillStyle = '#1a1008';
        ctx.fillRect(-u * 1.5, -u * 0.4, u * 3, u * 0.8);
        // Food chunk dots remaining on corpse
        for (let f = 0; f < c.foodChunks; f++) {
          ctx.fillStyle = '#e8b820';
          ctx.fillRect((-1 + f * 0.6) * u, -u * 0.3, u * 0.4, u * 0.4);
        }
        ctx.globalAlpha = 1;
        ctx.restore();
        continue;
      }

      // Damage flash
      if (c.hitFlash > 0) {
        ctx.globalAlpha = 0.65 + Math.sin(c.hitFlash * 0.9) * 0.35;
      }

      // Walking leg offset for animation
      const leg = (c.animFrame & 1) ? u * 0.18 : -u * 0.18;
      const dir = c.vx >= 0 ? 1 : -1;
      ctx.scale(dir, 1); // flip to face direction of travel

      if (c.type === 'beetle') {
        // Shell (elytra) — dark iridescent oval
        ctx.fillStyle = c.hitFlash > 0 ? '#8a4020' : '#2a1e0c';
        ctx.fillRect(-u * 1.5, -u * 0.7, u * 3, u * 1.4);
        // Shell highlight seam
        ctx.fillStyle = '#3a2c18';
        ctx.fillRect(-u * 0.08, -u * 0.65, u * 0.16, u * 1.3);
        // Head
        ctx.fillStyle = '#1e1408';
        ctx.fillRect(u * 1.4, -u * 0.45, u * 0.8, u * 0.9);
        // Antennae
        ctx.fillStyle = '#3a2818';
        ctx.fillRect(u * 2.1, -u * 0.9, u * 0.12, u * 0.6);
        ctx.fillRect(u * 2.0, -u * 0.4, u * 0.9, u * 0.12);
        // 6 legs
        ctx.fillStyle = '#120e06';
        for (let i = -1; i <= 1; i++) {
          const lx = i * u * 0.8, lo = i === 0 ? 0 : leg;
          ctx.fillRect(lx - u * 0.08, u * 0.7 + lo, u * 0.16, u * 0.55);
          ctx.fillRect(lx - u * 0.08, -u * 0.7 - lo, u * 0.16, u * 0.55);
        }
        // HP bar
        const hpPct = c.hp / c.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-u * 1.5, -u * 1.2, u * 3, u * 0.22);
        ctx.fillStyle = hpPct > 0.5 ? '#40c840' : hpPct > 0.25 ? '#c8a020' : '#c82020';
        ctx.fillRect(-u * 1.5, -u * 1.2, u * 3 * hpPct, u * 0.22);

      } else if (c.type === 'spider') {
        // Abdomen (rear, larger)
        ctx.fillStyle = c.hitFlash > 0 ? '#6a2818' : '#1a1220';
        ctx.fillRect(-u * 1.1, -u * 0.7, u * 1.8, u * 1.4);
        // Cephalothorax (front, smaller)
        ctx.fillStyle = '#221828';
        ctx.fillRect(u * 0.7, -u * 0.5, u * 1.0, u * 1.0);
        // 8 eyes
        ctx.fillStyle = '#e87820';
        for (let i = 0; i < 4; i++) {
          ctx.fillRect(u * (0.82 + (i & 1) * 0.22), u * (-0.3 + Math.floor(i / 2) * 0.22), u * 0.14, u * 0.14);
        }
        // 8 legs (4 each side)
        ctx.fillStyle = '#100c14';
        for (let i = 0; i < 4; i++) {
          const lx = (-0.6 + i * 0.45) * u;
          const lo = (i & 1) ? leg : -leg;
          ctx.fillRect(lx, u * 0.7 + lo, u * 0.12, u * 0.8);
          ctx.fillRect(lx, -u * 0.7 - lo, u * 0.12, u * 0.8);
        }
        // HP bar
        const hpPct = c.hp / c.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-u * 1.1, -u * 1.2, u * 2.2, u * 0.22);
        ctx.fillStyle = hpPct > 0.5 ? '#40c840' : hpPct > 0.25 ? '#c8a020' : '#c82020';
        ctx.fillRect(-u * 1.1, -u * 1.2, u * 2.2 * hpPct, u * 0.22);

      } else if (c.type === 'earwig') {
        // Elongated body segments
        ctx.fillStyle = c.hitFlash > 0 ? '#7a3818' : '#2c1e10';
        ctx.fillRect(-u * 1.6, -u * 0.45, u * 3.2, u * 0.9);
        ctx.fillStyle = '#1e140a';
        for (let i = -1; i <= 1; i++) ctx.fillRect(i * u * 0.8, -u * 0.4, u * 0.1, u * 0.8);
        // Pincers at rear
        ctx.fillStyle = '#3a2818';
        ctx.fillRect(-u * 2.4, -u * 0.5, u * 0.8, u * 0.22);
        ctx.fillRect(-u * 2.4,  u * 0.28, u * 0.8, u * 0.22);
        // Head + antennae
        ctx.fillStyle = '#241808';
        ctx.fillRect(u * 1.6, -u * 0.35, u * 0.7, u * 0.7);
        ctx.fillStyle = '#3a2810';
        ctx.fillRect(u * 2.2, -u * 0.6, u * 0.55, u * 0.1);
        ctx.fillRect(u * 2.2,  u * 0.5, u * 0.55, u * 0.1);
        // 6 legs
        ctx.fillStyle = '#18100a';
        for (let i = -1; i <= 1; i++) {
          const lx = i * u * 0.7, lo = i === 0 ? 0 : leg;
          ctx.fillRect(lx, u * 0.45 + lo, u * 0.12, u * 0.55);
          ctx.fillRect(lx, -u * 0.45 - lo, u * 0.12, u * 0.55);
        }
        const hpPct = c.hp / c.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-u * 1.6, -u * 1.1, u * 3.2, u * 0.22);
        ctx.fillStyle = hpPct > 0.5 ? '#40c840' : hpPct > 0.25 ? '#c8a020' : '#c82020';
        ctx.fillRect(-u * 1.6, -u * 1.1, u * 3.2 * hpPct, u * 0.22);

      } else if (c.type === 'centipede') {
        // Long segmented body with many legs — drawn as 6 connected ovals
        const segs = 6, sw2 = u * 0.55;
        ctx.fillStyle = c.hitFlash > 0 ? '#8a2810' : '#1a1c0c';
        for (let s = 0; s < segs; s++) {
          const sx = (s - segs * 0.5 + 0.5) * sw2;
          const sy2 = (s % 2 === 0 ? 1 : -1) * u * 0.08; // slight undulation
          ctx.fillRect(sx - sw2 * 0.45, sy2 - u * 0.35, sw2 * 0.9, u * 0.7);
          // Pair of legs per segment
          ctx.fillStyle = '#0e1008';
          ctx.fillRect(sx - u * 0.08, u * 0.35 + sy2 + leg * 0.3, u * 0.12, u * 0.55);
          ctx.fillRect(sx - u * 0.08, -u * 0.35 + sy2 - leg * 0.3, u * 0.12, u * 0.55);
          ctx.fillStyle = c.hitFlash > 0 ? '#8a2810' : '#1a1c0c';
        }
        // Head with antennae
        const hx = segs * sw2 * 0.5;
        ctx.fillStyle = '#2a2810';
        ctx.fillRect(hx - u * 0.4, -u * 0.4, u * 0.7, u * 0.8);
        ctx.fillStyle = '#0e1008';
        ctx.fillRect(hx + u * 0.3, -u * 0.8, u * 0.1, u * 0.5);
        ctx.fillRect(hx + u * 0.3, u * 0.3, u * 0.1, u * 0.5);
        const hpPct = c.hp / c.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-u * 1.8, -u * 1.1, u * 3.6, u * 0.22);
        ctx.fillStyle = hpPct > 0.5 ? '#40c840' : hpPct > 0.25 ? '#c8a020' : '#c82020';
        ctx.fillRect(-u * 1.8, -u * 1.1, u * 3.6 * hpPct, u * 0.22);

      } else if (c.type === 'pillbug') {
        // Round armoured oval — curls up when badly hurt
        const curled = c.hp < c.maxHp * 0.35;
        const bodyW = curled ? u * 1.4 : u * 2.2;
        const bodyH = curled ? u * 1.4 : u * 0.9;
        ctx.fillStyle = c.hitFlash > 0 ? '#607820' : '#3a4818';
        ctx.fillRect(-bodyW * 0.5, -bodyH * 0.5, bodyW, bodyH);
        // Armour segments
        ctx.fillStyle = '#2a3410';
        for (let i = -1; i <= 1; i++)
          ctx.fillRect(i * bodyW * 0.28 - u * 0.05, -bodyH * 0.5, u * 0.1, bodyH);
        // Highlight top
        ctx.fillStyle = 'rgba(120,160,60,0.35)';
        ctx.fillRect(-bodyW * 0.5, -bodyH * 0.5, bodyW, bodyH * 0.3);
        // Tiny head
        if (!curled) {
          ctx.fillStyle = '#2a3010';
          ctx.fillRect(bodyW * 0.5 - u * 0.1, -u * 0.25, u * 0.4, u * 0.5);
          // Antennae
          ctx.fillStyle = '#1a2008';
          ctx.fillRect(bodyW * 0.5 + u * 0.2, -u * 0.4, u * 0.5, u * 0.1);
          ctx.fillRect(bodyW * 0.5 + u * 0.2,  u * 0.3, u * 0.5, u * 0.1);
          // Legs (tiny)
          ctx.fillStyle = '#1e2610';
          for (let i = -1; i <= 1; i++) {
            ctx.fillRect(i * u * 0.55, bodyH * 0.5, u * 0.1, u * 0.45);
            ctx.fillRect(i * u * 0.55, -bodyH * 0.5 - u * 0.45, u * 0.1, u * 0.45);
          }
        }
        const hpPct = c.hp / c.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-u * 1.2, -u * 1.2, u * 2.4, u * 0.22);
        ctx.fillStyle = hpPct > 0.5 ? '#40c840' : hpPct > 0.25 ? '#c8a020' : '#c82020';
        ctx.fillRect(-u * 1.2, -u * 1.2, u * 2.4 * hpPct, u * 0.22);

      } else if (c.type === 'cricket') {
        // Elongated body, large jumping rear legs
        ctx.fillStyle = c.hitFlash > 0 ? '#7a5820' : '#2e2810';
        ctx.fillRect(-u * 1.4, -u * 0.4, u * 2.2, u * 0.8); // body
        // Wing cover (slightly raised)
        ctx.fillStyle = '#3a3218';
        ctx.fillRect(-u * 0.6, -u * 0.5, u * 1.2, u * 0.18);
        // Head
        ctx.fillStyle = '#241e0c';
        ctx.fillRect(u * 0.8, -u * 0.38, u * 0.6, u * 0.75);
        // Long antennae
        ctx.fillStyle = '#1a1408';
        ctx.fillRect(u * 1.2, -u * 0.5, u * 0.12, u * 1.0);
        ctx.fillRect(u * 1.3, -u * 0.5, u * 0.8, u * 0.1);
        ctx.fillRect(u * 1.3,  u * 0.4, u * 0.8, u * 0.1);
        // Large rear jumping legs (L-shaped)
        ctx.fillStyle = '#1e1808';
        ctx.fillRect(-u * 1.4, -u * 0.35, u * 0.12, u * 0.7 + leg * 0.4);  // femur
        ctx.fillRect(-u * 1.4, u * 0.35 + leg * 0.4, u * 0.6, u * 0.12);    // tibia
        ctx.fillRect(-u * 1.4, -u * 0.35 - leg * 0.4, u * 0.6, u * 0.12);   // upper
        // Small front legs
        ctx.fillRect(u * 0.1, u * 0.4, u * 0.1, u * 0.45);
        ctx.fillRect(u * 0.5, u * 0.4, u * 0.1, u * 0.45);
        const hpPct = c.hp / c.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-u * 1.4, -u * 1.1, u * 2.8, u * 0.22);
        ctx.fillStyle = hpPct > 0.5 ? '#40c840' : hpPct > 0.25 ? '#c8a020' : '#c82020';
        ctx.fillRect(-u * 1.4, -u * 1.1, u * 2.8 * hpPct, u * 0.22);

      } else { // worm
        // Simple pink-brown segmented worm wriggling along
        const wave = Math.sin(c.animFrame * 1.2) * u * 0.15;
        ctx.fillStyle = c.hitFlash > 0 ? '#c07060' : '#8a5040';
        for (let s = 0; s < 5; s++) {
          const sx = (s - 2.5) * u * 0.45;
          const sy2 = (s % 2 === 0 ? wave : -wave);
          ctx.fillRect(sx - u * 0.2, sy2 - u * 0.22, u * 0.42, u * 0.44);
        }
        // Tip / head
        ctx.fillStyle = '#a06050';
        ctx.fillRect(u * 0.8, -u * 0.18, u * 0.3, u * 0.36);
        const hpPct = c.hp / c.maxHp;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-u * 1.1, -u * 0.9, u * 2.2, u * 0.2);
        ctx.fillStyle = hpPct > 0.5 ? '#40c840' : hpPct > 0.25 ? '#c8a020' : '#c82020';
        ctx.fillRect(-u * 1.1, -u * 0.9, u * 2.2 * hpPct, u * 0.2);
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  _drawFrame(camera, world) {
    const ctx = this.ctx;
    const ts = CONFIG.TILE_SIZE;
    const W = world.width, H = world.height;
    const GT = CONFIG.GLASS_THICKNESS;

    const [x0, y0] = camera.worldToScreen(0, 0);
    const [x1, y1] = camera.worldToScreen(W * ts, H * ts);
    const bw = GT * ts * camera.zoom;

    ctx.strokeStyle = 'rgba(100,200,240,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + bw * 0.5, y0 + bw * 0.5, (x1 - x0) - bw, (y1 - y0) - bw);

    ctx.fillStyle = 'rgba(150,220,255,0.6)';
    const cs = 5;
    ctx.fillRect(x0, y0, cs, cs);
    ctx.fillRect(x1 - cs, y0, cs, cs);
    ctx.fillRect(x0, y1 - cs, cs, cs);
    ctx.fillRect(x1 - cs, y1 - cs, cs, cs);
  }

  _drawZoomHint(ctx, camera, w, h) {
    const pct = Math.round(camera.zoom * 100);
    const lod = camera.lodLevel;
    const lodColors = { far: '#6688aa', tiny: '#aabb88', mid: '#88aa66', close: '#aa8866' };
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(8, h - 38, 78, 32);
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = lodColors[lod];
    ctx.fillText(`[${lod}]`, 12, h - 24);
    ctx.fillStyle = '#8acce8';
    ctx.fillText(`zoom ${pct}%`, 12, h - 12);
  }

  resize(w, h) {
    this.canvas.width = w;
    this.canvas.height = h;
    this._firstFrame = true;
  }
}
