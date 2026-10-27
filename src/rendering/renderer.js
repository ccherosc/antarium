import { renderWorld, drawWorldToScreen, forceFullRedraw, renderPheromoneOverlay } from './renderWorld.js';
import { renderAnts } from './renderAnts.js';
import { drawSky, drawSurface, glowSprite, hash } from './renderSky.js';
import { drawCreatures } from './renderCreatures.js';
import { Effects } from './effects.js';
import { CONFIG, ROOM } from '../config.js';

const TS = CONFIG.TILE_SIZE;
const GT = CONFIG.GLASS_THICKNESS;
const SR = CONFIG.SURFACE_ROW;
const CX = CONFIG.COLONY_X;

const SEEDS = ['#e8b830', '#d89a28', '#f0d060', '#b87820', '#a8b040'];

// The case the glass sits in, and what it stands on
const WOOD = {
  edge: '#1c130b', body: '#3a2817', lip: '#5b4126',
  base: '#2c1e11', baseTop: '#4a3420',
  shelf: '#46311c', shelfTop: '#6b4d2c',
  brass: '#b8923c', brassEdge: '#6a5020', engraved: '#3a2a10',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = canvas.width;     // the size the farm is laid out in, in window pixels (see resize)
    this.h = canvas.height;
    this.effects = new Effects();
    this.t = 0;          // seconds of real time, for whatever sways, pulses or twinkles
    this.drift = 0;      // how far the clouds have blown
    this.hud = true;     // the zoom read-out; switched off while the farm is left to itself
    this._zoom = null;   // what the read-out last saw, and when it last changed
    this._zoomT = -9;
    this._firstFrame = true;
    this._vignette = null;
    this._decor = [];    // fungus-garden mushrooms, rebuilt when the rooms change
    this._decorVer = -1;
  }

  // alpha: how far this frame falls between two simulation ticks
  render(camera, sim, alpha = 1, frameMs = 16, speed = 1) {
    const { world, sky, antSystem, queen, creatures } = sim;
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    // Everything below is laid out in window pixels; this maps them onto the canvas's own
    ctx.setTransform(this.canvas.width / w, 0, 0, this.canvas.height / h, 0, 0);

    const dt = Math.min(0.1, frameMs / 1000);
    this.t += dt;
    this.drift += dt * speed;
    this.effects.update(sim, dt * Math.min(1, speed));

    this._drawRoom(ctx, camera, world, sky, w, h);

    if (this._firstFrame) {
      forceFullRedraw(world);
      this._firstFrame = false;
    }

    // The sky goes down first: the world canvas is clear above the ground line
    drawSky(ctx, camera, world, sky, this.t, this.drift);
    drawWorldToScreen(ctx, renderWorld(camera, world), camera);
    this._drawLight(ctx, camera, world, sky);

    // Whatever lives in the farm stays behind its glass: the grass grows right up
    // to it, a visitor walks in from behind the frame, and the winged ants are lost
    // to sight at the top of it
    const [gx, gy] = camera.worldToScreen(GT * TS, GT * TS);
    const [hx, hy] = camera.worldToScreen((world.width - GT) * TS, (world.height - GT) * TS);
    ctx.save();
    ctx.beginPath();
    ctx.rect(gx, gy, hx - gx, hy - gy);
    ctx.clip();

    drawSurface(ctx, camera, world, sky, this.t);

    const pherCanvas = renderPheromoneOverlay(world);
    if (pherCanvas) {
      const [sx, sy] = camera.worldToScreen(0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        pherCanvas, sx, sy,
        pherCanvas.width  * TS * camera.zoom,
        pherCanvas.height * TS * camera.zoom
      );
    }

    this._drawGlows(ctx, camera, sim);
    this._drawRooms(ctx, camera, world);

    renderAnts(ctx, antSystem, queen, camera, alpha, this.t);
    if (creatures) drawCreatures(ctx, camera, creatures.creatures);
    this.effects.draw(ctx, camera, sim);

    ctx.restore();

    this._drawFrame(camera, world);
    this._drawVignette(ctx, w, h);
    this._drawZoom(ctx, camera);
  }

  // The room the farm stands in: a wall, a shelf, and the wooden case round the glass
  _drawRoom(ctx, camera, world, sky, w, h) {
    ctx.fillStyle = '#0a0d13';
    ctx.fillRect(0, 0, w, h);

    const u = TS * camera.zoom, W = world.width, H = world.height;
    const [ox, oy] = camera.worldToScreen(0, 0);
    const X = x => Math.round(ox + x * u), Y = y => Math.round(oy + y * u);
    if (X(0) <= 0 && Y(0) <= 0 && X(W) >= w && Y(H) >= h) return;   // nothing but farm in view

    const box = (c, x0, y0, x1, y1) => {
      ctx.fillStyle = c;
      ctx.fillRect(X(x0), Y(y0), X(x1) - X(x0), Y(y1) - Y(y0));
    };
    // a band running round the farm, from a to b tiles out from the glass
    const ring = (c, a, b) => {
      box(c, -b, -b, W + b, -a);
      box(c, -b, H + a, W + b, H + b);
      box(c, -b, -a, -a, H + a);
      box(c, W + a, -a, W + b, H + a);
    };

    // lamplight on the wall behind
    const lx = X(W / 2), ly = Y(H * 0.42);
    const lamp = ctx.createRadialGradient(lx, ly, 0, lx, ly, W * 0.8 * u);
    lamp.addColorStop(0, 'rgba(84,100,138,0.3)');
    lamp.addColorStop(1, 'rgba(84,100,138,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, w, h);

    // the shelf, edge on, and the dark under it
    const st = Y(H + 6), sb = Y(H + 8.4);
    const under = ctx.createLinearGradient(0, sb, 0, sb + 10 * u);
    under.addColorStop(0, 'rgba(0,0,0,0.62)');
    under.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = under;
    ctx.fillRect(0, sb, w, 10 * u);
    ctx.fillStyle = WOOD.shelf;
    ctx.fillRect(0, st, w, sb - st);
    ctx.fillStyle = WOOD.shelfTop;
    ctx.fillRect(0, st, w, Math.max(1, Math.round(u * 0.4)));
    ctx.fillStyle = WOOD.edge;
    ctx.fillRect(0, sb - Math.max(1, Math.round(u * 0.3)), w, Math.max(1, Math.round(u * 0.3)));

    // the plinth, with its brass plate
    box(WOOD.base, -4, H + 2, W + 4, H + 6);
    box(WOOD.baseTop, -4, H + 2, W + 4, H + 2.5);
    box(WOOD.edge, -4, H + 5.5, W + 4, H + 6);
    box(WOOD.brassEdge, W / 2 - 19, H + 2.9, W / 2 + 19, H + 5.2);
    box(WOOD.brass, W / 2 - 18.6, H + 3.2, W / 2 + 18.6, H + 4.9);
    if (u >= 4) {
      ctx.font = `bold ${Math.round(u * 1.4)}px 'Courier New', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = WOOD.engraved;
      ctx.fillText('P I X E L   A N T S', X(W / 2), (Y(H + 3.2) + Y(H + 4.9)) / 2 + 0.5);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    }

    // the frame
    ring(WOOD.body, 0, 2);
    ring(WOOD.lip, 0, 0.4);
    ring(WOOD.edge, 1.6, 2);

    // the room dims with the day
    const dark = (1 - sky.light) * 0.5;
    if (dark > 0.01) {
      ctx.fillStyle = `rgba(3,4,10,${dark})`;
      ctx.fillRect(0, 0, w, h);
    }
  }

  // Daylight soaking into the topsoil; the blue of night over everything below ground
  _drawLight(ctx, camera, world, sky) {
    const u = TS * camera.zoom;
    const [ox, oy] = camera.worldToScreen(0, 0);
    const x = ox + GT * u, w = (world.width - GT * 2) * u;
    const y = oy + SR * u, h = (world.height - GT - SR) * u;

    const sun = sky.light * (1 - 0.75 * sky.overcast);
    if (sun > 0.02) {
      const g = ctx.createLinearGradient(0, y, 0, y + 14 * u);
      g.addColorStop(0, `rgba(255,214,140,${0.2 * sun})`);
      g.addColorStop(1, 'rgba(255,214,140,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, 14 * u);
    }

    const dark = (1 - sky.light) * 0.44 + sky.overcast * sky.light * 0.12;
    if (dark > 0.01) {
      ctx.fillStyle = `rgba(6,9,32,${dark})`;
      ctx.fillRect(x, y, w, h);
    }
  }

  // Light that the nest makes for itself. It is always there, but it is after dark,
  // with the soil dimmed, that it shows.
  _drawGlows(ctx, camera, sim) {
    const { world, sky, queen } = sim;
    const u = TS * camera.zoom, W = world.width, t = this.t;
    const [ox, oy] = camera.worldToScreen(0, 0);
    const cw = camera.cw, ch = camera.ch;
    const k = 0.5 + 0.5 * (1 - sky.light);

    const glow = (sprite, x, y, rx, ry, a) => {
      if (a <= 0.004) return;
      const sx = ox + x * u, sy = oy + y * u, w = rx * u, h = ry * u;
      if (sx + w < 0 || sx - w > cw || sy + h < 0 || sy - h > ch) return;
      ctx.globalAlpha = Math.min(1, a);
      ctx.drawImage(sprite, sx - w, sy - h, w * 2, h * 2);
    };

    const gold  = glowSprite(255, 190, 90);
    const cream = glowSprite(255, 216, 176);
    const amber = glowSprite(255, 166, 56);
    const teal  = glowSprite(70, 232, 200);
    const blue  = glowSprite(90, 170, 255);

    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;

    for (const c of world.chambers) {
      if (!c.built) continue;
      const x = c.cx + 0.5, y = c.cy + 0.5, rx = c.rx * 2.3 + 2, ry = c.ry * 2.3 + 2;
      if (c.type === ROOM.QUEEN) {
        glow(gold, x, y, rx, ry, (0.36 + 0.04 * Math.sin(t * 1.3) + queen.layPulse * 0.22) * k);
      } else if (c.type === ROOM.NURSERY) {
        glow(cream, x, y, rx, ry, (0.07 + 0.25 * Math.min(1, c.brood / Math.max(1, c.cap))) * k);
      } else if (c.type === ROOM.FOOD) {
        glow(amber, x, y, rx, ry, (0.06 + 0.22 * Math.min(1, c.held / Math.max(1, c.cap))) * k);
      } else if (c.type === ROOM.DEEP) {
        glow(teal, x, y, rx, ry, (0.2 + 0.07 * Math.sin(t * 0.7 + c.id * 1.9)) * k);
      }
    }

    // The queen herself, brightest as an egg is laid
    glow(gold, queen.x, queen.y, 5, 5, 0.3 + queen.layPulse * 0.5);

    // Food and water lying about underground
    for (const i of world.foodTiles) {
      const y = (i / W) | 0;
      if (y >= SR) glow(amber, i % W + 0.5, y + 0.5, 2.6, 2.6, 0.09 * k);   // a seam of them adds up
    }
    for (const i of world.waterTiles) {
      const y = (i / W) | 0;
      if (y >= SR) glow(blue, i % W + 0.5, y + 0.6, 2.4, 2, 0.11 * k);
    }

    // Mushroom caps in the fungus gardens
    if (u >= 2) {
      for (const m of this._mushrooms(world)) {
        glow(teal, m.x, m.y - m.h, 1.3, 1.3, (0.3 + 0.2 * Math.sin(t * 1.1 + m.p)) * k);
      }
    }

    // After dark a little warmth spills from the way in
    glow(amber, CX + 1, SR + 0.4, 6, 3.4, 0.3 * (1 - sky.light));

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Where the mushrooms grow: floor tiles of the fungus gardens
  _mushrooms(world) {
    if (this._decorVer === world.roomVersion) return this._decor;
    this._decorVer = world.roomVersion;
    const W = world.width, out = this._decor = [];
    for (const c of world.chambers) {
      if (!c.built || c.type !== ROOM.DEEP) continue;
      for (const i of c.tiles) {
        if (world.passable[i + W]) continue;      // only where there is a floor to grow on
        const n = hash(i * 7 + 3);
        if (n > 0.55) continue;
        out.push({ x: i % W + 0.3 + hash(i * 7 + 4) * 0.4, y: ((i / W) | 0) + 1,
                   h: 0.45 + hash(i * 7 + 5) * 0.75, p: n * 40 });
      }
    }
    return out;
  }

  // What the rooms hold: the food piled in the stores, the gardens' mushrooms
  _drawRooms(ctx, camera, world) {
    const u = TS * camera.zoom, W = world.width;
    const [ox, oy] = camera.worldToScreen(0, 0);
    const cw = camera.cw, ch = camera.ch;

    for (const c of world.chambers) {
      if (!c.built || c.type !== ROOM.FOOD || c.held <= 0) continue;
      const sx = ox + c.cx * u, sy = oy + c.cy * u, r = (c.rx + c.ry + 3) * u;
      if (sx + r < 0 || sx - r > cw || sy + r < 0 || sy - r > ch) continue;
      const n = Math.min(c.floor.length, Math.ceil(c.held / CONFIG.STORE_PER_TILE));
      if (u < 2.4) {
        // far off, the pile is just a band of gold on the floor
        ctx.fillStyle = '#d8a02c';
        for (let k = 0; k < n; k++) {
          const i = c.floor[k];
          ctx.fillRect(ox + (i % W) * u, oy + (((i / W) | 0) + 0.25) * u, u + 0.5, u * 0.75 + 0.5);
        }
        continue;
      }
      const s = u * 0.44;
      for (let k = 0; k < n; k++) {
        const i = c.floor[k], x = i % W, y = (i / W) | 0;
        for (let j = 0; j < 3; j++) {
          const a = hash(i * 5 + j), b = hash(i * 5 + j + 3);
          ctx.fillStyle = SEEDS[(a * 23 | 0) % SEEDS.length];
          ctx.fillRect(ox + (x + 0.08 + a * 0.84) * u - s / 2, oy + (y + 0.22 + b * 0.62) * u - s / 2, s, s * 0.8);
        }
      }
    }

    if (u < 2) return;
    const sw = Math.max(1, u * 0.14);
    for (const m of this._mushrooms(world)) {
      const sx = ox + m.x * u, sy = oy + m.y * u;
      if (sx < -u * 2 || sx > cw + u * 2 || sy < -u * 2 || sy > ch + u * 2) continue;
      const mh = m.h * u;
      ctx.fillStyle = '#b4d8cc';
      ctx.fillRect(sx - sw / 2, sy - mh, sw, mh);
      ctx.fillStyle = '#4ed8b8';
      ctx.fillRect(sx - u * 0.3, sy - mh - u * 0.14, u * 0.6, Math.max(1, u * 0.24));
      ctx.fillStyle = '#b8fff0';
      ctx.fillRect(sx - u * 0.16, sy - mh - u * 0.14, u * 0.2, Math.max(1, u * 0.1));
    }
  }

  _drawFrame(camera, world) {
    const ctx = this.ctx;
    const W = world.width, H = world.height;

    const [x0, y0] = camera.worldToScreen(0, 0);
    const [x1, y1] = camera.worldToScreen(W * TS, H * TS);
    const bw = GT * TS * camera.zoom;

    // Light catching the glass
    const g = ctx.createLinearGradient(x0, y0, x0 + (y1 - y0) * 0.9, y1);
    g.addColorStop(0.00, 'rgba(255,255,255,0)');
    g.addColorStop(0.16, 'rgba(255,255,255,0.045)');
    g.addColorStop(0.24, 'rgba(255,255,255,0)');
    g.addColorStop(0.31, 'rgba(255,255,255,0.03)');
    g.addColorStop(0.35, 'rgba(255,255,255,0)');
    g.addColorStop(1.00, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0 + bw, y0 + bw, (x1 - x0) - bw * 2, (y1 - y0) - bw * 2);

    ctx.strokeStyle = 'rgba(120,190,230,0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0 + bw * 0.5, y0 + bw * 0.5, (x1 - x0) - bw, (y1 - y0) - bw);
  }

  // Darkened corners draw the eye to the middle of the farm
  _drawVignette(ctx, w, h) {
    if (!this._vignette) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.hypot(w, h) * 0.58);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.42)');
      this._vignette = g;
    }
    ctx.fillStyle = this._vignette;
    ctx.fillRect(0, 0, w, h);
  }

  // The zoom, shown for a moment whenever it changes
  _drawZoom(ctx, camera) {
    if (this._zoom !== camera.zoom) {
      if (this._zoom !== null && this.hud) this._zoomT = this.t;
      this._zoom = camera.zoom;
    }
    const a = Math.min(1, (this._zoomT + 1.6 - this.t) / 0.5);
    if (a <= 0 || !this.hud) return;
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(14,10,6,0.72)';
    ctx.fillRect(12, 12, 82, 22);
    ctx.font = "11px 'Courier New', monospace";
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c8a870';
    ctx.fillText(`zoom ${Math.round(camera.zoom * 100)}%`, 20, 27);
    ctx.globalAlpha = 1;
  }

  // w x h is the window, which is what the camera, the HUD and the mouse all work in. The canvas holds
  // `scale` times as many pixels each way (low quality draws fewer) and is stretched back up to w x h.
  resize(w, h, scale = 1) {
    this.w = w;
    this.h = h;
    this.canvas.width  = Math.max(1, Math.round(w * scale));
    this.canvas.height = Math.max(1, Math.round(h * scale));
    this.canvas.style.width  = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this._firstFrame = true;
    this._vignette = null;
  }
}
