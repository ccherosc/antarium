import { CONFIG } from '../config.js';
import { settings } from '../settings.js';
import { VERSION } from '../version.js';
import { keepFocus } from './dialogs.js';

// The strip is this many of its own pixels high: five of air, with the ants' feet on the sixth row, and soil
const STRIP_ROWS = 8;
const FEET = 4;
const ANT_WIDTH = 5;

// The title screen (#mode-select in index.html), apart from choosing a mode, which main.js does: the version,
// the Settings and Credits buttons, the Credits dialog, and a strip along the bottom where a line of ants walks.
export class TitleScreen {
  // settingsMenu: the dialog the Settings button opens (the gear is under the title)
  constructor({ settingsMenu }) {
    const $ = id => document.getElementById(id);
    // the pause menu shows it too: both have the element, this fills them
    for (const el of document.querySelectorAll('[data-version]')) el.textContent = `v${VERSION}`;

    this._el = $('mode-select');
    this._credits = $('credits');
    this._button = $('btn-title-credits');
    if (!this._el || !this._credits) return;

    $('btn-title-settings')?.addEventListener('click', e => settingsMenu.open(e.currentTarget));
    this._button?.addEventListener('click', () => this.openCredits());
    // e.detail is 0 for a press of Enter or Space on the button, which has the keyboard and keeps it
    $('credits-close')?.addEventListener('click', e => this.closeCredits(e.detail === 0));
    // Not taking the keyboard as it goes, as with the other dialogs
    this._credits.addEventListener('mousedown', e => {
      if (e.target !== this._credits) return;
      e.preventDefault();
      this.closeCredits();
    });
    document.addEventListener('keydown', e => this._onKey(e));

    this._ants = [];
    this._canvas = $('ms-ants');
    this._ctx = this._canvas?.getContext('2d');
    if (this._ctx) this._startAnts();
  }

  get creditsOpen() { return !!this._credits && !this._credits.classList.contains('hidden'); }

  openCredits() {
    if (!this._credits || this.creditsOpen) return;
    this._credits.classList.remove('hidden');
    document.getElementById('credits-close')?.focus();
  }

  // giveBack: put the keyboard back on the Credits button; not after a click, which would leave a Space meant for
  // something else pressing it
  closeCredits(giveBack = false) {
    if (!this.creditsOpen) return;
    this._credits.classList.add('hidden');
    if (giveBack) this._button?.focus();
  }

  _onKey(e) {
    if (!this.creditsOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeCredits(true);
    } else if (e.key === 'Tab') {
      keepFocus(this._credits, e);
    }
  }

  // ── The ants ──

  _startAnts() {
    const [slow, fast] = CONFIG.TITLE_ANT_SPEED;
    this._size();
    for (let i = 0; i < CONFIG.TITLE_ANTS; i++) {
      const luck = (i * 37 % 11) / 10;   // the same walkers every time, not the same pace
      this._ants.push({ x: (i + luck / 2) * this._width / CONFIG.TITLE_ANTS, speed: slow + (fast - slow) * luck, food: i % 3 === 0 });
    }
    window.addEventListener('resize', () => { this._size(); if (!this._running) this._draw(); });
    settings.onChange(() => this._animate());   // reduced motion may have been turned off
    this._animate();
  }

  // One pixel of the strip is TITLE_ANT_PIXEL of the screen's, so the strip is as wide as the screen over that
  _size() {
    this._width = Math.ceil(this._el.clientWidth / CONFIG.TITLE_ANT_PIXEL);
    this._canvas.width = this._width;
    this._canvas.height = STRIP_ROWS;
    this._canvas.style.height = `${STRIP_ROWS * CONFIG.TITLE_ANT_PIXEL}px`;
  }

  _animate() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    requestAnimationFrame(t => this._frame(t));
  }

  // Draws only as often as the legs move, and stops with the title (the class `hidden`) or, once drawn, when the
  // player wants less motion: the ants then stand where they are
  _frame(now) {
    if (this._el.classList.contains('hidden')) { this._running = false; return; }
    const still = settings.get('reducedMotion');
    const gap = (now - this._last) / 1000;
    if (still || gap >= 1 / CONFIG.TITLE_ANT_FPS) {
      this._last = now;
      if (!still) for (const a of this._ants) a.x = (a.x + a.speed * Math.min(gap, 0.25)) % (this._width + ANT_WIDTH);
      this._draw();
    }
    if (still) { this._running = false; return; }
    requestAnimationFrame(t => this._frame(t));
  }

  _draw() {
    const ctx = this._ctx, w = this._width;
    ctx.clearRect(0, 0, w, STRIP_ROWS);
    ctx.fillStyle = CONFIG.C_SOIL;
    ctx.fillRect(0, FEET + 1, w, STRIP_ROWS);
    for (let x = 0; x < w; x++) {   // the same specks every time
      const h = (x * 37 + 11) % 13;
      if (h > 2) continue;
      ctx.fillStyle = h === 1 ? CONFIG.C_SOIL3 : CONFIG.C_SOIL2;
      ctx.fillRect(x, FEET + 1 + x % 3, 1, 1);
    }
    for (const a of this._ants) {
      const x = Math.floor(a.x) - ANT_WIDTH;   // it walks in from beyond the left edge
      ctx.fillStyle = CONFIG.C_CHAMBER2;
      ctx.fillRect(x, FEET - 1, 4, 1);   // abdomen, thorax and head
      ctx.fillStyle = CONFIG.C_TUNNEL;
      ctx.fillRect(x + 4, FEET - 2, 1, 1);   // an antenna
      const stride = (Math.floor(a.x) >> 1) & 1;   // the legs swap as it goes
      ctx.fillRect(x + stride, FEET, 1, 1);
      ctx.fillRect(x + stride + 2, FEET, 1, 1);
      if (a.food) {
        ctx.fillStyle = CONFIG.C_FOOD;
        ctx.fillRect(x + 3, FEET - 2, 1, 1);
      }
    }
  }
}
