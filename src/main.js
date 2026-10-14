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
import { Renderer } from './rendering/renderer.js';
import { Dashboard } from './ui/dashboard.js';
import { Controls } from './ui/controls.js';
import { Hud } from './ui/hud.js';
import { GameState } from './gameState.js';
import { logEvent } from './events.js';
import { hasSave, getSaveInfo, saveGame, loadGame, deleteSave } from './saveLoad.js';
import { Tutorial } from './ui/tutorial.js';

const canvas = document.getElementById('gameCanvas');

function resize() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', () => {
  resize();
  camera.resize(canvas.width, canvas.height);
  renderer.resize(canvas.width, canvas.height);
  hud?.layout();
});

let hud = null;   // made once the mode is known

const camera    = new Camera(canvas.width, canvas.height);
const renderer  = new Renderer(canvas);
const dashboard = new Dashboard();

// A colony is only built once the mode is known — it decides how long ants live
function createSim() {
  const world     = new World();
  const sky       = new Sky();
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
  const label = mode === 'survival' ? 'Survival' : 'Screensaver';
  document.getElementById('ms-resume-info').textContent =
    `${label} · Day ${info.day} · Peak population ${info.peakPopulation}`;

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
    ['screensaver', 'survival'].forEach(mode => {
      document.getElementById(`btn-mode-${mode}`).addEventListener('click', () => {
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

let sim = createSim();
if (shouldLoad && !loadGame(GameState.mode, sim)) {
  sim = createSim();
  updateSaveStatus('Save corrupted — starting fresh');
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

const gameLoop = new GameLoop(
  (dt) => {
    sky.update(world, antSystem);
    world.update(dt, sim);
    antSystem.update(dt, queen, sim);
    queen.update(world, antSystem);
    creatures.update(world, antSystem);
    stats.update(world, antSystem, queen);
  },
  (alpha, frameMs) => {
    // the camera runs on real time, however fast the colony is living
    const dt = frameMs / 1000;
    hud.update(dt);
    director.update(dt);
    camera.update(dt);

    renderer.render(camera, sim, alpha, frameMs, gameLoop.speed);
    if (hud.panelShown && (frame++ & 3) === 0) dashboard.update(stats, world, antSystem);

    if (GameState.mode === 'survival' && !GameState.over) {
      if (queen.health <= 0) triggerGameOver('The queen has perished.');
      else if (antSystem.population === 0 && antSystem.eggCount === 0)
        triggerGameOver('The last ant is gone.');
    }
  }
);

const controls = new Controls(camera, world, gameLoop, antSystem);
const input    = new InputHandler(canvas, camera, world, controls);
const director = new Director(camera, sim);
hud = new Hud({ camera, director, gameLoop, renderer, controls, sim });
let frame = 0;

// Manual save
document.getElementById('btn-save')?.addEventListener('click', () => {
  const ok = doSave();
  updateSaveStatus(ok ? `Saved — Day ${stats.day}` : 'Save failed');
});

new Tutorial().show(GameState.mode);

if (GameState.mode === 'survival') logEvent('Survival — keep the queen alive');

// Auto-save every 60 s
setInterval(() => {
  if (!GameState.over) {
    if (doSave()) updateSaveStatus(`Auto-saved — Day ${stats.day}`);
  }
}, 60_000);

gameLoop.start();
