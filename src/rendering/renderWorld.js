import { TILE, CONFIG } from '../config.js';

const C = CONFIG;

let offscreen = null;
let offCtx = null;

let pherCanvas = null;
let pherCtx    = null;
let _showPher  = false;

export function setPheromoneOverlay(val) { _showPher = val; }
export function getPheromoneOverlay()    { return _showPher; }

export function renderPheromoneOverlay(world) {
  if (!_showPher) return null;

  if (!pherCanvas || pherCanvas.width !== world.width) {
    pherCanvas = document.createElement('canvas');
    pherCanvas.width  = world.width;
    pherCanvas.height = world.height;
    pherCtx = pherCanvas.getContext('2d');
  }

  const img = pherCtx.createImageData(world.width, world.height);
  const d   = img.data;

  for (let y = 0; y < world.height; y++) {
    for (let x = 0; x < world.width; x++) {
      const wi = world.idx(x, y);
      const t  = world.tiles[wi];
      if (t === TILE.SOIL || t === TILE.GLASS || t === TILE.AIR) continue;

      const pf = world.pheromoneFood[wi];
      const ph = world.pheromoneHome[wi];
      if (pf < 0.015 && ph < 0.015) continue;

      const af = Math.min(pf * 0.9, 0.9);
      const ah = Math.min(ph * 0.8, 0.82);
      const tot = af + ah || 0.001;
      const pi  = (y * world.width + x) * 4;

      // Blend: food = amber (255,165,20), home = blue (50,130,255)
      d[pi]     = Math.round((255 * af + 50  * ah) / tot);
      d[pi + 1] = Math.round((165 * af + 130 * ah) / tot);
      d[pi + 2] = Math.round(( 20 * af + 255 * ah) / tot);
      d[pi + 3] = Math.round(Math.min(tot, 0.93) * 255);
    }
  }

  pherCtx.putImageData(img, 0, 0);
  return pherCanvas;
}

function ensureOffscreen(world) {
  const w = world.width * C.TILE_SIZE;
  const h = world.height * C.TILE_SIZE;
  if (!offscreen) {
    offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    offCtx = offscreen.getContext('2d');
    offCtx.imageSmoothingEnabled = false;
  }
}

// Low-bias hash — no diagonal correlation
function _hash(x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) & 0xff;
}

function tileColor(type, x, y, world) {
  const n = _hash(x, y);
  const j = (n / 255) * 10 - 5; // ±5 brightness variation

  const depth = y / world.height;

  switch (type) {
    case TILE.AIR:
      return '#7ab8d8'; // sky blue (covered by sky gradient)

    case TILE.SURFACE:
      // Top surface row: grass patches; lower row: dirt
      if (y === C.SURFACE_ROW) {
        if (n > 175) return '#4a7820';
        if (n > 135) return '#5a8428';
        return '#8a6432';
      }
      return n > 140 ? '#9a7038' : '#a87c40';

    case TILE.SOIL: {
      // Bright warm earth — visible through glass in sunlight
      if (depth < 0.22) return `rgb(${158+j|0},${112+j|0},${58+j|0})`;
      if (depth < 0.50) return `rgb(${128+j|0},${88+j|0},${44+j|0})`;
      if (depth < 0.75) return `rgb(${100+j|0},${68+j|0},${33+j|0})`;
      return `rgb(${78+j|0},${52+j|0},${24+j|0})`;
    }

    case TILE.TUNNEL:
      // Darker than soil — hollow channels catch less light
      return depth < 0.4
        ? `rgb(${82+j|0},${55+j|0},${24+j|0})`
        : `rgb(${66+j|0},${44+j|0},${18+j|0})`;

    case TILE.CHAMBER:
      // Slightly lighter than tunnel — larger open space
      return depth < 0.4
        ? `rgb(${96+j|0},${65+j|0},${30+j|0})`
        : `rgb(${78+j|0},${52+j|0},${22+j|0})`;

    case TILE.GLASS:   return '#9ad0f0';
    case TILE.FOOD:    return '#e8b820';
    case TILE.WATER:   return '#3488d8';
    case TILE.EGG:     return '#f0e8c8';
    default:           return '#8a6432';
  }
}

function drawTile(ctx, type, x, y, world) {
  const ts = C.TILE_SIZE;
  const px = x * ts, py = y * ts;
  const i  = world.idx(x, y);

  ctx.fillStyle = tileColor(type, x, y, world);
  ctx.fillRect(px, py, ts, ts);

  // One-pixel accent lines — ceiling highlight, floor shadow
  if (type === TILE.TUNNEL) {
    if (world.get(x, y - 1) === TILE.SOIL || world.get(x, y - 1) === TILE.SURFACE) {
      ctx.fillStyle = 'rgba(220,170,80,0.50)';
      ctx.fillRect(px, py, ts, 1);
    }
    if (world.get(x, y + 1) === TILE.SOIL) {
      ctx.fillStyle = 'rgba(0,0,0,0.40)';
      ctx.fillRect(px, py + ts - 1, ts, 1);
    }
  }

  if (type === TILE.CHAMBER && world.get(x, y - 1) !== TILE.CHAMBER) {
    ctx.fillStyle = 'rgba(220,170,80,0.40)';
    ctx.fillRect(px, py, ts, 1);
  }

  if (type === TILE.GLASS) {
    ctx.fillStyle = 'rgba(140,210,240,0.55)';
    ctx.fillRect(px, py, 1, ts);
    ctx.fillStyle = 'rgba(40,100,140,0.40)';
    ctx.fillRect(px + ts - 1, py, 1, ts);
  }

  if (type === TILE.FOOD) {
    // Bright centre dot so food is obvious even at far zoom
    ctx.fillStyle = '#f8d040';
    ctx.fillRect(px + 1, py + 1, ts - 2, ts - 2);
  }

  if (type === TILE.WATER) {
    ctx.fillStyle = '#4090e8';
    ctx.fillRect(px, py, ts, 1);
  }

  // Dig-progress cracks
  if (type === TILE.SOIL && world.digProgress[i] > 0) {
    const p = world.digProgress[i];
    ctx.fillStyle = `rgba(110,75,38,${p * 0.65})`;
    ctx.fillRect(px, py, ts, ts);
    if (p > 0.35) {
      ctx.fillStyle = `rgba(165,115,55,${p * 0.5})`;
      ctx.fillRect(px + 1, py + 1, 1, ts - 2);
    }
    if (p > 0.65) {
      ctx.fillStyle = `rgba(195,148,75,${p * 0.4})`;
      ctx.fillRect(px, py + 2, ts, 1);
    }
  }

  // Ambient occlusion — darken edges adjacent to soil (skip top: ceiling highlight handles it)
  if (type === TILE.TUNNEL || type === TILE.CHAMBER) {
    if (world.get(x, y + 1) === TILE.SOIL) {
      ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(px, py + ts - 1, ts, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(px, py + ts - 2, ts, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(px, py + ts - 3, ts, 1);
    }
    if (world.get(x - 1, y) === TILE.SOIL) {
      ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(px,     py, 1, ts);
      ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(px + 1, py, 1, ts);
      ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(px + 2, py, 1, ts);
    }
    if (world.get(x + 1, y) === TILE.SOIL) {
      ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(px + ts - 1, py, 1, ts);
      ctx.fillStyle = 'rgba(0,0,0,0.17)'; ctx.fillRect(px + ts - 2, py, 1, ts);
      ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(px + ts - 3, py, 1, ts);
    }
  }

  // Pheromone tints on open tiles
  if (type === TILE.TUNNEL || type === TILE.CHAMBER) {
    const pf = world.pheromoneFood[i];
    const ph = world.pheromoneHome[i];
    if (pf > 0.08) {
      ctx.fillStyle = `rgba(255,200,50,${Math.min(pf * 0.18, 0.28)})`;
      ctx.fillRect(px, py, ts, ts);
    }
    if (ph > 0.08) {
      ctx.fillStyle = `rgba(80,160,255,${Math.min(ph * 0.12, 0.22)})`;
      ctx.fillRect(px, py, ts, ts);
    }
  }
}

export function renderWorld(camera, world) {
  ensureOffscreen(world);

  if (world.dirty) {
    const full = world.dirtyTiles.size === 0 || world.dirtyTiles.size > 6000;
    if (full) {
      for (let y = 0; y < world.height; y++)
        for (let x = 0; x < world.width; x++)
          drawTile(offCtx, world.get(x, y), x, y, world);
    } else {
      for (const i of world.dirtyTiles) {
        const x = i % world.width;
        const y = Math.floor(i / world.width);
        drawTile(offCtx, world.tiles[i], x, y, world);
      }
    }
    world.dirty = false;
    world.dirtyTiles.clear();
  }

  return offscreen;
}

export function drawWorldToScreen(mainCtx, worldCanvas, camera) {
  const [sx, sy] = camera.worldToScreen(0, 0);
  mainCtx.imageSmoothingEnabled = false;
  mainCtx.drawImage(
    worldCanvas,
    sx, sy,
    worldCanvas.width  * camera.zoom,
    worldCanvas.height * camera.zoom
  );
}

export function forceFullRedraw(world) {
  if (!offCtx) return;
  for (let y = 0; y < world.height; y++)
    for (let x = 0; x < world.width; x++)
      drawTile(offCtx, world.get(x, y), x, y, world);
  world.dirty = false;
  world.dirtyTiles.clear();
}
