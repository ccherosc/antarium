// npm test — smoke test. Loads each mode in a real browser at 8x speed and fails on any page
// error, stalled clock, empty colony, NaN ant position or blank canvas, then saves the colony
// and checks the reload resumes it. It also walks the normal menu -> tutorial path, which ?debug
// skips, and checks that settings persist, that a save from an older build still resumes, that
// the events the simulation emits reach the event bus and that a new colony is grown, and a
// resumed one caught up, before the first frame. `npm test -- events saves` runs just the named
// checks (boot, settings, saves, events, fastforward, or a mode from src/modes.js).
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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const FIXTURES = path.join(HERE, 'fixtures');
const MODES = Object.keys(MODE_TABLE);   // every mode in src/modes.js is tested
const MIN_TICKS = 3000;    // sim ticks (16 ms each) that must have run...
const MIN_SECONDS = 10;    // ...and at least this much real time, so camera/director code runs too
const MAX_SECONDS = 90;    // stop waiting after this long
const RESUME_TICKS = 1500; // a resumed colony may have run this long (~25 s at 1x) before we look
const VIEWPORT = { width: 1600, height: 900 };

const CHECKS = ['boot', 'settings', 'saves', 'events', 'fastforward', ...MODES];
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
  const resume = async () => {
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
    await plant(OLD, justSaved);
    let back = await resume();
    problems.push(...resumeProblems(vitals(old), back).map(p => `old save: ${p}`));
    check(await stored(OLD) === justSaved && await stored(CUR) === null, 'loading the old save touched storage');
    await page.waitForTimeout(1000);
    await shot(page, 'saves-v2');

    // the first save after that writes the current format and leaves one copy (the peak is
    // raised to something a fresh colony couldn't reach, to see the stats come back too)
    await page.evaluate(() => { window.__pa.sim.stats.peakPopulation = 77; });
    await page.click('#btn-save');
    const cur = JSON.parse(await stored(CUR));
    const current = await page.evaluate(async () => (await import('/src/saveLoad.js')).VERSION);
    check(cur.version === current, `saved as version ${cur.version}, the current one is ${current}`);
    check(cur.extra && typeof cur.extra === 'object', 'the new save has no extra block');
    check(await stored(OLD) === null, 'the old copy was left behind once the new one was written');
    back = await resume();
    problems.push(...resumeProblems(vitals(cur), back).map(p => `new save: ${p}`));

    // a save from a newer build is refused and left alone; the player gets a fresh colony
    const future = JSON.stringify({ ...old, version: 999 });
    await plant(CUR, future);
    back = await resume();
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
  // Come back to a saved colony as if its player had left at `ts` ('none': with no time on the save)
  const returnAt = async (page, what, mode, raw, ts) => {
    if (page.url() === 'about:blank') await page.goto(base);   // storage belongs to the site
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

try {
  if (wanted('boot')) await runBoot();
  if (wanted('settings')) await runSettings();
  if (wanted('saves')) await runSaves();
  if (wanted('events')) await runEvents();
  if (wanted('fastforward')) await runFastForward();
  for (const mode of MODES) if (wanted(mode)) await runMode(mode);
} finally {
  await browser.close();
  server.close();
}
console.log(`${anyFailed ? 'FAILED' : 'All passed'}${only.length ? ` (just ${only.join(', ')})` : ''} - screenshots in tests/out/`);
process.exit(anyFailed ? 1 : 0);
