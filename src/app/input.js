export class InputHandler {
  constructor(canvas, camera, world, controls) {
    this.canvas = canvas;
    this.camera = camera;
    this.world = world;
    this.controls = controls;

    this._drag = false;
    this._lastX = 0;
    this._lastY = 0;
    this._touches = {};
    this._lastPinchDist = null;

    canvas.addEventListener('wheel', this._onWheel.bind(this), { passive: false });
    canvas.addEventListener('mousedown', this._onMouseDown.bind(this));
    canvas.addEventListener('mousemove', this._onMouseMove.bind(this));
    canvas.addEventListener('mouseup', this._onMouseUp.bind(this));
    canvas.addEventListener('mouseleave', this._onMouseUp.bind(this));
    canvas.addEventListener('click', this._onClick.bind(this));
    canvas.addEventListener('touchstart', this._onTouchStart.bind(this), { passive: false });
    canvas.addEventListener('touchmove', this._onTouchMove.bind(this), { passive: false });
    canvas.addEventListener('touchend', this._onTouchEnd.bind(this));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    this.camera.zoomAt(factor, sx, sy);
  }

  _onMouseDown(e) {
    if (e.button !== 0) return;
    this._drag = false;
    this._downX = e.clientX;
    this._downY = e.clientY;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    this._mouseDown = true;
  }

  _onMouseMove(e) {
    if (!this._mouseDown) return;
    const dx = e.clientX - this._lastX;
    const dy = e.clientY - this._lastY;
    const totalDx = e.clientX - this._downX;
    const totalDy = e.clientY - this._downY;
    if (Math.abs(totalDx) > 5 || Math.abs(totalDy) > 5) this._drag = true;
    if (this._drag) this.camera.pan(dx, dy);
    this._lastX = e.clientX;
    this._lastY = e.clientY;
  }

  _onMouseUp(e) {
    this._mouseDown = false;
  }

  _onClick(e) {
    if (this._drag) return;
    const rect = this.canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [tx, ty] = this.camera.screenToTile(sx, sy);
    this.controls.handleTileClick(tx, ty, this.world);
  }

  _onTouchStart(e) {
    e.preventDefault();
    for (const t of e.changedTouches) {
      this._touches[t.identifier] = { x: t.clientX, y: t.clientY };
    }
    if (Object.keys(this._touches).length === 2) {
      const pts = Object.values(this._touches);
      this._lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
    this._drag = false;
    const rect = this.canvas.getBoundingClientRect();
    if (e.touches.length === 1) {
      this._lastX = e.touches[0].clientX - rect.left;
      this._lastY = e.touches[0].clientY - rect.top;
      this._downX = this._lastX;
      this._downY = this._lastY;
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    const rect = this.canvas.getBoundingClientRect();

    if (e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      if (this._lastPinchDist) {
        const factor = dist / this._lastPinchDist;
        const cx = (t0.clientX + t1.clientX) / 2 - rect.left;
        const cy = (t0.clientY + t1.clientY) / 2 - rect.top;
        this.camera.zoomAt(factor, cx, cy);
      }
      this._lastPinchDist = dist;
      this._drag = true;
    } else if (e.touches.length === 1) {
      const sx = e.touches[0].clientX - rect.left;
      const sy = e.touches[0].clientY - rect.top;
      const dx = sx - this._lastX, dy = sy - this._lastY;
      if (Math.abs(sx - this._downX) > 5 || Math.abs(sy - this._downY) > 5) this._drag = true;
      if (this._drag) this.camera.pan(dx, dy);
      this._lastX = sx;
      this._lastY = sy;
    }

    for (const t of e.changedTouches) {
      this._touches[t.identifier] = { x: t.clientX, y: t.clientY };
    }
  }

  _onTouchEnd(e) {
    for (const t of e.changedTouches) delete this._touches[t.identifier];
    if (Object.keys(this._touches).length < 2) this._lastPinchDist = null;
    if (!this._drag && e.changedTouches.length === 1) {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.changedTouches[0].clientX - rect.left;
      const sy = e.changedTouches[0].clientY - rect.top;
      const [tx, ty] = this.camera.screenToTile(sx, sy);
      this.controls.handleTileClick(tx, ty, this.world);
    }
    this._drag = false;
  }
}
