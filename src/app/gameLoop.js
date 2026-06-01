export class GameLoop {
  constructor(onUpdate, onRender) {
    this.onUpdate = onUpdate;
    this.onRender = onRender;
    this.running = false;
    this._lastTime = 0;
    this._raf = null;
    this.speed = 0;
    this.simAccum = 0;
    this.SIM_STEP = 16; // ms per sim tick
  }

  start() {
    this.running = true;
    this._lastTime = performance.now();
    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  stop() {
    this.running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
  }

  _tick(now) {
    if (!this.running) return;
    const dt = Math.min(now - this._lastTime, 100);
    this._lastTime = now;

    this.simAccum += dt * this.speed;

    let steps = 0;
    while (this.simAccum >= this.SIM_STEP && steps < 8) {
      this.onUpdate(this.SIM_STEP);
      this.simAccum -= this.SIM_STEP;
      steps++;
    }

    this.onRender();
    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  setSpeed(s) {
    this.speed = Math.max(0, Math.min(8, s));
  }
}
