import { GameState } from '../gameState.js';
import { rules } from '../modes.js';
import { onEvent } from '../events.js';
import { settings } from '../settings.js';

const PREFS_KEY = 'pixelants_prefs';
const SPEEDS = [0.5, 1, 2, 4, 8];
const PAN_SPEED = 640;   // screen pixels a second

// Keys that move the view for as long as they are held
const PAN = {
  arrowleft: [-1, 0], a: [-1, 0],
  arrowright: [1, 0], d: [1, 0],
  arrowup:   [0, -1], w: [0, -1],
  arrowdown: [0, 1],  s: [0, 1],
};

// Keys that are none of the farm's business: pressing one must not end the tour
const QUIET = new Set([
  'shift', 'control', 'alt', 'altgraph', 'meta', 'os', 'capslock', 'numlock', 'scrolllock',
  'printscreen', 'contextmenu', 'pause', 'dead', 'unidentified',
]);

function loadPrefs() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PREFS_KEY)); } catch { /* none, or not ours */ }
  if (!p || typeof p !== 'object') p = {};
  if (!p.auto || typeof p.auto !== 'object') p.auto = {};
  return p;
}

function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private window */ }
}

// The farm's clock, to the ten minutes
export function clockText(phase) {
  const m = Math.floor((((phase % 1) + 1) % 1) * 144) * 10;
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}

// Everything on the page that is not the farm: what is showing, what is hidden while the
// director has the camera, the caption under its shots, and the keyboard.
export class Hud {
  constructor({ camera, director, gameLoop, renderer, controls, sim }) {
    this.camera = camera;
    this.director = director;
    this.gameLoop = gameLoop;
    this.renderer = renderer;
    this.controls = controls;
    this.sim = sim;

    const $ = id => document.getElementById(id);
    this._dash   = $('dashboard');
    this._title  = $('cap-title');
    this._status = $('cap-status');
    this._news   = $('cap-event');
    this._toast  = $('toast');
    this._hint   = $('hint');
    this._speed  = $('ctrl-speed');
    this._auto   = $('ctrl-auto-camera');
    this._dialogs = [$('tutorial'), $('gameover'), $('mode-select')].filter(Boolean);

    const prefs = this._prefs = loadPrefs();
    this.panel = typeof prefs.panel === 'boolean' ? prefs.panel : window.innerWidth >= 720;
    this.cine = false;   // the director has the camera and everything is put away

    const mode = GameState.mode;
    director.auto = typeof prefs.auto[mode] === 'boolean' ? prefs.auto[mode] : rules().autoTour;
    if (this._auto) this._auto.checked = director.auto;

    director.blocked  = () => gameLoop.speed === 0 || this._dialogUp();
    director.speed    = () => gameLoop.speed;
    director.onChange = on => this._setCine(on);
    director.onShot   = shot => this._setTitle(shot.title);
    onEvent(msg => this._setNews(msg));

    this._lastSpeed = gameLoop.speed || 1;
    this._keys = new Set();
    this._statusAge = 1;
    this._quietUntil = 0;   // mouse movement counts for nothing until then
    this._mx = null;
    this._my = null;
    this._toured = false;
    this._lock = null;

    this._bind();
    this.layout(true);
    camera.fitWorld();
  }

  get panelShown() { return this.panel && !this.cine; }

  // Tell the page and the camera what is showing
  layout(immediately = false) {
    const shown = this.panelShown;
    const body = document.body;
    body.classList.toggle('no-panel', !shown);
    body.classList.toggle('cine', this.cine);

    // on a narrow screen the panel lies over the farm rather than beside it
    const pw = this._dash?.offsetWidth || 220;
    const beside = shown && this.camera.cw - pw >= 480 ? pw : 0;
    this.camera.setInset(beside, immediately);
    body.style.setProperty('--panel-w', beside + 'px');
    this.renderer.hud = !this.cine;
  }

  // dt: seconds of real time
  update(dt) {
    if (this._keys.size && !this.director.active) {
      let dx = 0, dy = 0;
      for (const k of this._keys) { dx += PAN[k][0]; dy += PAN[k][1]; }
      if (dx || dy) this.camera.pan(-dx * PAN_SPEED * dt, -dy * PAN_SPEED * dt);
    }

    if (this.cine) {
      this._statusAge += dt;
      if (this._statusAge >= 0.5) { this._statusAge = 0; this._setStatus(); }
    }

    // the hint waits until the farm is in view, then stays a little while
    if (this._hint && !this._hintTimer && !this._dialogUp()) {
      this._hintTimer = setTimeout(() => {
        this._hint.classList.add('fade');
        setTimeout(() => { this._hint.remove(); this._hint = null; }, 2200);
      }, 9000);
    }
  }

  toast(msg, ms = 1700) {
    const el = this._toast;
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    // ms = 0: it stays until something else is said
    if (ms > 0) this._toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ── What can be asked of it ─────────────────────────────────────────────────

  startTour() {
    if (this._dialogUp()) return;
    if (this.gameLoop.speed === 0) this.setSpeed(this._lastSpeed);   // nothing to film in a still farm
    // the hand that pressed the button is still on its way off the mouse
    this._quietUntil = performance.now() + 1500;
    this.director.start();
  }

  togglePanel() {
    this.panel = !this.panel;
    this._prefs.panel = this.panel;
    savePrefs(this._prefs);
    this.layout();
    if (!this.panel) this.toast('Panel hidden — H brings it back', 2600);
  }

  toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else document.documentElement.requestFullscreen?.()?.catch?.(() => {});
    } catch { /* not allowed here */ }
  }

  toggleMute() {
    const muted = !settings.get('muted');
    settings.set('muted', muted);
    this.toast(muted ? 'Sound off' : 'Sound on');
  }

  setSpeed(v) {
    this.gameLoop.setSpeed(v);
    if (this._speed) this._speed.value = this.gameLoop.speed;
    this._speedChanged();
  }

  togglePause() {
    this.setSpeed(this.gameLoop.speed > 0 ? 0 : this._lastSpeed);
  }

  stepSpeed(dir) {
    const s = this.gameLoop.speed;
    let next;
    for (const v of SPEEDS) {
      if (dir > 0 ? v > s && next === undefined : v < s) next = v;
    }
    if (next === undefined) this._speedChanged();
    else this.setSpeed(next);
  }

  _speedChanged() {
    const s = this.gameLoop.speed;
    if (s > 0) {
      this._lastSpeed = s;
      this.toast(`Speed ${s}×`);
    } else {
      this.toast('Paused — Space to carry on', 0);
    }
  }

  // ── The farm left to itself ─────────────────────────────────────────────────

  _setCine(on) {
    this.cine = on;
    this.layout();
    this._keepAwake(on);
    if (on) {
      this._statusAge = 1;
      if (!this._toured) {
        this._toured = true;
        this.toast('Camera tour — move the mouse to take over', 4500);
      }
    } else {
      this._news?.classList.remove('show');
    }
  }

  _setTitle(text) {
    const el = this._title;
    if (!el) return;
    clearTimeout(this._titleTimer);
    if (!this.cine) {
      el.textContent = text;
      el.classList.remove('swap');
      return;
    }
    // fade the old one out before the new one comes up
    el.classList.add('swap');
    this._titleTimer = setTimeout(() => {
      el.textContent = text;
      el.classList.remove('swap');
    }, 700);
  }

  _setStatus() {
    const { sky, antSystem } = this.sim;
    const text = `Day ${sky.day} · ${clockText(sky.phase)} · ${antSystem.population} ants`;
    if (this._status && this._status.textContent !== text) this._status.textContent = text;
  }

  // The latest from the colony, shown under the picture for a few seconds
  _setNews(msg) {
    const el = this._news;
    if (!el || !this.cine) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(this._newsTimer);
    this._newsTimer = setTimeout(() => el.classList.remove('show'), 7000);
  }

  // The screen is kept from going to sleep for as long as the tour runs
  async _keepAwake(on) {
    try {
      if (!on) {
        const lock = this._lock;
        this._lock = null;
        await lock?.release();
      } else if (!this._lock && navigator.wakeLock && document.visibilityState === 'visible') {
        const lock = await navigator.wakeLock.request('screen');
        if (!this.cine) { await lock.release(); return; }
        lock.addEventListener('release', () => { if (this._lock === lock) this._lock = null; });
        this._lock = lock;
      }
    } catch { /* not allowed just now: the screen may sleep */ }
  }

  _dialogUp() {
    for (const el of this._dialogs) if (!el.classList.contains('hidden')) return true;
    return false;
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  _bind() {
    const click = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    click('btn-tour', () => this.startTour());
    click('btn-panel', () => this.togglePanel());
    click('btn-fullscreen', () => this.toggleFullscreen());
    if (!document.documentElement.requestFullscreen) document.getElementById('btn-fullscreen')?.remove();

    this._auto?.addEventListener('change', () => {
      this.director.auto = this._auto.checked;
      this._prefs.auto[GameState.mode] = this._auto.checked;
      savePrefs(this._prefs);
    });
    this._speed?.addEventListener('input', () => this._speedChanged());

    // A control that has been clicked should not keep hold of the keyboard
    document.addEventListener('click', e => {
      if (e.detail > 0) e.target.closest?.('button, input')?.blur();
    });

    // Any sign of life hands the camera back
    window.addEventListener('mousemove', e => this._onMouseMove(e), true);
    window.addEventListener('mousedown', () => this._wake(), true);
    window.addEventListener('touchstart', () => this._wake(), { capture: true, passive: true });
    window.addEventListener('wheel', () => this._wake(), { capture: true, passive: true });

    window.addEventListener('keydown', e => this._onKey(e));
    window.addEventListener('keyup', e => this._keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this._keys.clear());

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.cine) this._keepAwake(true);
    });
  }

  _wake() {
    const touring = this.director.active;
    this.director.poke();
    // The click or tap that wakes the farm is not also a click on it. Nor is one that
    // comes straight after the mouse stirs, before there is a cursor to aim with.
    if (touring) this.controls.mutedUntil = performance.now() + 700;
  }

  _onMouseMove(e) {
    const x = e.clientX, y = e.clientY;
    if (this._mx === null || performance.now() < this._quietUntil) {
      this._mx = x;
      this._my = y;
      return;
    }
    // a nudged desk is not a hand on the mouse
    if (Math.abs(x - this._mx) + Math.abs(y - this._my) < 6) return;
    this._mx = x;
    this._my = y;
    this._wake();
  }

  _onKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (QUIET.has(k) || /^f\d+$/.test(k)) return;
    if (this._dialogUp()) return;   // the tutorial has the keyboard

    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement) return;
    if (t instanceof HTMLButtonElement && (k === ' ' || k === 'enter')) return;

    // These leave a running tour alone
    if (k === 'c') {
      if (e.repeat) return;
      if (this.director.active) this.director.stop(); else this.startTour();
      return;
    }
    if (k === 'f') { if (!e.repeat) this.toggleFullscreen(); return; }
    if (k === 'm') { if (!e.repeat) this.toggleMute(); return; }
    if (k === '[' || k === ']') { this.stepSpeed(k === ']' ? 1 : -1); return; }

    this.director.poke();

    if (PAN[k]) {
      this._keys.add(k);
      if (k.startsWith('arrow')) e.preventDefault();
      return;
    }
    switch (k) {
      case ' ':
        e.preventDefault();
        if (!e.repeat) this.togglePause();
        break;
      case 'h':
        if (!e.repeat) this.togglePanel();
        break;
      case '+': case '=':
        this.camera.zoomBy(1.2);
        break;
      case '-': case '_':
        this.camera.zoomBy(1 / 1.2);
        break;
      case '0':
        this.camera.fitWorld(false);
        break;
    }
  }
}
