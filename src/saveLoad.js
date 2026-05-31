const VERSION = 1;
const key = mode => `pixelants_v${VERSION}_${mode}`;

export function hasSave(mode) {
  return !!localStorage.getItem(key(mode));
}

export function getSaveInfo(mode) {
  try {
    const d = JSON.parse(localStorage.getItem(key(mode)));
    return d ? { day: d.stats.day, peakPopulation: d.stats.peakPopulation } : null;
  } catch { return null; }
}

export function saveGame(mode, { world, antSystem, queen, stats }) {
  try {
    localStorage.setItem(key(mode), JSON.stringify({
      version: VERSION,
      ts: Date.now(),
      world: {
        tiles:             Array.from(world.tiles),
        foodAmount:        Array.from(world.foodAmount),
        waterAmount:       Array.from(world.waterAmount),
        digProgress:       Array.from(world.digProgress),
        foodStore:         world.foodStore,
        waterStore:        world.waterStore,
        tunnelCount:       world.tunnelCount,
        chamberCount:      world.chamberCount,
        stress:            world.stress,
        _foodRespawnTimer: world._foodRespawnTimer,
      },
      ants: antSystem.ants.map(a => ({ ...a })),
      eggs: antSystem.eggs.map(e => ({ ...e })),
      antMeta: {
        deaths:       antSystem.deaths,
        recentDeaths: antSystem.recentDeaths,
        _hatchCount:  antSystem._hatchCount,
        roleBoosts:   { ...antSystem.roleBoosts },
      },
      queen: {
        x: queen.x, y: queen.y,
        health: queen.health, hunger: queen.hunger,
        eggTimer: queen.eggTimer, restTimer: queen.restTimer,
        animFrame: queen.animFrame, angle: queen.angle,
      },
      stats: {
        day:            stats.day,
        peakPopulation: stats.peakPopulation,
        _simTick:       stats._simTick,
      },
    }));
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
}

export function loadGame(mode, { world, antSystem, queen, stats }) {
  try {
    const raw = localStorage.getItem(key(mode));
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.version !== VERSION) return false;

    world.tiles.set(d.world.tiles);
    world.foodAmount.set(d.world.foodAmount);
    world.waterAmount.set(d.world.waterAmount);
    world.digProgress.set(d.world.digProgress);
    world.foodStore         = d.world.foodStore;
    world.waterStore        = d.world.waterStore;
    world.tunnelCount       = d.world.tunnelCount;
    world.chamberCount      = d.world.chamberCount;
    world.stress            = d.world.stress;
    world._foodRespawnTimer = d.world._foodRespawnTimer;
    world.dirtyTiles.clear();
    world.dirty = true;

    antSystem.ants         = d.ants;
    antSystem.eggs         = d.eggs;
    antSystem.deaths       = d.antMeta.deaths;
    antSystem.recentDeaths = d.antMeta.recentDeaths;
    antSystem._hatchCount  = d.antMeta._hatchCount;
    Object.assign(antSystem.roleBoosts, d.antMeta.roleBoosts);

    Object.assign(queen, d.queen);

    stats.day            = d.stats.day;
    stats.peakPopulation = d.stats.peakPopulation;
    stats._simTick       = d.stats._simTick;

    return true;
  } catch (e) {
    console.error('Load failed:', e);
    return false;
  }
}

export function deleteSave(mode) {
  localStorage.removeItem(key(mode));
}
