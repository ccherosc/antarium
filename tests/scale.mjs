// npm run scale [-- --days 10]
//
// What a bigger world costs. Lives the same Zen colony, from fresh, in today's 240x160 tank and in a
// Biome-sized 720x180 world (?debug&world=), as fast as the page can, with the renderer off. For each
// it reports the time a tick takes (mean, and the slowest 1% of 100-tick runs), the share of that spent
// rebuilding flow fields, the fields alive at the end and the most there ever were, the JS heap and the
// size of the save. The table also goes to tests/out/scale.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../tools/serve.mjs';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const SIZES = [['zen', ''], ['biome', '&world=720x180x30']];
const RUN = 100;   // ticks timed together, for the slow-run percentile

const i = process.argv.indexOf('--days');
const days = i > 0 ? Number(process.argv[i + 1]) : 10;

fs.mkdirSync(OUT, { recursive: true });
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });

const rows = [];
for (const [name, extra] of SIZES) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${base}?debug&new&mode=screensaver${extra}`);
  await page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
  const r = await page.evaluate(async ({ days, RUN }) => {
    const { sim, gameLoop, CONFIG } = window.__pa;
    gameLoop.stop();   // from here on we are the clock
    const nav = sim.world.nav;
    let navMs = 0, most = 0;
    const build = nav._build.bind(nav);
    nav._build = (f, fill) => { const t = performance.now(); build(f, fill); navMs += performance.now() - t; };

    const runs = [];
    const ticks = days * CONFIG.DAY_TICKS;
    const t0 = performance.now();
    for (let n = 0; n < ticks; n += RUN) {
      const t = performance.now();
      for (let k = 0; k < RUN; k++) gameLoop.onUpdate(gameLoop.SIM_STEP);
      runs.push((performance.now() - t) / RUN);
      most = Math.max(most, nav.fields.size);
      if (n % CONFIG.DAY_TICKS < RUN) await new Promise(res => setTimeout(res));   // a breather each day
    }
    const ms = performance.now() - t0;
    runs.sort((a, b) => a - b);
    window.gc?.();
    const { buildSave } = await import('/src/saveLoad.js');
    return {
      size: `${sim.world.width}x${sim.world.height}`,
      pop: sim.antSystem.population,
      msPerTick: ms / ticks,
      p99: runs[Math.floor(runs.length * 0.99)],
      navShare: navMs / ms,
      fields: nav.fields.size, most, maxFields: nav.maxFields,
      heapMB: performance.memory.usedJSHeapSize / 1048576,
      saveKB: JSON.stringify(buildSave(sim)).length / 1024,
    };
  }, { days, RUN });
  await page.close();
  if (errors.length) { console.error(`${name}: ${errors.join('\n')}`); process.exitCode = 1; }
  rows.push({ name, ...r });
}
await browser.close();
server.close();

const COLS = [['world', 8, r => r.name], ['size', 8, r => r.size], ['pop', 5, r => r.pop],
  ['ms/tick', 8, r => r.msPerTick.toFixed(3)], ['p99', 7, r => r.p99.toFixed(3)],
  ['nav', 6, r => `${Math.round(r.navShare * 100)}%`], ['fields', 7, r => r.fields],
  ['most', 5, r => `${r.most}/${r.maxFields}`], ['heapMB', 7, r => r.heapMB.toFixed(1)],
  ['saveKB', 7, r => Math.round(r.saveKB)]];
const line = cells => cells.map((c, k) => String(c).padStart(COLS[k][1])).join(' ');
const [a, b] = rows;
const text = [`scale: ${days} days of a fresh Zen colony, headless Chromium`,
  line(COLS.map(c => c[0])), ...rows.map(r => line(COLS.map(c => c[2](r)))),
  `biome / zen: ${(b.msPerTick / a.msPerTick).toFixed(2)}x the time a tick, ${(b.heapMB / a.heapMB).toFixed(2)}x the heap, ` +
  `${(b.saveKB / a.saveKB).toFixed(2)}x the save`].join('\n');
console.log(text);
fs.writeFileSync(path.join(OUT, 'scale.txt'), text + '\n');
