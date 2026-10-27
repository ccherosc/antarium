// Player settings, persisted. The settings menu, sound, themes, clock and frame cap all read
// and write through here: settings.get('volume'), settings.set('volume', 0.2),
// settings.onChange((key, value) => ...). The HUD's own prefs (hud.js) and the tutorial flag
// are separate and stay where they are.
const KEY = 'pixelants_settings';
const DEFAULTS = Object.freeze({
  volume: 0.6,          // 0..1 master
  muted: false,
  fpsCap: 60,           // 30 | 60 | 0 (unlimited)
  quality: 'high',      // 'high' | 'low'
  theme: 'classic',
  showClock: false,
  clock24h: false,
  reducedMotion: false, // starts true when the OS asks for less motion, until the player chooses
  textScale: 1,         // 1 | 1.25 | 1.5
});

// A known setting, of the right type. Storage is hand-editable and a menu can send strings,
// so loading and set() hold to the same rule — otherwise a value would "work" until the reload.
const valid = (k, v) => Object.hasOwn(DEFAULTS, k) && typeof v === typeof DEFAULTS[k]
  && (typeof v !== 'number' || Number.isFinite(v));

// Only what the player actually chose is written back. Derived defaults (the OS motion
// preference) must not get frozen in just because some other setting changed.
const stored = {};
try {
  const raw = JSON.parse(localStorage.getItem(KEY));
  for (const k in DEFAULTS) if (valid(k, raw?.[k])) stored[k] = raw[k];
} catch { /* private window, blocked storage or corrupt JSON: use the defaults */ }

const data = { ...DEFAULTS, ...stored };
if (!('reducedMotion' in stored) && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
  data.reducedMotion = true;
}

const subs = [];

export const settings = {
  get: k => data[k],
  set(k, v) {
    if (!valid(k, v)) return;
    const changed = data[k] !== v;
    if (!changed && k in stored) return;   // nothing new; an unchosen default can still be pinned
    data[k] = stored[k] = v;
    try { localStorage.setItem(KEY, JSON.stringify(stored)); } catch { /* full or private */ }
    if (changed) for (const fn of subs) fn(k, v);
  },
  onChange: fn => { subs.push(fn); },
  defaults: DEFAULTS,
};
