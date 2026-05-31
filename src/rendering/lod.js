import { CONFIG } from '../config.js';

export function getLOD(zoom) {
  if (zoom < CONFIG.LOD_FAR) return 'far';
  if (zoom < CONFIG.LOD_MID) return 'mid';
  return 'close';
}

export function tileOnScreen(tx, ty, camera) {
  const ts = CONFIG.TILE_SIZE;
  const wx = tx * ts, wy = ty * ts;
  const [sx, sy] = camera.worldToScreen(wx, wy);
  const tileScreen = ts * camera.zoom;
  return sx + tileScreen > 0 && sx < camera.cw && sy + tileScreen > 0 && sy < camera.ch;
}
