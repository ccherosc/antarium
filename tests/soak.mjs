// npm run soak -- --mode screensaver --days 30
// Long-run stability: lives whole in-game days back to back with the renderer switched off, and
// after each one records the colony, the memory it holds, how long a tick takes and how big its
// save is. Fails (exit 1) on a page error, a non-finite ant, a colony that ends in a mode that
// can't end, a save that gets too big, or memory or tick time that has grown since an earlier
// day with a similar population. About a second per in-game day; the table fills in as it goes
// (d counts the days lived, day is the game's own counter) and the numbers are written to
// tests/out/soak-<mode>.csv. In a mode that can end (survival) the soak stops when the colony
// does. A colony that is still growing has no earlier day to compare with, so the memory and
// tick-time checks need a run long enough for it to level off (about 20 days in screensaver).
// It runs the simulation only, so a leak in the renderer, director or HUD isn't caught.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../tools/serve.mjs';
import { MODES } from '../src/modes.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');
const BASELINE_DAY = 5;          // the last day is compared with an earlier one, from this day on...
const SIMILAR = 0.25;            // ...whose population was within this fraction of the last day's
const MAX_HEAP_GROWTH = 1.5;     // last day's heap / the earlier day's
const MAX_SLOWDOWN = 2;          // last day's ms per tick / the earlier day's
const MAX_SAVE_BYTES = 3 * 1024 * 1024;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const mode = arg('mode', 'screensaver');
const days = Number(arg('days', 30));
if (!(mode in MODES) || !Number.isInteger(days) || days < 1) {
  console.error(`usage: npm run soak -- --mode <${Object.keys(MODES).join('|')}> --days <whole number>`);
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });
const server = await serve(0);   // port 0: any free port
const base = `http://127.0.0.1:${server.address().port}/`;
// gc() lets us measure what the colony really holds rather than garbage awaiting collection
const browser = await chromium.launch({ args: ['--js-flags=--expose-gc', '--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('requestfailed', r => errors.push(`request failed: ${r.url()}`));

const COLUMNS = [   // [heading, width, value]
  ['d', 3, r => r.d], ['day', 4, r => r.day], ['pop', 5, r => r.pop], ['cap', 5, r => r.cap],
  ['eggs', 5, r => r.eggs], ['food', 6, r => r.food], ['water', 6, r => r.water],
  ['queen', 6, r => r.queen], ['bad', 4, r => r.bad], ['heapMB', 7, r => r.heapMB.toFixed(1)],
  ['ms/tick', 8, r => r.msPerTick.toFixed(3)], ['saveKB', 7, r => Math.round(r.saveBytes / 1024)],
];
const line = cells => cells.map((c, i) => String(c).padStart(COLUMNS[i][1])).join(' ');
const writeCsv = rows => fs.writeFileSync(path.join(OUT, `soak-${mode}.csv`),
  [COLUMNS.map(c => c[0]).join(','), ...rows.map(r => COLUMNS.map(c => c[2](r)).join(','))].join('\n') + '\n');

const rows = [];
const problems = [];
try {
  await page.goto(`${base}?debug&new&mode=${mode}`);
  await page.waitForFunction(() => window.__pa, null, { timeout: 20_000 });
  const ticksPerDay = await page.evaluate(() => {
    window.__pa.gameLoop.stop();   // from here on we are the clock
    return window.__pa.CONFIG.DAY_TICKS;
  });
  console.log(`soak: ${mode}, ${days} days of ${ticksPerDay} ticks`);
  console.log(line(COLUMNS.map(c => c[0])));

  for (let d = 1; d <= days && !errors.length; d++) {
    // one whole day per call, so the page gets a breather between days
    const r = await page.evaluate(async ticks => {
      const { sim, gameLoop } = window.__pa;
      const t0 = performance.now();
      for (let i = 0; i < ticks; i++) gameLoop.onUpdate(gameLoop.SIM_STEP);
      const ms = performance.now() - t0;

      window.gc?.();
      const { buildSave } = await import('/src/saveLoad.js');
      const { world, antSystem, queen, stats } = sim;
      return {
        day: stats.day,
        pop: antSystem.population,
        cap: stats.capacity,
        eggs: antSystem.eggCount,
        food: Math.round(world.foodStore),
        water: Math.round(world.waterStore),
        queen: Math.round(queen.health),
        // what ends a game in modes that can end (the render callback in main.js)
        ended: queen.health <= 0 || (antSystem.population === 0 && antSystem.eggCount === 0),
        bad: antSystem.ants.filter(a => !Number.isFinite(a.x) || !Number.isFinite(a.y)).length,
        heapMB: (performance.memory?.usedJSHeapSize ?? NaN) / 1048576,
        msPerTick: ms / ticks,
        saveBytes: JSON.stringify(buildSave(sim)).length,
      };
    }, ticksPerDay);
    rows.push({ d, ...r });
    console.log(line(COLUMNS.map(c => c[2](rows.at(-1)))));
    writeCsv(rows);
    // more days can't undo any of these, so don't spend them
    if (r.ended || r.bad > 0 || r.saveBytes > MAX_SAVE_BYTES) {
      if (r.ended && MODES[mode].gameOver) console.log(`(the colony ended on day ${d}; ${mode} ends then, so the soak stops)`);
      break;
    }
  }

  // verdict
  const firstBad = rows.find(r => r.bad > 0);
  if (firstBad) problems.push(`${firstBad.bad} ants had a non-finite position on day ${firstBad.d}`);
  const ended = rows.find(r => r.ended);
  if (ended && !MODES[mode].gameOver) {
    problems.push(`the colony would have ended on day ${ended.d} (${ended.pop} ants, ${ended.eggs} eggs, queen ${ended.queen}), in a mode that can't end`);
  }
  const biggest = Math.max(...rows.map(r => r.saveBytes));
  if (biggest > MAX_SAVE_BYTES) problems.push(`a save reached ${(biggest / 1048576).toFixed(1)} MB (limit ${MAX_SAVE_BYTES / 1048576} MB)`);

  // A bigger colony legitimately holds more and costs more per tick (a Zen colony is still growing
  // at day 5), so the last day is compared with the first day from BASELINE_DAY on that had a
  // similar population.
  const last = rows.at(-1);
  const baseline = rows.slice(BASELINE_DAY - 1, -1).find(r => Math.abs(r.pop - last.pop) <= SIMILAR * last.pop);
  if (baseline) {
    const against = `than day ${baseline.d} (population ${baseline.pop} -> ${last.pop})`;
    console.log(`day ${last.d} against day ${baseline.d}: heap ${baseline.heapMB.toFixed(1)} -> ${last.heapMB.toFixed(1)} MB, ` +
      `${baseline.msPerTick.toFixed(3)} -> ${last.msPerTick.toFixed(3)} ms/tick, population ${baseline.pop} -> ${last.pop}`);
    if (last.heapMB > baseline.heapMB * MAX_HEAP_GROWTH) {
      problems.push(`on day ${last.d} the heap is ${last.heapMB.toFixed(1)} MB, more than ${MAX_HEAP_GROWTH}x the ${baseline.heapMB.toFixed(1)} MB ${against}`);
    }
    if (last.msPerTick > baseline.msPerTick * MAX_SLOWDOWN) {
      problems.push(`on day ${last.d} a tick takes ${last.msPerTick.toFixed(3)} ms, more than ${MAX_SLOWDOWN}x the ${baseline.msPerTick.toFixed(3)} ms ${against}`);
    }
  } else {
    console.log(rows.length > BASELINE_DAY
      ? `(no day from ${BASELINE_DAY} on had a population like day ${last.d}'s, so heap and tick-time checks are skipped)`
      : `(heap and tick-time checks need more than ${BASELINE_DAY} days; skipped)`);
  }
} catch (e) {
  problems.push(e.message.split('\n')[0]);
}
problems.push(...errors);

await browser.close();
server.close();
console.log(problems.length ? `FAILED\n  ${problems.join('\n  ')}` : `PASS soak ${mode}: ${rows.length} days`);
process.exit(problems.length ? 1 : 0);
