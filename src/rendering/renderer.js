import { renderWorld, drawWorldToScreen, forceFullRedraw, renderPheromoneOverlay } from './renderWorld.js';
import { renderAnts } from './renderAnts.js';
import { TILE, CONFIG } from '../config.js';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._firstFrame = true;
  }

  render(camera, world, antSystem, queen) {
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
    const ts     = CONFIG.TILE_SIZE;
    const [sx, sy] = camera.worldToScreen(queen.x * ts, queen.y * ts);
    const health = queen.health / 100;
    const radius = Math.max(28, 55 * camera.zoom);

    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius);
    grad.addColorStop(0,    `rgba(255,130,20,${(0.24 * health).toFixed(2)})`);
    grad.addColorStop(0.45, `rgba(255,110,10,${(0.12 * health).toFixed(2)})`);
    grad.addColorStop(1,    'rgba(255,90,0,0)');

    ctx.fillStyle = grad;
    ctx.fillRect(sx - radius, sy - radius, radius * 2, radius * 2);
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
    const lodColors = { far: '#6688aa', mid: '#88aa66', close: '#aa8866' };
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
