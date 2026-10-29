import { settings } from '../settings.js';
import { playSfx } from '../audio/audio.js';

// These cover the gear, so the mouse can't reach it; Tab still can, and they have the keyboard first.
// (The mode menu is gone before this exists: it is only up at page load.)
const OVERLAYS = ['tutorial', 'gameover'];

// The settings dialog (#settings in index.html). Every control names the setting it edits in
// data-setting: it shows settings.get(...) whenever the dialog opens or a setting changes, and
// writes settings.set(...) the moment it is touched, so there is no Apply button. What each
// setting does is up to whoever reads it (audio.js, main.js, hud.js); this only edits them.
export class SettingsMenu {
  constructor() {
    const $ = id => document.getElementById(id);
    this._el = $('settings');
    if (!this._el) return;
    this._controls = [...this._el.querySelectorAll('[data-setting]')];
    this._volume = $('set-volume');
    this._volumeText = $('set-volume-value');

    for (const el of this._controls) {
      // a slider follows the hand; the others change when one is chosen
      el.addEventListener(el.type === 'range' ? 'input' : 'change', () => this._edit(el));
    }
    this._volume?.addEventListener('change', () => playSfx('place'));   // a quiet farm still answers

    $('btn-settings')?.addEventListener('click', () => this.open());
    $('set-close')?.addEventListener('click', e => this.close(e.detail === 0));
    this._el.addEventListener('mousedown', e => { if (e.target === this._el) this.close(); });
    document.addEventListener('keydown', e => this._onKey(e));
    settings.onChange(() => this._show());
    this._show();
  }

  get isOpen() { return !!this._el && !this._el.classList.contains('hidden'); }

  open() {
    if (!this._el || OVERLAYS.some(id => document.getElementById(id)?.classList.contains('hidden') === false)) return;
    this._show();
    this._el.classList.remove('hidden');
    this._volume?.focus();
  }

  // giveBack: put the keyboard back on the gear. Not after a mouse click: a button that has the
  // keyboard turns Space into a click on itself, and Space is the pause key.
  close(giveBack = false) {
    if (!this.isOpen) return;
    this._el.classList.add('hidden');
    if (giveBack) document.getElementById('btn-settings')?.focus();
  }

  _show() {
    for (const el of this._controls) {
      const value = settings.get(el.dataset.setting);
      if (el.type === 'checkbox') el.checked = value;
      else if (el.type === 'radio') el.checked = String(value) === el.value;
      else if (el.type === 'range') el.value = Math.round(value * Number(el.dataset.scale));
      else el.value = String(value);
    }
    if (this._volumeText) this._volumeText.textContent = `${Math.round(settings.get('volume') * 100)}%`;
    this._el.classList.toggle('is-muted', settings.get('muted'));
  }

  // A control holds text; a setting is a number, a flag or a word
  _edit(el) {
    const key = el.dataset.setting;
    let value = el.value;
    if (el.type === 'checkbox') value = el.checked;
    else if (typeof settings.defaults[key] === 'number') value = Number(value) / (Number(el.dataset.scale) || 1);
    settings.set(key, value);
    this._show();   // settings turns down what it can't use: show what it kept
  }

  _onKey(e) {
    if (!this.isOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.close(true);
    } else if (e.key === 'Tab') {
      this._keepFocus(e);
    }
  }

  // Tab goes round the dialog, never out to the farm behind it
  _keepFocus(e) {
    const stops = [...this._el.querySelectorAll('input, select, button')].filter(el => el.offsetParent);
    const first = stops[0], last = stops[stops.length - 1], at = document.activeElement;
    if (!this._el.contains(at) || (e.shiftKey && at === first)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }
}
