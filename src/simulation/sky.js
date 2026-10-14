import { CONFIG } from '../config.js';
import { logEvent } from '../events.js';
import { GameState } from '../gameState.js';

// The colony's clock and weather. Everything above ground — and the daily rhythm
// below it — takes its cue from here.

const DAWN = 0.21;   // phase at which the colony stirs
const DUSK = 0.82;   // phase at which it settles

const smooth = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export class Sky {
  constructor() {
    const D = CONFIG.DAY_TICKS;
    this.time = CONFIG.DAY_START_PHASE * D;  // ticks since the first midnight
    this.phase = 0;        // 0 midnight · 0.25 sunrise · 0.5 noon · 0.75 sunset
    this.day = 1;
    this.elev = 0;         // sun height, −1 (midnight) … +1 (noon)
    this.light = 1;        // 0 night → 1 full daylight
    this.isNight = false;
    this.sinceDawn = 0;    // ticks since the colony's day began
    this.weather = 'clear';   // clear → gathering → rain → clear
    this.overcast = 0;     // 0 clear sky → 1 heavy cloud
    this.rain = 0;         // 0 dry → 1 pouring
    this.flightUntil = 0;  // a nuptial flight is under way until this time
    this._wTimer = 0;
    this._nextRain = this.time + D * (0.9 + Math.random() * 1.3);
    this._nextFlight = this.time + D * 0.8;
    this._calc();
  }

  _calc() {
    const D = CONFIG.DAY_TICKS;
    this.day = Math.floor(this.time / D) + 1;
    this.phase = (this.time % D) / D;
    this.elev = -Math.cos(this.phase * Math.PI * 2);
    this.light = smooth(-0.25, 0.25, this.elev);
    this.isNight = this.phase < DAWN || this.phase > DUSK;
    this.sinceDawn = this.isNight ? 0 : (this.phase - DAWN) * D;
  }

  update(world, antSystem) {
    const wasNight = this.isNight;
    this.time++;
    this._calc();
    if (wasNight && !this.isNight) this._dawn(world, antSystem);
    else if (!wasNight && this.isNight) logEvent('Dusk — the colony settles for the night');
    this._weather(world);
    this._flight(antSystem);
  }

  _dawn(world, antSystem) {
    logEvent('Dawn — the foragers head out');
    if (this.weather !== 'clear') return;
    // dew on the grass: the day's first drink. With no keeper to water it, the farm
    // grows dew enough for about a day's drinking, however big the colony gets
    let n = 2 + Math.floor(Math.random() * 2), size = 41;
    const want = GameState.mode === 'screensaver' && antSystem ? antSystem.population * 1.2 : 0;
    if (want > n * size) { n = Math.min(9, Math.ceil(want / 90)); size = want / n; }
    for (let k = 0; k < n; k++) world.addPuddle(size * (0.83 + Math.random() * 0.34));
  }

  _weather(world) {
    const D = CONFIG.DAY_TICKS;
    if (this.weather === 'clear') {
      if (this.rain > 0) this.rain = Math.max(0, this.rain - 0.006);
      else if (this.overcast > 0) this.overcast = Math.max(0, this.overcast - 0.0016);
      if (this.time >= this._nextRain && this.time > this.flightUntil) {
        this.weather = 'gathering';
        this._wTimer = 520;
        logEvent('Clouds are gathering');
      }
    } else if (this.weather === 'gathering') {
      this.overcast = Math.min(1, this.overcast + 0.0022);
      if (--this._wTimer <= 0) {
        this.weather = 'rain';
        this._wTimer = 1500 + Math.floor(Math.random() * 1300);
        logEvent('Rain — the foragers shelter below');
      }
    } else {
      this.overcast = Math.min(1, this.overcast + 0.0022);
      this.rain = Math.min(1, this.rain + 0.007);
      world.waterStore = Math.min(world.waterCap, world.waterStore + 0.15 * this.rain);
      if (this.time % 130 === 0) world.addPuddle();
      if (this.time % 260 === 0) world.erodeHill();
      if (--this._wTimer <= 0) {
        this.weather = 'clear';
        this._nextRain = this.time + D * (1.5 + Math.random() * 1.7);
        logEvent('The rain passes');
      }
    }
  }

  // On a warm, dry afternoon a big colony sends its winged ants into the sky
  _flight(antSystem) {
    if (this.time < this._nextFlight || this.weather !== 'clear' || this.overcast > 0.1) return;
    if (this.phase < 0.52 || this.phase > 0.64 || antSystem.population < 150) return;
    this._nextFlight = this.time + CONFIG.DAY_TICKS * 3;
    this.flightUntil = this.time + 1900;
    antSystem.startNuptialFlight(14 + Math.min(22, Math.floor(antSystem.population / 20)));
    logEvent('Nuptial flight — winged ants take to the sky!');
  }

  save() {
    return { time: this.time, weather: this.weather, overcast: this.overcast, rain: this.rain,
             wTimer: this._wTimer, nextRain: this._nextRain, nextFlight: this._nextFlight,
             flightUntil: this.flightUntil };
  }

  load(d) {
    if (!d) return;
    this.time = d.time;
    this.weather = d.weather;
    this.overcast = d.overcast;
    this.rain = d.rain;
    this._wTimer = d.wTimer;
    this._nextRain = d.nextRain;
    this._nextFlight = d.nextFlight;
    this.flightUntil = d.flightUntil;
    this._calc();
  }
}
