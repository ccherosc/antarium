import { CONFIG, STATE } from '../config.js';
import { logEvent } from '../events.js';

// Surface creature species templates — speeds reduced for dramatic, slow encounters
const SPECIES = {
  beetle:    { hp: 60, speed: 0.17, food: 6, aggro: 6,  damage: 18, atkCd: 35, label: 'Beetle'    },
  spider:    { hp: 32, speed: 0.30, food: 4, aggro: 8,  damage: 12, atkCd: 25, label: 'Spider'    },
  earwig:    { hp: 22, speed: 0.25, food: 3, aggro: 4,  damage:  8, atkCd: 20, label: 'Earwig'    },
  centipede: { hp: 18, speed: 0.40, food: 3, aggro: 9,  damage:  9, atkCd: 18, label: 'Centipede' },
  pillbug:   { hp: 50, speed: 0.09, food: 5, aggro: 2,  damage:  5, atkCd: 50, label: 'Pillbug'   },
  cricket:   { hp: 14, speed: 0.27, food: 2, aggro: 5,  damage:  7, atkCd: 20, label: 'Cricket'   },
  worm:      { hp: 12, speed: 0.11, food: 2, aggro: 1,  damage:  3, atkCd: 60, label: 'Worm'      },
};

export class CreatureSystem {
  constructor() {
    this.creatures  = [];
    this._timer     = 0;
    this._nextSpawn = 3500 + Math.floor(Math.random() * 2500); // rare, eventful encounters
  }

  update(world, antSystem) {
    if (++this._timer >= this._nextSpawn) {
      this._timer     = 0;
      this._nextSpawn = 3200 + Math.floor(Math.random() * 2800); // 3200–6000 ticks between visits
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

    this._alertAnts(antSystem, world);
  }

  _trySpawn(world) {
    if (this.creatures.filter(c => !c.dead).length >= 1) return; // one at a time — rare events
    const r = Math.random();
    const type = r < 0.22 ? 'beetle'
               : r < 0.40 ? 'spider'
               : r < 0.54 ? 'earwig'
               : r < 0.68 ? 'centipede'
               : r < 0.80 ? 'cricket'
               : r < 0.91 ? 'pillbug'
               :             'worm';
    const sp       = SPECIES[type];
    const GT       = CONFIG.GLASS_THICKNESS;
    const fromLeft = Math.random() < 0.5;
    const initialVx = (fromLeft ? 1 : -1) * sp.speed;

    this.creatures.push({
      type, sp,
      x: fromLeft ? GT + 1.5 : world.width - GT - 2.5,
      y: CONFIG.SURFACE_ROW - 0.5,
      vx: initialVx,
      initialVx,          // natural walking direction — used to resume crossing after chasing
      lifeTimer: 0,
      hp: sp.hp, maxHp: sp.hp,
      foodChunks: 0,
      dead: false, corpseTimer: 0,
      animTimer: 0, animFrame: 0,
      hitFlash: 0, atkCd: 0,
      hopTimer: type === 'cricket' ? 60 + Math.floor(Math.random() * 80) : 0,
    });
    logEvent(`A ${sp.label} is crossing the surface!`);
  }

  _tick(c, world, antSystem) {
    const { sp } = c;
    const GT = CONFIG.GLASS_THICKNESS;

    c.lifeTimer++;
    c.animTimer++;
    if (c.animTimer >= 5) { c.animTimer = 0; c.animFrame = (c.animFrame + 1) & 3; }
    if (c.hitFlash > 0) c.hitFlash--;
    if (c.atkCd   > 0) c.atkCd--;

    c.y = CONFIG.SURFACE_ROW - 0.5; // stay on surface

    // Creature presence keeps colony on edge — alarm builds slowly, spikes on attack
    world.alarmLevel = Math.min(1, world.alarmLevel + 0.002);

    // ── Cricket hop ────────────────────────────────────────────────────────
    if (c.type === 'cricket' && c.hopTimer !== undefined) {
      if (--c.hopTimer <= 0) {
        c.x += Math.sign(c.vx) * (3 + Math.floor(Math.random() * 4));
        c.hopTimer = 70 + Math.floor(Math.random() * 100);
      }
    }

    // ── Pillbug curls when badly hurt ──────────────────────────────────────
    if (c.type === 'pillbug' && c.hp < c.maxHp * 0.35) { c.vx *= 0.05; }

    // ── Rage mode: faster, harder, angrier below 40% HP ───────────────────
    const raging    = c.hp < c.maxHp * 0.40;
    const speedMult = raging ? 1.6  : 1.0;
    const dmgMult   = raging ? 1.6  : 1.0;
    const cdMult    = raging ? 0.55 : 1.0;
    if (raging) c.hitFlash = Math.max(c.hitFlash, 2);

    // Find nearest ant (extended aggro range when raging)
    const effectiveAggro = sp.aggro * (raging ? 1.8 : 1.0);
    let nearestAnt = null, nearestDist = effectiveAggro;
    for (const ant of antSystem.ants) {
      const d = Math.hypot(ant.x - c.x, ant.y - c.y);
      if (d < nearestDist) { nearestDist = d; nearestAnt = ant; }
    }

    // ── Movement: chase ant OR resume natural crossing walk ────────────────
    // No bouncing — creatures either get swarmed or pass through the scene
    if (nearestAnt && nearestDist < effectiveAggro) {
      const dx = nearestAnt.x - c.x;
      c.vx += Math.sign(dx) * sp.speed * speedMult * 0.3;
      c.vx  = Math.max(-sp.speed * speedMult * 1.6, Math.min(sp.speed * speedMult * 1.6, c.vx));
    } else {
      // Ease back to natural walking speed and direction
      c.vx += (c.initialVx * speedMult - c.vx) * 0.07;
    }

    c.x += c.vx;

    // Off-screen → creature passed through; mark for silent removal
    if (c.x < GT - 3 || c.x > world.width - GT + 3) {
      c.dead        = true;
      c.foodChunks  = 0;
      c.corpseTimer = 501; // triggers removal on next sweep
      logEvent(`The ${c.sp.label} moved on.`);
      return;
    }

    // ── Attack ant — blast colony alarm ────────────────────────────────────
    if (nearestAnt && nearestDist < 1.4 && c.atkCd <= 0) {
      const dmg = Math.ceil(sp.damage * dmgMult);
      nearestAnt.hp = Math.max(0, (nearestAnt.hp ?? 100) - dmg);
      c.atkCd       = Math.ceil(sp.atkCd * cdMult);
      c.hitFlash    = raging ? 14 : 8;
      // Alarm spike — pulls ants streaming from deep in the nest
      world.alarmLevel = Math.min(1, world.alarmLevel + 0.55);
    }
  }

  _alertAnts(antSystem, world) {
    const threats = this.creatures.filter(c => !c.dead);
    if (!threats.length) return;
    const SR    = CONFIG.SURFACE_ROW;
    const alarm = world ? world.alarmLevel : 0;

    // Count active defenders to gauge urgency
    let defenderCount = 0;
    for (const ant of antSystem.ants) {
      if (ant.state === STATE.DEFENDING) defenderCount++;
    }

    for (const ant of antSystem.ants) {
      if (ant.state === STATE.DEFENDING || ant.state === STATE.FEASTING ||
          ant.state === STATE.DUMPING_DIRT) continue;

      // Surface ants always eligible; deep ants join once alarm is high enough
      const depthOk = ant.y <= SR + 8 || alarm > 0.40;
      if (!depthOk) continue;

      // Recruitment scales with alarm level; desperate if under-defended
      const baseChance = 0.02 + alarm * 0.10;
      const urgency    = defenderCount < 6 ? 2.5 : 1.0;

      for (const c of threats) {
        const d = Math.hypot(ant.x - c.x, ant.y - c.y);
        // High alarm extends detection range — word travels through the colony
        const range = alarm > 0.50 ? 80 : 16;
        if (d < range && Math.random() < baseChance * urgency) {
          ant.state         = STATE.DEFENDING;
          ant.defenseTarget = c;
          defenderCount++;
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
