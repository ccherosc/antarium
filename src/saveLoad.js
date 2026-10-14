const VERSION = 2;
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

export function saveGame(mode, { world, sky, antSystem, queen, stats }) {
  try {
    localStorage.setItem(key(mode), JSON.stringify({
      version: VERSION,
      ts: Date.now(),
      world: world.save(),
      sky: sky.save(),
      colony: antSystem.save(),
      queen: queen.save(),
      stats: {
        day:            stats.day,
        peakPopulation: stats.peakPopulation,
      },
    }));
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
}

// Restores a save into a freshly built colony. If it returns false the colony may be
// half-loaded and should be thrown away.
export function loadGame(mode, { world, sky, antSystem, queen, stats }) {
  try {
    const raw = localStorage.getItem(key(mode));
    if (!raw) return false;
    const d = JSON.parse(raw);
    if (d.version !== VERSION) return false;

    world.load(d.world);
    sky.load(d.sky);
    antSystem.load(d.colony);
    queen.load(d.queen);

    stats.day            = d.stats.day;
    stats.peakPopulation = d.stats.peakPopulation;

    return true;
  } catch (e) {
    console.error('Load failed:', e);
    return false;
  }
}

export function deleteSave(mode) {
  localStorage.removeItem(key(mode));
}
