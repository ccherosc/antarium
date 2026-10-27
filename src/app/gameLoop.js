export class GameLoop {
  constructor(onUpdate, onRender) {
    this.onUpdate = onUpdate;
    this.onRender = onRender;
    this.running = false;
    this._lastTime = 0;
    this._raf = null;
    this.speed = 1;
    this.simAccum = 0;
    this.SIM_STEP = 16; // ms per sim tick
    this.fpsCap = 0;        // frames drawn per second at most; 0 draws every frame the screen offers
    this._lastRender = 0;   // when a frame was last drawn
    this._nextRender = 0;   // when the next is due
  }

  start() {
    this.running = true;
    this._lastTime = this._lastRender = this._nextRender = performance.now();
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
    // Couldn't keep up: drop the backlog rather than let it pile up
    if (this.simAccum >= this.SIM_STEP) this.simAccum = this.SIM_STEP * 0.999;

    // The colony lives on at every frame the screen offers; only the drawing is held to the cap.
    // frameMs is the time since the last frame drawn, so what runs on real time (the camera, the
    // sway of the grass) keeps its pace however few frames there are.
    if (this._frameDue(now)) {
      const frameMs = Math.min(now - this._lastRender, 100);
      this._lastRender = now;
      // How far into the next tick this frame falls, so movement can be drawn in between
      this.onRender(this.speed > 0 ? this.simAccum / this.SIM_STEP : 1, frameMs);
    }
    this._raf = requestAnimationFrame(this._tick.bind(this));
  }

  // Frames are due 1000 / fpsCap ms apart, on a schedule of their own rather than counted from the
  // last frame drawn: counting from it would give a cap of 60 only 48 fps on a 144 Hz screen. A
  // refresh up to 1 ms early still counts as on time, and one more than a frame late starts the
  // schedule over instead of drawing a burst to catch up.
  _frameDue(now) {
    if (!(this.fpsCap > 0)) return true;
    if (now < this._nextRender - 1) return false;
    const every = 1000 / this.fpsCap;
    this._nextRender = now - this._nextRender > every ? now + every : this._nextRender + every;
    return true;
  }

  setSpeed(s) {
    this.speed = Math.max(0, Math.min(8, s));
  }
}
