// A small read-out of how the game is running, shown with ?debug: how many frames were drawn each
// second, how long the game spent on a frame (updating and drawing it, not the browser's own work
// of putting it on screen), and the frame cap and quality in force.
const EVERY_MS = 500;   // how often the numbers are refreshed

export class PerfReadout {
  constructor({ cap, quality }) {
    this.cap = cap;           // () => the frame cap in force (0 = none)
    this.quality = quality;   // () => 'high' | 'low'
    this.fps = 0;             // as of the last refresh
    this.avgMs = 0;
    this.maxMs = 0;
    this._frames = 0;
    this._busy = 0;
    this._worst = 0;
    this._since = null;       // when the current stretch began

    this.el = document.createElement('div');
    this.el.id = 'perf';
    document.body.appendChild(this.el);
  }

  // One frame drawn, which took busyMs; `now` is a timestamp in ms. Frames are counted from the one
  // after the stretch began, so n frames n intervals apart are n frames a stretch, not n + 1.
  frame(busyMs, now = performance.now()) {
    if (this._since === null) { this._since = now; return; }
    this._frames++;
    this._busy += busyMs;
    this._worst = Math.max(this._worst, busyMs);

    const span = now - this._since;
    if (span < EVERY_MS) return;
    this.fps = this._frames * 1000 / span;
    this.avgMs = this._busy / this._frames;
    this.maxMs = this._worst;
    this._frames = this._busy = this._worst = 0;
    this._since = now;
    this._show();
  }

  _show() {
    const cap = this.cap();
    this.el.textContent =
      `${this.fps.toFixed(0)} fps · ${this.avgMs.toFixed(1)} ms/frame (worst ${this.maxMs.toFixed(1)})` +
      ` · cap ${cap || 'off'} · ${this.quality()}`;
  }
}
