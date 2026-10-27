// npm test — smoke test. Loads each mode in a real browser at 8x speed and fails on any page
// error, stalled clock, empty colony, NaN ant position or blank canvas, then saves the colony
// and checks the reload resumes it. It also walks the normal menu -> tutorial path, which ?debug
// skips, and checks that settings persist, that a save from an older build still resumes, that
// the events the simulation emits reach the event bus and that a new colony is grown, and a
// resumed one caught up, before the first frame, and that the frame cap and low quality save power
// without changing the colony or the picture. `npm test -- events saves` runs just the named
// checks (boot, settings, saves, events, fastforward, performance, or a mode from src/modes.js).
// Numbers can pass while the picture is wrong, so always look at the screenshots this writes to
// tests/out/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../tools/serve.mjs';
import { MODES as MODE_TABLE } from '../src/modes.js';
import { CONFIG } from '../src/config.js';
import { fastForward } from '../src/app/fastForward.js';
import { GameLoop } from '../src/app/gameLoop.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const FIXTURES = path.join(HERE, 'fixtures');
const MODES = Object.keys(MODE_TABLE);   // every mode in src/modes.js is tested
const MIN_TICKS = 3000;    // sim ticks (16 ms each) that must have run...
const MIN_SECONDS = 10;    // ...and at least this much real time, so camera/director code runs too
const MAX_SECONDS = 90;    // stop waiting after this long
const RESUME_TICKS = 1500; // a resumed colony may have run this long (~25 s at 1x) before we look
const VIEWPORT = { width: 1600, height: 900 };

const CHECKS = ['boot', 'settings', 'saves', 'events', 'fastforward', 'performance', ...MODES];
const only = process.argv.slice(2);   // the checks to run; none named means all of them
const unknown = only.filter(name => !CHECKS.includes(name));
if (unknown.length) {
  console.error(`unknown check ${unknown.join(', ')}; the checks are ${CHECKS.join(', ')}`);
  process.exit(2);
}
const wanted = name => !only.length || only.includes(name);

fs.mkdirSync(OUT, { recursive: true });
const server = await serve(0);   // port 0: any free port
const base = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
let anyFailed = false;

function report(name, problems, info = '') {
  const ok = problems.length === 0;
  if (!ok) anyFailed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(12)} ${ok ? info : problems.join('; ')}`);
}

// Everything that should never happen in a healthy page
function watch(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console.error: ${m.text()}`); });
  page.on('requestfailed', r => errors.push(`request failed: ${r.url()}`));
  return errors;
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
}

// A colony's vital signs, plus how many distinct colours the canvas shows (a blank one has few)
const inspect = page => page.evaluate(() => {
  const { world, sky, antSystem, queen, stats } = window.__pa.sim;
  const c = document.getElementById('gameCanvas');
  const ctx = c.getContext('2d');
  const colours = new Set();
  for (let y = 10; y < c.height; y += 40) {
    for (let x = 10; x < c.width; x += 40) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      colours.add((d[0] << 16) | (d[1] << 8) | d[2]);
    }
  }
  return {
    tick: world.tick,
    time: sky.time,
    light: sky.light,
    pop: antSystem.population,
    eggs: antSystem.eggCount,
    laid: queen.laid,
    day: stats.day,
    peak: stats.peakPopulation,
    badAnts: antSystem.ants.filter(a => !Number.isFinite(a.x) || !Number.isFinite(a.y)).length,
    colours: colours.size,
  };
});

// What the earth looks like: the mean red and blue of a block in the middle of the glass, below the
// ground line, with the farm in its usual place. Soil is brown (red well above blue) at any hour; a
// tile canvas that was never drawn shows the dark room behind it (blue above red), and `inspect`'s
// count of colours would not notice, since the ants and glows are still there.
const soilTone = page => page.evaluate(() => {
  const c = document.getElementById('gameCanvas');
  const d = c.getContext('2d').getImageData(Math.round(c.width * 0.2), Math.round(c.height * 0.4),
    Math.round(c.width * 0.4), Math.round(c.height * 0.4)).data;
  let r = 0, b = 0;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; b += d[i + 2]; }
  return { r: Math.round(r / (d.length / 4)), b: Math.round(b / (d.length / 4)) };
});
const soilDrawn = t => t.r > t.b * 1.2;
const soilNote = t => `the middle of the farm averages red ${t.r}, blue ${t.b}: soil is brown`;

// Did the saved colony come back, rather than a fresh one? Each part of the save (world, sky,
// ants, queen, stats) shows up in a different number. The game is running again by the time we
// look, so allow for some drift.
function resumeProblems(saved, back) {
  const out = [];
  const within = (v, lo, hi) => v >= lo && v <= hi;
  if (!within(back.tick, saved.tick, saved.tick + RESUME_TICKS)) out.push(`resumed at tick ${back.tick}, saved at ${saved.tick}`);
  if (!within(back.time, saved.time, saved.time + RESUME_TICKS)) out.push(`sky clock resumed at ${back.time}, saved at ${saved.time}`);
  if (back.day < saved.day) out.push(`resumed on day ${back.day}, saved on day ${saved.day}`);
  if (Math.abs(back.pop - saved.pop) > 10) out.push(`resumed with ${back.pop} ants, saved with ${saved.pop}`);
  if (Math.abs(back.eggs - saved.eggs) > 10) out.push(`resumed with ${back.eggs} eggs, saved with ${saved.eggs}`);
  if (!within(back.laid, saved.laid, saved.laid + 60)) out.push(`queen resumed at ${back.laid} eggs laid, saved at ${saved.laid}`);
  if (back.peak < saved.peak) out.push(`peak population fell from ${saved.peak} to ${back.peak}`);
  if (back.badAnts > 0) out.push(`${back.badAnts} resumed ants have a non-finite position`);
  return out;
}

// Straight into a mode with ?debug, run it at top speed, inspect the colony, then save it and
// check that a reload resumes it
async function runMode(mode) {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = watch(page);
  const problems = [];
  let info = '';
  try {
    await page.goto(`${base}?debug&new&mode=${mode}`);
    await page.waitForFunction(() => window.__pa, null, { timeout: 20_000 });
    await page.evaluate(() => window.__pa.gameLoop.setSpeed(8));
    // a new colony may have been grown before the page was ready: only the ticks since count as the clock running
    const tick0 = await page.evaluate(() => window.__pa.sim.world.tick);

    const t0 = Date.now();
    for (;;) {
      const tick = await page.evaluate(() => window.__pa.sim.world.tick) - tick0;
      const secs = (Date.now() - t0) / 1000;
      // an error freezes the loop, so don't wait out the clock once one has happened
      if (errors.length || (tick >= MIN_TICKS && secs >= MIN_SECONDS) || secs > MAX_SECONDS) break;
      await page.waitForTimeout(500);
    }

    const s = await inspect(page);
    info = `tick=${s.tick} pop=${s.pop} colours=${s.colours}`;
    if (s.tick - tick0 <= MIN_TICKS) problems.push(`only ${s.tick - tick0} ticks ran (need > ${MIN_TICKS})`);
    if (s.pop <= 0) problems.push('no ants alive');
    if (s.badAnts > 0) problems.push(`${s.badAnts} ants have a non-finite position`);
    if (s.colours < 20) problems.push(`canvas looks blank (${s.colours} distinct colours)`);
    await shot(page, mode);

    // Save the way a player does, paused so the numbers hold still, then come back. The peak is
    // raised to something a fresh colony couldn't reach, to see the stats come back too. The
    // second visit has no &new: that would wipe the save we are trying to resume.
    await page.evaluate(() => {
      window.__pa.gameLoop.setSpeed(0);
      window.__pa.sim.stats.peakPopulation += 25;
    });
    const saved = await inspect(page);
    await page.click('#btn-save');
    await page.goto(`${base}?debug&mode=${mode}`);
    await page.waitForFunction(() => window.__pa, null, { timeout: 20_000 });
    const back = await inspect(page);
    problems.push(...resumeProblems(saved, back));
    info += ` resumed@${back.tick}`;
    await page.waitForTimeout(1000);   // a few frames, so the restored colony is on screen
    await shot(page, `${mode}-resumed`);
  } catch (e) {
    problems.push(e.message.split('\n')[0]);
    await shot(page, mode);   // leave a picture of wherever it got stuck
  }
  problems.push(...errors);
  await page.close();
  report(mode, problems, info);
}

// The path a customer takes: menu -> pick a mode -> tutorial. No ?debug, so no window.__pa.
async function runBoot() {
  const page = await browser.newPage({ viewport: VIEWPORT });
  const errors = watch(page);
  const problems = [];
  try {
    await page.goto(base);
    await page.waitForSelector('#mode-select:not(.hidden)', { timeout: 10_000 });
    if (await page.evaluate(() => window.__pa !== undefined)) problems.push('window.__pa exists without ?debug');
    await page.click('#btn-mode-screensaver');
    await page.waitForSelector('#tutorial:not(.hidden)', { timeout: 20_000 });   // the new colony is grown first
    await page.waitForTimeout(1500);   // let a few frames render
    if (await page.evaluate(() => document.getElementById('perf') !== null)) problems.push('the ?debug frame-rate read-out shows without ?debug');
  } catch (e) {
    problems.push(e.message.split('\n')[0]);
  }
  problems.push(...errors);
  await shot(page, 'boot');
  await page.close();
  report('boot', problems, 'menu -> tutorial');
}

// Settings live in localStorage: they must survive a reload, shrug off corrupt storage, and the
// reduced-motion default must follow the OS until the player chooses.
async function runSettings() {
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const get = (page, k) => page.evaluate(k => window.__pa.settings.get(k), k);
  const ready = page => page.waitForFunction(() => window.__pa, null, { timeout: 20_000 });
  const reload = async page => { await page.reload(); await ready(page); };
  const errors = [];
  const contexts = [];
  try {
    // an ordinary browser: defaults, change events, rejected input, survives a reload
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(ctx);
    const page = await ctx.newPage();
    errors.push(watch(page));
    await page.goto(`${base}?debug&new&mode=screensaver`);
    await ready(page);
    check(await get(page, 'volume') === 0.6, 'volume should default to 0.6');
    check(await get(page, 'reducedMotion') === false, 'reducedMotion should default to false');

    const r = await page.evaluate(() => {
      const { settings } = window.__pa, calls = [];
      settings.onChange((k, v) => calls.push([k, v]));
      settings.set('volume', 0.2);
      settings.set('volume', 0.2);       // no change, so no event
      settings.set('volume', 'loud');    // wrong type
      settings.set('bogus', 1);          // not a setting
      return { calls, volume: settings.get('volume'), bogus: settings.get('bogus') };
    });
    check(JSON.stringify(r.calls) === '[["volume",0.2]]', `onChange fired ${JSON.stringify(r.calls)}`);
    check(r.volume === 0.2, `volume is ${r.volume} after bad input`);
    check(r.bogus === undefined, 'an unknown setting was accepted');
    await reload(page);
    check(await get(page, 'volume') === 0.2, 'volume did not survive a reload');

    // hand-edited or corrupt storage must not leak in or break the page
    await page.evaluate(() => localStorage.setItem('pixelants_settings', '{"volume":"loud","muted":true,"bogus":1}'));
    await reload(page);
    check(await get(page, 'volume') === 0.6, 'a wrong-typed stored value was not ignored');
    check(await get(page, 'muted') === true, 'a valid stored value was dropped');
    check(await get(page, 'bogus') === undefined, 'an unknown stored key leaked in');
    await page.evaluate(() => localStorage.setItem('pixelants_settings', '[1,2'));
    await reload(page);
    check(await get(page, 'volume') === 0.6, 'unparseable storage should fall back to the defaults');

    // a default that depends on something settings cannot see (the mode's frame cap): heard by the
    // listeners but not stored, kept if the player picks the same, and never over a choice already made
    const dflt = await page.evaluate(() => {
      const { settings } = window.__pa, calls = [], key = 'pixelants_settings';
      const before = localStorage.getItem(key);
      settings.onChange((k, v) => calls.push([k, v]));
      settings.setDefault('fpsCap', 0);
      const stored = localStorage.getItem(key), now = settings.get('fpsCap');
      settings.setDefault('fpsCap', 0);        // the same again: no event
      settings.setDefault('fpsCap', 'fast');   // wrong type
      settings.setDefault('bogus', 1);         // not a setting
      settings.set('fpsCap', 0);               // choosing what the default already is still pins it
      const pinned = localStorage.getItem(key);
      settings.setDefault('fpsCap', 30);       // a choice beats a default
      return { before, stored, now, pinned, kept: settings.get('fpsCap'), calls };
    });
    check(dflt.now === 0 && dflt.stored === dflt.before, `a default was stored as the player's choice: it read ${dflt.now}, storage went from ${dflt.before} to ${dflt.stored}`);
    check(dflt.pinned === '{"fpsCap":0}', `choosing the value a default already had was not kept: ${dflt.pinned}`);
    check(dflt.kept === 0, `a default beat the player's choice: it read ${dflt.kept}`);
    check(JSON.stringify(dflt.calls) === '[["fpsCap",0]]', `setDefault told the listeners ${JSON.stringify(dflt.calls)}`);

    // the OS asks for less motion: that is the default, but only until the player chooses
    const rctx = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
    contexts.push(rctx);
    const rpage = await rctx.newPage();
    errors.push(watch(rpage));
    await rpage.goto(`${base}?debug&new&mode=screensaver`);
    await ready(rpage);
    check(await get(rpage, 'reducedMotion') === true, 'reducedMotion should follow the OS preference');
    await rpage.evaluate(() => window.__pa.settings.set('volume', 0.3));
    const saved = await rpage.evaluate(() => localStorage.getItem('pixelants_settings'));
    check(saved === '{"volume":0.3}', `an unchosen default was written to storage: ${saved}`);
    await rpage.evaluate(() => window.__pa.settings.set('reducedMotion', false));
    await reload(rpage);
    check(await get(rpage, 'reducedMotion') === false, "the player's choice should beat the OS preference");

    // choosing what the OS already implies is still a choice: no change event, but it is kept
    await rpage.evaluate(() => localStorage.removeItem('pixelants_settings'));
    await reload(rpage);
    check(await get(rpage, 'reducedMotion') === true, 'reducedMotion should follow the OS again with nothing stored');
    const fired = await rpage.evaluate(() => {
      let n = 0;
      window.__pa.settings.onChange(() => n++);
      window.__pa.settings.set('reducedMotion', true);
      return n;
    });
    check(fired === 0, `choosing the current value fired ${fired} change events`);
    await rpage.emulateMedia({ reducedMotion: 'no-preference' });
    await reload(rpage);
    check(await rpage.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches) === false,
      'test setup: the OS preference did not change');
    check(await get(rpage, 'reducedMotion') === true, 'a choice that matched the OS was forgotten when the OS changed');
  } catch (e) {
    problems.push(e.message.split('\n')[0]);
  }
  problems.push(...errors.flat());
  for (const c of contexts) await c.close();
  report('settings', problems, 'defaults, validation, reload, reduced motion');
}

// Saves outlive builds. tests/fixtures/save-v2-screensaver.json is a real save from the build
// that kept the version in the storage key, so this fails if a change to what a save holds comes
// without a migration. Also: a save from a newer build is refused without a crash, New Colony
// wipes every copy, and the `extra` block that later systems save into round-trips.
async function runSaves() {
  const OLD = 'pixelants_v2_screensaver', CUR = 'pixelants_screensaver';
  const legacy = fs.readFileSync(path.join(FIXTURES, 'save-v2-screensaver.json'), 'utf8');
  const old = JSON.parse(legacy);
  const vitals = d => ({
    tick: d.world.tick, time: d.sky.time, pop: d.colony.ants.length, eggs: d.colony.eggs.length,
    laid: d.queen.laid, day: d.stats.day, peak: d.stats.peakPopulation,
  });
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const ctx = await browser.newContext({ viewport: VIEWPORT });   // its own storage
  const page = await ctx.newPage();
  const errors = watch(page);
  const stored = k => page.evaluate(k => localStorage.getItem(k), k);
  const plant = (k, v) => page.evaluate(([k, v]) => localStorage.setItem(k, v), [k, v]);
  // Come back to the colony with `saves` ({ key: text }) in storage and nothing else. A colony that is
  // left saves itself (its tab goes hidden), so the saves are planted once the player has gone: from
  // a page with no game in it, after wiping whatever the leaving wrote.
  const resume = async saves => {
    await page.goto(`${base}styles/main.css`);
    await page.evaluate(([keys, saves]) => {
      for (const k of keys) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(saves)) localStorage.setItem(k, v);
    }, [[OLD, CUR], saves]);
    await page.goto(`${base}?debug&mode=screensaver`);
    await page.waitForFunction(() => window.__pa, null, { timeout: 20_000 });
    return inspect(page);
  };
  try {
    // the menu offers the old colony, and New Colony removes it for good
    await page.goto(base);
    await page.waitForSelector('#mode-select:not(.hidden)', { timeout: 10_000 });
    await plant(OLD, legacy);
    await page.click('#btn-mode-screensaver');
    await page.waitForSelector('#ms-confirm:not(.hidden)', { timeout: 10_000 });
    const dialog = await page.textContent('#ms-resume-info');
    check(dialog.includes(`Day ${old.stats.day}`) && dialog.includes(`Peak population ${old.stats.peakPopulation}`),
      `the resume dialog says "${dialog}"`);
    await page.click('#btn-new-colony');
    await page.waitForSelector('#tutorial:not(.hidden)', { timeout: 20_000 });
    check(await stored(OLD) === null && await stored(CUR) === null, 'New Colony left a saved copy behind');

    // the old colony resumes, and merely loading it changes nothing in storage. It is planted as if
    // it had just been saved: a colony that was away for a while catches up first (see fastforward)
    const justSaved = JSON.stringify({ ...old, ts: Date.now() });
    let back = await resume({ [OLD]: justSaved });
    problems.push(...resumeProblems(vitals(old), back).map(p => `old save: ${p}`));
    check(await stored(OLD) === justSaved && await stored(CUR) === null, 'loading the old save touched storage');
    await page.waitForTimeout(1000);
    await shot(page, 'saves-v2');

    // the first save after that writes the current format and leaves one copy (the peak is
    // raised to something a fresh colony couldn't reach, to see the stats come back too)
    await page.evaluate(() => { window.__pa.sim.stats.peakPopulation = 77; });
    await page.click('#btn-save');
    const curRaw = await stored(CUR);
    const cur = JSON.parse(curRaw);
    const current = await page.evaluate(async () => (await import('/src/saveLoad.js')).VERSION);
    check(cur.version === current, `saved as version ${cur.version}, the current one is ${current}`);
    check(cur.extra && typeof cur.extra === 'object', 'the new save has no extra block');
    check(await stored(OLD) === null, 'the old copy was left behind once the new one was written');
    back = await resume({ [CUR]: curRaw });
    problems.push(...resumeProblems(vitals(cur), back).map(p => `new save: ${p}`));

    // a save from a newer build is refused and left alone; the player gets a fresh colony
    const future = JSON.stringify({ ...old, version: 999 });
    back = await resume({ [CUR]: future });
    const fresh = await page.evaluate(() => window.__pa.startup);   // a new colony is grown first
    check(fresh?.kind === 'pregrow' && back.tick <= fresh.ticks + RESUME_TICKS,
      `a newer save was loaded, not refused (startup ${JSON.stringify(fresh)}, tick ${back.tick})`);
    check(back.pop > 0, 'refusing a newer save left no colony');
    check((await page.textContent('#save-status')).includes('starting fresh'), 'the player was not told the save was refused');
    check(await stored(CUR) === future, 'a refused save was deleted by merely loading it');

    // `extra`: systems saved beside the core ones. Stand-ins keep this independent of the game.
    const x = await page.evaluate(async () => {
      const { saveGame, loadGame, getSaveInfo } = await import('/src/saveLoad.js');
      const part = data => ({ calls: 0, save: () => data, load(d) { this.calls++; this.got = d; } });
      const core = () => ({ world: part({}), sky: part({}), antSystem: part({}), queen: part({}),
                            stats: { day: 2, peakPopulation: 6 } });
      const out = {};

      saveGame('stub', { ...core(), decor: part({ hats: 3 }) });
      out.saved = JSON.parse(localStorage.getItem('pixelants_stub')).extra;
      const into = { ...core(), decor: part(null), run: part(null) };
      out.loaded = loadGame('stub', into);
      out.decor = into.decor.got;
      out.runCalls = into.run.calls;      // nothing was saved for it, so it must not be loaded

      localStorage.setItem('pixelants_stub', JSON.stringify({ version: 3, ts: 42, name: 'Hill', stats: { day: 4, peakPopulation: 9 } }));
      out.info = getSaveInfo('stub');

      // a save from before `extra` existed: loads, and the systems are left alone
      localStorage.removeItem('pixelants_stub');
      localStorage.setItem('pixelants_v2_stub', JSON.stringify({ version: 2, ts: 1, world: {}, sky: {}, colony: {}, queen: {},
                                                                 stats: { day: 1, peakPopulation: 1 } }));
      const older = { ...core(), decor: part(null) };
      out.olderLoaded = loadGame('stub', older);
      out.olderDecorCalls = older.decor.calls;
      return out;
    });
    check(JSON.stringify(x.saved) === '{"decor":{"hats":3}}', `extra was saved as ${JSON.stringify(x.saved)}`);
    check(x.loaded === true && JSON.stringify(x.decor) === '{"hats":3}', 'saved extra state was not handed back on load');
    check(x.runCalls === 0, `a system with nothing saved was loaded ${x.runCalls} times`);
    check(JSON.stringify(x.info) === '{"day":4,"peakPopulation":9,"ts":42,"name":"Hill"}', `getSaveInfo returned ${JSON.stringify(x.info)}`);
    check(x.olderLoaded === true && x.olderDecorCalls === 0, 'a save from before `extra` should load without touching the extra systems');
  } catch (e) {
    problems.push(e.message.split('\n')[0]);
    await shot(page, 'saves-v2');   // leave a picture of wherever it got stuck
  }
  problems.push(...errors);
  await ctx.close();
  report('saves', problems, 'old save resumes, newer refused, New Colony wipes both, extras');
}

// The event bus (src/events.js): delivery, unsubscribing and a handler that throws, then a real
// colony played until every event the simulation emits has fired, each carrying what it should.
// Nothing in the game listens yet, so this is the only thing that notices a lost or wrong emit.
async function runEvents() {
  const TYPES = ['dawn', 'dusk', 'rainStart', 'rainEnd', 'flight', 'hatch', 'death', 'projectDone'];
  const MAX_DAYS = 10;   // the first rain and the first nuptial flight take a few days to come
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const page = await ctx.newPage();
  const errors = watch(page);
  let days = 0;
  try {
    await page.goto(`${base}?debug&new&mode=screensaver`);
    await page.waitForFunction(() => window.__pa, null, { timeout: 20_000 });
    await page.evaluate(() => window.__pa.gameLoop.stop());   // from here on we are the clock

    // the bus on its own
    const bus = await page.evaluate(async () => {
      const { on, emit, logEvent, onEvent } = await import('/src/events.js');
      const out = {};

      // reaches the right type, in the order registered, as the very object that was emitted
      const got = [], sent = { n: 1 };
      on('a', d => got.push(['first', d]));
      on('a', d => got.push(['second', d]));
      on('b', () => got.push(['wrong type']));
      emit('a', sent);
      emit('nobody listens');
      out.delivery = got.map(g => g[0]).join();
      out.sameObject = got.every(g => g[1] === sent);

      // unsubscribing removes just that registration, and doing it twice changes nothing
      let n = 0;
      const bump = () => n++;
      const off1 = on('c', bump), off2 = on('c', bump);
      off1(); off1();
      emit('c');
      out.callsWithOneOff = n;
      off2();
      emit('c');
      out.callsWithBothOff = n - out.callsWithOneOff;

      // removed during an emit, a handler is not called again; added during one, it hears the next
      const order = [];
      let offB;
      const offA = on('d', () => { order.push('A'); offB(); offA(); on('d', () => order.push('late')); });
      offB = on('d', () => order.push('B'));
      on('d', () => order.push('C'));
      emit('d');
      out.firstEmit = order.join();
      order.length = 0;
      emit('d');
      out.secondEmit = order.join();

      // added with nothing taken away, a handler still first hears the next emit
      const added = [];
      on('f', () => { added.push('first'); on('f', () => added.push('late')); });
      emit('f');
      out.addedFirst = added.join();
      added.length = 0;
      emit('f');
      out.addedSecond = added.join();

      // a handler that throws is reported, and the others and the emitter carry on
      const real = console.error, reported = [];
      console.error = (...a) => reported.push(a);
      const ran = [];
      on('e', () => { throw new Error('boom'); });
      on('e', () => ran.push('after'));
      try { emit('e', 1); out.threw = false; } catch { out.threw = true; } finally { console.error = real; }
      out.ran = ran.join();
      out.reported = reported.length;
      out.namedTheType = String(reported[0]?.[0]).includes("'e'");

      // a type is just a name, even one that Object itself has
      const hits = [];
      on('constructor', d => hits.push(d));
      for (const t of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) emit(t, t);
      out.names = hits.join();

      // and the Colony Log hooks are as they were
      const heard = [];
      onEvent(m => heard.push(m));
      logEvent('bus test'); logEvent('bus test');
      out.logged = heard.join();
      return out;
    });
    check(bus.delivery === 'first,second' && bus.sameObject,
      `emit reached "${bus.delivery}" (wanted first,second)${bus.sameObject ? '' : ' and handed over a copy of the data'}`);
    check(bus.callsWithOneOff === 1 && bus.callsWithBothOff === 0,
      `unsubscribing one of a handler's two registrations left ${bus.callsWithOneOff} calls (wanted 1), then the other ${bus.callsWithBothOff} (wanted 0)`);
    check(bus.firstEmit === 'A,C' && bus.secondEmit === 'C,late',
      `handlers changed during an emit ran as "${bus.firstEmit}" then "${bus.secondEmit}" (wanted A,C then C,late)`);
    check(bus.addedFirst === 'first' && bus.addedSecond === 'first,late',
      `a handler added during an emit ran as "${bus.addedFirst}" then "${bus.addedSecond}" (wanted first then first,late)`);
    check(bus.threw === false && bus.ran === 'after' && bus.reported === 1 && bus.namedTheType,
      `a throwing handler: emit ${bus.threw ? 'threw' : 'did not throw'}, the next handler ${bus.ran ? 'ran' : 'did not run'}, ` +
      `${bus.reported} console.error calls${bus.namedTheType ? '' : ' (none naming the event)'}`);
    check(bus.names === 'constructor', `event names that Object has were heard as "${bus.names}"`);
    check(bus.logged === 'bus test', `logEvent reached onEvent as "${bus.logged}" (wanted one bus test)`);

    // the simulation's own events, from a colony played until each has fired
    await page.evaluate(async types => {
      const { on } = await import('/src/events.js');
      const { sky, antSystem, world } = window.__pa.sim;
      window.__heard = [];
      // lastHatch is where the egg now hatching was: the hatch event has to say the same
      for (const type of types) on(type, data => window.__heard.push({ type, data, skyDay: sky.day, lastHatch: { ...antSystem.lastHatch } }));
      // what the game counts for itself, to hold the events to exactly one per hatching, death and finished project
      window.__before = { hatches: antSystem._hatchCount, deaths: antSystem.deaths };
      const finish = world._completeProject;
      if (typeof finish !== 'function') throw new Error('world._completeProject is gone: update the events check in tests/smoke.mjs');
      window.__finished = [];
      world._completeProject = function (p) { window.__finished.push(p.kind); return finish.call(this, p); };
    }, TYPES);
    const playDay = () => page.evaluate(() => {
      const { gameLoop, CONFIG } = window.__pa;
      for (let i = 0; i < CONFIG.DAY_TICKS; i++) gameLoop.onUpdate(gameLoop.SIM_STEP);
      return [...new Set(window.__heard.map(e => e.type))];
    });
    let seen = [];
    // not waiting for death: old age and fights are down to chance, so one of each is made below
    while (days < MAX_DAYS && TYPES.some(t => t !== 'death' && !seen.includes(t))) { seen = await playDay(); days++; }

    const causes = await page.evaluate(async () => {
      const { gameLoop, sim } = window.__pa;
      const { ROLE } = await import('/src/config.js');
      const mark = window.__heard.length;
      const walkers = sim.antSystem.ants.filter(a => a.role !== ROLE.ALATE);
      walkers[0].hp = 0;                            // dies in a fight
      walkers[1].age = walkers[1].lifespan;         // dies of old age
      for (let i = 0; i < 3; i++) gameLoop.onUpdate(gameLoop.SIM_STEP);
      return window.__heard.slice(mark).filter(e => e.type === 'death').map(e => e.data.cause);
    });
    check(causes.includes('fight') && causes.includes('age'),
      `an ant with no health left and one with no life left died of: ${causes.join(', ') || 'nothing reported'}`);

    const { heard, counted } = await page.evaluate(() => {
      const { antSystem } = window.__pa.sim;
      return {
        heard: window.__heard,
        counted: { hatch: antSystem._hatchCount - window.__before.hatches, death: antSystem.deaths - window.__before.deaths, projects: window.__finished },
      };
    });
    const of = type => heard.filter(e => e.type === type);
    const keys = e => e.data && typeof e.data === 'object' ? Object.keys(e.data).sort().join() : String(e.data);
    for (const t of TYPES) check(of(t).length > 0, `${t} never fired in ${days} days`);

    // dawn and dusk say which day it is, and take turns day after day
    const sun = heard.filter(e => e.type === 'dawn' || e.type === 'dusk');
    const badSun = sun.find(e => keys(e) !== 'day' || e.data.day !== e.skyDay);
    check(!badSun, badSun && `${badSun.type} carried ${JSON.stringify(badSun.data)} on day ${badSun.skyDay}`);
    for (let i = 1; i < sun.length; i++) {
      const p = sun[i - 1], e = sun[i];
      if (e.type === (p.type === 'dawn' ? 'dusk' : 'dawn') && e.data.day === p.data.day + (p.type === 'dusk' ? 1 : 0)) continue;
      problems.push(`${p.type} of day ${p.data.day} was followed by ${e.type} of day ${e.data.day}`);
      break;
    }
    const rain = heard.filter(e => e.type === 'rainStart' || e.type === 'rainEnd');
    check(rain.every((e, i) => e.type === (i % 2 ? 'rainEnd' : 'rainStart')), `rain came as ${rain.map(e => e.type).join(', ')}`);
    const dataless = ['rainStart', 'rainEnd', 'flight'].flatMap(of).find(e => keys(e) !== '');
    check(!dataless, dataless && `${dataless.type} carried ${JSON.stringify(dataless.data)} (wanted none)`);
    const badHatch = of('hatch').find(e => keys(e) !== 'x,y' || e.data.x !== e.lastHatch.x || e.data.y !== e.lastHatch.y);
    check(!badHatch, badHatch && `hatch carried ${JSON.stringify(badHatch.data)} for an egg at ${JSON.stringify(badHatch.lastHatch)}`);
    const badDeath = of('death').find(e => keys(e) !== 'cause' || typeof e.data.cause !== 'string');
    check(!badDeath, badDeath && `death carried ${JSON.stringify(badDeath.data)} (wanted a cause)`);
    const badProject = of('projectDone').find(e => keys(e) !== 'kind' || typeof e.data.kind !== 'string' || !e.data.kind);
    check(!badProject, badProject && `projectDone carried ${JSON.stringify(badProject.data)} (wanted a kind)`);

    // one event for every hatching and death, and one per finished project, naming its kind
    for (const t of ['hatch', 'death']) check(of(t).length === counted[t], `${of(t).length} ${t} events for ${counted[t]} in the game's own count`);
    const kinds = of('projectDone').map(e => e.data.kind);
    check(kinds.join() === counted.projects.join(), `projectDone named ${kinds.join() || 'nothing'} for projects that were ${counted.projects.join() || 'none'}`);
  } catch (e) {
    problems.push(e.message.split('\n')[0]);
    await shot(page, 'events');   // leave a picture of wherever it got stuck
  }
  problems.push(...errors);
  await ctx.close();
  report('events', problems, `bus works, and all ${TYPES.length} events fired within ${days} days`);
}

// Runs in the page, before its own scripts: logs what the founding overlay does, one entry each
// time its classes change, with the text it showed. It can't use anything from this file.
function recordOverlay() {
  window.__overlay = [];
  const attach = el => {
    const note = () => window.__overlay.push({ hidden: el.classList.contains('hidden'), text: document.getElementById('fd-text')?.textContent ?? '' });
    note();
    new MutationObserver(note).observe(el, { attributes: true, attributeFilter: ['class'] });
  };
  const find = () => {
    const el = document.getElementById('founding');
    if (el) attach(el);
    return Boolean(el);
  };
  if (!find()) {
    const waiting = new MutationObserver(() => { if (find()) waiting.disconnect(); });
    waiting.observe(document, { childList: true, subtree: true });
  }
}

// Fast-forward (src/app/fastForward.js, src/main.js): the engine on its own; a new colony grown
// before its first frame (in daylight, within its limits, and still starting if the growth fails);
// and a resumed colony catching up on the time its player was away, with the news.
async function runFastForward() {
  const OLD = 'pixelants_v2_screensaver', CUR = 'pixelants_screensaver';
  const PEAK = 777;   // more than a new colony reaches: tells a resumed colony from a new one
  const CAP = Math.round(CONFIG.CATCHUP_MAX_DAYS * CONFIG.DAY_TICKS);   // the most a resumed colony catches up
  const read = (...file) => fs.readFileSync(path.join(HERE, '..', ...file), 'utf8');
  const legacy = fs.readFileSync(path.join(FIXTURES, 'save-v2-screensaver.json'), 'utf8');
  const old = JSON.parse(legacy);
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const errors = [];   // a list for each page, as watch() makes them
  const contexts = [];
  const info = [];

  // A page that logs what the founding overlay does. `changes` swaps numbers in config.js on their way
  // to the browser; `into` is where its console errors go (any in `errors` fails the check).
  const open = async (ctx, { changes = {}, into = errors } = {}) => {
    const page = await ctx.newPage();
    into.push(watch(page));
    await page.addInitScript(recordOverlay);
    if (Object.keys(changes).length) {
      let src = read('src', 'config.js');
      for (const [key, value] of Object.entries(changes)) {
        const number = new RegExp(`\\b${key}:\\s*[-\\d.]+`);
        if (!number.test(src)) throw new Error(`config.js has no number called ${key}: update the fastforward check in tests/smoke.mjs`);
        src = src.replace(number, `${key}: ${value}`);
      }
      await page.route('**/src/config.js', route => route.fulfill({ contentType: 'text/javascript', body: src }));
    }
    return page;
  };
  const newContext = async () => {
    const ctx = await browser.newContext({ viewport: VIEWPORT });   // its own storage
    contexts.push(ctx);
    return ctx;
  };
  // To the game, then wait for the colony to be ready and the overlay gone
  const visit = async (page, query, what) => {
    try {
      const t0 = Date.now();
      await page.goto(`${base}?debug&${query}`);
      await page.waitForFunction(() => window.__pa, null, { timeout: 30_000 })
        .catch(() => { throw new Error('the game was not ready (no window.__pa) after 30 s'); });
      const ms = Date.now() - t0;
      await page.waitForFunction(() => document.getElementById('founding').classList.contains('hidden'), null, { timeout: 5_000 })
        .catch(() => { throw new Error('the colony was ready but the cover over it was still up 5 s later'); });
      const { startup, overlay } = await page.evaluate(() => ({ startup: window.__pa.startup, overlay: window.__overlay }));
      return { startup, ms, shown: overlay.filter(o => !o.hidden) };
    } catch (e) {
      throw new Error(`${what}: ${e.message.split('\n')[0]}`);
    }
  };
  // Come back to a saved colony as if its player had left at `ts` ('none': with no time on the save).
  // A colony that is left saves itself (its tab goes hidden), so the save is planted once the player
  // has gone: from a page with no game in it (storage belongs to the site, not to a game).
  const returnAt = async (page, what, mode, raw, ts) => {
    await page.goto(`${base}styles/main.css`);
    await page.evaluate(([mode, raw, ts]) => {
      const save = JSON.parse(raw);
      if (ts === 'none') delete save.ts; else save.ts = ts;
      localStorage.setItem(`pixelants_${mode}`, JSON.stringify(save));
    }, [mode, raw, ts]);
    const visited = await visit(page, `mode=${mode}`, what);
    return { ...visited, back: await inspect(page) };
  };

  try {
    // ── the engine on its own ──
    const busy = ms => { const end = performance.now() + ms; while (performance.now() < end); };
    let steps = 0;
    const ran = await fastForward({ step: () => steps++, maxTicks: 1000 });
    check(ran === 1000 && steps === 1000, `maxTicks 1000 ran ${steps} ticks and resolved ${ran}`);

    steps = 0;
    const stopped = await fastForward({ step: () => steps++, maxTicks: 1000, until: () => steps >= 10 });
    check(stopped === 10 && steps === 10, `until stopped it after ${steps} ticks (resolved ${stopped}), wanted 10`);

    steps = 0;
    await fastForward({ step: () => steps++, maxTicks: 1000, until: () => true });
    check(steps === 0, `a colony that was ready already still ran ${steps} ticks`);

    steps = 0;
    const calls = [];
    const none = await fastForward({ step: () => steps++, maxTicks: 0, onProgress: f => calls.push(f) });
    check(none === 0 && steps === 0 && calls.join() === '1',
      `maxTicks 0 ran ${steps} ticks, resolved ${none} and reported progress ${calls.join() || 'never'} (wanted no ticks, then 1)`);

    steps = 0;
    const crawled = await fastForward({ step: () => steps++, maxTicks: 50, sliceMs: 0 });
    check(crawled === 50 && steps === 50, `with no time allowed a slice it ran ${steps} of 50 ticks`);

    // slow ticks: the clock stops it, and the page gets its turns in between (maxTicks is finite so
    // an engine that ignores the clock fails the check, not hangs it)
    steps = 0;
    let timerAt = -1;
    setTimeout(() => { timerAt = steps; }, 100);   // due part-way through the run
    const t0 = performance.now();
    const slow = await fastForward({ step: () => { busy(1); steps++; }, maxTicks: 3000, budgetMs: 300, sliceMs: 5 });
    const took = performance.now() - t0;
    check(slow === steps && slow >= 1 && slow <= 300 && took < 2000, `budgetMs 300 with 1 ms ticks ran ${slow} ticks in ${took.toFixed(0)} ms`);
    check(timerAt > 0 && timerAt < slow, `a timer due 100 ms into the run fired at tick ${timerAt} of ${slow}: the page should get its turns between slices`);

    // progress stays within 0..1, never goes back and ends on 1
    const seen = [];
    await fastForward({ step: () => busy(0.5), maxTicks: 100, sliceMs: 5, onProgress: f => seen.push(f) });
    check(seen.length >= 2 && seen.every((f, i) => f >= 0 && f <= 1 && (i === 0 || f >= seen[i - 1])) && seen.at(-1) === 1,
      `progress went ${seen.map(f => f.toFixed(2)).join(' ')} (wanted rising within 0..1 and ending on 1)`);

    // a tick that throws rejects the promise, and nothing more runs
    steps = 0;
    const failure = await fastForward({ step: () => { if (++steps === 5) throw new Error('boom'); }, maxTicks: 100 }).then(() => null, e => e);
    await new Promise(r => setTimeout(r, 20));
    check(failure?.message === 'boom' && steps === 5,
      `a throwing tick ${failure ? `rejected with "${failure.message}"` : 'did not reject'} and ${steps} ticks ran (wanted boom, 5)`);

    // ── a new colony is grown before its first frame ──
    check(MODE_TABLE.survival && !MODE_TABLE.survival.pregrow && !MODE_TABLE.survival.catchUp,
      'Survival must never fast-forward: pregrow and catchUp should be off in its row of src/modes.js');
    for (const mode of MODES) {
      const page = await open(await newContext());
      const { startup, ms, shown } = await visit(page, `new&mode=${mode}`, `a new ${mode} colony`);
      const s = await inspect(page);
      const soil = await soilTone(page);
      check(soilDrawn(soil), `${mode}: the ground was not drawn: ${soilNote(soil)}`);
      if (MODE_TABLE[mode].pregrow) {
        check(startup?.kind === 'pregrow', `${mode}: a new colony should be grown first, startup was ${JSON.stringify(startup)}`);
        check(s.pop >= CONFIG.PREGROW_POP, `${mode}: it opened with ${s.pop} ants, wanted at least ${CONFIG.PREGROW_POP}`);
        check(s.light >= CONFIG.PREGROW_MIN_LIGHT - 0.05, `${mode}: it opened at dusk or night (light ${s.light.toFixed(2)})`);
        check(s.day === 1, `${mode}: it opened on day ${s.day}, wanted 1`);
        check(startup?.ticks > 0 && startup.ticks <= CONFIG.PREGROW_DAYS * CONFIG.DAY_TICKS, `${mode}: it was grown for ${startup?.ticks} ticks`);
        check(shown.length > 0 && shown.every(o => o.text === 'Founding your colony…'), `${mode}: the overlay said ${JSON.stringify(shown.map(o => o.text))}`);
        info.push(`${mode} is ready in ${(ms / 1000).toFixed(1)} s with ${s.pop} ants`);
      } else {
        check(startup === null, `${mode}: it should start as it is, startup was ${JSON.stringify(startup)}`);
        check(shown.length === 0, `${mode}: the founding overlay came up`);
        check(s.tick <= RESUME_TICKS, `${mode}: it was already ${s.tick} ticks old`);
        const morning = CONFIG.DAY_START_PHASE * CONFIG.DAY_TICKS;   // only a pre-grown colony is founded at midnight
        check(s.time >= morning && s.time <= morning + RESUME_TICKS, `${mode}: it started at sky time ${s.time}, wanted about ${morning}`);
      }
      await shot(page, `fastforward-${mode}`);
      await page.waitForTimeout(700);
      check((await inspect(page)).tick > s.tick, `${mode}: the clock stood still once the colony was ready`);
    }

    // founded late in the day, it is grown on until the sun is up
    {
      const page = await open(await newContext(), { changes: { PREGROW_START_PHASE: 0.6 } });
      const { startup } = await visit(page, 'new&mode=screensaver', 'a colony founded at dusk');
      const s = await inspect(page);
      check(s.light >= CONFIG.PREGROW_MIN_LIGHT - 0.05, `founded at dusk, it opened at light ${s.light.toFixed(2)}, wanted daylight`);
      check(s.pop >= CONFIG.PREGROW_POP, `founded at dusk, it opened with ${s.pop} ants`);
      check(startup?.ticks <= CONFIG.PREGROW_DAYS * CONFIG.DAY_TICKS, `founded at dusk, it was grown for ${startup?.ticks} ticks`);
      const soil = await soilTone(page);
      check(soilDrawn(soil), `founded at dusk, the ground was not drawn: ${soilNote(soil)}`);
      await shot(page, 'fastforward-dusk');
    }

    // the limits: how many days to grow it, and how long on the clock
    {
      const ctx = await newContext();
      const days = await visit(await open(ctx, { changes: { PREGROW_DAYS: 0.01 } }), 'new&mode=screensaver', 'a colony grown for 0.01 days');
      const wantTicks = Math.round(0.01 * CONFIG.DAY_TICKS);
      check(days.startup?.ticks === wantTicks, `PREGROW_DAYS 0.01 grew it for ${days.startup?.ticks} ticks, wanted ${wantTicks}`);
      const rushed = await open(ctx, { changes: { PREGROW_BUDGET_MS: 1 } });
      const r = await visit(rushed, 'new&mode=screensaver', 'a colony grown for 1 ms');
      check(r.startup?.kind === 'pregrow' && r.startup.ticks < 2000, `PREGROW_BUDGET_MS 1 grew it for ${r.startup?.ticks} ticks, wanted it cut short`);
      check((await inspect(rushed)).pop > 0, 'a colony whose growth was cut short has no ants');
    }

    // growth that fails must not leave the player stuck behind the overlay
    {
      const expected = [];
      const page = await open(await newContext(), { into: expected });
      const src = read('src', 'app', 'fastForward.js');
      const failing = src.replace('step();', 'if (ticks === 300) throw new Error("injected failure");\n      step();');
      if (failing === src) throw new Error('src/app/fastForward.js has no step(); to make fail: update the fastforward check in tests/smoke.mjs');
      await page.route('**/src/app/fastForward.js', route => route.fulfill({ contentType: 'text/javascript', body: failing }));
      const { startup, shown } = await visit(page, 'new&mode=screensaver', 'a colony whose growth fails');
      const logged = expected.flat();
      check(logged.length === 1 && logged[0].includes('Fast-forward failed') && logged[0].includes('injected failure'),
        `a failing fast-forward logged ${JSON.stringify(logged)}`);
      check(startup?.kind === 'pregrow' && shown.length > 0, `a failing fast-forward: startup was ${JSON.stringify(startup)}, overlay shown ${shown.length > 0}`);
      const s = await inspect(page);
      await page.waitForTimeout(700);
      check((await inspect(page)).tick > s.tick, 'the colony did not run after its growth failed');
    }

    // ── a resumed colony catches up on the time it was away ──
    {
      const ctx = await newContext();
      const page = await open(ctx);
      const stored = k => page.evaluate(k => localStorage.getItem(k), k);

      // a real save, paused so the numbers hold still, with a peak that marks it as ours
      await visit(page, 'new&mode=screensaver', 'a colony to save');
      await page.evaluate(peak => { window.__pa.gameLoop.setSpeed(0); window.__pa.sim.stats.peakPopulation = peak; }, PEAK);
      const at = await inspect(page);
      await page.click('#btn-save');
      const raw = await stored(CUR);
      if (!raw) throw new Error('the Save button wrote no save');
      const hatchesAtSave = JSON.parse(raw).colony?.hatchCount;
      check(Number.isFinite(hatchesAtSave), 'a save has no colony.hatchCount: update the fastforward check in tests/smoke.mjs');
      const stepMs = await page.evaluate(() => window.__pa.gameLoop.SIM_STEP);

      // away for too short a time, or for a time that makes no sense: the colony just carries on
      const quiet = async (what, ts) => {
        const r = await returnAt(page, what, 'screensaver', raw, ts);
        check(r.startup === null, `${what}: nothing to catch up on, but startup was ${JSON.stringify(r.startup)}`);
        check(r.shown.length === 0, `${what}: the overlay came up with nothing to catch up on`);
        check(r.back.peak >= PEAK && r.back.tick >= at.tick && r.back.tick <= at.tick + RESUME_TICKS,
          `${what}: not the saved colony as it was (peak ${r.back.peak} of ${PEAK}, tick ${r.back.tick}, saved at ${at.tick})`);
      };
      await quiet('saved 5 seconds ago', Date.now() - 5_000);
      await quiet('saved in the future', Date.now() + 3_600_000);
      await quiet('saved with no time on it', 'none');

      // a minute away is a minute of ticks
      const minute = await returnAt(page, 'saved a minute ago', 'screensaver', raw, Date.now() - 60_000);
      const m = minute.startup, wantMinute = 60_000 / stepMs;
      check(m?.kind === 'catchUp' && m.ticks >= wantMinute && m.ticks <= wantMinute + 2500,
        `a minute away should catch up about ${wantMinute} ticks, startup was ${JSON.stringify(m)}`);
      check(minute.back.tick >= at.tick + (m?.ticks ?? 0) && minute.back.time >= at.time + (m?.ticks ?? 0),
        `after ${m?.ticks} catch-up ticks the clocks read tick ${minute.back.tick} and sky ${minute.back.time}, from ${at.tick} and ${at.time}`);

      // ten minutes is more than it will catch up on, and it says what happened
      const long = await returnAt(page, 'saved ten minutes ago', 'screensaver', raw, Date.now() - 600_000);
      await shot(page, 'fastforward-catchup');
      const soilBack = await soilTone(page);
      check(soilDrawn(soilBack), `ten minutes away, the ground was not drawn: ${soilNote(soilBack)}`);
      const c = long.startup;
      check(c?.kind === 'catchUp' && c.ticks === CAP, `ten minutes away should catch up the cap of ${CAP} ticks, startup was ${JSON.stringify(c)}`);
      check(long.shown.length > 0 && long.shown.every(o => o.text === 'Catching up on your colony…'),
        `the overlay said ${JSON.stringify(long.shown.map(o => o.text))}`);
      check(long.back.peak >= PEAK && long.back.pop > 0, `ten minutes away: not the saved colony (peak ${long.back.peak} of ${PEAK}, ${long.back.pop} ants)`);
      const game = await page.evaluate(() => {
        const toast = document.getElementById('toast');
        return { hatches: window.__pa.sim.antSystem._hatchCount, chambers: window.__pa.sim.world.chamberCount,
                 toast: toast.textContent, toasting: toast.classList.contains('show') };
      });
      const drift = game.hatches - hatchesAtSave - (c?.hatched ?? 0);   // hatchings between the catch-up ending and our looking
      check(c?.hatched > 0 && drift >= 0 && drift <= 8,
        `the catch-up counted ${c?.hatched} hatchings, the game counts ${game.hatches - hatchesAtSave} since the save`);
      check(c?.chambers >= 0 && c.chambers < game.chambers, `the catch-up counted ${c?.chambers} new chambers in a nest of ${game.chambers}`);
      const news = [c?.hatched && `${c.hatched} ${c.hatched === 1 ? 'ant' : 'ants'} hatched`,
                    c?.chambers && `${c.chambers} new ${c.chambers === 1 ? 'chamber' : 'chambers'}`].filter(Boolean);
      const wantToast = `While you were away: ${news.join(' · ')}`;
      check(news.length > 0 && game.toasting && game.toast === wantToast,
        `the toast ${game.toasting ? 'said' : 'was not showing and had'} "${game.toast}", wanted "${wantToast}"`);
      info.push(`ten minutes away catches up ${c?.ticks} ticks (${c?.hatched} hatched, ${c?.chambers} new chambers)`);

      // and the clock stops a catch-up that is taking too long
      const hurried = await open(ctx, { changes: { CATCHUP_BUDGET_MS: 1 } });
      const h = await returnAt(hurried, 'saved ten minutes ago, 1 ms to catch up', 'screensaver', raw, Date.now() - 600_000);
      check(h.startup?.kind === 'catchUp' && h.startup.ticks < 2000, `CATCHUP_BUDGET_MS 1 caught up ${h.startup?.ticks} ticks, wanted it cut short`);

      // a mode that never fast-forwards stays as it was, however long ago it was saved
      await visit(page, 'new&mode=survival', 'a survival colony to save');
      await page.evaluate(() => window.__pa.gameLoop.setSpeed(0));
      const survivalAt = await inspect(page);
      await page.click('#btn-save');
      const survivalRaw = await stored('pixelants_survival');
      if (!survivalRaw) throw new Error('the Save button wrote no survival save');
      const sv = await returnAt(page, 'a survival colony saved ten minutes ago', 'survival', survivalRaw, Date.now() - 600_000);
      check(sv.startup === null && sv.shown.length === 0, `survival caught up: startup ${JSON.stringify(sv.startup)}, overlay shown ${sv.shown.length > 0}`);
      check(sv.back.tick >= survivalAt.tick && sv.back.tick <= survivalAt.tick + RESUME_TICKS,
        `survival was at tick ${sv.back.tick} after being saved at ${survivalAt.tick}`);

      // the real save from an old build, last written long ago
      await page.evaluate(([cur, oldKey, legacy]) => { localStorage.removeItem(cur); localStorage.setItem(oldKey, legacy); }, [CUR, OLD, legacy]);
      const fx = await visit(page, 'mode=screensaver', "the old build's save");
      const fxBack = await inspect(page);
      check(fx.startup?.kind === 'catchUp' && fx.startup.ticks === CAP, `the old build's save caught up ${fx.startup?.ticks} ticks, wanted ${CAP}`);
      check(fxBack.tick >= old.world.tick + CAP && fxBack.pop > 0, `the old build's save: tick ${fxBack.tick} from ${old.world.tick}, ${fxBack.pop} ants`);
    }
  } catch (e) {
    problems.push(e.message.split('\n')[0]);
  }
  problems.push(...errors.flat());
  for (const ctx of contexts) await ctx.close();
  report('fastforward', problems, info.join(', '));
}

// A GameLoop on a screen of our own: each refresh of an `hz` screen calls back with the time it
// happened, give or take `jitter` ms, except the ones inside `gaps` ([from, to) in ms into the run),
// when nothing arrives, as in a hidden tab. `at` is [[ms, fn(loop)]] to run once the run gets there.
// The clock is ours as well, so ten seconds on the screen take no time at all.
function playLoop({ hz, cap, seconds, jitter = 0, gaps = [], at = [] }) {
  const saved = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame };
  const begin = 1000;
  let clock = begin, pending = null, seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  globalThis.requestAnimationFrame = f => { pending = f; return 1; };
  globalThis.cancelAnimationFrame = () => { pending = null; };
  performance.now = () => clock;
  const run = { ticks: 0, refreshes: 0, draws: [], frameMs: [] };   // draws: when each frame was drawn
  try {
    const loop = new GameLoop(() => { run.ticks++; }, (alpha, ms) => { run.draws.push(clock - begin); run.frameMs.push(ms); });
    loop.fpsCap = cap;
    loop.start();
    const todo = [...at].sort((a, b) => a[0] - b[0]);
    for (let k = 1; k * (1000 / hz) <= seconds * 1000; k++) {
      const t = k * (1000 / hz);
      while (todo.length && todo[0][0] <= t) todo.shift()[1](loop);
      if (gaps.some(([from, to]) => t >= from && t < to)) continue;
      clock = Math.max(clock, begin + t + (jitter ? (rand() * 2 - 1) * jitter : 0));
      const frame = pending;
      pending = null;
      frame(clock);
      run.refreshes++;
    }
  } finally {
    delete performance.now;
    for (const [k, v] of [['requestAnimationFrame', saved.raf], ['cancelAnimationFrame', saved.caf]]) {
      if (v === undefined) delete globalThis[k]; else globalThis[k] = v;
    }
  }
  return run;
}

// Power saving. The frame cap (src/app/gameLoop.js) holds on screens of every refresh rate and never
// slows the colony; it starts at the mode's own cap until the player chooses one (src/settings.js,
// src/modes.js); low quality (src/rendering/renderer.js) draws the same farm on a canvas of a quarter
// the pixels; a tab that goes hidden saves the colony (src/main.js); ?debug shows the frame rate.
async function runPerformance() {
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const info = [];
  const errors = [];
  const contexts = [];
  const ready = page => page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
  const SCREEN_SECONDS = 10, TICK_MS = 16;
  const gapsOf = draws => draws.map((t, i) => t - (draws[i - 1] ?? 0));
  try {
    // The loop on its own: the cap decides how often the farm is drawn, never how fast it lives
    for (const [hz, cap] of [[60, 30], [60, 60], [60, 0], [30, 60], [75, 60], [120, 30], [120, 60], [144, 30], [144, 60], [240, 60]]) {
      const run = playLoop({ hz, cap, seconds: SCREEN_SECONDS });
      const where = `${hz} Hz screen, cap ${cap || 'off'}`;
      const want = cap > 0 ? Math.min(cap, hz) : hz;
      const fps = run.draws.length / SCREEN_SECONDS;
      check(Math.abs(fps - want) <= 0.3, `${where}: ${fps.toFixed(1)} frames a second, wanted ${want}`);
      const ticks = SCREEN_SECONDS * 1000 / TICK_MS;
      check(Math.abs(run.ticks - ticks) <= 2, `${where}: ${run.ticks} sim ticks in ${SCREEN_SECONDS} s, wanted ${ticks}`);
      const told = run.frameMs.reduce((a, b) => a + b, 0), last = run.draws.at(-1);
      check(Math.abs(told - last) < 0.001, `${where}: the frames were told ${told.toFixed(1)} ms had passed, the last came at ${last?.toFixed(1)}`);
      const worst = Math.max(...gapsOf(run.draws));
      check(worst <= 1000 / want + 1000 / hz + 1, `${where}: a frame came ${worst.toFixed(1)} ms after the one before`);
    }
    // A little jitter in the timestamps must not cost frames or make a gap. (Without the 1 ms of
    // grace for an early refresh, a cap of 60 on a 60 Hz screen loses a frame in 150.)
    for (const [hz, cap] of [[60, 60], [60, 30], [144, 60]]) {
      const run = playLoop({ hz, cap, seconds: SCREEN_SECONDS, jitter: 0.4 });
      const where = `${hz} Hz screen, cap ${cap}, timestamps off by up to 0.4 ms`;
      const fps = run.draws.length / SCREEN_SECONDS, worst = Math.max(...gapsOf(run.draws));
      check(Math.abs(fps - cap) <= 0.3, `${where}: ${fps.toFixed(1)} frames a second, wanted ${cap}`);
      check(worst <= 1000 / cap + 1000 / hz + 1, `${where}: a frame came ${worst.toFixed(1)} ms after the one before`);
    }
    // A stall is not made up for with a burst of frames (on a screen that could show them) or of colony time
    const stall = playLoop({ hz: 120, cap: 30, seconds: 5, gaps: [[2000, 2500]] });
    const burst = stall.draws.filter(t => t >= 2500 && t < 2600).length;
    check(burst <= 4, `after half a second with no frames, ${burst} came in the next 100 ms, at a cap of 30`);
    check(Math.max(...stall.frameMs) <= 100, `a frame was told ${Math.max(...stall.frameMs).toFixed(0)} ms had passed`);
    check(stall.ticks <= 5000 / TICK_MS - 20, `the colony lived through the stall: ${stall.ticks} ticks in 5 s with half a second missing`);
    // Ten minutes in a hidden tab: one frame when it comes back, and the colony hardly older
    const away = playLoop({ hz: 60, cap: 30, seconds: 602, gaps: [[1000, 601000]] });
    check(away.ticks <= 2000 / TICK_MS + 8, `ten hidden minutes: ${away.ticks} ticks, wanted at most ${2000 / TICK_MS + 8}`);
    check(Math.max(...away.frameMs) <= 100, `the first frame back was told ${Math.max(...away.frameMs).toFixed(0)} ms had passed`);
    check(away.draws.filter(t => t > 600000).length <= 31, 'after ten hidden minutes more than a second of frames came in a second');
    // The cap can change while the game runs, and anything that is not a number of frames means none
    const live = playLoop({ hz: 120, cap: 60, seconds: 6, at: [[2000, l => { l.fpsCap = 30; }], [4000, l => { l.fpsCap = 0; }]] });
    for (const [from, to, want] of [[0, 2000, 60], [2100, 4000, 30], [4100, 6000, 120]]) {
      const fps = live.draws.filter(t => t >= from && t < to).length * 1000 / (to - from);
      check(Math.abs(fps - want) <= want * 0.05 + 0.5, `live cap change: ${fps.toFixed(1)} frames a second between ${from} and ${to} ms, wanted ${want}`);
    }
    for (const bad of [NaN, -30, undefined]) {
      const run = playLoop({ hz: 60, cap: bad, seconds: 2 });
      check(run.draws.length === run.refreshes && run.refreshes > 100, `a cap of ${bad} drew ${run.draws.length} of ${run.refreshes} frames, wanted all of them`);
    }
    info.push('cap held on 30-240 Hz screens');

    // ── In the game ──
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(ctx);
    const page = await ctx.newPage();
    errors.push(watch(page));
    await page.goto(`${base}?debug&new&mode=screensaver`);
    await ready(page);

    // Zen starts at 30 fps without that being stored as the player's choice, not even when some other
    // setting is chosen and the player's choices are written out
    const start = await page.evaluate(() => {
      const { settings, gameLoop } = window.__pa;
      const before = { setting: settings.get('fpsCap'), loop: gameLoop.fpsCap, quality: settings.get('quality') };
      settings.set('volume', 0.5);
      return { ...before, stored: localStorage.getItem('pixelants_settings') };
    });
    check(start.setting === 30 && start.loop === 30, `a new Zen colony should draw at 30 fps: the setting is ${start.setting}, the loop's cap ${start.loop}`);
    check(!start.stored?.includes('fpsCap'), `the mode's own cap was stored as if the player had chosen it: ${start.stored}`);
    check(start.quality === 'high', `quality starts at ${start.quality}, not high`);

    // What a cap does to the running game: frames drawn, and colony ticks lived, a second
    const measure = (cap, ms = 2500) => page.evaluate(async ([cap, ms]) => {
      const { gameLoop, settings, sim } = window.__pa;
      gameLoop.setSpeed(1);
      settings.set('fpsCap', cap);
      await new Promise(r => setTimeout(r, 300));   // frames just after a change are not a fair count
      let frames = 0;
      const drawn = gameLoop.onRender;
      gameLoop.onRender = function (...args) { frames++; return drawn.apply(this, args); };
      const t0 = performance.now(), tick0 = sim.world.tick;
      await new Promise(r => setTimeout(r, ms));
      const seconds = (performance.now() - t0) / 1000;
      gameLoop.onRender = drawn;
      return { fps: frames / seconds, tps: (sim.world.tick - tick0) / seconds };
    }, [cap, ms]);
    const at30 = await measure(30), at60 = await measure(60);
    check(at30.fps >= 21 && at30.fps <= 33, `at a cap of 30 the game drew ${at30.fps.toFixed(1)} frames a second`);
    check(at60.fps >= 30 && at60.fps <= 66, `at a cap of 60 the game drew ${at60.fps.toFixed(1)} frames a second`);
    for (const [cap, m] of [[30, at30], [60, at60]]) {
      check(Math.abs(m.tps - 1000 / TICK_MS) <= 1000 / TICK_MS * 0.15, `at a cap of ${cap} the colony lived ${m.tps.toFixed(1)} ticks a second, not ${1000 / TICK_MS}`);
    }
    info.push(`in the game ${at30.fps.toFixed(0)} fps at cap 30 and ${at60.fps.toFixed(0)} at 60`);
    const chosen = await page.evaluate(() => {
      const { settings, gameLoop } = window.__pa;
      settings.set('fpsCap', 0);
      const off = gameLoop.fpsCap;
      settings.set('fpsCap', 30);
      return [off, gameLoop.fpsCap];
    });
    check(chosen.join() === '0,30', `choosing a cap did not reach the running loop: it was ${chosen} after choosing 0 then 30`);

    // The ?debug read-out: what it works out, and that it is on screen
    const unit = await page.evaluate(async () => {
      const { PerfReadout } = await import('/src/ui/perfReadout.js');
      let cap = 30;
      const r = new PerfReadout({ cap: () => cap, quality: () => 'low' });
      const said = [];
      for (let i = 0; i <= 60; i++) {   // frames of 4 ms, one of 9, at 60 a second: it speaks every half second
        r.frame(i === 7 ? 9 : 4, 5000 + i * 1000 / 60);
        if (i % 30 === 0 && r.el.textContent) said.push(r.el.textContent);
        if (i === 30) cap = 0;
      }
      r.el.remove();
      return said;
    });
    check(unit.join(' | ') === '60 fps · 4.2 ms/frame (worst 9.0) · cap 30 · low | 60 fps · 4.0 ms/frame (worst 4.0) · cap off · low',
      `a read-out given 60 frames a second said ${JSON.stringify(unit)}`);
    await page.waitForTimeout(1200);   // the read-out is on the real game, and the cap changes above are over
    const readout = await page.evaluate(() => document.getElementById('perf')?.textContent);
    check(/^\d+ fps · [\d.]+ ms\/frame \(worst [\d.]+\) · cap 30 · high$/.test(readout ?? ''), `the ?debug read-out said ${JSON.stringify(readout)}`);
    await shot(page, 'perf-readout');

    // Low quality draws the very same farm. The colony is frozen so the two are the same moment.
    const scene = await page.evaluate(() => {
      const { gameLoop, camera, renderer, sim, settings, CONFIG } = window.__pa;
      gameLoop.stop();
      const draw = quality => {
        settings.set('quality', quality);
        renderer.render(camera, sim, 0.5, 0, 1);
        renderer.render(camera, sim, 0.5, 0, 1);   // the first frame after a resize redraws the earth
        const c = renderer.canvas, g = c.getContext('2d'), cols = 40, rows = 24, px = [];
        for (let j = 0; j < rows; j++) {
          for (let i = 0; i < cols; i++) {
            const d = g.getImageData(Math.floor((i + 0.5) / cols * c.width), Math.floor((j + 0.5) / rows * c.height), 1, 1).data;
            px.push([d[0], d[1], d[2]]);
          }
        }
        return { w: c.width, h: c.height, css: [c.style.width, c.style.height], look: getComputedStyle(c).imageRendering,
                 camera: [camera.cw, camera.ch], px };
      };
      const high = draw('high'), low = draw('low');
      return { high, low, win: [innerWidth, innerHeight], scale: CONFIG.LOW_QUALITY_SCALE };
    });
    const [ww, wh] = scene.win;
    const half = n => Math.max(1, Math.round(n * scene.scale));
    check(scene.high.w === ww && scene.high.h === wh, `high quality: the canvas is ${scene.high.w}x${scene.high.h} in a ${ww}x${wh} window`);
    check(scene.low.w === half(ww) && scene.low.h === half(wh), `low quality: the canvas is ${scene.low.w}x${scene.low.h}, wanted ${half(ww)}x${half(wh)}`);
    for (const [name, q] of [['high', scene.high], ['low', scene.low]]) {
      check(q.css.join() === `${ww}px,${wh}px`, `${name} quality: the canvas is shown ${q.css.join(' x ')}, wanted the size of the window`);
      check(q.look === 'pixelated', `${name} quality: image-rendering is ${q.look}, not pixelated`);
      check(q.camera.join() === `${ww},${wh}`, `${name} quality: the camera works in ${q.camera.join('x')}, not in window pixels`);
    }
    let off = 0, far = 0;
    scene.high.px.forEach((p, i) => {
      const gaps = p.map((v, k) => Math.abs(v - scene.low.px[i][k]));
      off += gaps.reduce((a, b) => a + b, 0) / 3;
      if (Math.max(...gaps) > 40) far++;
    });
    off /= scene.high.px.length;
    check(off <= 8 && far / scene.high.px.length <= 0.06, `low quality draws a different picture: ${off.toFixed(1)} off on average, and ${far} of ${scene.high.px.length} places by more than 40`);
    const lowSoil = await soilTone(page);
    check(soilDrawn(lowSoil), `low quality: ${soilNote(lowSoil)}`);
    // The browser stretches it with hard edges: every 2x2 block of the screen is a single colour
    const sameBlocks = async () => {
      const png = (await page.screenshot({ clip: { x: 400, y: 250, width: 800, height: 400 } })).toString('base64');
      return page.evaluate(async b64 => {
        const img = new Image();
        img.src = `data:image/png;base64,${b64}`;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let same = 0, total = 0;
        for (let y = 0; y + 1 < c.height; y += 2) {
          for (let x = 0; x + 1 < c.width; x += 2) {
            const a = (y * c.width + x) * 4, b = a + 4, e = a + c.width * 4, f = e + 4;
            total++;
            if ([1, 2].every(k => d[a + k] === d[b + k] && d[a + k] === d[e + k] && d[a + k] === d[f + k]) && d[a] === d[b] && d[a] === d[e] && d[a] === d[f]) same++;
          }
        }
        c.remove();
        return same / total;
      }, png);
    };
    const lowBlocks = await sameBlocks();
    await shot(page, 'low-quality');
    await page.evaluate(() => {
      const { settings, renderer, camera, sim } = window.__pa;
      settings.set('quality', 'high');
      renderer.render(camera, sim, 0.5, 0, 1);
      renderer.render(camera, sim, 0.5, 0, 1);
    });
    const highBlocks = await sameBlocks();
    check(highBlocks < 0.9, `test setup: ${(highBlocks * 100).toFixed(0)}% of the 2x2 blocks of the full-size picture are one colour already`);
    check(lowBlocks >= 0.97, `low quality is not stretched with hard edges: ${(lowBlocks * 100).toFixed(0)}% of the 2x2 blocks on screen are one colour`);
    info.push(`low quality ${scene.low.w}x${scene.low.h}, ${off.toFixed(1)} off the full picture, ${(lowBlocks * 100).toFixed(0)}% hard-edged`);

    // The window can change size, at either quality, without the camera, canvas and screen disagreeing
    for (const [w, h, quality] of [[1000, 600, 'high'], [1000, 600, 'low'], [1300, 800, 'low'], [1300, 800, 'high']]) {
      await page.setViewportSize({ width: w, height: h });
      const got = await page.evaluate(async quality => {
        window.__pa.settings.set('quality', quality);
        await new Promise(r => requestAnimationFrame(() => r()));
        const c = document.getElementById('gameCanvas'), { camera, renderer, sim } = window.__pa;
        renderer.render(camera, sim, 0.5, 0, 1);
        renderer.render(camera, sim, 0.5, 0, 1);   // the first frame after a resize redraws the earth
        const alpha = (x, y) => c.getContext('2d').getImageData(x, y, 1, 1).data[3];
        return { canvas: [c.width, c.height], css: [c.style.width, c.style.height], camera: [camera.cw, camera.ch],
                 layout: [renderer.w, renderer.h],
                 corners: [alpha(0, 0), alpha(c.width - 1, 0), alpha(0, c.height - 1), alpha(c.width - 1, c.height - 1)] };
      }, quality);
      const k = quality === 'low' ? scene.scale : 1;
      const where = `a ${w}x${h} window at ${quality} quality`;
      check(got.canvas.join() === `${Math.round(w * k)},${Math.round(h * k)}`, `${where}: the canvas is ${got.canvas.join('x')}`);
      check(got.css.join() === `${w}px,${h}px`, `${where}: the canvas is shown ${got.css.join(' x ')}`);
      check(got.camera.join() === `${w},${h}`, `${where}: the camera is ${got.camera.join('x')}`);
      check(got.layout.join() === `${w},${h}`, `${where}: the farm is laid out in ${got.layout.join('x')}, not in window pixels`);
      check(got.corners.every(a => a === 255), `${where}: the picture does not reach every corner of the canvas (opacity there: ${got.corners.join(', ')})`);
    }
    await page.setViewportSize(VIEWPORT);

    // A tab that goes hidden is saved; one that comes into view is not; a finished game is not brought back
    const CUR = 'pixelants_screensaver';
    const stored = () => page.evaluate(k => localStorage.getItem(k), CUR);
    const tabIs = hidden => page.evaluate(h => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await page.evaluate(k => localStorage.removeItem(k), CUR);
    await tabIs(false);
    check(await stored() === null, 'the colony was saved when the tab came into view');
    const before = Date.now();
    await tabIs(true);
    const hiddenSave = JSON.parse(await stored() ?? 'null');
    check(hiddenSave && hiddenSave.ts >= before && hiddenSave.world, `hiding the tab saved ${hiddenSave ? `a save from ${before - hiddenSave.ts} ms before` : 'nothing'}`);
    await page.evaluate(k => { localStorage.removeItem(k); window.__pa.GameState.over = true; }, CUR);
    await tabIs(true);
    check(await stored() === null, 'a game that was over was saved when the tab was hidden');
    await page.evaluate(() => { window.__pa.GameState.over = false; });
    await tabIs(false);
    info.push('hidden tab saves');

    // Survival starts at 60, the player's own choices win over the mode's and stay after a reload
    const ctx2 = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(ctx2);
    const page2 = await ctx2.newPage();
    errors.push(watch(page2));
    await page2.goto(`${base}?debug&new&mode=survival`);
    await ready(page2);
    const sv = await page2.evaluate(() => ({ setting: window.__pa.settings.get('fpsCap'), loop: window.__pa.gameLoop.fpsCap }));
    check(sv.setting === 60 && sv.loop === 60, `a new Survival colony should draw at 60 fps: the setting is ${sv.setting}, the loop's cap ${sv.loop}`);
    await page2.evaluate(() => { window.__pa.settings.set('fpsCap', 0); window.__pa.settings.set('quality', 'low'); });
    await page2.goto(`${base}?debug&mode=survival`);
    await ready(page2);
    const kept = await page2.evaluate(() => {
      const c = document.getElementById('gameCanvas');
      return { setting: window.__pa.settings.get('fpsCap'), loop: window.__pa.gameLoop.fpsCap, canvas: [c.width, c.height], win: [innerWidth, innerHeight] };
    });
    check(kept.setting === 0 && kept.loop === 0, `no frame cap, chosen in Survival, came back as ${kept.setting} (the loop's cap ${kept.loop})`);
    check(kept.canvas.join() === `${half(kept.win[0])},${half(kept.win[1])}`, `low quality, chosen, was not there after a reload: the canvas is ${kept.canvas.join('x')} in a ${kept.win.join('x')} window`);
    await page2.goto(`${base}?debug&new&mode=screensaver`);
    await ready(page2);
    const zen = await page2.evaluate(() => window.__pa.gameLoop.fpsCap);
    check(zen === 0, `a cap chosen in Survival should hold in Zen: it was ${zen}`);
  } catch (e) {
    problems.push(e.message.split('\n')[0]);
  }
  problems.push(...errors.flat());
  for (const c of contexts) await c.close();
  report('performance', problems, info.join(', '));
}

try {
  if (wanted('boot')) await runBoot();
  if (wanted('settings')) await runSettings();
  if (wanted('saves')) await runSaves();
  if (wanted('events')) await runEvents();
  if (wanted('fastforward')) await runFastForward();
  if (wanted('performance')) await runPerformance();
  for (const mode of MODES) if (wanted(mode)) await runMode(mode);
} finally {
  await browser.close();
  server.close();
}
console.log(`${anyFailed ? 'FAILED' : 'All passed'}${only.length ? ` (just ${only.join(', ')})` : ''} - screenshots in tests/out/`);
process.exit(anyFailed ? 1 : 0);
