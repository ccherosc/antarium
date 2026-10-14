import { CONFIG } from '../config.js';
import { GameState } from '../gameState.js';

// The colony the nest has room for. Every tile the diggers hollow out makes space
// for more ants, so the population keeps climbing for as long as the nest grows.
export function colonyTarget(world) {
  const p = CONFIG.POP_BASE + world.openCount * CONFIG.POP_PER_TILE;
  return Math.max(60, Math.min(CONFIG.POP_MAX, p));
}

export class Queen {
  constructor(world) {
    const home = world.queenChamberPos;
    this.x = home.x + 0.5;
    this.y = home.y + 0.5;
    this.targetX = this.x;
    this.targetY = this.y;
    this.health = 100;
    this.hunger = 10;
    this.eggTimer = 60;
    this.restTimer = 0;
    this.animFrame = 0;
    this.animTimer = 0;
    this.angle = 0;
    this.laid = 0;        // eggs laid so far
    this.layPulse = 0;    // 1 → 0 just after an egg is laid (the renderer glows with it)
  }

  update(world, antSystem) {
    const screensaver = GameState.mode === 'screensaver';

    // Animate slowly
    this.animTimer++;
    if (this.animTimer >= 20) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) % 3; }
    if (this.layPulse > 0) this.layPulse = Math.max(0, this.layPulse - 0.012);

    // Hunger
    this.hunger += CONFIG.QUEEN_HUNGER_RATE;
    if (this.hunger > 100) this.hunger = 100;

    // Feed from colony store
    if (this.hunger > 30 && world.foodStore > 0) {
      const eat = Math.min(0.5, world.foodStore);
      world.foodStore -= eat;
      this.hunger -= eat * 0.8;
      if (world.waterStore > 0) world.waterStore = Math.max(0, world.waterStore - eat * 0.3);
    }

    // Health follows how well she is fed and watered
    const foodFactor = Math.max(0, Math.min(1, (100 - this.hunger) / 60));
    const waterFactor = Math.max(0, Math.min(1, world.waterStore / 200));
    const targetHealth = foodFactor * 0.7 + waterFactor * 0.3;
    this.health += (targetHealth * 100 - this.health) * 0.001;
    if (this.hunger >= 100) this.health -= 0.012;   // starving outright
    const floor = screensaver ? 5 : 0;
    this.health = Math.max(floor, Math.min(100, this.health));

    // ── Egg laying ──────────────────────────────────────────────────────────
    // She lays just fast enough to replace the ants that die of old age, and a good
    // deal faster while the colony is smaller than the nest could hold.
    const birthFactor = (this.health / 100) * foodFactor * Math.min(1, world.waterStore / 100);
    const f = 500 / CONFIG.QUEEN_EGG_INTERVAL;                 // the Birth Rate slider
    const want = Math.min(CONFIG.POP_MAX, colonyTarget(world) * (0.75 + 0.25 * f));
    const deficit = Math.max(0, 1 - (antSystem.population + antSystem.eggCount) / want);
    const meanLife = (CONFIG.ANT_LIFESPAN_MIN + CONFIG.ANT_LIFESPAN_MAX) / 2 * (screensaver ? 1.5 : 1);
    let rate = want / meanLife * (1 + 3.2 * deficit * f);
    if (!screensaver) rate *= birthFactor * Math.min(1, world.foodStore / 300);

    if (--this.eggTimer <= 0) {
      this.eggTimer = Math.max(45, Math.min(2500, 1 / rate)) * (0.7 + Math.random() * 0.6);
      const room = antSystem.eggCount < Math.max(16, Math.min(150, want * 0.3));
      const fed = screensaver || world.foodStore > CONFIG.EGG_FOOD_COST + 40;
      if (birthFactor > 0.3 && room && fed) this._lay(world, antSystem);
    }

    // Pick a new drift target periodically, then smoothly glide toward it
    this.restTimer--;
    if (this.restTimer <= 0) {
      const home = world.queenChamberPos;
      this.restTimer = 80 + Math.floor(Math.random() * 120);
      this.targetX = home.x + 0.5 + (Math.random() - 0.5) * 6;
      this.targetY = home.y + 0.5 + (Math.random() - 0.5) * 3;
    }

    // Lerp position — slow, regal drift (reaches ~75% of target in ~50 ticks)
    const lerpSpeed = 0.028;
    this.x += (this.targetX - this.x) * lerpSpeed;
    this.y += (this.targetY - this.y) * lerpSpeed;

    // Rotate smoothly toward movement direction
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    if (Math.hypot(dx, dy) > 0.08) {
      const targetAngle = Math.atan2(dy, dx);
      let diff = targetAngle - this.angle;
      // Wrap diff to [-π, π] so she turns the short way
      while (diff >  Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.angle += diff * 0.04; // smooth turn — ~25 ticks to align fully
    }
  }

  // Eggs are left in a loose clutch behind her, for the nurses to carry off to a nursery
  _lay(world, antSystem) {
    const id = world.queenRoom + 1, W = world.width;
    let x = this.x, y = this.y + 0.4;
    for (let k = 0; k < 8; k++) {
      const a = this.angle + Math.PI + (Math.random() - 0.5) * 2.4;
      const r = 1.8 + Math.random() * 1.8;
      const ex = this.x + Math.cos(a) * r, ey = this.y + Math.sin(a) * r * 0.6 + 0.5;
      const j = Math.floor(ey) * W + Math.floor(ex);
      if (world.roomId[j] === id && world.passable[j]) { x = ex; y = ey; break; }
    }
    antSystem.addEgg(x, y, false, -1);
    world.foodStore = Math.max(0, world.foodStore - CONFIG.EGG_FOOD_COST);
    this.laid++;
    this.layPulse = 1;
  }

  get birthRate() {
    return Math.max(0, Math.min(1, this.health / 100));
  }

  save() {
    return { x: this.x, y: this.y, health: this.health, hunger: this.hunger,
             eggTimer: this.eggTimer, angle: this.angle, laid: this.laid };
  }

  load(d) {
    if (!d) return;
    this.x = this.targetX = d.x;
    this.y = this.targetY = d.y;
    this.health = d.health;
    this.hunger = d.hunger;
    this.eggTimer = d.eggTimer;
    this.angle = d.angle;
    this.laid = d.laid || 0;
  }
}
