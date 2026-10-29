import { World } from './simulation/world.js';
import { Sky } from './simulation/sky.js';
import { AntSystem } from './simulation/ants.js';
import { Queen } from './simulation/queen.js';
import { ColonyStats } from './simulation/stats.js';
import { CreatureSystem } from './simulation/creatures.js';
import { Camera } from './app/camera.js';
import { Director } from './app/director.js';
import { InputHandler } from './app/input.js';
import { GameLoop } from './app/gameLoop.js';
import { fastForward } from './app/fastForward.js';
import { Renderer } from './rendering/renderer.js';
import { Dashboard } from './ui/dashboard.js';
import { Controls } from './ui/controls.js';
import { Hud } from './ui/hud.js';
import { SettingsMenu } from './ui/settingsMenu.js';
import { GameState } from './gameState.js';
import { MODES, rules } from './modes.js';
import { CONFIG } from './config.js';
import { settings } from './settings.js';
import { logEvent, on } from './events.js';
import { hasSave, getSaveInfo, saveGame, loadGame, deleteSave } from './saveLoad.js';
import { Tutorial } from './ui/tutorial.js';
import { PerfReadout } from './ui/perfReadout.js';
import * as audio from './audio/audio.js';

// URL parameters, read once.
//   ?debug         expose window.__pa (once the colony is ready) for tests and skip the tutorial
//   ?mode=<name>   skip the menu and go straight into that mode (resumes its save)
//   ?new           with ?debug only: wipe that mode's save first (a stray link must never delete a colony)
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const canvas = document.getElementById('gameCanvas');

let hud = null;   // made once the mode is known

// The camera, the HUD and the mouse all work in window pixels. Low quality only gives the canvas
// fewer pixels than that, and the browser stretches it back up.
const camera   = new Camera(window.innerWidth, window.innerHeight);
const renderer = new Renderer(canvas);
function fitWindow() {
  camera.resize(window.innerWidth, window.innerHeight);
  renderer.resize(window.innerWidth, window.innerHeight, settings.get('quality') === 'low' ? CONFIG.LOW_QUALITY_SCALE : 1);
  hud?.layout();
}
fitWindow();
window.addEventListener('resize', fitWindow);

const dashboard = new Dashboard();

// A browser keeps a page silent until the player has touched it, so the sound starts with the first
// click, tap or key (this is before the menu, which is the first thing there is to click). Every later
// one tries again: a key that doesn't count as a touch, like Esc, may have left it locked.
for (const type of ['pointerdown', 'pointerup', 'keydown']) {
  window.addEventListener(type, () => audio.initAudio(), { capture: true });
}

// A colony is only built once the mode is known — it decides how long ants live
function createSim() {
  const world     = new World();
  const sky       = new Sky(rules().pregrow ? CONFIG.PREGROW_START_PHASE : CONFIG.DAY_START_PHASE);
  world.sky       = sky;
  const antSystem = new AntSystem(world);
  const queen     = new Queen(world);
  return { world, sky, antSystem, queen, stats: new ColonyStats(), creatures: new CreatureSystem() };
}

function updateSaveStatus(msg) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 4000);
}

// ── Mode selector ─────────────────────────────────────────────────────────────

function showConfirm(mode, resolve) {
  const info = getSaveInfo(mode);
  document.getElementById('ms-resume-info').textContent =
    `${MODES[mode].label} · Day ${info.day} · Peak population ${info.peakPopulation}`;

  document.getElementById('ms-pick').classList.add('hidden');
  document.getElementById('ms-confirm').classList.remove('hidden');

  document.getElementById('btn-resume').onclick = () => {
    document.getElementById('mode-select').classList.add('hidden');
    resolve(true);
  };
  document.getElementById('btn-new-colony').onclick = () => {
    deleteSave(mode);
    document.getElementById('mode-select').classList.add('hidden');
    resolve(false);
  };
}

function pickMode() {
  return new Promise(resolve => {
    const wanted = params.get('mode');
    if (Object.keys(MODES).includes(wanted)) {
      GameState.mode = wanted;
      if (DEBUG && params.has('new')) deleteSave(wanted);
      document.getElementById('mode-select').classList.add('hidden');
      resolve(hasSave(wanted));
      return;
    }

    Object.keys(MODES).forEach(mode => {
      document.getElementById(`btn-mode-${mode}`)?.addEventListener('click', () => {
        GameState.mode = mode;
        if (hasSave(mode) && getSaveInfo(mode)) {
          showConfirm(mode, resolve);
        } else {
          document.getElementById('mode-select').classList.add('hidden');
          resolve(false);
        }
      });
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────

const shouldLoad = await pickMode();
const savedTs = shouldLoad ? getSaveInfo(GameState.mode)?.ts : undefined;   // when it was last saved

let sim = createSim();
let resumed = shouldLoad;   // false once it is a new colony, however we got there
let bootNote = null;        // said once the colony is on screen; the founding overlay would hide it
if (shouldLoad && !loadGame(GameState.mode, sim)) {
  sim = createSim();
  resumed = false;
  bootNote = 'Save corrupted — starting fresh';
}
const { world, sky, antSystem, queen, stats, creatures } = sim;

function doSave() {
  return saveGame(GameState.mode, sim);
}

// ── Game over ─────────────────────────────────────────────────────────────────

function triggerGameOver(cause) {
  GameState.over = true;
  gameLoop.stop();
  deleteSave(GameState.mode);
  audio.playSfx('gameover');

  document.getElementById('go-cause').textContent = cause;
  document.getElementById('go-day').textContent   = `Survived Day ${stats.day}`;
  document.getElementById('go-stats').innerHTML   = [
    `Peak population: ${stats.peakPopulation}`,
    `Total deaths:    ${antSystem.deaths}`,
    `Tunnels dug:     ${stats.tunnelLength}`,
    `Chambers built:  ${stats.chamberCount}`,
  ].map(s => `<div>${s}</div>`).join('');

  document.getElementById('gameover').classList.remove('hidden');
}

document.getElementById('btn-restart')?.addEventListener('click', () => location.reload());

// ── Game loop ─────────────────────────────────────────────────────────────────

// One tick of the colony's life. The game loop runs it once per SIM_STEP, the fast-forward as fast as it can.
function tick(dt) {
  sky.update(world, antSystem);
  world.update(dt, sim);
  antSystem.update(dt, queen, sim);
  queen.update(world, antSystem);
  creatures.update(world, antSystem);
  stats.update(world, antSystem, queen);
}

const gameLoop = new GameLoop(
  tick,
  (alpha, frameMs) => {
    // the camera runs on real time, however fast the colony is living
    const dt = frameMs / 1000;
    hud.update(dt);
    director.update(dt);
    camera.update(dt);

    renderer.render(camera, sim, alpha, frameMs, gameLoop.speed);
    audio.updateAudio(sim, camera, gameLoop.speed);
    if (hud.panelShown && (frame++ & 3) === 0) dashboard.update(stats, world, antSystem);

    if (rules().gameOver && !GameState.over) {
      if (queen.health <= 0) triggerGameOver('The queen has perished.');
      else if (antSystem.population === 0 && antSystem.eggCount === 0)
        triggerGameOver('The last ant is gone.');
    }
  }
);

// The frame cap is the mode's own until the player picks one; a pick applies at once
settings.setDefault('fpsCap', rules().fpsCap);
gameLoop.fpsCap = settings.get('fpsCap');
settings.onChange((key, value) => {
  if (key === 'fpsCap') gameLoop.fpsCap = value;
  else if (key === 'quality') fitWindow();
});

if (DEBUG) {
  const perf = new PerfReadout({ cap: () => gameLoop.fpsCap, quality: () => settings.get('quality') });
  const drawFrame = gameLoop.onRender;
  gameLoop.onRender = (alpha, frameMs) => {
    const t0 = performance.now();
    drawFrame(alpha, frameMs);
    perf.frame(performance.now() - t0);
  };
}

const controls = new Controls(camera, world, gameLoop, antSystem);
const input    = new InputHandler(canvas, camera, world, controls);
const director = new Director(camera, sim);
hud = new Hud({ camera, director, gameLoop, renderer, controls, sim });
new SettingsMenu();
let frame = 0;

// ── Fast-forward ──────────────────────────────────────────────────────────────
// A new colony is grown into a busy nest before its first frame, and a resumed one lives on
// through the time the player was away. Both run the real simulation behind the founding overlay.

const founding     = document.getElementById('founding');
const foundingFill = document.getElementById('fd-fill');

// Ticks a resumed colony missed while the page was closed (0 when the save is too recent to matter)
function missedTicks(ts) {
  const away = Date.now() - ts;   // NaN when the save has no time on it
  if (!(away >= CONFIG.CATCHUP_MIN_MS)) return 0;
  return Math.min(Math.floor(away / gameLoop.SIM_STEP), Math.round(CONFIG.CATCHUP_MAX_DAYS * CONFIG.DAY_TICKS));
}

// Fast-forward behind the overlay, then fade it out. `progress` may add its own 0..1 to the bar.
// Resolves to the ticks run.
async function runBehindOverlay(text, { progress, ...limits }) {
  document.getElementById('fd-text').textContent = text;
  foundingFill.style.width = '0%';
  founding.style.transition = `opacity ${CONFIG.FF_FADE_MS}ms`;
  founding.classList.remove('hidden');

  let shown = 0;   // the bar never goes backwards
  let ticks = 0;
  try {
    ticks = await fastForward({
      step: () => tick(gameLoop.SIM_STEP),
      ...limits,
      onProgress: f => {
        shown = Math.max(shown, f, progress ? progress() : 0);
        foundingFill.style.width = `${Math.round(shown * 100)}%`;
      },
    });
  } catch (e) {
    console.error('Fast-forward failed; starting the colony as it is:', e);   // never stuck behind the overlay
  }
  founding.classList.add('fading');
  setTimeout(() => founding.classList.add('hidden'), CONFIG.FF_FADE_MS);
  return ticks;
}

// Returns what it did, or null when the colony just starts: { kind: 'pregrow', ticks } or
// { kind: 'catchUp', ticks, hatched, chambers }
async function fastForwardStart() {
  if (!resumed && rules().pregrow) {
    const from = antSystem.population;
    const ticks = await runBehindOverlay('Founding your colony…', {
      maxTicks: Math.round(CONFIG.PREGROW_DAYS * CONFIG.DAY_TICKS),
      until: () => antSystem.population >= CONFIG.PREGROW_POP && sky.light >= CONFIG.PREGROW_MIN_LIGHT,
      budgetMs: CONFIG.PREGROW_BUDGET_MS,
      progress: () => (antSystem.population - from) / Math.max(1, CONFIG.PREGROW_POP - from),
    });
    return { kind: 'pregrow', ticks };
  }

  const maxTicks = resumed && rules().catchUp ? missedTicks(savedTs) : 0;
  if (!maxTicks) return null;

  const chambersBefore = world.chamberCount;   // not stats.chamberCount: that reads 0 until the first tick
  let hatched = 0;
  const stopCounting = on('hatch', () => hatched++);
  const ticks = await runBehindOverlay('Catching up on your colony…', { maxTicks, budgetMs: CONFIG.CATCHUP_BUDGET_MS });
  stopCounting();
  const chambers = Math.max(0, world.chamberCount - chambersBefore);

  const news = [];
  if (hatched)  news.push(`${hatched} ${hatched === 1 ? 'ant' : 'ants'} hatched`);
  if (chambers) news.push(`${chambers} new ${chambers === 1 ? 'chamber' : 'chambers'}`);
  if (news.length) hud.toast(`While you were away: ${news.join(' · ')}`, 7000);
  return { kind: 'catchUp', ticks, hatched, chambers };
}

const startup = await fastForwardStart();
if (bootNote) updateSaveStatus(bootNote);

// Effects that follow the colony's events. Listening starts here, not earlier, so the weather and the
// hatchings of a fast-forward are not played back as one roar.
on('rainStart', () => audio.playSfx('thunder'));
on('hatch', e => audio.playSfx('hatch', e));

// Test/debug hook: tests/*.mjs drive the game through this (see claude.md). It appears once the
// colony is ready, so a test that waits for it never races the fast-forward.
if (DEBUG) window.__pa = { sim, gameLoop, camera, renderer, director, hud, GameState, CONFIG, settings, startup, audio };

// Manual save
document.getElementById('btn-save')?.addEventListener('click', () => {
  const ok = doSave();
  updateSaveStatus(ok ? `Saved — Day ${stats.day}` : 'Save failed');
});

if (!DEBUG) new Tutorial().show(GameState.mode);

if (rules().intro) logEvent(rules().intro);

function autoSave() {
  if (GameState.over) return;   // the save was deleted with the colony; don't bring it back
  if (doSave()) updateSaveStatus(`Auto-saved — Day ${stats.day}`);
}

// Auto-save every 60 s, and whenever the tab is hidden: a tab nobody is looking at is the one most
// likely to be closed, and the browser stops drawing it anyway
setInterval(autoSave, 60_000);
document.addEventListener('visibilitychange', () => { if (document.hidden) autoSave(); });

gameLoop.start();
