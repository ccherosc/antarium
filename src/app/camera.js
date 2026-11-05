import { CONFIG } from '../config.js';
import { rules } from '../modes.js';

const TS = CONFIG.TILE_SIZE;

// Room kept around the farm for its frame and the shelf it stands on, in tiles
const PAD_X = 5, PAD_TOP = 4, PAD_BOTTOM = 10;

// The world's size is the mode's (src/main.js sets it before the camera is built), so these
// are worked out in the constructor rather than when the module loads
let WORLD_W, WORLD_H, BOX_W, BOX_H;
let OPEN, EDGE;   // open land (rules().frame), and the width of its hidden border rows in world pixels

// Where the camera sits when the whole farm is in view (world pixels)
export const HOME = { x: 0, y: 0 };

export class Camera {
  constructor(canvasWidth, canvasHeight) {
    WORLD_W = CONFIG.WORLD_WIDTH * TS;
    WORLD_H = CONFIG.WORLD_HEIGHT * TS;
    BOX_W = WORLD_W + PAD_X * 2 * TS;
    BOX_H = WORLD_H + (PAD_TOP + PAD_BOTTOM) * TS;
    OPEN = rules().frame === 'open';
    EDGE = CONFIG.GLASS_THICKNESS * TS + 1;   // a world pixel more, so rounding the corner never shows a sliver of it
    // the farm, frame and shelf all in view; open land is too wide for that, so its colony
    HOME.x = OPEN ? (CONFIG.COLONY_X + 0.5) * TS : WORLD_W / 2;
    HOME.y = OPEN ? WORLD_H / 2 : (WORLD_H + (PAD_BOTTOM - PAD_TOP) * TS) / 2;

    this.cw = canvasWidth;
    this.ch = canvasHeight;

    // Width of the strip on the right that the dashboard covers. The view is centred
    // in what is left of the canvas; inset eases to insetTarget as the panel slides.
    this.inset = 0;
    this.insetTarget = 0;

    // Camera center in world pixels
    this.x = HOME.x;
    this.y = HOME.y;
    this.zoom = 1;

    // Showing the whole farm, and keeping to that as the window or the panel changes.
    // Panning or zooming by hand lets go of it.
    this.fitted = true;
    this.fitWorld();
  }

  resize(w, h) {
    this.cw = w;
    this.ch = h;
  }

  setInset(px, immediately = false) {
    this.insetTarget = Math.max(0, px);
    if (immediately) this.inset = this.insetTarget;
  }

  // dt in seconds
  update(dt) {
    const k = Math.min(1, dt * 4.5);
    const d = this.insetTarget - this.inset;
    if (d !== 0) this.inset = Math.abs(d) < 0.5 ? this.insetTarget : this.inset + d * k;

    if (this.fitted) {
      const z = this.fitZoom();
      this.zoom = Math.abs(z - this.zoom) < 0.002 ? z : this.zoom + (z - this.zoom) * k;
      this.x = Math.abs(HOME.x - this.x) < 0.1 ? HOME.x : this.x + (HOME.x - this.x) * k;
      this.y = Math.abs(HOME.y - this.y) < 0.1 ? HOME.y : this.y + (HOME.y - this.y) * k;
    }
    if (OPEN) this._clamp();   // whoever moved it (the tour, the panel sliding), the land's edges stay hidden
  }

  // Middle of the part of the canvas that can be seen
  get cx() { return (this.cw - this.inset) / 2; }
  get cy() { return this.ch / 2; }

  // The world's corner is kept on a whole pixel so tiles stay crisp as the view moves
  worldToScreen(wx, wy) {
    return [
      wx * this.zoom + Math.round(this.cx - this.x * this.zoom),
      wy * this.zoom + Math.round(this.cy - this.y * this.zoom),
    ];
  }

  screenToWorld(sx, sy) {
    return [
      (sx - Math.round(this.cx - this.x * this.zoom)) / this.zoom,
      (sy - Math.round(this.cy - this.y * this.zoom)) / this.zoom,
    ];
  }

  screenToTile(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    return [
      Math.floor(wx / TS),
      Math.floor(wy / TS),
    ];
  }

  pan(dx, dy) {
    this.fitted = false;
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this._clamp();
  }

  zoomAt(factor, screenX, screenY) {
    this.fitted = false;
    const [wx, wy] = this.screenToWorld(screenX, screenY);
    this.zoom *= factor;
    this.zoom = Math.max(OPEN ? this.fitZoom() : CONFIG.MIN_ZOOM, Math.min(CONFIG.MAX_ZOOM, this.zoom));
    // Zoom toward cursor
    const [nx, ny] = this.screenToWorld(screenX, screenY);
    this.x += wx - nx;
    this.y += wy - ny;
    this._clamp();
  }

  // Zoom about the middle of the view
  zoomBy(factor) {
    this.zoomAt(factor, this.cx, this.cy);
  }

  _clamp() {
    if (OPEN) {
      // the view stays inside the land: its border rows and columns are never seen
      const hw = (this.cw - this.inset) / 2 / this.zoom, hh = this.ch / 2 / this.zoom;
      const within = (v, lo, hi) => lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v));
      this.x = within(this.x, EDGE + hw, WORLD_W - EDGE - hw);
      this.y = within(this.y, EDGE + hh, WORLD_H - EDGE - hh);
      return;
    }
    const margin = 50;
    this.x = Math.max(-margin / this.zoom, Math.min(WORLD_W + margin / this.zoom, this.x));
    this.y = Math.max(-margin / this.zoom, Math.min(WORLD_H + margin / this.zoom, this.y));
  }

  // The closest view that still shows the whole farm, frame and all, beside a panel
  // `inset` pixels wide. Where there is room it stops at a whole number of pixels per
  // tile, which keeps the pixel art even.
  fitZoom(inset = this.insetTarget) {
    // open land fills the screen's height exactly (rounding to whole pixels a tile would hide a sixth of it)
    if (OPEN) return Math.min(CONFIG.MAX_ZOOM, this.ch / (WORLD_H - 2 * EDGE));
    const z = Math.min((this.cw - inset) / BOX_W, this.ch / BOX_H);
    const even = Math.floor(z * TS) / TS;
    return Math.max(CONFIG.MIN_ZOOM, Math.min(CONFIG.MAX_ZOOM, even >= 0.75 ? even : z));
  }

  // Back to the whole farm — at once, or eased there over the next few frames
  fitWorld(immediately = true) {
    this.fitted = true;
    if (!immediately) return;
    this.zoom = this.fitZoom();
    this.x = HOME.x;
    this.y = HOME.y;
  }

  get tilePixelSize() {
    return TS * this.zoom;
  }

  get lodLevel() {
    if (this.zoom < CONFIG.LOD_FAR)  return 'far';
    if (this.zoom < CONFIG.LOD_TINY) return 'tiny';
    if (this.zoom < CONFIG.LOD_MID)  return 'mid';
    return 'close';
  }
}
