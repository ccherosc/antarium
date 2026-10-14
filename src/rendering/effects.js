import { CONFIG } from '../config.js';
import { hash, glowSprite } from './renderSky.js';

const TS = CONFIG.TILE_SIZE;
const GT = CONFIG.GLASS_THICKNESS;
const SR = CONFIG.SURFACE_ROW;
const CX = CONFIG.COLONY_X;

const rnd = (a, b) => a + Math.random() * (b - a);
const WING = ['#f6f2e6', '#f4d458', '#9cc8f4', '#f0a0b8'];

// Short-lived things drawn over the world: puffs of dust, hatching sparkles, rain and
// the water it sends down the entrance shaft, fireflies after dark, butterflies by day.
// Positions are in tiles, times in seconds.
export class Effects {
  constructor() {
    this.t = 0;
    this.parts  = [];   // specks: { x, y, vx, vy, g, life, max, r, c }
    this.sparks = [];   // the same, drawn as light
    this.rings  = [];   // { x, y, life, max }
    this.drips  = [];   // water running down into the nest: { x, y, vy, slide, life }
    this.flash  = 0;    // lightning, 1 → 0
    this.bolt   = null;
    this._again = 0;
    this._splash = 0;
    this._drip = 0;
  }

  // dt: seconds since the last frame (0 while the simulation is paused)
  update(sim, dt) {
    const { world, sky } = sim;
    const W = world.width;
    this.t += dt;

    // Whatever happened in the simulation since the last frame
    const fx = world.fx;
    for (let i = Math.max(0, fx.length - 30); i < fx.length; i++) this._spawn(fx[i]);
    fx.length = 0;

    if (sky.rain > 0.05) {
      // Drops bursting on the ground…
      this._splash += dt * sky.rain * 80;
      while (this._splash >= 1) {
        this._splash--;
        const x = rnd(GT + 1, W - GT - 1);
        this.parts.push({ x, y: SR - world.hillH[x | 0], vx: rnd(-1.4, 1.4), vy: rnd(-3.4, -1.6), g: 16,
                          life: 0, max: rnd(0.16, 0.3), r: 0.13, c: '#d4e6ff' });
      }
      // …and running down the entrance shaft
      if (sky.rain > 0.25) {
        this._drip += dt * sky.rain * 10;
        while (this._drip >= 1) {
          this._drip--;
          if (this.drips.length < 70) {
            this.drips.push({ x: CX + rnd(0.15, 1.85), y: SR - 0.7, vy: rnd(2, 5), slide: 0, life: 0 });
          }
        }
      }
      // Now and then a storm throws some lightning
      if (sky.rain > 0.6 && this.flash < 0.02 && Math.random() < dt * 0.06) this._strike(world);
    }

    if (this._again > 0 && (this._again -= dt) <= 0) this.flash = Math.max(this.flash, 0.75);
    this.flash *= Math.exp(-dt * 6);
    if (this.flash < 0.01) { this.flash = 0; this.bolt = null; }

    this._move(this.parts, dt);
    this._move(this.sparks, dt);

    const R = this.rings;
    for (let i = R.length - 1; i >= 0; i--) {
      if ((R[i].life += dt) >= R[i].max) R.splice(i, 1);
    }

    // Water finds its way down: it falls, runs along a step to the next drop, and
    // is gone when it reaches level ground
    const D = this.drips, P = world.passable;
    for (let i = D.length - 1; i >= 0; i--) {
      const d = D[i];
      d.life += dt;
      if (d.slide) {
        const step = Math.sign(d.slide) * Math.min(Math.abs(d.slide), 7 * dt);
        d.x += step;
        d.slide -= step;
        continue;
      }
      d.vy = Math.min(17, d.vy + 24 * dt);
      const ny = d.y + d.vy * dt;
      const tx = d.x | 0, ty = Math.floor(ny + 0.35);
      if (ty < SR || P[ty * W + tx]) { d.y = ny; continue; }
      const l = P[ty * W + tx - 1] && P[(ty - 1) * W + tx - 1];
      const r = P[ty * W + tx + 1] && P[(ty - 1) * W + tx + 1];
      if ((l || r) && d.life < 9) {
        d.slide = (l && r ? (Math.random() < 0.5 ? -1 : 1) : l ? -1 : 1) * (0.6 + Math.random() * 0.5);
        d.y = ty - 0.36;
        d.vy = 2;
      } else {
        for (let k = 0; k < 2; k++) {
          this.parts.push({ x: d.x, y: ty - 0.1, vx: rnd(-1.6, 1.6), vy: rnd(-2.6, -1), g: 15,
                            life: 0, max: rnd(0.18, 0.34), r: 0.14, c: '#9cccff' });
        }
        D.splice(i, 1);
      }
    }
  }

  _move(list, dt) {
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if ((p.life += dt) >= p.max) { list.splice(i, 1); continue; }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (list.length > 400) list.splice(0, list.length - 400);
  }

  _spawn(e) {
    const P = this.parts;
    if (e.t === 'dust') {            // a tile of soil gives way
      for (let k = 0; k < 6; k++) {
        P.push({ x: e.x + rnd(-0.4, 0.4), y: e.y + rnd(-0.4, 0.4), vx: rnd(-1.8, 1.8), vy: rnd(-2.4, 0.4), g: 7,
                 life: 0, max: rnd(0.35, 0.85), r: rnd(0.14, 0.27), c: k & 1 ? '#caa878' : '#8c6a40' });
      }
    } else if (e.t === 'drop') {     // a load of dirt lands on the mound
      for (let k = 0; k < 3; k++) {
        P.push({ x: e.x + rnd(-0.3, 0.3), y: e.y, vx: rnd(-1.5, 1.5), vy: rnd(-2.6, -0.8), g: 10,
                 life: 0, max: rnd(0.3, 0.6), r: rnd(0.14, 0.24), c: k ? '#b48c56' : '#d6b27c' });
      }
    } else if (e.t === 'death') {    // an ant's time is up
      for (let k = 0; k < 4; k++) {
        P.push({ x: e.x + rnd(-0.3, 0.3), y: e.y + rnd(-0.3, 0.3), vx: rnd(-0.5, 0.5), vy: rnd(-1, -0.3), g: 0,
                 life: 0, max: rnd(0.9, 1.6), r: 0.16, c: '#a09a8e' });
      }
    } else if (e.t === 'hatch') {    // a new ant
      for (let k = 0; k < 8; k++) {
        this.sparks.push({ x: e.x, y: e.y, vx: rnd(-1.4, 1.4), vy: rnd(-1.9, 0.3), g: -0.6,
                           life: 0, max: rnd(0.7, 1.4), r: rnd(0.12, 0.2), c: '#fff2b8' });
      }
      this.rings.push({ x: e.x, y: e.y, life: 0, max: 0.8 });
    }
  }

  _strike(world) {
    this.flash = 1;
    this._again = rnd(0.07, 0.16);
    const pts = [];
    let x = rnd(GT + 12, world.width - GT - 12);
    for (let y = GT; y < SR - 1; y += rnd(1.6, 3.2)) {
      pts.push([x, y]);
      x = Math.max(GT + 1, Math.min(world.width - GT - 2, x + rnd(-2.6, 2.6)));
    }
    pts.push([x, SR - world.hillH[Math.max(0, Math.min(world.width - 1, x | 0))]]);
    this.bolt = pts;
  }

  draw(ctx, camera, sim) {
    const { world, sky } = sim;
    const u = TS * camera.zoom, W = world.width, t = this.t;
    const [ox, oy] = camera.worldToScreen(0, 0);
    const X = x => ox + x * u, Y = y => oy + y * u;
    ctx.imageSmoothingEnabled = true;

    // ── Butterflies over the flowers by day ──
    const day = Math.max(0, Math.min(1, (sky.light * (1 - sky.overcast) - 0.55) * 4));
    if (day > 0 && u >= 1.6) {
      ctx.globalAlpha = day;
      for (let i = 0; i < 4; i++) {
        const x = GT + 20 + hash(i * 9 + 301) * (W - GT * 2 - 40)
                + Math.sin(t * (0.09 + hash(i * 9 + 302) * 0.08) + i * 2.4) * 14 + Math.sin(t * 0.9 + i) * 1.2;
        const y = world.groundY(x) - 1.6 - (0.5 + 0.5 * Math.sin(t * (0.31 + hash(i * 9 + 303) * 0.2) + i * 1.3)) * 4
                + Math.sin(t * 5 + i) * 0.25;
        const flap = Math.abs(Math.sin(t * 9 + i * 1.7));
        const ww = u * (0.14 + 0.72 * flap), wh = u * 1.05, bx = X(x), by = Y(y);
        ctx.fillStyle = WING[i % WING.length];
        ctx.fillRect(bx - ww, by - wh * 0.55, ww * 2, wh * 0.6);                // forewings
        ctx.fillRect(bx - ww * 0.7, by + wh * 0.05, ww * 1.4, wh * 0.4);        // hindwings
        if (u >= 5) {
          ctx.fillStyle = 'rgba(255,255,255,0.55)';
          ctx.fillRect(bx - ww * 0.72, by - wh * 0.38, ww * 0.32, wh * 0.22);
          ctx.fillRect(bx + ww * 0.4, by - wh * 0.38, ww * 0.32, wh * 0.22);
        }
        ctx.fillStyle = '#2a1c10';
        ctx.fillRect(bx - Math.max(0.5, u * 0.07), by - wh * 0.55, Math.max(1, u * 0.14), wh);
      }
      ctx.globalAlpha = 1;
    }

    // ── Rain ──
    if (sky.rain > 0.02) {
      const n = (sky.rain * 180) | 0, slant = 0.24, len = 1.7;
      ctx.save();
      ctx.beginPath();
      ctx.rect(X(GT), Y(GT), (W - GT * 2) * u, (SR - GT) * u);
      ctx.clip();
      ctx.strokeStyle = `rgba(200,222,255,${0.2 + 0.3 * sky.rain})`;
      ctx.lineWidth = Math.max(1, u * 0.13);
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = GT + hash(i * 3 + 7) * (W - GT * 2);
        const top = SR - world.hillH[x | 0];
        const f = (hash(i * 3 + 8) + t * (1.5 + hash(i * 3 + 9) * 0.9)) % 1;
        const y1 = GT + f * (top - GT + len);
        const ya = Math.max(GT, y1 - len), yb = Math.min(top, y1);
        if (yb <= ya) continue;
        ctx.moveTo(X(x + (ya - top) * slant), Y(ya));
        ctx.lineTo(X(x + (yb - top) * slant), Y(yb));
      }
      ctx.stroke();
      ctx.restore();
    }

    // ── Specks ──
    for (const p of this.parts) {
      const s = Math.max(1, p.r * u);
      ctx.globalAlpha = 1 - p.life / p.max;
      ctx.fillStyle = p.c;
      ctx.fillRect(X(p.x) - s / 2, Y(p.y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;

    // ── Water trickling down the shaft ──
    if (this.drips.length) {
      const dw = Math.max(1, u * 0.24), dh = Math.max(2, u * 0.7);
      ctx.fillStyle = 'rgba(150,204,255,0.9)';
      for (const d of this.drips) ctx.fillRect(X(d.x) - dw / 2, Y(d.y) - dh * (d.slide ? 0.35 : 1), d.slide ? dh * 0.8 : dw, d.slide ? dw : dh);
    }

    // ── Light: hatching sparkles and fireflies ──
    const night = (1 - sky.light) * (1 - sky.rain);
    if (this.sparks.length || this.rings.length || night > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      const warm = glowSprite(255, 236, 160);
      for (const p of this.sparks) {
        const a = 1 - p.life / p.max, s = Math.max(1, p.r * u), gs = s * 5;
        ctx.globalAlpha = a * 0.7;
        ctx.drawImage(warm, X(p.x) - gs / 2, Y(p.y) - gs / 2, gs, gs);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.c;
        ctx.fillRect(X(p.x) - s / 2, Y(p.y) - s / 2, s, s);
      }
      ctx.strokeStyle = '#fff2b8';
      ctx.lineWidth = Math.max(1, u * 0.14);
      for (const r of this.rings) {
        const f = r.life / r.max;
        ctx.globalAlpha = (1 - f) * 0.7;
        ctx.beginPath();
        ctx.arc(X(r.x), Y(r.y), (0.4 + 2.3 * f) * u, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (night > 0.05) {
        const green = glowSprite(190, 255, 110);
        ctx.fillStyle = '#f0ffc0';
        for (let i = 0; i < 16; i++) {
          let blink = Math.sin(t * (0.9 + hash(i * 9 + 204) * 0.8) + i * 3.1);
          if (blink <= 0) continue;
          blink *= blink;
          const x = GT + 13 + hash(i * 9 + 201) * (W - GT * 2 - 26)
                  + Math.sin(t * (0.11 + hash(i * 9 + 202) * 0.12) + i) * 9 + Math.sin(t * 0.53 + i * 2.1) * 1.5;
          const y = world.groundY(x) - 1 - (0.5 + 0.5 * Math.sin(t * (0.23 + hash(i * 9 + 203) * 0.2) + i * 1.7)) * 5;
          const gs = Math.max(6, u * 3.4), s = Math.max(1, u * 0.22);
          ctx.globalAlpha = night * blink * 0.85;
          ctx.drawImage(green, X(x) - gs / 2, Y(y) - gs / 2, gs, gs);
          ctx.fillRect(X(x) - s / 2, Y(y) - s / 2, s, s);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // ── Lightning ──
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(232,240,255,${this.flash * 0.5})`;
      ctx.fillRect(X(GT), Y(GT), (W - GT * 2) * u, (SR - GT) * u);
      ctx.fillStyle = `rgba(232,240,255,${this.flash * 0.07})`;
      ctx.fillRect(X(GT), Y(SR), (W - GT * 2) * u, (world.height - GT - SR) * u);
      if (this.bolt && this.flash > 0.3) {
        ctx.strokeStyle = `rgba(255,255,255,${Math.min(1, this.flash * 1.4)})`;
        ctx.lineWidth = Math.max(1.5, u * 0.3);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        this.bolt.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
        ctx.stroke();
      }
    }
  }
}
