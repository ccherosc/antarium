// Saves live in localStorage as pixelants_<mode>, with the format version inside the save.
//
// Changing what a save holds? Bump VERSION and add a MIGRATIONS entry. Never delete a migration:
// somebody's colony is still on that version. tests/fixtures/save-v2-screensaver.json is a real
// version-2 save, and npm test must keep resuming it.
export const VERSION = 3;

// MIGRATIONS[n] turns a version-n save into a version-(n+1) save
const MIGRATIONS = {
  2: d => ({ ...d, extra: {} }),
};

// Systems on `sim` beyond the core colony that save themselves (save() / load(data)); what
// they save goes in the save's `extra`. Survival run state (T5.1), decorations (T4.2).
const EXTRAS = ['run', 'decor'];

const key = mode => `pixelants_${mode}`;
const legacyKey = mode => `pixelants_v2_${mode}`;   // from when the version was part of the key

// The stored save: under the current key, else under the one earlier builds used. The first
// save after loading an old one writes the current key and removes the old.
function readRaw(mode) {
  try { return localStorage.getItem(key(mode)) || localStorage.getItem(legacyKey(mode)); }
  catch { return null; }   // storage blocked
}

export function hasSave(mode) {
  return !!readRaw(mode);
}

export function getSaveInfo(mode) {
  try {
    const d = JSON.parse(readRaw(mode));
    return d ? { day: d.stats.day, peakPopulation: d.stats.peakPopulation, ts: d.ts, name: d.name } : null;
  } catch { return null; }
}

// The save as plain data: what saveGame writes, and what the soak test measures
export function buildSave(sim) {
  const { world, sky, antSystem, queen, stats } = sim;
  const extra = {};
  for (const k of EXTRAS) if (sim[k]) extra[k] = sim[k].save();
  return {
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
    extra,
  };
}

export function saveGame(mode, sim) {
  try {
    localStorage.setItem(key(mode), JSON.stringify(buildSave(sim)));
    localStorage.removeItem(legacyKey(mode));   // only once the new copy is safely written
    return true;
  } catch (e) {
    console.error('Save failed:', e);
    return false;
  }
}

// Restores a save into a freshly built colony. If it returns false the colony may be
// half-loaded and should be thrown away.
export function loadGame(mode, sim) {
  try {
    const raw = readRaw(mode);
    if (!raw) return false;
    let d = JSON.parse(raw);
    if (!Number.isInteger(d.version) || d.version > VERSION) {   // not a save, or from a newer build
      console.warn(`Save is version ${d.version}; this build reads up to ${VERSION}`);
      return false;
    }
    while (d.version < VERSION) {
      const migrate = MIGRATIONS[d.version];
      if (!migrate) return false;
      d = { ...migrate(d), version: d.version + 1 };
    }

    const { world, sky, antSystem, queen, stats } = sim;
    world.load(d.world);
    sky.load(d.sky);
    antSystem.load(d.colony);
    queen.load(d.queen);
    for (const k of EXTRAS) if (sim[k] && d.extra?.[k] !== undefined) sim[k].load(d.extra[k]);

    stats.day            = d.stats.day;
    stats.peakPopulation = d.stats.peakPopulation;

    return true;
  } catch (e) {
    console.error('Load failed:', e);
    return false;
  }
}

export function deleteSave(mode) {
  try {
    localStorage.removeItem(key(mode));
    localStorage.removeItem(legacyKey(mode));   // or the old copy would come back as the saved colony
  } catch { /* storage blocked */ }
}
