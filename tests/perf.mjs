// npm run perf -- --seconds 12 --mode screensaver
// What the frame cap and low quality save. Opens a colony in headless Chromium and, while it runs,
// switches between the settings, reporting for each how many frames the game drew a second, how long
// it spent on a frame, and how much processor time all of the browser's processes used (the page, the
// GPU process, the browser itself). The settings are measured back and forth (A B C D D C B A) and
// averaged, so a colony that grows or a machine that warms up does not favour one of them.
//
// A stand-in for Chrome's Task Manager (Shift+Esc), which cannot be scripted. Headless Chromium
// draws with the CPU, so a desktop with a GPU shows lower percentages, and a cap saves only the
// drawing share of them: read the direction and the ratios, not the absolute numbers. It has no 'no
// cap' row because headless Chromium refreshes at 60 Hz, which makes that the same as a cap of 60.
// ms/frame is only the game's own time on a frame (as ?debug shows it): the browser rasterises the
// frame after that, and the CPU columns are where that cost shows.
// Close other heavy programs first; with the defaults a run takes about two minutes. Exits 1 if a
// page errors or a cap does not hold (the CPU numbers would mean nothing), and never on how fast
// or slow the machine is.
import { chromium } from 'playwright';
import { serve } from '../tools/serve.mjs';
import { MODES } from '../src/modes.js';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const mode = arg('mode', 'screensaver');
const seconds = Number(arg('seconds', 12));
if (!(mode in MODES) || !(seconds >= 2)) {
  console.error(`usage: npm run perf -- --mode <${Object.keys(MODES).join('|')}> --seconds <2 or more>`);
  process.exit(2);
}
const SETTLE_MS = 5000;    // a new colony is busy for a moment: fast-forward aftermath, first garbage collections
const WARM_UP_MS = 3000;   // after a change, the first frames are not a fair count
const VIEWPORT = { width: 1600, height: 900 };

const SCENARIOS = [   // [label, frame cap, quality]
  ['cap 60', 60, 'high'],
  ['cap 30', 30, 'high'],
  ['cap 60, low quality', 60, 'low'],
  ['cap 30, low quality', 30, 'low'],
];

const server = await serve(0);   // port 0: any free port
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT });
const errors = [];
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
page.on('requestfailed', r => errors.push(`request failed: ${r.url()}`));
const cdp = await browser.newBrowserCDPSession();

// Seconds of processor time each browser process has used so far, by process id
const cpuTimes = async () => {
  const { processInfo } = await cdp.send('SystemInfo.getProcessInfo');
  return new Map(processInfo.map(p => [p.id, { type: p.type, cpu: p.cpuTime }]));
};
const used = (before, after) => {   // processor seconds used between two readings, by kind of process
  const by = { page: 0, gpu: 0, other: 0 };
  for (const [id, now] of after) {
    const spent = now.cpu - (before.get(id)?.cpu ?? 0);
    by[now.type === 'renderer' ? 'page' : now.type === 'gpu' ? 'gpu' : 'other'] += spent;
  }
  return by;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function sample([, cap, quality]) {
  await page.evaluate(([cap, quality]) => {
    window.__pa.settings.set('quality', quality);
    window.__pa.settings.set('fpsCap', cap);
    Object.assign(window.__perf, { frames: 0, busy: 0 });
  }, [cap, quality]);
  await sleep(WARM_UP_MS);
  await page.evaluate(() => Object.assign(window.__perf, { frames: 0, busy: 0 }));
  const before = await cpuTimes(), t0 = performance.now();
  await sleep(seconds * 1000);
  const after = await cpuTimes(), wall = (performance.now() - t0) / 1000;
  const drawn = await page.evaluate(() => ({ ...window.__perf }));
  const cpu = used(before, after);
  const pct = x => x / wall * 100;   // of one core
  return {
    fps: drawn.frames / wall, msPerFrame: drawn.frames ? drawn.busy / drawn.frames : 0,
    total: pct(cpu.page + cpu.gpu + cpu.other), page: pct(cpu.page), gpu: pct(cpu.gpu), other: pct(cpu.other),
  };
}

const results = SCENARIOS.map(() => []);
try {
  await page.goto(`${base}?debug&new&mode=${mode}`);
  await page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
  await page.evaluate(() => {   // count the frames drawn and the time they took
    const { gameLoop } = window.__pa;
    const drawn = gameLoop.onRender;
    const stats = window.__perf = { frames: 0, busy: 0 };
    gameLoop.setSpeed(1);
    gameLoop.onRender = function (...args) {
      const t0 = performance.now();
      drawn.apply(this, args);
      stats.frames++;
      stats.busy += performance.now() - t0;
    };
  });
  console.log(`${mode} colony, ${VIEWPORT.width}x${VIEWPORT.height}, headless Chromium; ${SCENARIOS.length * 2} samples of ${seconds} s after ${WARM_UP_MS / 1000} s of warming up`);
  await sleep(SETTLE_MS);
  const order = [...SCENARIOS.keys(), ...[...SCENARIOS.keys()].reverse()];
  for (const [n, i] of order.entries()) {
    process.stdout.write(`\r  sample ${n + 1} of ${order.length}: ${SCENARIOS[i][0].padEnd(22)}`);
    results[i].push(await sample(SCENARIOS[i]));
  }
  process.stdout.write('\r' + ' '.repeat(60) + '\r');
} catch (e) {
  errors.push(e.message.split('\n')[0]);
}
await browser.close();
server.close();

const mean = (rows, key) => rows.reduce((a, r) => a + r[key], 0) / rows.length;
const avg = results.map(rows => rows.length ? Object.fromEntries(Object.keys(rows[0]).map(k => [k, mean(rows, k)])) : null);
const problems = [...errors];
if (avg.every(Boolean)) {
  const f = (x, d = 1) => x.toFixed(d).padStart(7);
  console.log('');
  console.log(`${''.padEnd(22)}  frames/s  ms/frame  |  CPU, % of one core: all    page     gpu   other  |  of cap 60's`);
  SCENARIOS.forEach(([label, cap], i) => {
    const r = avg[i];
    console.log(`${label.padEnd(22)}  ${f(r.fps)}  ${f(r.msPerFrame)}  |  ${' '.repeat(19)}${f(r.total)} ${f(r.page)} ${f(r.gpu)} ${f(r.other)}  |  ${(r.total / avg[0].total * 100).toFixed(0).padStart(5)}%`);
    if (cap > 0 && r.fps > cap * 1.1 + 1) problems.push(`${label}: the game drew ${r.fps.toFixed(1)} frames a second, over its cap of ${cap}`);
  });
  const less = i => `${(100 - avg[i].total / avg[0].total * 100).toFixed(0)}% less`;
  console.log(`\nCompared with a cap of 60 (${avg[0].total.toFixed(0)}% of a core): a cap of 30 uses ${less(1)} (${avg[1].total.toFixed(0)}%), low quality alone ${less(2)} (${avg[2].total.toFixed(0)}%), both ${less(3)} (${avg[3].total.toFixed(0)}%).`);
  if (avg[0].fps < 51) console.log(`Note: at a cap of 60 this machine drew only ${avg[0].fps.toFixed(0)} frames a second, so a cap of 60 was not the full load.`);
}
for (const p of problems) console.error(`PROBLEM ${p}`);
process.exit(problems.length ? 1 : 0);
