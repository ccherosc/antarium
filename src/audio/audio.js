import { CONFIG } from '../config.js';
import { settings } from '../settings.js';
import { whiteNoise, brownNoise } from './noise.js';
import { watchView, layerTargets, soilRate, heardAt } from './mix.js';

// Sound: a soundscape the sky drives, and a few one-shot effects. All of it is made here with
// WebAudio, so there are no sound files (RECORDED says how a recording can replace a layer). It is
// optional: where the browser has no WebAudio, or anything in here throws, the game goes on in silence.
//
//   initAudio()                       the first click, tap or key (src/main.js) makes the audio context
//   updateAudio(sim, camera, speed)   every frame; a few times a second it re-aims the layers
//   playSfx(name, at)                 a one-shot effect: place, unlock, thunder, hatch, gameover
//
// The layers each have a gain node, and updateAudio only sets where that gain is heading:
//   wind    brown noise, low-passed             rain   white noise, band-passed
//   night   clusters of insect chirps           birds  sine sweeps at dawn
//   soil    tiny clicks where ants dig in view
// What drives their loudness is in mix.js.

const LAYERS = ['wind', 'rain', 'night', 'birds', 'soil'];

// How the sounds are made. What follows the game (how loud, how often) is in CONFIG.
const LOOP_SECONDS = { wind: 4, rain: 2 };   // length of each looped noise buffer
const RUMBLE_HIGHPASS = 60;   // Hz, for the wind and the thunder. Brown noise is mostly far lower than this, which small speakers can't play
const WIND_LOWPASS = 350;     // Hz
const RAIN_BAND = 3000;       // Hz
const RAIN_Q = 0.7;
const LOOKAHEAD = 0.6;        // seconds ahead of the clock that chirps and clicks are booked: longer than a stutter in the frame rate
const NAP_MS = 400;           // a muted or hidden context is suspended after this long, once its volume has faded away
const AUDIBLE = 0.005;        // below this gain a layer is not worth booking events for

// recorded loop: a layer plays a recording instead of the sound made here once it has loaded.
// Name the file by layer, e.g. { wind: 'assets/audio/wind.ogg' }. The files are listed, not looked
// for, so that a game without any asks the server for nothing.
const RECORDED = {};

let ctx = null;          // the audio context, made by the first click, tap or key
let graph = null;        // its nodes (buildGraph)
let dead = false;        // the browser has no WebAudio, or it threw: the game goes on without sound
let started = false;     // updateAudio has run, so the colony is on screen and the sound may come up
let lastUpdate = 0;      // real time of the last re-aim
let lastCamera = null;   // the camera as of the last updateAudio: an effect that happens somewhere (a hatching) needs it
let nap = 0;             // timer that suspends the context when nobody can hear it
const lastSfx = {};      // effect -> when it last played, on the audio clock
const played = {};       // effect -> how many have played (the tests count them)

const level = () => (settings.get('muted') ? 0 : settings.get('volume'));

function fail(e) {
  if (dead) return;
  dead = true;
  console.error('Sound stopped:', e);
  try { ctx?.close().catch(() => {}); } catch { /* never opened, or already closed */ }
}

// Sound must never take the game down with it: updateAudio runs inside the frame, and an exception
// there would stop the game loop for good
function guard(fn) {
  try { return fn(); } catch (e) { fail(e); }
}

// ── The graph ─────────────────────────────────────────────────────────────────

function noiseBuffer(ctx, seconds, fill, channels = 2) {
  const buffer = ctx.createBuffer(channels, Math.round(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let c = 0; c < channels; c++) fill(buffer.getChannelData(c));
  return buffer;
}

function looping(ctx, buffer) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  return src;
}

function filter(ctx, type, frequency, Q = Math.SQRT1_2) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  return f;
}

function gain(ctx, value) {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

// Builds the sound into `ctx` and starts it, all of it silent until a gain is raised:
//
//   each layer → master (the player's volume) → fade (up when the colony appears) → limiter → destination
//   effects ───→ master
//
// Takes any context, so the tests can render it with an OfflineAudioContext and measure the result.
export function buildGraph(ctx, destination = ctx.destination) {
  const limiter = ctx.createDynamicsCompressor();   // insurance for a clap of thunder over everything else
  limiter.threshold.value = -8;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  limiter.connect(destination);

  const fade = gain(ctx, 0);
  fade.connect(limiter);
  const master = gain(ctx, 0);
  master.connect(fade);
  const sfx = gain(ctx, 1);
  sfx.connect(master);

  const layers = {};
  for (const name of LAYERS) {
    layers[name] = gain(ctx, 0);
    layers[name].connect(master);
  }

  const brown = noiseBuffer(ctx, LOOP_SECONDS.wind, data => brownNoise(data));
  const white = noiseBuffer(ctx, LOOP_SECONDS.rain, data => whiteNoise(data));
  const clicks = noiseBuffer(ctx, 0.5, data => whiteNoise(data), 1);

  // recorded loop: wind
  const windHigh = filter(ctx, 'highpass', RUMBLE_HIGHPASS);
  const windLow = filter(ctx, 'lowpass', WIND_LOWPASS);
  const windTrim = gain(ctx, CONFIG.AUDIO_TRIM.wind);
  const wind = looping(ctx, brown);
  wind.connect(windHigh);
  windHigh.connect(windLow);
  windLow.connect(windTrim);
  windTrim.connect(layers.wind);

  // recorded loop: rain
  const rainBand = filter(ctx, 'bandpass', RAIN_BAND, RAIN_Q);
  const rainTrim = gain(ctx, CONFIG.AUDIO_TRIM.rain);
  const rain = looping(ctx, white);
  rain.connect(rainBand);
  rainBand.connect(rainTrim);
  rainTrim.connect(layers.rain);

  // recorded loop: night, birds and soil are single events, booked by book()
  wind.start();
  rain.start();

  return {
    ctx, master, fade, sfx, layers, limiter,
    buffers: { brown, white, clicks },
    sources: { wind, rain },
    filters: { windHigh, windLow, rainBand },
    sched: { night: { next: 0 }, birds: { next: 0 }, soil: { next: 0 } },   // when the next event of each is due
    recorded: new Set(),   // layers that play a recording
  };
}

// ── Voices ────────────────────────────────────────────────────────────────────

// Connects `node` to `out`, `pan` of the way from the middle to the left (-1) or right (1)
function send(ctx, node, out, pan = 0) {
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    p.connect(out);
  } else {
    node.connect(out);
  }
}

// One note: a wave that gets loud in `attack` seconds and dies away over the rest of `dur`, gliding
// from `freq` to `to` Hz meanwhile
function tone(ctx, out, { at, freq, to = freq, dur, peak, pan = 0, type = 'sine', attack = 0.003 }) {
  const osc = ctx.createOscillator(), env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  env.gain.setValueAtTime(0.001, at);
  env.gain.linearRampToValueAtTime(peak, at + attack);
  env.gain.exponentialRampToValueAtTime(0.001, at + dur);
  osc.connect(env);
  send(ctx, env, out, pan);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

const wander = () => (Math.random() * 2 - 1) * 0.8;   // somewhere across the screen

// Night: three short chirps
function chirps({ ctx, layers }, at) {
  const freq = 4000 + Math.random() * 1000, pan = wander();
  for (let i = 0; i < 3; i++) tone(ctx, layers.night, { at: at + i * 0.06, freq, to: freq * 1.08, dur: 0.025, peak: 0.9, pan });
}

// Dawn: two or three bright upward sweeps
function song({ ctx, layers }, at) {
  const from = 2000 * (0.9 + Math.random() * 0.2), pan = wander();
  const notes = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < notes; i++) tone(ctx, layers.birds, { at: at + i * 0.22, freq: from, to: from * 1.75, dur: 0.15, peak: 0.8, pan });
}

// Soil: a few milliseconds of noise, from where an ant that is digging in view is
function click({ ctx, layers, buffers }, at, { diggers }) {
  const src = ctx.createBufferSource(), env = ctx.createGain();
  src.buffer = buffers.clicks;
  const band = filter(ctx, 'bandpass', 1500 + Math.random() * 2500, 2);
  env.gain.setValueAtTime(3.5, at);   // what the band-pass leaves of a few milliseconds of noise is about this much quieter
  env.gain.exponentialRampToValueAtTime(0.001, at + 0.006);
  src.connect(band);
  band.connect(env);
  send(ctx, env, layers.soil, diggers[Math.floor(Math.random() * diggers.length)]);
  src.start(at, Math.random() * (buffers.clicks.duration - 0.02), 0.012);
}

// Chirps, songs and clicks are single events. Each is booked a little ahead of the clock, at the
// gaps this says (in seconds; the soil's is random, at `rate` a second).
const EVENTS = {
  night: { gap: () => 0.3 + Math.random() * 0.9, play: chirps },
  birds: { gap: () => 1.2 + Math.random() * 3, play: song },
  soil:  { gap: rate => -Math.log(1 - Math.random()) / rate, play: click },
};

// Books the events that fall before `now` + LOOKAHEAD for the layers that are loud enough to hear.
// Calling it again with a later `now` carries on where it left off.
export function book(graph, targets, view, speed, now) {
  const rate = soilRate(view.diggers.length, speed);
  for (const [name, event] of Object.entries(EVENTS)) {
    const sched = graph.sched[name];
    const wanted = targets[name] > AUDIBLE && !graph.recorded.has(name) && (name !== 'soil' || rate > 0);
    if (!wanted) { sched.next = 0; continue; }   // starts afresh, a gap from now, when it is wanted again

    if (sched.next < now) sched.next = now + event.gap(rate);   // also after a stall: the missed ones are not played in a heap
    while (sched.next < now + LOOKAHEAD) {
      event.play(graph, sched.next, view);
      sched.next += event.gap(rate);
    }
  }
}

// ── Effects ───────────────────────────────────────────────────────────────────
// Each makes its sound at time `at` into graph.sfx; `pan` says where from, for those that happen somewhere.

export const SFX = {
  // a soft pluck, a little lower as it dies away
  place({ ctx, sfx }, at) {
    tone(ctx, sfx, { at, freq: 620, to: 520, dur: 0.28, peak: 0.35, attack: 0.004 });
    tone(ctx, sfx, { at, freq: 1240, to: 1040, dur: 0.12, peak: 0.08, attack: 0.004 });
  },

  // two notes of a chime, the second higher
  unlock({ ctx, sfx }, at) {
    tone(ctx, sfx, { at, freq: 659, dur: 0.8, peak: 0.3, attack: 0.01 });
    tone(ctx, sfx, { at: at + 0.14, freq: 988, dur: 1, peak: 0.3, attack: 0.01 });
  },

  // a low swell of noise that rolls away. Once the rumble nobody can hear is filtered out, brown noise
  // is quiet, hence an envelope that goes above 1: it comes out a little louder than full rain.
  thunder({ ctx, sfx, buffers }, at) {
    const src = looping(ctx, buffers.brown), env = ctx.createGain();
    const high = filter(ctx, 'highpass', RUMBLE_HIGHPASS), low = filter(ctx, 'lowpass', 500);
    low.frequency.setValueAtTime(500, at);
    low.frequency.exponentialRampToValueAtTime(120, at + 5);
    env.gain.setValueAtTime(0.001, at);
    env.gain.exponentialRampToValueAtTime(2.6, at + 0.9);
    env.gain.exponentialRampToValueAtTime(0.001, at + 5);
    src.connect(high);
    high.connect(low);
    low.connect(env);
    env.connect(sfx);
    src.start(at, Math.random() * buffers.brown.duration);
    src.stop(at + 5.1);
  },

  // a tiny pop
  hatch({ ctx, sfx }, at, pan) {
    tone(ctx, sfx, { at, freq: 320, to: 900, dur: 0.05, peak: 0.25, pan });
  },

  // a low tone that falls away
  gameover({ ctx, sfx }, at) {
    tone(ctx, sfx, { at, freq: 220, to: 55, dur: 1.8, peak: 0.5, attack: 0.02, type: 'triangle' });
  },
};

// ── Running it ────────────────────────────────────────────────────────────────

// Makes the audio context. Browsers keep a page silent until the player has touched it, so this
// runs on the first click, tap or key; main.js calls it for every later one too, which unlocks a
// context that a key which does not count as a gesture (Esc) left locked.
export function initAudio() {
  if (dead) return;
  if (ctx) { settle(); return; }
  guard(() => {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) { dead = true; return; }
    ctx = new AudioContext({ latencyHint: 'playback' });   // a soundscape needs steady sound, not quick sound
    graph = buildGraph(ctx);
    for (const [name, url] of Object.entries(RECORDED)) useRecording(name, url);
    settings.onChange(key => { if (key === 'volume' || key === 'muted') applyVolume(); });
    document.addEventListener('visibilitychange', settle);
    applyVolume();
  });
}

function applyVolume() {
  if (!ctx || dead) return;
  guard(() => graph.master.gain.setTargetAtTime(level(), ctx.currentTime, 0.08));
  settle();
}

// A context nobody can hear (muted, or its tab hidden) is suspended so that it costs nothing, after
// a moment for the volume to fade away; one somebody can hear is resumed
function settle() {
  if (!ctx || dead) return;
  clearTimeout(nap);
  if (!document.hidden && level() > 0) {
    ctx.resume().catch(() => {});   // harmless when it is running; waits for a gesture when the browser wants one
  } else {
    nap = setTimeout(() => { if (document.hidden || level() === 0) ctx.suspend().catch(() => {}); }, NAP_MS);
  }
}

// Called every frame. The layers are re-aimed a few times a second, and the colony being on screen
// is what lets the sound fade in.
export function updateAudio(sim, camera, speed = 1) {
  if (!ctx || dead) return;
  guard(() => {
    lastCamera = camera;
    if (ctx.state !== 'running') return;   // muted, hidden, or still locked: nothing to aim
    const stamp = performance.now();
    if (started && stamp - lastUpdate < CONFIG.AUDIO_UPDATE_MS) return;
    lastUpdate = stamp;

    const now = ctx.currentTime;
    if (!started) {
      started = true;
      graph.fade.gain.cancelScheduledValues(now);
      graph.fade.gain.setValueAtTime(0, now);
      graph.fade.gain.linearRampToValueAtTime(1, now + CONFIG.AUDIO_FADE_IN);
    }

    const seen = watchView(sim, camera);
    const targets = layerTargets(sim.sky, seen);
    for (const name of LAYERS) graph.layers[name].gain.setTargetAtTime(targets[name], now, CONFIG.AUDIO_GLIDE);
    book(graph, targets, seen, speed, now);
  });
}

// One-shot effect `name`. `at` is where it happens, in tiles ({ x, y }), for those that can only be
// heard from close: it is not played when the camera is far from it or looking elsewhere.
// Returns whether it played. It does not before the colony is on screen, nor while the sound is
// muted, nor when the same effect has just played.
export function playSfx(name, at) {
  if (!ctx || dead || !started || ctx.state !== 'running' || level() === 0) return false;
  const make = SFX[name];
  if (!make) return false;

  const now = ctx.currentTime;
  if (now - (lastSfx[name] ?? -Infinity) < CONFIG.AUDIO_SFX_GAP) return false;
  let pan = 0;
  if (at) {
    pan = lastCamera ? heardAt(lastCamera, at.x, at.y) : null;
    if (pan === null) return false;
  }

  return guard(() => {
    make(graph, now + 0.01, pan);
    lastSfx[name] = now;
    played[name] = (played[name] ?? 0) + 1;
    return true;
  }) ?? false;
}

// A recording in place of a layer's made sound: it loops, and the layer's gain works on it as on the
// rest. Resolves to whether it took over (not when the file would not load; the made sound stays).
export function useRecording(name, url) {
  if (!ctx || dead || !LAYERS.includes(name)) return Promise.resolve(false);
  return fetch(url)
    .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.arrayBuffer(); })
    .then(bytes => new Promise((done, reject) => {
      // the callback form, for older Safari. Newer browsers also return a promise, which rejects with
      // the same error that `reject` has already passed on: left alone, it is reported as unhandled
      ctx.decodeAudioData(bytes, done, reject)?.catch(() => {});
    }))
    .then(buffer => guard(() => {
      const src = looping(ctx, buffer);
      src.connect(graph.layers[name]);
      src.start();
      graph.sources[name]?.stop();   // wind and rain: the noise made here
      graph.recorded.add(name);
      return true;
    }) ?? false)
    .catch(() => false);
}

// For the tests: the live context and graph, and what has been played
export function audioGraph() {
  return ctx ? { ctx, graph, started, dead, played } : null;
}
