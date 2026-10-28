import { CONFIG, STATE } from '../config.js';

// What the sky and the camera ask of the sound. Plain functions of the colony and the view, so the
// tests can check them without a browser or an audio context; src/audio/audio.js does the playing.

const TS = CONFIG.TILE_SIZE;
const WIDEST_PAN = 0.8;   // sounds at the very edges of the screen are kept off the ear's extremes
const clamp01 = x => Math.max(0, Math.min(1, x));

// Where a thing `sx` pixels across a view `w` pixels wide is heard from: -0.8 (left) to 0.8 (right)
export function panAt(sx, w) {
  return WIDEST_PAN * Math.max(-1, Math.min(1, sx / w * 2 - 1));
}

// Whether the camera is close enough to the tile (x, y) to hear it: null when it is not, otherwise
// where it is heard from (see panAt). Ants and eggs are positioned in tiles, like (x, y).
export function heardAt(camera, x, y) {
  if (camera.zoom < CONFIG.AUDIO_CLOSE_ZOOM) return null;
  const [ox, oy] = camera.worldToScreen(0, 0);
  const u = TS * camera.zoom;
  const sx = ox + x * u, sy = oy + y * u;
  const w = camera.cw - camera.inset;   // the panel covers the strip on the right
  return sx < 0 || sx > w || sy < 0 || sy > camera.ch ? null : panAt(sx, w);
}

// What the camera is looking at, as far as the sound goes:
//   buried   0 when the sky is in view, up to 1 when the view is deep in the soil
//   diggers  where from (see panAt) each ant that is digging in view is heard, one entry an ant. Empty unless the
//            camera is close in: from far away a colony digging is not a sound.
export function watchView(sim, camera) {
  const u = TS * camera.zoom;   // screen pixels to a tile
  const [ox, oy] = camera.worldToScreen(0, 0);
  const topRow = -oy / u;       // the row of tiles along the top edge of the screen
  const buried = clamp01((topRow - CONFIG.SURFACE_ROW) / CONFIG.AUDIO_BURY_ROWS);

  const diggers = [];
  if (camera.zoom >= CONFIG.AUDIO_CLOSE_ZOOM) {
    const w = camera.cw - camera.inset, h = camera.ch;
    for (const ant of sim.antSystem.ants) {
      if (ant.state !== STATE.DIGGING) continue;
      const sx = ox + ant.x * u, sy = oy + ant.y * u;
      if (sx >= 0 && sx <= w && sy >= 0 && sy <= h) diggers.push(panAt(sx, w));
    }
  }
  return { buried, diggers };
}

// How loud each layer should be now (gains, see CONFIG)
export function layerTargets(sky, view) {
  const wind = (CONFIG.AUDIO_WIND + CONFIG.AUDIO_WIND_OVERCAST * sky.overcast)
    * (1 - (1 - CONFIG.AUDIO_WIND_BURIED) * view.buried);
  const dawn = sky.phase >= CONFIG.AUDIO_BIRDS_FROM && sky.phase <= CONFIG.AUDIO_BIRDS_TO && sky.weather === 'clear';
  return {
    wind,
    rain: sky.rain * CONFIG.AUDIO_RAIN,
    night: (1 - sky.light) * CONFIG.AUDIO_NIGHT,
    birds: dawn ? CONFIG.AUDIO_BIRDS : 0,
    soil: view.diggers.length ? CONFIG.AUDIO_SOIL : 0,
  };
}

// Soil clicks a second for `diggers` ants digging in view, with the colony living at `speed`× (0 is paused)
export function soilRate(diggers, speed) {
  return Math.min(CONFIG.AUDIO_SOIL_MAX_RATE, diggers * CONFIG.AUDIO_SOIL_RATE * speed);
}
