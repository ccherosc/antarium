import { CONFIG, STATE } from '../config.js';
import { logEvent } from '../events.js';

// Surface creature species templates
const SPECIES = {
  beetle: { hp: 60, speed: 0.28, food: 6, aggro: 6,  damage: 18, atkCd: 35, label: 'Beetle' },
  spider: { hp: 32, speed: 0.50, food: 4, aggro: 8,  damage: 12, atkCd: 25, label: 'Spider' },
  earwig: { hp: 22, speed: 0.42, food: 3, aggro: 4,  damage:  8, atkCd: 20, label: 'Earwig' },
};

export class CreatureSystem {
  constructor() {
    this.creatures  = [];
    this._timer     = 0;
    this._nextSpawn = 1100 + Math.floor(Math.random() * 900);
  }

  update(world, antSystem) {
    if (++this._timer >= this._nextSpawn) {
      this._timer     = 0;
      this._nextSpawn = 900 + Math.floor(Math.random() * 1100);
      this._trySpawn(world);
    }

    for (let i = this.creatures.length - 1; i >= 0; i--) {
      const c = this.creatures[i];
      if (c.dead) {
        c.corpseTimer++;
        if (c.foodChunks <= 0 && c.corpseTimer > 500) this.creatures.splice(i, 1);
        continue;
      }
      this._tick(c, world, antSystem);
    }

    this._alertAnts(antSystem);
  }

  _trySpawn(world) {
    if (this.creatures.filter(c => !c.dead).length >= 2) return;
    const r    = Math.random();
    const type = r < 0.50 ? 'beetle' : r < 0.78 ? 'spider' : 'earwig';
    const sp   = SPECIES[type];
    const GT   = CONFIG.GLASS_THICKNESS;
    const fromLeft = Math.random() < 0.5;

    this.creatures.push({
      type, sp,
      x: fromLeft ? GT + 1.5 : world.width - GT - 2.5,
      y: CONFIG.SURFACE_ROW - 0.5,
      vx: (fromLeft ? 1 : -1) * sp.speed,
      hp: sp.hp, maxHp: sp.hp,
      foodChunks: 0,
      dead: false, corpseTimer: 0,
      animTimer: 0, animFrame: 0,
      hitFlash: 0, atkCd: 0,
    });
    logEvent(`A ${sp.label} approaches the colony!`);
  }

  _tick(c, world, antSystem) {
    const { sp } = c;
    const GT = CONFIG.GLASS_THICKNESS;

    c.animTimer++;
    if (c.animTimer >= 5) { c.animTimer = 0; c.animFrame = (c.animFrame + 1) & 3; }
    if (c.hitFlash > 0) c.hitFlash--;
    if (c.atkCd   > 0) c.atkCd--;

    c.y = CONFIG.SURFACE_ROW - 0.5; // stay on surface

    // Find nearest ant on or near surface
    let nearestAnt = null, nearestDist = sp.aggro;
    for (const ant of antSystem.ants) {
      const d = Math.hypot(ant.x - c.x, ant.y - c.y);
      if (d < nearestDist) { nearestDist = d; nearestAnt = ant; }
    }

    // Chase or wander
    if (nearestAnt && nearestDist < sp.aggro) {
      const dx = nearestAnt.x - c.x;
      c.vx += Math.sign(dx) * sp.speed * 0.25;
      c.vx  = Math.max(-sp.speed * 1.4, Math.min(sp.speed * 1.4, c.vx));
    } else {
      // Drift back to normal walking speed
      c.vx += (Math.sign(c.vx) * sp.speed - c.vx) * 0.08;
    }

    c.x += c.vx;
    const left = GT + 1.5, right = world.width - GT - 2.5;
    if (c.x <= left)  { c.x = left;  c.vx =  Math.abs(c.vx); }
    if (c.x >= right) { c.x = right; c.vx = -Math.abs(c.vx); }

    // Attack adjacent ant
    if (nearestAnt && nearestDist < 1.4 && c.atkCd <= 0) {
      nearestAnt.hp = Math.max(0, (nearestAnt.hp ?? 100) - sp.damage);
      c.atkCd    = sp.atkCd;
      c.hitFlash = 6;
    }
  }

  _alertAnts(antSystem) {
    const threats = this.creatures.filter(c => !c.dead);
    if (!threats.length) return;
    const SR = CONFIG.SURFACE_ROW;

    for (const ant of antSystem.ants) {
      if (ant.y > SR + 7) continue;
      if (ant.state === STATE.DEFENDING || ant.state === STATE.FEASTING ||
          ant.state === STATE.DUMPING_DIRT) continue;
      for (const c of threats) {
        if (Math.hypot(ant.x - c.x, ant.y - c.y) < 14 && Math.random() < 0.018) {
          ant.state        = STATE.DEFENDING;
          ant.defenseTarget = c;
          break;
        }
      }
    }
  }

  damage(creature, dmg) {
    if (creature.dead) return;
    creature.hp      -= dmg;
    creature.hitFlash = 8;
    if (creature.hp <= 0) {
      creature.dead        = true;
      creature.foodChunks  = creature.sp.food;
      creature.corpseTimer = 0;
      logEvent(`${creature.sp.label} defeated! Ants drag the remains underground.`);
    }
  }

  getNearestThreat(x, y, radius = 14) {
    let best = null, bd = radius;
    for (const c of this.creatures) {
      if (c.dead) continue;
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  getNearestCorpse(x, y, radius = 22) {
    let best = null, bd = radius;
    for (const c of this.creatures) {
      if (!c.dead || c.foodChunks <= 0) continue;
      const d = Math.hypot(x - c.x, y - c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
}
