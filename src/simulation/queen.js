import { CONFIG } from '../config.js';
import { GameState } from '../gameState.js';

export class Queen {
  constructor() {
    this.x = CONFIG.COLONY_X;
    this.y = CONFIG.COLONY_Y;
    this.health = 100;
    this.hunger = 10;
    this.eggTimer = CONFIG.QUEEN_EGG_INTERVAL * 0.5;
    this.restTimer = 0;
    this.animFrame = 0;
    this.animTimer = 0;
    this.angle = Math.PI * 0.25;
  }

  update(world, antSystem, sim) {
    const { foodStore, waterStore } = world;

    // Animate slowly
    this.animTimer++;
    if (this.animTimer >= 20) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) % 3; }

    // Hunger
    this.hunger += CONFIG.QUEEN_HUNGER_RATE;
    if (this.hunger > 100) this.hunger = 100;

    // Feed from colony store
    if (this.hunger > 30 && world.foodStore > 0) {
      const eat = Math.min(0.5, world.foodStore);
      world.foodStore -= eat;
      this.hunger -= eat * 0.8;
      if (world.waterStore > 0) world.waterStore -= eat * 0.3;
    }

    // Health driven by hunger + water
    const foodFactor = Math.max(0, Math.min(1, (100 - this.hunger) / 100));
    const waterFactor = Math.max(0, Math.min(1, waterStore / 200));
    const targetHealth = foodFactor * 0.7 + waterFactor * 0.3;
    this.health += (targetHealth * 100 - this.health) * 0.001;
    const floor = GameState.mode === 'survival' ? 0 : 5;
    this.health = Math.max(floor, Math.min(100, this.health));

    // Egg laying
    this.eggTimer--;
    const birthFactor = (this.health / 100) * foodFactor * Math.min(1, waterStore / 100);

    if (this.eggTimer <= 0 && birthFactor > 0.3) {
      const screensaver = GameState.mode === 'screensaver';
      const interval = screensaver
        ? CONFIG.QUEEN_EGG_INTERVAL * 0.35          // ~175 ticks — 3× faster
        : CONFIG.QUEEN_EGG_INTERVAL / Math.max(0.1, birthFactor);
      this.eggTimer = interval;

      const eggCap = screensaver ? 60 : 20;
      if (antSystem.eggCount < eggCap) {
        antSystem.eggs.push({
          x: CONFIG.COLONY_X - 14 + (Math.random() - 0.5) * 4,
          y: CONFIG.COLONY_Y + 8 + Math.random() * 3,
          hatchTimer: CONFIG.EGG_HATCH_TICKS * (0.8 + Math.random() * 0.4),
          nurseBonus: 0,
        });
      }
    }

    // Subtle movement within queen chamber
    this.restTimer--;
    if (this.restTimer <= 0) {
      this.restTimer = 40 + Math.floor(Math.random() * 60);
      this.x = CONFIG.COLONY_X + (Math.random() - 0.5) * 3;
      this.y = CONFIG.COLONY_Y + (Math.random() - 0.5) * 2;
    }
  }

  get birthRate() {
    return Math.max(0, Math.min(1, this.health / 100));
  }
}
