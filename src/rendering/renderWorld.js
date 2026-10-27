import { TILE, CONFIG } from '../config.js';

const C = CONFIG;
const SR = C.SURFACE_ROW;

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

// True when this call made the canvas: it is blank, whatever the world says has changed
function ensureOffscreen(world) {
  const w = world.width * C.TILE_SIZE;
  const h = world.height * C.TILE_SIZE;
  if (offscreen) return false;
  offscreen = document.createElement('canvas');
  offscreen.width = w;
  offscreen.height = h;
  offCtx = offscreen.getContext('2d');
  offCtx.imageSmoothingEnabled = false;
  return true;
}

// Low-bias hash — no diagonal correlation
function _hash(x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) & 0xff;
}

const isEarth = t => t === TILE.SOIL || t === TILE.ROCK || t === TILE.SURFACE;
const isOpen  = t => t === TILE.TUNNEL || t === TILE.CHAMBER || t === TILE.FOOD || t === TILE.WATER || t === TILE.EGG;

// Chamber floors, as a tint of the bare hollow colour: [scale r, g, b, add r, g, b]
const ROOM_TINT = [
  [1.12, 1.12, 1.12,  0, 0,  0],   // living quarters
  [1.36, 1.34, 1.20, 14, 6,  0],   // queen — rich warm amber
  [1.28, 1.34, 1.42,  8, 8,  6],   // nursery — soft cream
  [1.22, 1.20, 1.00,  8, 4,  0],   // food store — deep ochre
  [0.82, 1.02, 1.30,  0, 4, 10],   // fungus garden — cool and damp
];

function tileColor(type, x, y, world) {
  const n = _hash(x, y);
  const j = (n / 255) * 10 - 5; // ±5 brightness variation

  // 0 at the surface → 1 at the bottom of the farm
  const k = Math.max(0, Math.min(1, (y - SR) / (world.height - SR)));

  switch (type) {
    case TILE.SURFACE:
      // A dark, rooty skin of humus over the paler earth below
      return y === SR ? `rgb(${92+j|0},${64+j|0},${32+j|0})` : `rgb(${124+j|0},${86+j|0},${44+j|0})`;

    case TILE.SOIL: {
      // Warm sunlit topsoil shading down to dark damp clay, laid down in wavy strata
      const wave = y + Math.sin(x * 0.045) * 3.2 + Math.sin(x * 0.118 + 2) * 1.6;
      const band = Math.sin(wave * 0.52);
      // loose soil is a shade paler than the compacted lumps the tunnels wind around
      const s = j + (band > 0.8 ? -10 : band < -0.88 ? 7 : 0) + (70 - world.hardness[world.idx(x, y)]) * 0.12;
      return `rgb(${168 - 94 * k + s | 0},${120 - 72 * k + s | 0},${64 - 40 * k + s * 0.6 | 0})`;
    }

    case TILE.TUNNEL:
      // Hollows catch less light than the soil around them, and less still deep down
      return `rgb(${86 - 44 * k + j | 0},${58 - 30 * k + j | 0},${28 - 14 * k + j * 0.6 | 0})`;

    case TILE.CHAMBER: {
      const t = ROOM_TINT[world.chamberType[world.idx(x, y)]] || ROOM_TINT[0];
      return `rgb(${(86 - 44 * k) * t[0] + t[3] + j | 0},${(58 - 30 * k) * t[1] + t[4] + j | 0},${(28 - 14 * k) * t[2] + t[5] + j * 0.6 | 0})`;
    }

    case TILE.ROCK:    return `rgb(${114 - 40 * k + j * 2 | 0},${110 - 40 * k + j * 2 | 0},${106 - 36 * k + j * 2 | 0})`;
    case TILE.GLASS:   return '#1a2530';
    case TILE.EGG:     return '#f0e8c8';
    default:           return '#8a6432';
  }
}

function drawTile(ctx, tile, x, y, world) {
  const ts = C.TILE_SIZE;
  const px = x * ts, py = y * ts;
  const i  = world.idx(x, y);
  let type = tile, item = 0;

  // Above the ground the canvas stays clear: the sky, the mound and whatever is lying
  // on the grass are drawn live by the renderer
  if (type !== TILE.GLASS && (y < SR || type === TILE.AIR || type === TILE.ANTHILL)) {
    ctx.clearRect(px, py, ts, ts);
    return;
  }

  // Something lying in a passage: paint the passage, then the thing
  if (type === TILE.FOOD || type === TILE.WATER) {
    item = type;
    type = world.under[i] === TILE.CHAMBER ? TILE.CHAMBER : TILE.TUNNEL;
  }

  ctx.fillStyle = tileColor(type, x, y, world);
  ctx.fillRect(px, py, ts, ts);

  const up = world.get(x, y - 1), down = world.get(x, y + 1);

  // The frame: dark at the rim, with a lit bevel on the inside edge
  if (type === TILE.GLASS) {
    const W = world.width, H = world.height, GT = C.GLASS_THICKNESS;
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (d === 0) { ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(px, py, ts, ts); }
    if (d === GT - 1) {
      ctx.fillStyle = 'rgba(150,200,230,0.34)';
      if (x === GT - 1) ctx.fillRect(px + ts - 1, py, 1, ts);
      if (x === W - GT) ctx.fillRect(px, py, 1, ts);
      if (y === GT - 1) ctx.fillRect(px, py + ts - 1, ts, 1);
      if (y === H - GT) ctx.fillRect(px, py, ts, 1);
    }
    return;
  }

  // Roots trailing down from the turf
  if ((type === TILE.SOIL || type === TILE.SURFACE) && y <= SR + 6) {
    const r = _hash(x + 13, 7);
    if (r < 60 && y - SR - 1 <= (r & 3) + 1) {
      ctx.fillStyle = 'rgba(48,30,12,0.5)';
      ctx.fillRect(px + 1 + (((r >> 2) ^ y) & 1), py, 1, ts);
    }
  }

  if (type === TILE.SOIL) {
    // Grain: a pale fleck here, a dark one there, the odd pebble
    const g = _hash(x + 911, y + 373);
    if (g < 64) {
      ctx.fillStyle = 'rgba(255,226,170,0.11)';
      ctx.fillRect(px + (g & 3), py + ((g >> 2) & 3), 1, 1);
    } else if (g > 204) {
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      ctx.fillRect(px + (g & 1), py + ((g >> 2) & 3), 2, 1);
    } else if (g === 100 || g === 101) {
      ctx.fillStyle = 'rgba(176,168,156,0.55)';
      ctx.fillRect(px + 1, py + 1, 2, 2);
      ctx.fillStyle = 'rgba(232,226,214,0.5)';
      ctx.fillRect(px + 1, py + 1, 1, 1);
    }

    // Organic matter specs — dark flecks visible in soil
    if (world.organics[i] > 0.25) {
      const o  = world.organics[i];
      const nh = _hash(x + 77, y + 33);
      // Primary spec — always present above threshold
      if (nh > 160 - o * 80) {
        ctx.fillStyle = o > 0.65 ? '#1e1810' : '#2c2418';
        ctx.fillRect(px + (nh & 3), py + ((nh >> 2) & 3), 1, 1);
      }
      // Secondary spec — only for rich deposits
      if (o > 0.55) {
        const nh2 = _hash(x + 200, y + 150);
        ctx.fillStyle = '#181410';
        ctx.fillRect(px + ((nh2 & 3) ^ 2), py + (((nh2 >> 2) & 3) ^ 1), 1, 1);
      }
    }

    // Dig-progress cracks
    if (world.digProgress[i] > 0) {
      const p = world.digProgress[i];
      ctx.fillStyle = `rgba(60,38,16,${p * 0.6})`;
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
    return;
  }

  if (type === TILE.ROCK) {
    // Stones: lit along the top, shadowed underneath
    if (up !== TILE.ROCK) { ctx.fillStyle = 'rgba(255,255,255,0.20)'; ctx.fillRect(px, py, ts, 1); }
    if (down !== TILE.ROCK) { ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(px, py + ts - 1, ts, 1); }
    if (world.get(x - 1, y) !== TILE.ROCK) { ctx.fillStyle = 'rgba(255,255,255,0.09)'; ctx.fillRect(px, py, 1, ts); }
    if (world.get(x + 1, y) !== TILE.ROCK) { ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(px + ts - 1, py, 1, ts); }
    return;
  }

  if (type !== TILE.TUNNEL && type !== TILE.CHAMBER) return;

  // Ambient occlusion — the hollow darkens toward the earth it was cut from
  if (isEarth(down)) {
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(px, py + ts - 1, ts, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(px, py + ts - 2, ts, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(px, py + ts - 3, ts, 1);
  }
  if (isEarth(world.get(x - 1, y))) {
    ctx.fillStyle = 'rgba(0,0,0,0.42)'; ctx.fillRect(px,     py, 1, ts);
    ctx.fillStyle = 'rgba(0,0,0,0.20)'; ctx.fillRect(px + 1, py, 1, ts);
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(px + 2, py, 1, ts);
  }
  if (isEarth(world.get(x + 1, y))) {
    ctx.fillStyle = 'rgba(0,0,0,0.38)'; ctx.fillRect(px + ts - 1, py, 1, ts);
    ctx.fillStyle = 'rgba(0,0,0,0.17)'; ctx.fillRect(px + ts - 2, py, 1, ts);
    ctx.fillStyle = 'rgba(0,0,0,0.07)'; ctx.fillRect(px + ts - 3, py, 1, ts);
  }

  // One-pixel ceiling highlight where the roof catches the light
  if (!isOpen(up) && up !== TILE.AIR) {
    if (type === TILE.CHAMBER) {
      const ct = world.chamberType[i];
      ctx.fillStyle = ct === 1 ? 'rgba(255,200,80,0.60)'    // queen — bright gold
                    : ct === 2 ? 'rgba(240,214,150,0.46)'   // nursery — warm cream
                    : ct === 3 ? 'rgba(220,160,60,0.42)'    // food — amber
                    : ct === 4 ? 'rgba(120,200,190,0.30)'   // fungus garden — pale teal
                    :            'rgba(220,170,80,0.34)';
    } else {
      ctx.fillStyle = 'rgba(220,170,80,0.34)';
    }
    ctx.fillRect(px, py, ts, 1);
  }

  if (item === TILE.FOOD) {
    // A heap of seeds, no two tiles alike
    const f = _hash(x + 431, y + 97);
    const ax = f & 1, ay = (f >> 1) & 1, bx = (f >> 4) & 1;
    ctx.fillStyle = '#8f6414';
    ctx.fillRect(px, py + 1 + ay, ts, 3 - ay);
    ctx.fillStyle = (f & 4) ? '#e8b830' : '#d49a26';
    ctx.fillRect(px + ax, py + 1 + ay, 2, 2);
    ctx.fillStyle = (f & 8) ? '#f0d060' : '#c08420';
    ctx.fillRect(px + 2 + bx, py + 2, bx ? 1 : 1 + ((f >> 5) & 1), 2);
    ctx.fillStyle = '#fff0a8';
    ctx.fillRect(px + ax + ((f >> 6) & 1), py + 1 + ay, 1, 1);
  } else if (item === TILE.WATER) {
    // Standing water
    ctx.fillStyle = 'rgba(46,124,206,0.86)';
    ctx.fillRect(px, py + 2, ts, 2);
    ctx.fillStyle = '#8cc8ff';
    ctx.fillRect(px, py + 2, ts, 1);
  }
}

export function renderWorld(camera, world) {
  const blank = ensureOffscreen(world);

  // A colony that ran before its first frame (grown or caught up) has changed a few thousand
  // tiles, but a canvas nobody has drawn on needs all of them
  if (blank || world.dirty) {
    const full = blank || world.dirtyTiles.size === 0 || world.dirtyTiles.size > 6000;
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
