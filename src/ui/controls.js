import { TILE, CONFIG } from '../config.js';
import { setPheromoneOverlay, getPheromoneOverlay } from '../rendering/renderWorld.js';

export class Controls {
  constructor(camera, world, gameLoop, antSystem) {
    this.camera = camera;
    this.world = world;
    this.gameLoop = gameLoop;
    this.antSystem = antSystem;
    this.activeTool = 'food';
    this.inspectInfo = null;

    this._setupButtons();
    this._setupSliders();
    this._setupNudgeButtons();
  }

  _setupButtons() {
    const toolBtns = document.querySelectorAll('.tool-btn:not(#btn-pher-toggle)');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        toolBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTool = btn.dataset.tool;
        document.getElementById('inspect-panel').classList.add('hidden');
      });
    });

    const pherBtn = document.getElementById('btn-pher-toggle');
    pherBtn?.addEventListener('click', function() {
      const next = !getPheromoneOverlay();
      setPheromoneOverlay(next);
      this.classList.toggle('active', next);
    });

    document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
      this.camera.zoomAt(1.3, this.camera.cw / 2, this.camera.ch / 2);
    });
    document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
      this.camera.zoomAt(0.77, this.camera.cw / 2, this.camera.ch / 2);
    });
    document.getElementById('btn-zoom-reset')?.addEventListener('click', () => {
      this.camera.fitWorld();
    });
  }

  _setupSliders() {
    const digSlider = document.getElementById('ctrl-dig-rate');
    digSlider?.addEventListener('input', e => {
      CONFIG.DIG_TICKS = Math.round(50 + (100 - parseInt(e.target.value)) * 3.5);
    });

    const birthSlider = document.getElementById('ctrl-birth-rate');
    birthSlider?.addEventListener('input', e => {
      CONFIG.QUEEN_EGG_INTERVAL = Math.round(800 - parseInt(e.target.value) * 6);
    });

    const speedSlider = document.getElementById('ctrl-speed');
    speedSlider?.addEventListener('input', e => {
      this.gameLoop.setSpeed(parseFloat(e.target.value));
    });

    const foodSlider = document.getElementById('ctrl-food-rate');
    foodSlider?.addEventListener('input', e => {
      CONFIG.FOOD_DECAY_RATE = 0.0001 + parseInt(e.target.value) * 0.0004;
    });
  }

  _setupNudgeButtons() {
    document.querySelectorAll('.boost-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const role = btn.dataset.role;
        this.antSystem.roleBoosts[role] = (this.antSystem.roleBoosts[role] + 1) % 3;
        this._refreshNudgeBtn(btn, this.antSystem.roleBoosts[role]);
      });
    });
  }

  _refreshNudgeBtn(btn, level) {
    btn.className = 'boost-btn' + (level > 0 ? ' b' + level : '');
    btn.textContent = level === 0 ? '+' : level === 1 ? '▲' : '▲▲';
    btn.title = level === 0 ? 'No boost' : level === 1 ? 'Moderate boost (2×)' : 'Strong boost (4×)';
  }

  handleTileClick(tx, ty, world) {
    if (this.activeTool === 'food') {
      if (world.placeFood(tx, ty, 80)) {
        world.dirty = true;
        this._flashTile(tx, ty);
      }
    } else if (this.activeTool === 'water') {
      if (world.placeWater(tx, ty, 70)) {
        world.dirty = true;
        this._flashTile(tx, ty);
      }
    } else if (this.activeTool === 'inspect') {
      this._inspect(tx, ty, world);
    } else if (this.activeTool === 'soil') {
      if (world.get(tx, ty) === TILE.TUNNEL || world.get(tx, ty) === TILE.CHAMBER) {
        world.set(tx, ty, TILE.SOIL);
        world.dirty = true;
      }
    }
  }

  _inspect(tx, ty, world) {
    const t = world.get(tx, ty);
    const typeNames = ['Air', 'Surface', 'Soil', 'Tunnel', 'Chamber', 'Glass', 'Food', 'Water', 'Egg'];
    const panel = document.getElementById('inspect-panel');
    const content = document.getElementById('inspect-content');
    if (!panel || !content) return;

    const i = world.idx(tx, ty);
    const info = [
      `Tile: ${typeNames[t] || 'Unknown'} (${tx},${ty})`,
      `Hardness: ${Math.round(world.hardness[i])}`,
      t === TILE.FOOD ? `Food: ${Math.round(world.foodAmount[i])}` : '',
      t === TILE.WATER ? `Water: ${Math.round(world.waterAmount[i])}` : '',
      `Pheromone ↑: ${world.pheromoneFood[i].toFixed(2)}`,
      `Pheromone ⌂: ${world.pheromoneHome[i].toFixed(2)}`,
    ].filter(Boolean);

    content.innerHTML = info.map(l => `<div>${l}</div>`).join('');
    panel.classList.remove('hidden');
    this.inspectInfo = { tx, ty };
  }

  _flashTile(tx, ty) {
    // Visual feedback (brief highlight) — handled by dirty redraw
  }
}
