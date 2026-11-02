import { SHORTCUTS } from './hud.js';
import { keepFocus, overlayUp } from './dialogs.js';

// With one of these up there is nothing to pause or to list: the colony is being founded or caught up
// or is gone or not chosen yet, or another dialog has the keyboard
const OVERLAYS = ['tutorial', 'settings', 'gameover', 'founding', 'mode-select', 'credits', 'crash'];

// The pause menu (#pause in index.html) and the key list (#keys). Esc, or the toolbar's menu button,
// opens the menu and the farm holds still, at the speed it had, until the menu is closed; ? opens the
// list the same way. The keys come from Hud._onKey (hud.js), which passes Esc and ? to key(). Settings
// and How to play are dialogs of their own: the menu steps aside for them and comes back when they close.
// `save` saves the colony and says whether it worked; `mode` is the one the tutorial tells about.
export class PauseMenu {
  constructor({ gameLoop, settingsMenu, tutorial, mode, save }) {
    const $ = id => document.getElementById(id);
    this._menu = $('pause');
    this._keys = $('keys');
    if (!this._menu || !this._keys) return;
    this._loop = gameLoop;
    this._save = save;
    this._note = $('pause-note');
    this._keysItem = $('pause-keys');
    this._shown = null;       // the dialog that is up: the menu, the list, or neither
    this._was = null;         // the speed to go back to while the farm is held
    this._fromMenu = false;   // the list was opened from the menu, so closing it goes back there
    this._leaving = false;    // Main menu was refused because the colony couldn't be saved

    this._build($('keys-list'));
    const on = (id, fn) => $(id).addEventListener('click', fn);
    on('pause-resume', () => this.resume());
    on('pause-settings', e => this._hand(settingsMenu, () => settingsMenu.open(), e.currentTarget));
    on('pause-save', () => this._say(this._save() ? 'Saved' : "Couldn't save: this browser won't keep it"));
    on('pause-howto', e => this._hand(tutorial, () => tutorial.show(mode, true), e.currentTarget));
    on('pause-keys', () => this.openKeys());
    on('pause-leave', () => this._leave());
    on('keys-close', () => this._closeKeys());
    // A press on the dark outside the box closes it, and does not take the keyboard off the button
    // that it hands the keyboard back to
    const outside = (el, close) => el.addEventListener('mousedown', e => {
      if (e.target !== el) return;
      e.preventDefault();
      close();
    });
    outside(this._menu, () => this.resume());
    outside(this._keys, () => this._closeKeys());
    document.addEventListener('keydown', e => this._onTab(e));
  }

  open() {
    if (!this._canOpen()) return;
    this._hold();
    this._show(this._menu);
  }

  // Closes the menu, and the farm goes on at the speed it had
  resume() {
    if (this._shown !== this._menu) return;
    this._hide(this._menu);
    this._release();
  }

  // From the menu, or from the farm: either way the list closes back to where it was opened
  openKeys() {
    if (this._shown === this._menu) {
      this._fromMenu = true;
      this._hide(this._menu);
    } else if (this._canOpen()) {
      this._fromMenu = false;
      this._hold();
    } else {
      return;
    }
    this._show(this._keys);
  }

  _closeKeys() {
    if (this._shown !== this._keys) return;
    this._hide(this._keys);
    if (this._fromMenu) this._show(this._menu, this._keysItem);
    else this._release();
  }

  _canOpen() { return !!this._menu && !this._shown && !overlayUp(OVERLAYS); }

  // The list reads SHORTCUTS, so it can't say anything the keys don't do (hud.js)
  _build(list) {
    for (const [keys, does] of SHORTCUTS) {
      const row = document.createElement('div');
      row.className = 'keys-row';
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = keys;
      dd.textContent = does;
      row.append(dt, dd);
      list.append(row);
    }
  }

  // Another dialog takes over; when it closes the menu comes back, on the button that opened it.
  // The farm stays held in between.
  _hand(child, open, button) {
    const back = () => {
      child.onClose = null;
      this._show(this._menu, button);
    };
    this._hide(this._menu);
    child.onClose = back;
    open();
    if (!child.isOpen) back();   // it wouldn't open: don't leave the farm held behind nothing
  }

  // The colony is saved first. If it can't be, say so and leave only when asked a second time.
  _leave() {
    if (this._save() || this._leaving) {
      location.href = location.pathname;   // no ?debug or ?mode: back to the mode menu
    } else {
      this._leaving = true;
      this._say("Couldn't save: this browser won't keep it. Main menu again leaves without saving.");
    }
  }

  _say(text) { this._note.textContent = text; }

  _hold() {
    if (this._was !== null) return;
    this._was = this._loop.speed;
    this._loop.setSpeed(0);
  }

  _release() {
    if (this._was === null) return;
    this._loop.setSpeed(this._was);
    this._was = null;
  }

  _show(dialog, focus) {
    this._shown = dialog;
    if (dialog === this._menu) {
      this._leaving = false;
      this._say('');
    }
    dialog.classList.remove('hidden');
    (focus ?? dialog.querySelector('button')).focus();
  }

  // Not leaving the keyboard on a button that is gone: Space is the pause key, and a button
  // that has it turns Space into a click on itself
  _hide(dialog) {
    dialog.classList.add('hidden');
    if (this._shown === dialog) this._shown = null;
    if (dialog.contains(document.activeElement)) document.activeElement.blur();
  }

  // Esc or ?, from Hud._onKey. Says whether it was taken; if not, another dialog has the keyboard and
  // the key is for it.
  key(e) {
    const shown = this._shown;
    if (!shown && !this._canOpen()) return false;
    e.preventDefault();
    if (e.repeat) return true;   // a held key must not close what it just opened
    if (shown === this._keys) this._closeKeys();
    else if (e.key === '?') this.openKeys();
    else if (shown) this.resume();
    else this.open();
    return true;
  }

  _onTab(e) {
    if (e.key === 'Tab' && this._shown && !e.defaultPrevented && !e.ctrlKey && !e.metaKey && !e.altKey) keepFocus(this._shown, e);
  }
}
