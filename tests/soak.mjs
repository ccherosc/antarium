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
//
// npm run soak -- --realtime --hours 8 [--mode screensaver] [--every 10]
// The game as a player leaves it: a real Chromium window at 1x, renderer, camera tour and all,
// looked in on every `--every` minutes (frames drawn and requestAnimationFrame calls counted over
// 5 s, ticks lived since the last look, heap, colony) into tests/out/soak-realtime-<mode>.csv.
// Fails on a page error, a game that stopped living at 1x (or a machine that slept), or frame rate
// or heap that got worse since hour 1. On Windows it keeps the machine and screen awake while it runs.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
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

// --realtime
const WARM_UP_MS = 30_000;       // the first look waits for start-up and the camera's first shot to settle
const FPS_WINDOW_MS = 5000;      // frames are counted over this long
const MAX_FPS_DROP = 0.1;        // the last look's frame rates may be this fraction below hour 1's, and any look's below the cap
const MAX_HEAP_DRIFT = 1.2;      // the last look's heap / hour 1's, scaled up by how much the colony grew
const MIN_TICK_RATE = 0.95;      // ticks lived / the ticks 1x lives in that time; below this the game fell behind

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const realtime = process.argv.includes('--realtime');
const mode = arg('mode', 'screensaver');
const days = Number(arg('days', 30));
const hours = Number(arg('hours', 8));
const every = Number(arg('every', 10));   // minutes between looks
if (!(mode in MODES) || (realtime ? !(hours > 0 && every > 0) : !(Number.isInteger(days) && days >= 1))) {
  console.error(`usage: npm run soak -- --mode <${Object.keys(MODES).join('|')}> --days <whole number>\n` +
    `       npm run soak -- --realtime --hours <hours> [--mode <mode>] [--every <minutes>]`);
  process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });
const server = await serve(0);   // port 0: any free port
const base = `http://127.0.0.1:${server.address().port}/`;
// gc() lets us measure what the colony really holds rather than garbage awaiting collection
const browser = await chromium.launch({
  headless: !realtime,
  args: ['--js-flags=--expose-gc', '--enable-precise-memory-info',
    // a window behind others, or a screen gone dark overnight, is still drawn at full rate: Windows
    // slows a covered window's frames to about one a second, so the frames are paced by Chromium's
    // own clock rather than the screen's
    ...(realtime ? ['--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
      '--disable-gpu-vsync'] : [])],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('requestfailed', r => errors.push(`request failed: ${r.url()}`));

const DAY_COLUMNS = [   // [heading, width, value]
  ['d', 3, r => r.d], ['day', 4, r => r.day], ['pop', 5, r => r.pop], ['cap', 5, r => r.cap],
  ['eggs', 5, r => r.eggs], ['food', 6, r => r.food], ['water', 6, r => r.water],
  ['queen', 6, r => r.queen], ['bad', 4, r => r.bad], ['heapMB', 7, r => r.heapMB.toFixed(1)],
  ['ms/tick', 8, r => r.msPerTick.toFixed(3)], ['saveKB', 7, r => Math.round(r.saveBytes / 1024)],
];
const LIVE_COLUMNS = [
  ['min', 5, r => r.min], ['day', 5, r => r.day], ['pop', 5, r => r.pop], ['eggs', 5, r => r.eggs],
  ['fps', 6, r => r.fps.toFixed(1)], ['raf', 6, r => r.raf.toFixed(1)], ['ticks/s', 8, r => r.tps.toFixed(1)],
  ['heapMB', 7, r => r.heapMB.toFixed(1)], ['shot', 18, r => r.shot],
];
const COLUMNS = realtime ? LIVE_COLUMNS : DAY_COLUMNS;
const CSV = path.join(OUT, realtime ? `soak-realtime-${mode}.csv` : `soak-${mode}.csv`);
const line = cells => cells.map((c, i) => String(c).padStart(COLUMNS[i][1])).join(' ');
const writeCsv = rows => fs.writeFileSync(CSV,
  [COLUMNS.map(c => c[0]).join(','), ...rows.map(r => COLUMNS.map(c => c[2](r)).join(','))].join('\n') + '\n');

const rows = [];
const problems = [];

// Whole in-game days as fast as the page can live them, with the renderer off
async function byDays() {
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
}

// Windows sleeps, or darkens the screen and stops drawing, when nobody touches it for a while;
// a child PowerShell holds it awake until it is killed
function stayAwake() {
  if (process.platform !== 'win32') return null;
  const ps = `Add-Type -Name P -Namespace W -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);';` +
    ` [W.P]::SetThreadExecutionState(0x80000003) | Out-Null; while ($true) { Start-Sleep 60 }`;   // CONTINUOUS | SYSTEM | DISPLAY
  return spawn('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore', windowsHide: true });
}

// Is this a laptop running on its battery? (Win32_Battery's status 2 is on mains power.)
function onBattery() {
  if (process.platform !== 'win32') return false;
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command', '(Get-CimInstance Win32_Battery).BatteryStatus'],
      { encoding: 'utf8', windowsHide: true }).trim();
    return out !== '' && out !== '2';
  } catch {
    return false;
  }
}

// The game left running at 1x, looked in on now and then
async function inRealTime() {
  if (onBattery()) console.warn('soak: this machine is on battery; it will sleep when the battery runs low, whatever the soak asks');
  const awake = stayAwake();
  try {
    await page.goto(`${base}?debug&new&mode=${mode}`);
    await page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
    // count what the loop does: ticks lived and frames drawn
    let prev = await page.evaluate(() => {
      const { gameLoop } = window.__pa;
      const n = window.__soak = { ticks: 0, frames: 0 };
      const update = gameLoop.onUpdate, render = gameLoop.onRender;
      gameLoop.onUpdate = (...a) => { n.ticks++; return update.apply(gameLoop, a); };
      gameLoop.onRender = (...a) => { n.frames++; return render.apply(gameLoop, a); };
      gameLoop.setSpeed(1);
      return { ticks: 0, at: Date.now(), tickRate: 1000 / gameLoop.SIM_STEP };
    });
    const tickRate = prev.tickRate;
    console.log(`soak: ${mode} in real time, ${hours} h, a look every ${every} min (1x is ${tickRate} ticks/s)`);
    console.log(line(COLUMNS.map(c => c[0])));

    const start = Date.now(), end = start + hours * 3_600_000;
    const look = () => page.evaluate(async ms => {
      const { sim, director, gameLoop } = window.__pa, n = window.__soak;
      const f0 = n.frames, t0 = performance.now();
      let raf = 0;
      await new Promise(done => {
        const step = () => { raf++; if (performance.now() - t0 < ms) requestAnimationFrame(step); else done(); };
        requestAnimationFrame(step);
      });
      const secs = (performance.now() - t0) / 1000;
      window.gc?.();
      return {
        day: sim.stats.day, pop: sim.antSystem.population, eggs: sim.antSystem.eggCount,
        fps: (n.frames - f0) / secs, raf: raf / secs,
        ticks: n.ticks, at: Date.now(),   // the wall clock, which runs on while a machine sleeps
        heapMB: (performance.memory?.usedJSHeapSize ?? NaN) / 1048576,
        shot: String(director.shot?.kind ?? '-').replace(/,/g, ' '),
        speed: gameLoop.speed, cap: gameLoop.fpsCap,
      };
    }, FPS_WINDOW_MS);
    const until = t => new Promise(done => setTimeout(done, Math.max(0, t - Date.now())));

    for (let k = 0, due = start + WARM_UP_MS; due <= end && !errors.length;) {
      await until(due);
      const r = await look();
      const tps = (r.ticks - prev.ticks) / ((r.at - prev.at) / 1000);
      rows.push({ min: Math.round((Date.now() - start) / 60_000), ...r, tps });
      prev = r;
      console.log(line(COLUMNS.map(c => c[2](rows.at(-1)))));
      writeCsv(rows);
      // the next look; after a sleep the ones missed are skipped rather than taken back to back
      k = Math.max(k + 1, Math.ceil((Date.now() - start) / (every * 60_000)));
      due = start + k * every * 60_000;
    }
    if (!rows.length) return;

    // verdict
    const gap = rows.findIndex((r, i) => i && r.min - rows[i - 1].min > every * 1.5);
    if (gap > 0) problems.push(`there was no look between minute ${rows[gap - 1].min} and ${rows[gap].min} (the machine slept, or the page hung)`);
    const slow = rows.find(r => r.tps < tickRate * MIN_TICK_RATE);
    if (slow) problems.push(`by minute ${slow.min} the game lived ${slow.tps.toFixed(1)} ticks/s, not ${tickRate} (it fell behind, or the machine slept)`);
    const stopped = rows.find(r => r.speed !== 1);
    if (stopped) problems.push(`at minute ${stopped.min} the game was at ${stopped.speed}x, not 1x`);
    const short = rows.find(r => r.cap > 0 && r.fps < r.cap * (1 - MAX_FPS_DROP));
    if (short) problems.push(`at minute ${short.min} ${short.fps.toFixed(1)} frames a second were drawn, more than ${MAX_FPS_DROP * 100}% short of the ${short.cap} cap`);
    const last = rows.at(-1);
    const hour1 = rows.find(r => r.min >= 60 && r !== last) ?? rows[0];
    console.log(`minute ${last.min} against minute ${hour1.min}: fps ${hour1.fps.toFixed(1)} -> ${last.fps.toFixed(1)}, ` +
      `raf ${hour1.raf.toFixed(1)} -> ${last.raf.toFixed(1)}, heap ${hour1.heapMB.toFixed(1)} -> ${last.heapMB.toFixed(1)} MB, ` +
      `population ${hour1.pop} -> ${last.pop}, day ${hour1.day} -> ${last.day}`);
    for (const k of ['fps', 'raf']) {
      if (last[k] < hour1[k] * (1 - MAX_FPS_DROP)) {
        problems.push(`at minute ${last.min} ${k} is ${last[k].toFixed(1)}, more than ${MAX_FPS_DROP * 100}% below minute ${hour1.min}'s ${hour1[k].toFixed(1)}`);
      }
    }
    const heapLimit = hour1.heapMB * MAX_HEAP_DRIFT * Math.max(1, last.pop / hour1.pop);
    if (last.heapMB > heapLimit) {
      problems.push(`at minute ${last.min} the heap is ${last.heapMB.toFixed(1)} MB, over the ${heapLimit.toFixed(1)} MB allowed from minute ${hour1.min}'s ${hour1.heapMB.toFixed(1)} MB (population ${hour1.pop} -> ${last.pop})`);
    }
    // what the commit message carries
    console.log(`summary (first, middle, last):\n${line(COLUMNS.map(c => c[0]))}\n` +
      [rows[0], rows[Math.floor((rows.length - 1) / 2)], last].map(r => line(COLUMNS.map(c => c[2](r)))).join('\n'));
  } finally {
    awake?.kill();
  }
}

try {
  await (realtime ? inRealTime() : byDays());
} catch (e) {
  problems.push(e.message.split('\n')[0]);
}
problems.push(...errors);

await browser.close();
server.close();
console.log(problems.length ? `FAILED\n  ${problems.join('\n  ')}`
  : realtime ? `PASS soak ${mode} in real time: ${rows.at(-1).min} min` : `PASS soak ${mode}: ${rows.length} days`);
process.exit(problems.length ? 1 : 0);
