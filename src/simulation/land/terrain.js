import { TILE, CONFIG } from '../../config.js';

// The shape of open land above the surface line: rolling hills, a level meadow round the colony,
// and ponds between high banks. Made once with the world and never changed by the ants. The shape
// lives in the tiles themselves (raised SOIL, and POND water), and World.rebuildDerived reads the
// heights back from them, so a save carries the land without a field of its own.

const { SOIL, POND } = TILE;
const between = (rng, [a, b]) => a + rng() * (b - a);
const smooth = t => t * t * (3 - 2 * t);

// opts.ponds: the columns to put a pond's middle at (T9.5's layouts will choose their own)
export function makeTerrain(world, rng = Math.random, opts = {}) {
  const W = world.width, T = world.tiles, HD = world.hardness;
  const SR = CONFIG.SURFACE_ROW, GT = CONFIG.GLASS_THICKNESS, MID = CONFIG.COLONY_X + 1;
  const h = new Float32Array(W);

  // gentle hills: a few swells of random phase, the long ones the tallest
  const amp = between(rng, CONFIG.TERRAIN_AMP);
  const waves = CONFIG.TERRAIN_WAVES.map((len, k) =>
    ({ len, share: CONFIG.TERRAIN_WAVE_SHARE[k], ph: rng() * Math.PI * 2 }));
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (const w of waves) s += w.share * (Math.sin(x / w.len * Math.PI * 2 + w.ph) + 1) / 2;
    // the colony's ground is level, so the anthill and the way in work as they do in the tank
    const d = Math.abs(x + 0.5 - MID) - CONFIG.TERRAIN_FLAT;
    h[x] = s * amp * (d <= 0 ? 0 : smooth(Math.min(1, d / CONFIG.TERRAIN_EASE)));
  }

  // ponds: level water, with a bank either side that slopes back down into the hills
  const wet = new Uint8Array(W);
  for (const at of opts.ponds || []) {
    const pw = Math.round(between(rng, CONFIG.POND_WIDTH));
    const bank = Math.round(between(rng, CONFIG.POND_BANK));
    const p0 = Math.max(GT + bank + 2, Math.round(at - pw / 2));
    const p1 = Math.min(W - GT - bank - 3, p0 + pw - 1);
    for (let x = p0; x <= p1; x++) { wet[x] = 1; h[x] = 0; }
    for (let k = 0; k < bank; k++) {
      for (const x of [p0 - 1 - k, p1 + 1 + k]) h[x] = Math.max(h[x], bank - k);
    }
  }

  // whole tiles, and no step of more than one tile between columns, so every slope is walkable
  // (the drop from a bank into the water is the one cliff, and nothing walks there)
  const H = new Uint8Array(W);
  for (let x = 0; x < W; x++) H[x] = wet[x] ? 0 : Math.round(h[x]);
  for (let x = 1; x < W; x++) if (!wet[x] && !wet[x - 1]) H[x] = Math.min(H[x], H[x - 1] + 1);
  for (let x = W - 2; x >= 0; x--) if (!wet[x] && !wet[x + 1]) H[x] = Math.min(H[x], H[x + 1] + 1);

  const hard = CONFIG.TERRAIN_HARDNESS;
  for (let x = GT; x < W - GT; x++) {
    for (let k = 1; k <= H[x]; k++) { const i = (SR - k) * W + x; T[i] = SOIL; HD[i] = hard; }
    if (wet[x]) for (let k = 1; k <= CONFIG.POND_DEPTH; k++) T[(SR - k) * W + x] = POND;
  }
}
