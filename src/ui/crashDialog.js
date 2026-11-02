import { keepFocus } from './dialogs.js';

// The dialog the game puts up when the colony's loop has died (#crash in index.html), so the player is never left
// looking at a frozen or black screen. It sits over every other dialog and has one way out: reload, which resumes
// the save.
export class CrashDialog {
  constructor() {
    this._el = document.getElementById('crash');
    document.getElementById('crash-reload')?.addEventListener('click', () => location.reload());
    document.addEventListener('keydown', e => {
      if (this.isOpen && e.key === 'Tab') keepFocus(this._el, e);
    });
  }

  get isOpen() { return !!this._el && !this._el.classList.contains('hidden'); }

  // saved: whether the colony was written to the save just now. Returns false when it was already up.
  show(saved) {
    if (!this._el || this.isOpen) return false;
    document.getElementById('crash-saved').textContent = saved
      ? 'Your colony was saved.'
      : 'Your colony could not be saved just now; the last save is still there.';
    this._el.classList.remove('hidden');
    document.getElementById('crash-reload')?.focus();
    return true;
  }
}
