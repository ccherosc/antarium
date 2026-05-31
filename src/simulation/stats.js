import { CONFIG } from '../config.js';
import { logEvent } from '../events.js';

export class ColonyStats {
  constructor() {
    this.population = 0;
    this.eggs = 0;
    this.queenHealth = 100;
    this.foodSupply = 0;
    this.waterSupply = 0;
    this.vitality = 100;
    this.happiness = 100;
    this.birthRate = 0;
    this.tunnelLength = 0;
    this.chamberCount = 0;
    this.day = 1;
    this.peakPopulation = 0;
    this._simTick = 0;
    this._queenWarnedLow = false;
    this._queenWarnedCrit = false;
    this._smoothed = {};
  }

  update(world, antSystem, queen) {
    this._simTick++;
    this.day = Math.floor(this._simTick / CONFIG.TICKS_PER_DAY) + 1;

    this.population = antSystem.population;
    if (this.population > this.peakPopulation) this.peakPopulation = this.population;
    this.eggs = antSystem.eggCount;
    this.queenHealth = queen.health;

    if (this.queenHealth < 30 && !this._queenWarnedCrit) {
      this._queenWarnedCrit = true;
      logEvent('Queen health critical!');
    } else if (this.queenHealth >= 50) {
      this._queenWarnedCrit = false;
    }
    if (this.queenHealth < 60 && !this._queenWarnedLow) {
      this._queenWarnedLow = true;
      logEvent('Queen health is low');
    } else if (this.queenHealth >= 70) {
      this._queenWarnedLow = false;
    }
    this.foodSupply = world.foodStore;
    this.waterSupply = world.waterStore;
    this.tunnelLength = world.tunnelCount;
    this.chamberCount = world.chamberCount;

    const foodFactor = Math.min(1, world.foodStore / 300);
    const waterFactor = Math.min(1, world.waterStore / 200);
    const crowding = Math.max(0, 1 - antSystem.population / 150);

    this.happiness = Math.round(
      (foodFactor * 0.35 + waterFactor * 0.25 + (queen.health / 100) * 0.25 + crowding * 0.15) * 100
    );
    this.vitality = Math.round(
      ((queen.health / 100) * 0.4 +
      foodFactor * 0.3 +
      waterFactor * 0.2 +
      (antSystem.population / Math.max(1, antSystem.population + 5)) * 0.1) * 100
    );
    this.vitality = Math.max(0, Math.min(100, this.vitality));
    this.happiness = Math.max(0, Math.min(100, this.happiness));

    const birthFactor = (queen.health / 100) * foodFactor * waterFactor;
    this.birthRate = Math.round(birthFactor * 100);
  }

  percent(val, max) {
    return Math.round((val / max) * 100);
  }
}
