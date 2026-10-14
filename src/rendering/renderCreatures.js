import { CONFIG } from '../config.js';

// Visitors to the farm: beetles, spiders, earwigs, centipedes, pillbugs, crickets and worms
export function drawCreatures(ctx, camera, creatures) {
  const ts   = CONFIG.TILE_SIZE;
  const zoom = camera.zoom;
  const u    = ts * zoom; // 1 tile in screen pixels

  for (const c of creatures) {
    const [sx, sy] = camera.worldToScreen(c.x * ts, c.y * ts);
    if (sx < -u * 4 || sx > camera.cw + u * 4) continue;

    ctx.save();
    ctx.translate(Math.round(sx), Math.round(sy));

    if (c.dead) {
      // Flat corpse — darkened outline
      ctx.globalAlpha = c.foodChunks > 0 ? Math.min(1, (2400 - c.corpseTimer) / 300)
                                         : Math.max(0, Math.min(1, (500 - c.corpseTimer) / 200));
      ctx.fillStyle = '#1a1008';
      ctx.fillRect(-u * 1.5, -u * 0.4, u * 3, u * 0.8);
      // Food chunk dots remaining on corpse
      for (let f = 0; f < c.foodChunks; f++) {
        ctx.fillStyle = '#e8b820';
        ctx.fillRect((-1 + f * 0.6) * u, -u * 0.3, u * 0.4, u * 0.4);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      continue;
    }

    // Damage flash
    if (c.hitFlash > 0) {
      ctx.globalAlpha = 0.65 + Math.sin(c.hitFlash * 0.9) * 0.35;
    }

    // Walking leg offset for animation
    const leg = (c.animFrame & 1) ? u * 0.18 : -u * 0.18;
    const dir = c.vx >= 0 ? 1 : -1;
    ctx.scale(dir, 1); // flip to face direction of travel

    if (c.type === 'beetle') {
      // Shell (elytra) — dark iridescent oval
      ctx.fillStyle = c.hitFlash > 0 ? '#8a4020' : '#2a1e0c';
      ctx.fillRect(-u * 1.5, -u * 0.7, u * 3, u * 1.4);
      // Shell highlight seam
      ctx.fillStyle = '#3a2c18';
      ctx.fillRect(-u * 0.08, -u * 0.65, u * 0.16, u * 1.3);
      // Head
      ctx.fillStyle = '#1e1408';
      ctx.fillRect(u * 1.4, -u * 0.45, u * 0.8, u * 0.9);
      // Antennae
      ctx.fillStyle = '#3a2818';
      ctx.fillRect(u * 2.1, -u * 0.9, u * 0.12, u * 0.6);
      ctx.fillRect(u * 2.0, -u * 0.4, u * 0.9, u * 0.12);
      // 6 legs
      ctx.fillStyle = '#120e06';
      for (let i = -1; i <= 1; i++) {
        const lx = i * u * 0.8, lo = i === 0 ? 0 : leg;
        ctx.fillRect(lx - u * 0.08, u * 0.7 + lo, u * 0.16, u * 0.55);
        ctx.fillRect(lx - u * 0.08, -u * 0.7 - lo, u * 0.16, u * 0.55);
      }
      // HP bar

    } else if (c.type === 'spider') {
      // Abdomen (rear, larger)
      ctx.fillStyle = c.hitFlash > 0 ? '#6a2818' : '#1a1220';
      ctx.fillRect(-u * 1.1, -u * 0.7, u * 1.8, u * 1.4);
      // Cephalothorax (front, smaller)
      ctx.fillStyle = '#221828';
      ctx.fillRect(u * 0.7, -u * 0.5, u * 1.0, u * 1.0);
      // 8 eyes
      ctx.fillStyle = '#e87820';
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(u * (0.82 + (i & 1) * 0.22), u * (-0.3 + Math.floor(i / 2) * 0.22), u * 0.14, u * 0.14);
      }
      // 8 legs (4 each side)
      ctx.fillStyle = '#100c14';
      for (let i = 0; i < 4; i++) {
        const lx = (-0.6 + i * 0.45) * u;
        const lo = (i & 1) ? leg : -leg;
        ctx.fillRect(lx, u * 0.7 + lo, u * 0.12, u * 0.8);
        ctx.fillRect(lx, -u * 0.7 - lo, u * 0.12, u * 0.8);
      }
      // HP bar

    } else if (c.type === 'earwig') {
      // Elongated body segments
      ctx.fillStyle = c.hitFlash > 0 ? '#7a3818' : '#2c1e10';
      ctx.fillRect(-u * 1.6, -u * 0.45, u * 3.2, u * 0.9);
      ctx.fillStyle = '#1e140a';
      for (let i = -1; i <= 1; i++) ctx.fillRect(i * u * 0.8, -u * 0.4, u * 0.1, u * 0.8);
      // Pincers at rear
      ctx.fillStyle = '#3a2818';
      ctx.fillRect(-u * 2.4, -u * 0.5, u * 0.8, u * 0.22);
      ctx.fillRect(-u * 2.4,  u * 0.28, u * 0.8, u * 0.22);
      // Head + antennae
      ctx.fillStyle = '#241808';
      ctx.fillRect(u * 1.6, -u * 0.35, u * 0.7, u * 0.7);
      ctx.fillStyle = '#3a2810';
      ctx.fillRect(u * 2.2, -u * 0.6, u * 0.55, u * 0.1);
      ctx.fillRect(u * 2.2,  u * 0.5, u * 0.55, u * 0.1);
      // 6 legs
      ctx.fillStyle = '#18100a';
      for (let i = -1; i <= 1; i++) {
        const lx = i * u * 0.7, lo = i === 0 ? 0 : leg;
        ctx.fillRect(lx, u * 0.45 + lo, u * 0.12, u * 0.55);
        ctx.fillRect(lx, -u * 0.45 - lo, u * 0.12, u * 0.55);
      }

    } else if (c.type === 'centipede') {
      // Long segmented body with many legs — drawn as 6 connected ovals
      const segs = 6, sw2 = u * 0.55;
      ctx.fillStyle = c.hitFlash > 0 ? '#8a2810' : '#1a1c0c';
      for (let s = 0; s < segs; s++) {
        const sx = (s - segs * 0.5 + 0.5) * sw2;
        const sy2 = (s % 2 === 0 ? 1 : -1) * u * 0.08; // slight undulation
        ctx.fillRect(sx - sw2 * 0.45, sy2 - u * 0.35, sw2 * 0.9, u * 0.7);
        // Pair of legs per segment
        ctx.fillStyle = '#0e1008';
        ctx.fillRect(sx - u * 0.08, u * 0.35 + sy2 + leg * 0.3, u * 0.12, u * 0.55);
        ctx.fillRect(sx - u * 0.08, -u * 0.35 + sy2 - leg * 0.3, u * 0.12, u * 0.55);
        ctx.fillStyle = c.hitFlash > 0 ? '#8a2810' : '#1a1c0c';
      }
      // Head with antennae
      const hx = segs * sw2 * 0.5;
      ctx.fillStyle = '#2a2810';
      ctx.fillRect(hx - u * 0.4, -u * 0.4, u * 0.7, u * 0.8);
      ctx.fillStyle = '#0e1008';
      ctx.fillRect(hx + u * 0.3, -u * 0.8, u * 0.1, u * 0.5);
      ctx.fillRect(hx + u * 0.3, u * 0.3, u * 0.1, u * 0.5);

    } else if (c.type === 'pillbug') {
      // Round armoured oval — curls up when badly hurt
      const curled = c.hp < c.maxHp * 0.35;
      const bodyW = curled ? u * 1.4 : u * 2.2;
      const bodyH = curled ? u * 1.4 : u * 0.9;
      ctx.fillStyle = c.hitFlash > 0 ? '#607820' : '#3a4818';
      ctx.fillRect(-bodyW * 0.5, -bodyH * 0.5, bodyW, bodyH);
      // Armour segments
      ctx.fillStyle = '#2a3410';
      for (let i = -1; i <= 1; i++)
        ctx.fillRect(i * bodyW * 0.28 - u * 0.05, -bodyH * 0.5, u * 0.1, bodyH);
      // Highlight top
      ctx.fillStyle = 'rgba(120,160,60,0.35)';
      ctx.fillRect(-bodyW * 0.5, -bodyH * 0.5, bodyW, bodyH * 0.3);
      // Tiny head
      if (!curled) {
        ctx.fillStyle = '#2a3010';
        ctx.fillRect(bodyW * 0.5 - u * 0.1, -u * 0.25, u * 0.4, u * 0.5);
        // Antennae
        ctx.fillStyle = '#1a2008';
        ctx.fillRect(bodyW * 0.5 + u * 0.2, -u * 0.4, u * 0.5, u * 0.1);
        ctx.fillRect(bodyW * 0.5 + u * 0.2,  u * 0.3, u * 0.5, u * 0.1);
        // Legs (tiny)
        ctx.fillStyle = '#1e2610';
        for (let i = -1; i <= 1; i++) {
          ctx.fillRect(i * u * 0.55, bodyH * 0.5, u * 0.1, u * 0.45);
          ctx.fillRect(i * u * 0.55, -bodyH * 0.5 - u * 0.45, u * 0.1, u * 0.45);
        }
      }

    } else if (c.type === 'cricket') {
      // Elongated body, large jumping rear legs
      ctx.fillStyle = c.hitFlash > 0 ? '#7a5820' : '#2e2810';
      ctx.fillRect(-u * 1.4, -u * 0.4, u * 2.2, u * 0.8); // body
      // Wing cover (slightly raised)
      ctx.fillStyle = '#3a3218';
      ctx.fillRect(-u * 0.6, -u * 0.5, u * 1.2, u * 0.18);
      // Head
      ctx.fillStyle = '#241e0c';
      ctx.fillRect(u * 0.8, -u * 0.38, u * 0.6, u * 0.75);
      // Long antennae
      ctx.fillStyle = '#1a1408';
      ctx.fillRect(u * 1.2, -u * 0.5, u * 0.12, u * 1.0);
      ctx.fillRect(u * 1.3, -u * 0.5, u * 0.8, u * 0.1);
      ctx.fillRect(u * 1.3,  u * 0.4, u * 0.8, u * 0.1);
      // Large rear jumping legs (L-shaped)
      ctx.fillStyle = '#1e1808';
      ctx.fillRect(-u * 1.4, -u * 0.35, u * 0.12, u * 0.7 + leg * 0.4);  // femur
      ctx.fillRect(-u * 1.4, u * 0.35 + leg * 0.4, u * 0.6, u * 0.12);    // tibia
      ctx.fillRect(-u * 1.4, -u * 0.35 - leg * 0.4, u * 0.6, u * 0.12);   // upper
      // Small front legs
      ctx.fillRect(u * 0.1, u * 0.4, u * 0.1, u * 0.45);
      ctx.fillRect(u * 0.5, u * 0.4, u * 0.1, u * 0.45);

    } else { // worm
      // Simple pink-brown segmented worm wriggling along
      const wave = Math.sin(c.animFrame * 1.2) * u * 0.15;
      ctx.fillStyle = c.hitFlash > 0 ? '#c07060' : '#8a5040';
      for (let s = 0; s < 5; s++) {
        const sx = (s - 2.5) * u * 0.45;
        const sy2 = (s % 2 === 0 ? wave : -wave);
        ctx.fillRect(sx - u * 0.2, sy2 - u * 0.22, u * 0.42, u * 0.44);
      }
      // Tip / head
      ctx.fillStyle = '#a06050';
      ctx.fillRect(u * 0.8, -u * 0.18, u * 0.3, u * 0.36);
    }

    // Health shows only once the ants have drawn blood
    if (c.hp < c.maxHp) {
      const hpPct = Math.max(0, c.hp / c.maxHp);
      ctx.scale(dir, 1); // un-flip, so the bar always drains the same way
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(-u * 1.3, -u * 1.3, u * 2.6, u * 0.2);
      ctx.fillStyle = hpPct > 0.5 ? '#40c840' : hpPct > 0.25 ? '#c8a020' : '#c82020';
      ctx.fillRect(-u * 1.3, -u * 1.3, u * 2.6 * hpPct, u * 0.2);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
