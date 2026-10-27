// npm test — smoke test. Loads each mode in a real browser at 8x speed and fails on any page
// error, stalled clock, empty colony, NaN ant position or blank canvas, then saves the colony
// and checks the reload resumes it. It also walks the normal menu -> tutorial path, which ?debug
// skips, and checks that settings persist, that a save from an older build still resumes and that
// the events the simulation emits reach the event bus. `npm test -- events saves` runs just the
// named checks (boot, settings, saves, events, or a mode from src/modes.js).
// Numbers can pass while the picture is wrong, so always look at the screenshots this writes to
// tests/out/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../tools/serve.mjs';
import { MODES as MODE_TABLE } from '../src/modes.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const FIXTURES = path.join(HERE, 'fixtures');
const MODES = Object.keys(MODE_TABLE);   // every mode in src/modes.js is tested
const MIN_TICKS = 3000;    // sim ticks (16 ms each) that must have run...
const MIN_SECONDS = 10;    // ...and at least this much real time, so camera/director code runs too
const MAX_SECONDS = 90;    // stop waiting after this long
const RESUME_TICKS = 1500; // a resumed colony may have run this long (~25 s at 1x) before we look
const VIEWPORT = { width: 1600, height: 900 };

const CHECKS = ['boot', 'settings', 'saves', 'events', ...MODES];
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
    pop: antSystem.population,
    eggs: antSystem.eggCount,
    laid: queen.laid,
    day: stats.day,
    peak: stats.peakPopulation,
    badAnts: antSystem.ants.filter(a => !Number.isFinite(a.x) || !Number.isFinite(a.y)).length,
    colours: colours.size,
  };
});

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

    const t0 = Date.now();
    for (;;) {
      const tick = await page.evaluate(() => window.__pa.sim.world.tick);
      const secs = (Date.now() - t0) / 1000;
      // an error freezes the loop, so don't wait out the clock once one has happened
      if (errors.length || (tick >= MIN_TICKS && secs >= MIN_SECONDS) || secs > MAX_SECONDS) break;
      await page.waitForTimeout(500);
    }

    const s = await inspect(page);
    info = `tick=${s.tick} pop=${s.pop} colours=${s.colours}`;
    if (s.tick <= MIN_TICKS) problems.push(`only ${s.tick} ticks ran (need > ${MIN_TICKS})`);
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
    await page.waitForSelector('#tutorial:not(.hidden)', { timeout: 10_000 });
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
    await page.waitForSelector('#tutorial:not(.hidden)', { timeout: 10_000 });
    check(await stored(OLD) === null && await stored(CUR) === null, 'New Colony left a saved copy behind');

    // the old colony resumes, and merely loading it changes nothing in storage
    await plant(OLD, legacy);
    let back = await resume();
    problems.push(...resumeProblems(vitals(old), back).map(p => `old save: ${p}`));
    check(await stored(OLD) === legacy && await stored(CUR) === null, 'loading the old save touched storage');
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
    check(back.tick < old.world.tick, `a newer save was loaded (tick ${back.tick})`);
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

try {
  if (wanted('boot')) await runBoot();
  if (wanted('settings')) await runSettings();
  if (wanted('saves')) await runSaves();
  if (wanted('events')) await runEvents();
  for (const mode of MODES) if (wanted(mode)) await runMode(mode);
} finally {
  await browser.close();
  server.close();
}
console.log(`${anyFailed ? 'FAILED' : 'All passed'}${only.length ? ` (just ${only.join(', ')})` : ''} - screenshots in tests/out/`);
process.exit(anyFailed ? 1 : 0);
