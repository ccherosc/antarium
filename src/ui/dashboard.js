import { GameState } from '../gameState.js';

export class Dashboard {
  constructor() {
    this._els = {};
    const ids = [
      'stat-population', 'stat-eggs', 'stat-queen-health',
      'stat-food', 'stat-water', 'stat-vitality',
      'stat-happiness', 'stat-birthrate',
      'stat-tunnels', 'stat-chambers',
      'stat-day',
    ];
    for (const id of ids) {
      this._els[id] = document.getElementById(id);
    }
    this._bars = {};
    const barIds = ['queen-health', 'food', 'water', 'vitality', 'happiness', 'birthrate'];
    for (const id of barIds) {
      this._bars[id] = document.getElementById(`bar-${id}`);
    }
    this._tickEl = document.getElementById('sim-tick');
    this._tick = 0;
  }

  _set(id, val) {
    const el = this._els[id];
    if (el && el.textContent !== String(val)) el.textContent = val;
  }

  _setBar(id, pct) {
    const el = this._bars[id];
    if (!el) return;
    const p = Math.round(Math.max(0, Math.min(100, pct)));
    el.style.width = p + '%';
    el.style.background = p > 70 ? '#4a8' : p > 40 ? '#a84' : '#a44';
  }

  update(stats, world, antSystem) {
    this._tick++;

    this._set('stat-population', stats.population);
    this._set('stat-eggs', stats.eggs);
    this._set('stat-queen-health', Math.round(stats.queenHealth) + '%');
    this._set('stat-food', Math.round(stats.foodSupply));
    this._set('stat-water', Math.round(stats.waterSupply));
    this._set('stat-vitality', stats.vitality + '%');
    this._set('stat-happiness', stats.happiness + '%');
    this._set('stat-birthrate', stats.birthRate + '%');
    this._set('stat-tunnels', stats.tunnelLength);
    this._set('stat-chambers', stats.chamberCount);
    this._set('stat-day', 'DAY ' + stats.day);

    this._setBar('queen-health', stats.queenHealth);
    this._setBar('food', (stats.foodSupply / 1000) * 100);
    this._setBar('water', (stats.waterSupply / 1000) * 100);
    this._setBar('vitality', stats.vitality);
    this._setBar('happiness', stats.happiness);
    this._setBar('birthrate', stats.birthRate);

    if (this._tickEl) this._tickEl.textContent = this._tick;

    const modeEl = document.getElementById('stat-mode');
    if (modeEl) {
      const survival = GameState.mode === 'survival';
      modeEl.textContent = survival ? 'SURVIVAL' : 'SCREENSAVER';
      modeEl.className = 'dash-mode' + (survival ? ' survival' : '');
    }

    if (antSystem) {
      const rc  = antSystem.roleCounts;
      const pop = Math.max(1, antSystem.population);
      const roles = ['forager', 'digger', 'worker', 'nurse', 'explorer'];
      for (const r of roles) {
        const cnt = rc[r];
        const pct = (cnt / pop) * 100;
        const cntEl = document.getElementById(`stat-role-${r}`);
        const barEl = document.getElementById(`bar-role-${r}`);
        if (cntEl && cntEl.textContent !== String(cnt)) cntEl.textContent = cnt;
        if (barEl) barEl.style.width = Math.round(pct) + '%';
      }
    }
  }
}
