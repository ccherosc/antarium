import { CONFIG } from '../../config.js';
import { logEvent, emit } from '../../events.js';
import fireflies from './fireflies.js';
import earthworm from './earthworm.js';
import beetle from './burrowingBeetle.js';

// Rare scenes with a beginning and an end: fireflies on a clear night, a worm passing the glass…
// Each is a row in its own file (see fireflies.js for the shape). The engine picks one now and then,
// favouring the ones not seen for a while, so that a long run keeps surprising.
export const MOMENTS = [fireflies, earthworm, beetle];

const byId = id => MOMENTS.find(r => r.id === id);

// Which moment to start on day `day`, or null. Only rows that can() run now and have not run in their
// last `gapDays` are considered; the longer one has waited, the likelier it is (up to three times its
// weight, which is also what a moment never seen gets).
export function pickMoment(rows, last, day, rand = Math.random) {
  const open = [];
  let total = 0;
  for (const row of rows) {
    const since = day - (last[row.id] ?? -Infinity);
    if (since < row.gapDays) continue;
    const weight = row.weight * Math.min(3, 1 + since / row.gapDays);
    open.push([row, weight]);
    total += weight;
  }
  let r = rand() * total;
  for (const [row, weight] of open) {
    r -= weight;
    if (r <= 0) return row;
  }
  return open.length ? open[open.length - 1][0] : null;
}

export class Moments {
  constructor() {
    this.active = null;      // { row, m }: the moment playing now
    this.last = {};          // id -> the day it last started
    this._timer = 0;         // ticks since the last roll
    this._quiet = 0;         // ticks since the last moment ended
  }

  update(sim) {
    const a = this.active;
    if (a) {
      if (a.row.tick(a.m, sim) === false) this._end();
      return;
    }
    this._quiet++;
    if (++this._timer < CONFIG.MOMENT_CHECK_TICKS) return;
    this._timer = 0;
    if (this._quiet < CONFIG.MOMENT_MIN_GAP_TICKS || Math.random() >= CONFIG.MOMENT_CHANCE) return;
    const row = pickMoment(MOMENTS.filter(r => r.can(sim)), this.last, sim.sky.day);
    if (row) this._start(row, sim);
  }

  // Starts moment `id` now, whatever the chances, the gaps and can() say (for the tests). False when
  // there was nowhere for it.
  force(id, sim) {
    const row = byId(id);
    if (!row) return false;
    if (this.active) this._end();
    return this._start(row, sim);
  }

  _start(row, sim) {
    const m = row.start(sim);
    if (!m) return false;
    this.active = { row, m };
    this.last[row.id] = sim.sky.day;
    logEvent(row.title);
    const live = () => (this.active?.m === m ? (row.subject ? row.subject(m) : m) : null);
    emit('moment', { id: row.id, title: row.title, x: m.x, y: m.y, shot: row.shot, subject: live });
    return true;
  }

  _end() {
    const id = this.active.row.id;
    this.active = null;
    this._quiet = 0;
    emit('momentEnd', { id });
  }

  // What is playing is not kept: a reload ends it
  save() {
    return { last: this.last, timer: this._timer, quiet: this._quiet };
  }

  load(d) {
    this.last = { ...(d.last || {}) };
    this._timer = d.timer || 0;
    this._quiet = d.quiet ?? CONFIG.MOMENT_MIN_GAP_TICKS;
  }
}
