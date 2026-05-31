import { CONFIG } from '../config.js';

export class Camera {
  constructor(canvasWidth, canvasHeight) {
    this.cw = canvasWidth;
    this.ch = canvasHeight;

    const worldW = CONFIG.WORLD_WIDTH * CONFIG.TILE_SIZE;
    const worldH = CONFIG.WORLD_HEIGHT * CONFIG.TILE_SIZE;

    // Start zoom to fit world nicely
    this.zoom = Math.min(
      (canvasWidth * 0.72) / worldW,
      canvasHeight / worldH
    );
    this.zoom = Math.max(this.zoom, CONFIG.MIN_ZOOM);

    // Camera center in world pixels
    this.x = worldW / 2;
    this.y = worldH / 2;
  }

  resize(w, h) {
    this.cw = w;
    this.ch = h;
  }

  worldToScreen(wx, wy) {
    return [
      (wx - this.x) * this.zoom + this.cw / 2,
      (wy - this.y) * this.zoom + this.ch / 2,
    ];
  }

  screenToWorld(sx, sy) {
    return [
      (sx - this.cw / 2) / this.zoom + this.x,
      (sy - this.ch / 2) / this.zoom + this.y,
    ];
  }

  screenToTile(sx, sy) {
    const [wx, wy] = this.screenToWorld(sx, sy);
    return [
      Math.floor(wx / CONFIG.TILE_SIZE),
      Math.floor(wy / CONFIG.TILE_SIZE),
    ];
  }

  pan(dx, dy) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
    this._clamp();
  }

  zoomAt(factor, screenX, screenY) {
    const [wx, wy] = this.screenToWorld(screenX, screenY);
    this.zoom *= factor;
    this.zoom = Math.max(CONFIG.MIN_ZOOM, Math.min(CONFIG.MAX_ZOOM, this.zoom));
    // Zoom toward cursor
    const [nx, ny] = this.screenToWorld(screenX, screenY);
    this.x += wx - nx;
    this.y += wy - ny;
    this._clamp();
  }

  _clamp() {
    const worldW = CONFIG.WORLD_WIDTH * CONFIG.TILE_SIZE;
    const worldH = CONFIG.WORLD_HEIGHT * CONFIG.TILE_SIZE;
    const margin = 50;
    this.x = Math.max(-margin / this.zoom, Math.min(worldW + margin / this.zoom, this.x));
    this.y = Math.max(-margin / this.zoom, Math.min(worldH + margin / this.zoom, this.y));
  }

  fitWorld() {
    const worldW = CONFIG.WORLD_WIDTH * CONFIG.TILE_SIZE;
    const worldH = CONFIG.WORLD_HEIGHT * CONFIG.TILE_SIZE;
    this.zoom = Math.min(
      (this.cw * 0.72) / worldW,
      (this.ch * 0.95) / worldH
    );
    this.zoom = Math.max(CONFIG.MIN_ZOOM, this.zoom);
    this.x = worldW / 2;
    this.y = worldH / 2;
  }

  get tilePixelSize() {
    return CONFIG.TILE_SIZE * this.zoom;
  }

  get lodLevel() {
    if (this.zoom < CONFIG.LOD_FAR) return 'far';
    if (this.zoom < CONFIG.LOD_MID) return 'mid';
    return 'close';
  }
}
