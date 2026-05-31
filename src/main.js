import { World } from './simulation/world.js';
import { AntSystem } from './simulation/ants.js';
import { Queen } from './simulation/queen.js';
import { ColonyStats } from './simulation/stats.js';
import { Camera } from './app/camera.js';
import { InputHandler } from './app/input.js';
import { GameLoop } from './app/gameLoop.js';
import { Renderer } from './rendering/renderer.js';
import { Dashboard } from './ui/dashboard.js';
import { Controls } from './ui/controls.js';
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
});

const world     = new World();
const antSystem = new AntSystem(world);
const queen     = new Queen();
const stats     = new ColonyStats();
const camera    = new Camera(canvas.width, canvas.height);
const renderer  = new Renderer(canvas);
const dashboard = new Dashboard();

// ── Save helpers ──────────────────────────────────────────────────────────────

function doSave() {
  return saveGame(GameState.mode, { world, antSystem, queen, stats });
}

function updateSaveStatus(msg) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.textContent = msg;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.textContent = ''; }, 4000);
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
        if (hasSave(mode)) {
          showConfirm(mode, resolve);
        } else {
          document.getElementById('mode-select').classList.add('hidden');
          resolve(false);
        }
      });
    });
  });
}

// ── Game loop ─────────────────────────────────────────────────────────────────

const gameLoop = new GameLoop(
  (dt) => {
    world.update(dt, { antSystem, queen });
    antSystem.update(dt, queen, { world });
    queen.update(world, antSystem, {});
    stats.update(world, antSystem, queen);
  },
  () => {
    renderer.render(camera, world, antSystem, queen);
    dashboard.update(stats, world, antSystem);

    if (GameState.mode === 'survival' && !GameState.over) {
      if (queen.health <= 0) triggerGameOver('The queen has perished.');
      else if (antSystem.population === 0 && antSystem.eggCount === 0)
        triggerGameOver('The last ant is gone.');
    }
  }
);

const controls = new Controls(camera, world, gameLoop, antSystem);
const input    = new InputHandler(canvas, camera, world, controls);

// Manual save
document.getElementById('btn-save')?.addEventListener('click', () => {
  const ok = doSave();
  updateSaveStatus(ok ? `Saved — Day ${stats.day}` : 'Save failed');
});

// ── Boot ──────────────────────────────────────────────────────────────────────

const shouldLoad = await pickMode();

new Tutorial().show(GameState.mode);

if (shouldLoad) {
  if (!loadGame(GameState.mode, { world, antSystem, queen, stats })) {
    updateSaveStatus('Save corrupted — starting fresh');
  }
}

if (GameState.mode === 'survival') logEvent('Survival — keep the queen alive');

// Auto-save every 60 s
setInterval(() => {
  if (!GameState.over) {
    if (doSave()) updateSaveStatus(`Auto-saved — Day ${stats.day}`);
  }
}, 60_000);

gameLoop.start();
