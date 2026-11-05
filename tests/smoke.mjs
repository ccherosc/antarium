// npm test — smoke test. Loads each mode in a real browser at 8x speed and fails on any page
// error, stalled clock, empty colony, NaN ant position or blank canvas, then saves the colony
// and checks the reload resumes it. It also walks the normal menu -> tutorial path, which ?debug
// skips, and checks that settings persist, that a save from an older build still resumes, that
// the events the simulation emits reach the event bus and that a new colony is grown, and a
// resumed one caught up, before the first frame, that the frame cap and low quality save power
// without changing the colony or the picture, and that the sound stays silent until the first
// click, follows the sky, mutes, and can never stop the game, and that every control in the
// settings dialog does what it says, keeps the keyboard to itself and survives a reload, and that
// Esc pauses and resumes exactly where the farm was and ? lists the keys that really work, and that the
// title shows the version, opens Settings and Credits, and walks its ants, and that a tick or a frame that
// throws stops the loop with the colony saved and a dialog whose Reload resumes it.
// `npm test -- events saves` runs just the named checks (boot, title, crash, settings, settingsmenu, pause, saves,
// events, fastforward, performance, sound, or a mode from src/modes.js). Numbers can pass while
// the picture is wrong, so always look at the screenshots this writes to tests/out/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { serve } from '../tools/serve.mjs';
import { MODES as MODE_TABLE } from '../src/modes.js';
import { CONFIG, STATE } from '../src/config.js';
import { VERSION } from '../src/version.js';
import { fastForward } from '../src/app/fastForward.js';
import { GameLoop } from '../src/app/gameLoop.js';
import { Camera } from '../src/app/camera.js';
import { whiteNoise, brownNoise } from '../src/audio/noise.js';
import { panAt, heardAt, watchView, layerTargets, soilRate } from '../src/audio/mix.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const FIXTURES = path.join(HERE, 'fixtures');
const MODES = Object.keys(MODE_TABLE);   // every mode in src/modes.js is tested
const MIN_TICKS = 3000;    // sim ticks (16 ms each) that must have run...
const MIN_SECONDS = 10;    // ...and at least this much real time, so camera/director code runs too
const MAX_SECONDS = 90;    // stop waiting after this long
const RESUME_TICKS = 1500; // a resumed colony may have run this long (~25 s at 1x) before we look
const VIEWPORT = { width: 1600, height: 900 };

const CHECKS = ['boot', 'title', 'crash', 'settings', 'settingsmenu', 'pause', 'saves', 'events', 'moments', 'fastforward', 'performance', 'sound', ...MODES];
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

// Where in the window a click sets food down, for a test that needs one to: open air, since food does not
// go onto the water that rain leaves in the grass. Left of the middle, clear of the dialogs' boxes.
const foodSpot = page => page.evaluate(async () => {
  const { TILE } = await import('/src/config.js');
  const { camera, sim } = window.__pa, world = sim.world;
  for (let x = 300; x < 560; x += 10) {
    const [tx, ty] = camera.screenToTile(x, 450);
    const i = world._dropTarget(tx, ty);
    if (i >= 0 && world.tiles[i] === TILE.AIR) return [x, 450];
  }
  return [300, 450];
});

// Why a click on the farm set no food down, when a test expected it to
const noFoodBecause = (page, x, y) => page.evaluate(async ([x, y]) => {
  const { TILE } = await import('/src/config.js');
  const { camera, sim, hud } = window.__pa, world = sim.world;
  const names = Object.fromEntries(Object.entries(TILE).map(([name, id]) => [id, name]));
  const [tx, ty] = camera.screenToTile(x, y), i = world._dropTarget(tx, ty);
  const muted = Math.round(hud.controls.mutedUntil - performance.now());
  return `; the click was on tile ${tx},${ty}, which drops food on ${i < 0 ? 'nothing' : names[world.tiles[i]]}, the tool is ${hud.controls.activeTool}, `
    + (muted > 0 ? `and clicks on the farm were muted for another ${muted} ms` : 'and clicks on the farm were not muted');
}, [x, y]);

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
    // the world is the size the mode's row asks for (width, height, surface row, colony column)
    const size = await page.evaluate(() => {
      const { sim: { world }, CONFIG: C } = window.__pa;
      return [world.width, world.height, C.SURFACE_ROW, C.COLONY_X].join(',');
    });
    const w = MODE_TABLE[mode].world;
    if (size !== [w.w, w.h, w.surface, w.colonyX].join(',')) problems.push(`world is ${size}, the mode asks for ${w.w},${w.h},${w.surface},${w.colonyX}`);
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

// The settings dialog (T1.4). The gear opens it; each control edits one setting and the farm or the
// sound changes with it at once; the choices come back after a reload; and the dialog is a proper
// modal: the farm's keys and clicks stay behind it and Tab stays inside it. Real clicks and keys, as
// a player makes them.
// Crash safety: a tick or a frame that throws stops the loop and puts up the snag dialog with the colony saved,
// Reload resumes it, nothing saves it again after that, and the page saves itself when it is left
async function runCrash() {
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const contexts = [];
  // What the game logs on purpose, and what the page reports of the errors thrown to cause it
  const ON_PURPOSE = /Test crash|Test rejection|hit a snag|Unhandled rejection/;
  const seen = [];
  const open = async (context, query) => {
    const page = await context.newPage();
    const own = watch(page);
    seen.push(own);
    await page.goto(`${base}${query}`);
    await page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
    await page.evaluate(() => { window.__pa.director.auto = false; });
    return page;
  };
  const snag = page => page.evaluate(() => ({
    up: getComputedStyle(document.getElementById('crash')).display !== 'none',
    text: document.getElementById('crash').innerText,
    focus: document.activeElement?.id,
    running: window.__pa.gameLoop.running,
    pause: getComputedStyle(document.getElementById('pause')).display !== 'none',
    save: localStorage.getItem('pixelants_screensaver'),
    tick: window.__pa.sim.world.tick,
    ants: window.__pa.sim.antSystem.population,
    time: window.__pa.sim.sky.time,
  }));
  const dialog = (page, ms = 4000) => page.waitForFunction(() => getComputedStyle(document.getElementById('crash')).display !== 'none', null, { timeout: ms }).then(() => true, () => false);
  const info = [];
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'no-preference' });
    contexts.push(context);

    // A tick that throws. (Not ?new: that starts the colony afresh at every load, Reload included.)
    const page = await open(context, '?debug&mode=screensaver');
    await page.waitForTimeout(600);
    check((await snag(page)).running, 'the loop was not running before the error');
    check(!(await snag(page)).up, 'the snag dialog was up before any error');
    await page.evaluate(() => { window.__pa.sim.world.update = () => { throw new Error('Test crash: tick'); }; });
    check(await dialog(page), 'a tick that threw put up no dialog');
    const a = await snag(page);
    check(!a.running, 'the loop carried on after a tick threw');
    check(/colony was saved/i.test(a.text) && /Reload/.test(a.text), `the dialog says "${a.text.replace(/\n+/g, ' / ')}"`);
    check(a.focus === 'crash-reload', `the keyboard is on ${a.focus}, wanted crash-reload`);
    check(!!a.save, 'the colony was not saved when the tick threw');
    await shot(page, 'crash');
    // nothing gets past it: Esc does not open the pause menu, Tab stays in the dialog, and the page does not save over it
    await page.keyboard.press('Escape');
    await page.keyboard.press('Tab');   // one press: with one button to stop at, going out and back would hide a leak
    await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(1200);
    const b = await snag(page);
    check(!b.pause, 'Esc opened the pause menu over the snag dialog');
    check(b.focus === 'crash-reload', `Tab left the snag dialog for ${b.focus}`);
    check(b.save === a.save, 'the colony was saved again after it had thrown');
    check(b.tick === a.tick, 'the colony went on ticking after it had thrown');

    // Reload resumes it
    await page.click('#crash-reload');
    await page.waitForFunction(() => window.__pa && window.__pa.sim.world.tick > 0 && getComputedStyle(document.getElementById('crash')).display === 'none', null, { timeout: 60_000 });
    const r = await snag(page);
    // the tick count is not saved; the sky and the ants are, and a few seconds is all that has passed
    check(Math.abs(r.time - a.time) < 0.05, `after Reload the sky is at ${r.time}, was at ${a.time}`);
    check(Math.abs(r.ants - a.ants) <= 3 + a.ants * 0.1, `after Reload the colony has ${r.ants} ants, had ${a.ants}`);
    check(r.ants > 0, 'after Reload the colony has no ants');
    check(!(await snag(page)).up, 'the snag dialog was still up after Reload');
    info.push(`resumed with ${r.ants} ants`);
    await page.close();

    // A frame that throws, and one that throws once the colony has been playing a while
    const page2 = await open(context, '?debug&mode=screensaver');
    await page2.waitForTimeout(400);
    await page2.evaluate(() => { window.__pa.renderer.render = () => { throw new Error('Test crash: frame'); }; });
    check(await dialog(page2), 'a frame that threw put up no dialog');
    check(!(await snag(page2)).running, 'the loop carried on after a frame threw');
    await page2.close();

    // A promise nobody caught: not worth stopping a running colony for, worth a word when it is not running
    const page3 = await open(context, '?debug&mode=screensaver');
    await page3.evaluate(() => { Promise.reject(new Error('Test rejection: running')); });
    await page3.waitForTimeout(500);
    const c = await snag(page3);
    check(!c.up && c.running, 'a stray rejection stopped a colony that was running');
    await page3.evaluate(() => { window.__pa.gameLoop.stop(); Promise.reject(new Error('Test rejection: stopped')); });
    check(await dialog(page3), 'a stray rejection with the loop stopped put up no dialog');
    await page3.close();

    // Leaving the page saves it
    const page4 = await open(context, '?debug&mode=screensaver');
    const before = (await snag(page4)).save;
    await page4.waitForTimeout(1500);
    await page4.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    const after = (await snag(page4)).save;
    check(!!after && after !== before, 'pagehide did not save the colony');
    await page4.close();
    info.push('tick, frame, rejection, pagehide');
  } catch (e) {
    problems.push(`stopped: ${e.message}`);
  }
  problems.push(...seen.flat().filter(m => !ON_PURPOSE.test(m)));
  for (const c of contexts) await c.close();
  report('crash', problems, info.join(', '));
}

// The title screen: the version, the modes by the name the player sees, Settings and Credits from it, and
// the strip of ants along its foot, which walks, stands when the player wants less motion, and stops with the title
async function runTitle() {
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const errors = [];
  const contexts = [];
  const visit = async (reducedMotion = 'no-preference') => {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion });
    contexts.push(context);
    const page = await context.newPage();
    errors.push(watch(page));
    await page.goto(`${base}?debug`);   // no mode in the address: the title stays up
    await page.waitForSelector('#ms-ants');
    return page;
  };
  const strip = page => page.evaluate(() => document.getElementById('ms-ants').toDataURL());
  const shown = (page, id) => page.evaluate(id => getComputedStyle(document.getElementById(id)).display !== 'none', id);
  const focus = page => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  const info = [];
  try {
    const page = await visit();
    await page.waitForTimeout(600);
    const t = await page.evaluate(() => ({
      version: document.querySelector('#mode-select .ms-version')?.textContent,
      cards: [...document.querySelectorAll('#ms-pick .ms-btn-name')].map(el => el.textContent),
      pitches: [...document.querySelectorAll('#ms-pick .ms-btn-pitch')].map(el => el.textContent.trim()),
      text: document.getElementById('mode-select').innerText,
      strip: document.getElementById('ms-ants').width,
      wide: document.documentElement.scrollWidth > innerWidth,
    }));
    check(t.version === `v${VERSION}`, `the title shows "${t.version}", wanted v${VERSION}`);
    check(t.cards.join() === 'Zen,Survival', `the mode cards are ${t.cards.join(', ')}, wanted Zen, Survival`);
    check(t.pitches.every(Boolean) && t.pitches.length === 2, 'a mode card has no one-line pitch');
    check(!/screensaver/i.test(t.text), 'the title still says Screensaver');
    check(t.strip > 100, `the strip of ants is ${t.strip} pixels wide`);
    check(!t.wide, 'the title makes the page scroll sideways');
    await shot(page, 'title');

    // the ants walk
    const a = await strip(page);
    await page.waitForTimeout(500);
    const b = await strip(page);
    check(a !== b, 'the ants along the foot of the title stand still');

    // Settings, from the title: over it, and the keyboard goes back to the button
    await page.click('#btn-title-settings');
    check(await shown(page, 'settings'), 'Settings on the title opened nothing');
    check(await page.evaluate(() => {
      const r = document.getElementById('set-close').getBoundingClientRect();
      return document.getElementById('settings').contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }), 'the settings dialog is under the title');
    await page.keyboard.press('Escape');
    check(!(await shown(page, 'settings')), 'Esc did not close the settings opened from the title');
    check((await focus(page)) === 'btn-title-settings', `after Settings from the title the keyboard is on ${await focus(page)}, wanted btn-title-settings`);
    check(await shown(page, 'mode-select'), 'closing Settings took the title away');

    // Credits: Esc, the Close button and a click outside close it; the keyboard goes back after the keys
    const credits = await page.evaluate(() => document.getElementById('credits').textContent);
    check(/John Such/.test(credits) && /JavaScript/.test(credits) && /v\d/.test(credits), 'the credits lack the name, the tools or the version');
    await page.click('#btn-title-credits');
    check(await shown(page, 'credits'), 'Credits opened nothing');
    check((await focus(page)) === 'credits-close', `Credits opened with the keyboard on ${await focus(page)}`);
    await shot(page, 'credits');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    check((await focus(page)) === 'credits-close', `Tab left the credits for ${await focus(page)}`);
    await page.keyboard.press('Escape');
    check(!(await shown(page, 'credits')), 'Esc did not close the credits');
    check((await focus(page)) === 'btn-title-credits', `after Esc the keyboard is on ${await focus(page)}, wanted btn-title-credits`);
    await page.click('#btn-title-credits');
    await page.click('#credits-close');
    check(!(await shown(page, 'credits')), 'the Close button did not close the credits');
    await page.click('#btn-title-credits');
    await page.mouse.click(8, 8);
    check(!(await shown(page, 'credits')), 'a click outside did not close the credits');
    await page.focus('#btn-title-credits');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');   // on the Close button now
    check(!(await shown(page, 'credits')) && (await focus(page)) === 'btn-title-credits', `Enter on Close left the keyboard on ${await focus(page)}`);

    // Choosing a mode ends the title, and the strip with it; the pause menu shows the version too
    await page.click('#btn-mode-screensaver');
    await page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
    check(!(await shown(page, 'mode-select')), 'the title stayed up after choosing a mode');
    const c = await strip(page);
    await page.waitForTimeout(500);
    check(c === (await strip(page)), 'the strip of ants carries on drawing under the farm');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => getComputedStyle(document.getElementById('pause')).display !== 'none', null, { timeout: 3000 }).catch(() => {});
    const v = await page.evaluate(() => document.querySelector('#pause .pause-version')?.textContent);
    check(v === `v${VERSION}`, `the pause menu shows "${v}", wanted v${VERSION}`);
    const badge = await page.evaluate(() => document.getElementById('dashboard').innerText);
    check(!/screensaver/i.test(badge), 'the dashboard still says Screensaver');

    // Less motion: the ants are drawn once and stand
    const still = await visit('reduce');
    await still.waitForTimeout(400);
    const s1 = await strip(still);
    await still.waitForTimeout(500);
    check(s1 === (await strip(still)), 'the ants walk for a player who wants less motion');
    check(await still.evaluate(() => document.getElementById('ms-ants').getContext('2d').getImageData(0, 7, 400, 1).data.some(x => x > 0)), 'with less motion the strip was not drawn at all');
    info.push('title, credits, version, ants');
  } catch (e) {
    problems.push(`stopped: ${e.message}`);
  }
  problems.push(...errors.flat());
  for (const c of contexts) await c.close();
  report('title', problems, info.join(', '));
}

async function runSettingsMenu() {
  // The settings whose control is worked below. A control that is shown and is not in here fails the
  // check: a row with no effect behind it belongs in the dialog hidden (the note in index.html)
  const TESTED = ['volume', 'muted', 'fpsCap', 'quality', 'reducedMotion'];
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const errors = [];
  const contexts = [];
  const ready = page => page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
  // The audio thread runs behind when the machine is busy: wait for the sound to get where it is
  // going, and if it never does, the check that follows says what it did instead
  const till = (page, test, arg) => page.waitForFunction(test, arg, { timeout: 6000 }).catch(() => {});
  const half = (n, scale) => Math.max(1, Math.round(n * scale));
  const wrong = (got, want) => Object.keys(want).filter(k => got[k] !== want[k]).map(k => `${k} is ${got[k]}, wanted ${want[k]}`).join('; ');
  const seg = (page, name, value) => page.locator('#settings label', { has: page.locator(`input[name="${name}"][value="${value}"]`) });

  // The sound is awake once a click has made it (a muted one sleeps until it is unmuted)
  let awake = false;
  const wake = async page => {
    awake = await page.waitForFunction(() => window.__pa.audio.audioGraph()?.ctx.state === 'running', null, { timeout: 5000 }).then(() => true, () => false);
    return awake;
  };
  // A page with the colony ready. The camera tour is off: it would put the panel away under the H key.
  const tame = async page => {
    await ready(page);
    await page.evaluate(() => { window.__pa.director.auto = false; });
  };
  // A browser of its own, so that nothing chosen before is in its storage
  const fresh = async (query, viewport = VIEWPORT) => {
    const context = await browser.newContext({ viewport, reducedMotion: 'no-preference' });
    contexts.push(context);
    const page = await context.newPage();
    errors.push(watch(page));
    await page.goto(`${base}${query}`);
    await tame(page);
    return page;
  };
  // What the dialog shows, what is chosen, and what the game does about it
  const look = page => page.evaluate(() => {
    const { settings, gameLoop, hud, CONFIG } = window.__pa;
    const dialog = document.getElementById('settings'), canvas = document.getElementById('gameCanvas');
    const picked = name => document.querySelector(`#settings input[name="${name}"]:checked`)?.value;
    const sound = window.__pa.audio.audioGraph();
    // A modal has the whole page under it: at the middle of its Close button, of the panel and of the
    // toolbar (where they are on screen), what a click would reach must be the dialog or in it
    const covered = ['set-close', 'dashboard', 'toolbar'].filter(id => {
      const r = document.getElementById(id).getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && !dialog.contains(document.elementFromPoint(x, y));
    });
    return {
      open: getComputedStyle(dialog).display !== 'none',   // as a player sees it, whatever the classes say
      covered,
      focus: document.activeElement?.id || document.activeElement?.tagName,
      shows: {
        volume: Number(document.getElementById('set-volume').value), said: document.getElementById('set-volume-value').textContent,
        muted: document.getElementById('set-muted').checked, fps: picked('set-fps'), quality: picked('set-quality'),
        motion: document.getElementById('set-motion').checked, dim: dialog.classList.contains('is-muted'),
      },
      chose: Object.fromEntries(['volume', 'muted', 'fpsCap', 'quality', 'reducedMotion'].map(k => [k, settings.get(k)])),
      stored: localStorage.getItem('pixelants_settings'),
      loop: gameLoop.fpsCap, speed: gameLoop.speed, panel: hud.panel,
      canvas: [canvas.width, canvas.height], win: [innerWidth, innerHeight], scale: CONFIG.LOW_QUALITY_SCALE,
      still: document.body.classList.contains('reduce-motion'),
      glide: getComputedStyle(document.getElementById('dashboard')).transitionDuration,
      master: sound?.graph.master.gain.value, played: { ...sound?.played },
    };
  });
  // The sound is as loud as the volume says
  const loud = async (page, want, why) => {
    if (!awake) return;
    await till(page, v => Math.abs(window.__pa.audio.audioGraph().graph.master.gain.value - v) < 0.03, want);
    const { master } = await look(page);
    check(Math.abs(master - want) < 0.03, `${why}: the master volume is ${master?.toFixed(2)}, wanted ${want.toFixed(2)}`);
  };
  // Which rows of the Conditions panel a player can see
  const conditions = page => page.evaluate(() => Object.fromEntries(
    [['dig', 'ctrl-dig-rate'], ['birth', 'ctrl-birth-rate'], ['speed', 'ctrl-speed'], ['tour', 'ctrl-auto-camera']]
      .map(([name, id]) => [name, document.getElementById(id).offsetParent !== null])));

  try {
    // ── Zen: the dialog, one control at a time ──
    const page = await fresh('?debug&new&mode=screensaver');
    let s = await look(page);
    let bad;
    check(!s.open, 'the settings dialog is open before anyone asked');
    check(s.stored === null, `a new visitor already has settings stored: ${s.stored}`);
    const zen = await conditions(page);
    check(!zen.dig && !zen.birth && zen.speed && zen.tour,
      `Zen's Conditions panel shows ${JSON.stringify(zen)}, wanted Sim Speed and Auto Tour and no dig-speed or birthrate slider`);
    check(await page.evaluate(() => document.querySelector('#toolbar > #btn-settings')?.title) === 'Settings',
      'the toolbar has no gear button titled Settings');

    await page.click('#btn-settings');
    check(await wake(page), 'the sound did not wake after the first click on the page');
    s = await look(page);
    check(s.open, 'the gear did not open the settings dialog');
    check(!s.covered.length, `something covers the open settings dialog: at the middle of ${s.covered.join(', ')} a click would not reach it`);
    check(s.focus === 'set-volume', `the keyboard is on ${s.focus} when the dialog opens, wanted the volume slider`);
    check(await page.getAttribute('#settings', 'role') === 'dialog' && await page.getAttribute('#settings', 'aria-modal') === 'true',
      'the dialog is not marked up as a modal dialog');
    bad = wrong(s.shows, { volume: 60, said: '60%', muted: false, fps: '30', quality: 'high', motion: false, dim: false });
    check(!bad, `a new Zen colony's dialog shows: ${bad}`);
    check(s.loop === 30, `a new Zen colony's game loop is capped at ${s.loop} frames a second, wanted Zen's own 30`);
    await shot(page, 'settings-menu');

    // Opening and closing it alone chooses nothing (a stored value would pin the mode's own frame cap)
    await page.keyboard.press('Escape');
    s = await look(page);
    check(!s.open && s.focus === 'btn-settings', `Esc left the dialog ${s.open ? 'open' : 'closed'} with the keyboard on ${s.focus}, wanted it closed and the keyboard back on the gear`);
    check(s.stored === null, `opening and closing the dialog stored settings the player never chose: ${s.stored}`);

    // It shows what is chosen, whether that changed before it opened or while it is open
    await page.evaluate(() => { const { settings } = window.__pa; settings.set('volume', 0.25); settings.set('muted', true); });
    await page.click('#btn-settings');
    await page.click('#set-title');   // inside the box: it stays open
    check((await look(page)).open, 'a click on the dialog itself closed it');
    bad = wrong((await look(page)).shows, { volume: 25, said: '25%', muted: true, dim: true });
    check(!bad, `the dialog, opened after the volume and mute were changed elsewhere, shows: ${bad}`);
    await page.evaluate(() => { const { settings } = window.__pa; settings.set('volume', 0.6); settings.set('muted', false); });
    bad = wrong((await look(page)).shows, { volume: 60, said: '60%', muted: false, dim: false });
    check(!bad, `the open dialog, after the volume and mute were changed back elsewhere, shows: ${bad}`);
    await wake(page);

    // Every setting has a row, and every row a player can see has been worked below
    const rows = await page.evaluate(() => [...document.querySelectorAll('#settings [data-setting]')]
      .map(el => ({ key: el.dataset.setting, shown: el.offsetParent !== null })));
    const known = await page.evaluate(() => Object.keys(window.__pa.settings.defaults));
    for (const key of known) check(rows.some(r => r.key === key), `the setting ${key} has no control in the dialog: add a row to #settings in index.html, hidden until something reads it`);
    for (const key of new Set(rows.filter(r => r.shown).map(r => r.key))) {
      check(TESTED.includes(key), `the dialog shows a control for ${key} that no test works: show it only once something reads it, then test it here`);
    }
    for (const key of TESTED) check(rows.some(r => r.key === key && r.shown), `${key} is tested here but the dialog shows no control for it`);

    // Volume: the slider follows the mouse and the keys, the number beside it follows the slider,
    // and the sound follows the number
    const bar = await page.locator('#set-volume').boundingBox();
    const chimes = (await look(page)).played.place ?? 0;
    await page.mouse.click(bar.x + bar.width * 0.4, bar.y + bar.height / 2);
    s = await look(page);
    check(Math.abs(s.shows.volume - 40) <= 3, `a click 40% along the volume slider set it to ${s.shows.volume}`);
    check(s.chose.volume === s.shows.volume / 100 && s.shows.said === `${s.shows.volume}%`,
      `the slider reads ${s.shows.volume} and says ${s.shows.said}, but the volume is ${s.chose.volume}`);
    await loud(page, s.chose.volume, 'the volume slider');
    if (awake) check(((await look(page)).played.place ?? 0) > chimes, 'letting go of the volume slider played no sound to judge the volume by');
    await page.focus('#set-volume');   // the click let go of the slider: the keys need it back
    for (const [key, want] of [['End', 100], ['Home', 0], ['ArrowRight', 1]]) {
      await page.keyboard.press(key);
      s = await look(page);
      check(s.shows.volume === want && s.chose.volume === want / 100 && s.shows.said === `${want}%`,
        `${key} on the volume slider: it shows ${s.shows.volume} (${s.shows.said}) and the volume is ${s.chose.volume}, wanted ${want}`);
      if (want === 100) await loud(page, 1, 'the volume slider at its top');
    }
    await page.mouse.move(bar.x + bar.width * 0.2, bar.y + bar.height / 2);   // held and dragged, the volume follows before the hand lets go
    await page.mouse.down();
    await page.mouse.move(bar.x + bar.width * 0.7, bar.y + bar.height / 2, { steps: 5 });
    s = await look(page);
    check(Math.abs(s.shows.volume - 70) <= 3 && s.chose.volume === s.shows.volume / 100 && s.shows.said === `${s.shows.volume}%`,
      `the volume slider, held 70% along: it shows ${s.shows.volume} (${s.shows.said}) and the volume is ${s.chose.volume}`);
    await page.mouse.up();
    await page.mouse.click(bar.x + bar.width * 0.35, bar.y + bar.height / 2);
    const volume = (await look(page)).chose.volume;
    await wake(page);
    await loud(page, volume, 'the volume slider, raised again');

    // Mute
    await page.click('#set-muted');
    s = await look(page);
    check(s.chose.muted && s.shows.muted && s.shows.dim, `Mute: the setting is ${s.chose.muted}, the box ${s.shows.muted}, the volume row dimmed ${s.shows.dim}`);
    await loud(page, 0, 'Mute');
    await page.click('#set-muted');
    s = await look(page);
    check(!s.chose.muted && !s.shows.muted && !s.shows.dim, `Mute, again: the setting is ${s.chose.muted}, the box ${s.shows.muted}, the volume row dimmed ${s.shows.dim}`);
    await wake(page);
    await loud(page, volume, 'Mute, taken off');

    // Frame rate: the loop's cap follows
    const caps = await page.$$eval('input[name="set-fps"]', els => els.map(el => el.value).join());
    check(caps === '30,60,0', `the frame rate choices are ${caps}, wanted 30, 60 and 0 (unlimited)`);
    for (const [value, cap] of [['0', 0], ['60', 60], ['30', 30]]) {
      await seg(page, 'set-fps', value).click();
      s = await look(page);
      check(s.chose.fpsCap === cap && s.loop === cap && s.shows.fps === value,
        `Frame rate ${value}: the setting is ${s.chose.fpsCap}, the game loop's cap ${s.loop}, the dialog shows ${s.shows.fps}`);
    }
    await page.focus('input[name="set-fps"][value="30"]');
    await page.keyboard.press('ArrowRight');
    s = await look(page);
    check(s.chose.fpsCap === 60 && s.loop === 60, `the arrow key on the frame rate: the setting is ${s.chose.fpsCap}, the game loop's cap ${s.loop}, wanted 60`);

    // Quality: the canvas is drawn with fewer pixels, and with all of them again
    await seg(page, 'set-quality', 'low').click();
    s = await look(page);
    check(s.chose.quality === 'low' && s.shows.quality === 'low' && s.canvas.join() === `${half(s.win[0], s.scale)},${half(s.win[1], s.scale)}`,
      `Quality low: the setting is ${s.chose.quality}, the canvas is ${s.canvas.join('x')} in a ${s.win.join('x')} window, wanted ${half(s.win[0], s.scale)}x${half(s.win[1], s.scale)}`);
    await seg(page, 'set-quality', 'high').click();
    s = await look(page);
    check(s.chose.quality === 'high' && s.canvas.join() === s.win.join(), `Quality high: the setting is ${s.chose.quality}, the canvas is ${s.canvas.join('x')} in a ${s.win.join('x')} window`);

    // Reduce motion: the page's own sliding and fading stop. The label counts as the box.
    check(s.glide === '0.55s' && !s.still, `test setup: the panel's slide is ${s.glide} and the page is ${s.still ? '' : 'not '}marked as reduced motion`);
    await page.click('label[for="set-motion"]');
    s = await look(page);
    check(s.chose.reducedMotion && s.shows.motion && s.still && s.glide === '0s',
      `Reduce motion on: the setting is ${s.chose.reducedMotion}, the page is marked ${s.still}, the panel's slide takes ${s.glide}, wanted 0s`);
    await page.click('#set-motion');
    s = await look(page);
    check(!s.chose.reducedMotion && !s.shows.motion && !s.still && s.glide === '0.55s',
      `Reduce motion off: the setting is ${s.chose.reducedMotion}, the page is marked ${s.still}, the panel's slide takes ${s.glide}, wanted 0.55s`);
    await page.click('#set-motion');   // left on: the reload below must bring it back

    // The dialog has the keyboard: the farm's keys do nothing behind it, and work again once it is gone
    await page.click('#set-title');   // inside the box: it stays open, and no control keeps the keyboard
    const farm = async () => { const t = await look(page); return `${t.open ? 'open' : 'closed'}, speed ${t.speed}, panel ${t.panel ? 'out' : 'away'}, muted ${t.chose.muted}`; };
    const before = await farm();
    check(before.startsWith('open'), 'a click on the dialog itself closed it');
    for (const key of [' ', 'h', 'm']) await page.keyboard.press(key);
    check(await farm() === before, `Space, H and M did something behind the open dialog: ${before}, then ${await farm()}`);
    await page.click('#set-close');
    s = await look(page);
    check(!s.open && s.focus === 'BODY', `the Close button left the dialog ${s.open ? 'open' : 'closed'} with the keyboard on ${s.focus}, wanted it closed and no button holding the keyboard (Space is the pause key)`);
    const speed = s.speed;
    await page.keyboard.press(' ');
    check((await look(page)).speed === 0, 'Space did not pause the game once the dialog had closed');
    await page.keyboard.press(' ');
    check((await look(page)).speed === speed, 'Space did not carry the game on again');
    await page.keyboard.press('h');
    check(!(await look(page)).panel, 'H did not put the panel away once the dialog had closed');
    await page.keyboard.press('h');
    await page.keyboard.press('m');
    check((await look(page)).chose.muted, 'M did not mute once the dialog had closed');
    await page.keyboard.press('m');
    check(!(await look(page)).chose.muted, 'M did not unmute');

    // Tab goes round the dialog and never out to the farm; Enter on Close hands the keyboard back to the gear
    await page.click('#btn-settings');
    const reached = new Set();
    let strayed = null;
    const whereIs = () => page.evaluate(() => { const a = document.activeElement; return { id: a.id || a.name || a.tagName, inside: document.getElementById('settings').contains(a) }; });
    for (let i = 0; i < 24 && !strayed; i++) {
      await page.keyboard.press('Tab');
      const at = await whereIs();
      reached.add(at.id);
      if (!at.inside) strayed = at.id;
    }
    check(!strayed, `Tab went out of the dialog, to ${strayed}`);
    for (const id of ['set-volume', 'set-muted', 'set-fps', 'set-quality', 'set-motion', 'set-close']) check(reached.has(id), `Tab never reached ${id}`);
    await page.focus('#set-volume');
    await page.keyboard.press('Shift+Tab');
    check((await whereIs()).id === 'set-close', `Shift+Tab from the first control went to ${(await whereIs()).id}, wanted the last, Close`);
    await page.keyboard.press('Enter');
    s = await look(page);
    check(!s.open && s.focus === 'btn-settings', `Enter on Close left the dialog ${s.open ? 'open' : 'closed'} with the keyboard on ${s.focus}, wanted it closed and the keyboard back on the gear`);

    // A click outside the box closes it, and is not also a click on the farm behind
    await page.evaluate(() => window.__pa.gameLoop.setSpeed(0));   // the colony holds still, so any food that lands is ours
    const food = () => page.evaluate(() => window.__pa.sim.world.foodAmount.reduce((a, b) => a + b, 0));
    await page.click('#btn-settings');
    const fed = await food();
    const [spotX, spotY] = await foodSpot(page);
    await page.mouse.click(spotX, spotY);
    check(!(await look(page)).open, 'a click outside the box did not close the dialog');
    check(await food() === fed, 'the click that closed the dialog also dropped food on the farm behind it');
    await till(page, () => performance.now() >= window.__pa.hud.controls.mutedUntil);   // a click that wakes the farm from a tour is muted for a moment
    await page.mouse.click(spotX, spotY);   // the same click, with the dialog gone, feeds the colony: so the check above could have failed
    check(await food() > fed, `test setup: a click on the farm dropped no food${await noFoodBecause(page, spotX, spotY)}`);
    await page.evaluate(speed => window.__pa.gameLoop.setSpeed(speed), speed);

    // What a player leaves with: a quiet, frugal farm. It must still be so after a reload.
    await page.click('#btn-settings');
    await seg(page, 'set-fps', '0').click();
    await seg(page, 'set-quality', 'low').click();
    await page.click('#set-muted');
    const kept = await look(page);
    check(kept.chose.volume === volume && kept.chose.muted && kept.chose.fpsCap === 0 && kept.chose.quality === 'low' && kept.chose.reducedMotion,
      `test setup: the choices are ${JSON.stringify(kept.chose)}`);
    check(Object.keys(JSON.parse(kept.stored)).sort().join() === 'fpsCap,muted,quality,reducedMotion,volume',
      `storage holds ${kept.stored}, wanted just the five settings the player chose`);
    await page.reload();
    await tame(page);
    s = await look(page);
    check(JSON.stringify(s.chose) === JSON.stringify(kept.chose), `after a reload the settings are ${JSON.stringify(s.chose)}, they were ${JSON.stringify(kept.chose)}`);
    check(s.loop === 0, `after a reload the game loop's cap is ${s.loop}, wanted the chosen 0 (unlimited), not the mode's own`);
    check(s.canvas.join() === `${half(s.win[0], s.scale)},${half(s.win[1], s.scale)}`, `after a reload the canvas is ${s.canvas.join('x')} in a ${s.win.join('x')} window, wanted low quality`);
    check(s.still && s.glide === '0s', `after a reload the page is marked ${s.still} and the panel's slide takes ${s.glide}, wanted reduced motion`);
    await page.click('#btn-settings');
    bad = wrong((await look(page)).shows, { volume: Math.round(volume * 100), muted: true, fps: '0', quality: 'low', motion: true, dim: true });
    check(!bad, `after a reload the dialog shows: ${bad}`);
    await page.click('#set-muted');
    check(await wake(page), 'the sound did not wake when it was unmuted after a reload');
    await loud(page, volume, 'the volume kept over a reload');

    // ── Survival: the developer sliders are there, and the dialog fits a phone ──
    const hard = await fresh('?debug&new&mode=survival');
    const cond = await conditions(hard);
    check(cond.dig && cond.birth && cond.speed, `Survival's Conditions panel shows ${JSON.stringify(cond)}, wanted every slider`);
    await hard.setViewportSize({ width: 360, height: 640 });
    await hard.waitForTimeout(400);
    await hard.click('#btn-settings', { timeout: 5000 });
    const fit = await hard.evaluate(() => {
      const box = document.querySelector('.set-box').getBoundingClientRect();
      const stray = [...document.querySelectorAll('#settings input, #settings select, #settings button')]
        .filter(el => el.offsetParent && (el.getBoundingClientRect().left < box.left - 1 || el.getBoundingClientRect().right > box.right + 1))
        .map(el => el.id || el.name);
      return { box: [box.left, box.top, box.right, box.bottom].map(Math.round), win: [innerWidth, innerHeight], wide: document.documentElement.scrollWidth, stray };
    });
    check(fit.box[0] >= 0 && fit.box[1] >= 0 && fit.box[2] <= fit.win[0] && fit.box[3] <= fit.win[1],
      `on a ${fit.win.join('x')} screen the dialog spans ${fit.box.join(', ')} (left, top, right, bottom)`);
    check(fit.wide <= fit.win[0], `on a ${fit.win.join('x')} screen the page is ${fit.wide} wide: it scrolls sideways`);
    check(!fit.stray.length, `on a ${fit.win.join('x')} screen ${fit.stray.join(', ')} stick out of the dialog`);
    const near = await look(hard);
    check(!near.covered.length, `on a ${fit.win.join('x')} screen something covers the open settings dialog: at the middle of ${near.covered.join(', ')} a click would not reach it`);
    await shot(hard, 'settings-menu-narrow');
    if (!near.covered.includes('set-close')) {   // else the message above says so, and the click would only wait
      await hard.click('#set-close', { timeout: 5000 });   // reachable, if the box has to scroll
      check(!(await look(hard)).open, 'the Close button did not close the dialog on a small screen');
    }

    // ── Under another dialog: the mouse can't reach the gear, but Tab can, and they have the keyboard first ──
    // (The mode menu is only up before the gear exists. The tutorial and the end of a colony are the two left.)
    for (const [query, overlay, raise, dismiss] of [
      ['?mode=screensaver', 'tutorial', async () => {}, over => over.keyboard.press('Escape')],
      ['?debug&new&mode=survival', 'gameover',
        async over => { await ready(over); await over.evaluate(() => { window.__pa.gameLoop.setSpeed(0); window.__pa.sim.queen.health = 0; }); },   // held still, so no tick heals her before a frame sees her
        over => over.evaluate(() => document.getElementById('gameover').classList.add('hidden'))],
    ]) {
      const context = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'no-preference' });
      contexts.push(context);
      const over = await context.newPage();
      errors.push(watch(over));
      await over.goto(`${base}${query}`);
      await raise(over);
      await over.waitForSelector(`#${overlay}:not(.hidden)`, { timeout: 60_000 });
      const opens = () => over.evaluate(() => !document.getElementById('settings').classList.contains('hidden'));
      const gear = () => over.evaluate(() => document.getElementById('btn-settings').click());   // what Enter on the focused gear does
      await gear();
      check(!await opens(), `the settings dialog opened over the ${overlay}`);
      await dismiss(over);
      await over.waitForSelector(`#${overlay}.hidden`, { state: 'attached', timeout: 10_000 });
      await gear();
      check(await opens(), `test setup: the gear did not open the settings dialog once the ${overlay} was gone`);
    }
  } catch (e) {
    problems.push(`stopped: ${e.message.split('\n')[0]}`);
  }
  problems.push(...errors.flat());
  for (const c of contexts) await c.close();
  report('settingsmenu', problems, 'gear, each control and its effect, keys, focus, reload, small screen');
}

// The pause menu and the key list (T1.5). Esc holds the farm still and Esc again lets it go at the speed
// it had; Settings, How to play and Keyboard open over the menu and give it back; Save and Main menu keep
// the colony; ? lists the keys, and the list is held to what the keys do: every row works and no key left
// out of it does anything. Real keys and clicks, as a player makes them.
async function runPause() {
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const errors = [];
  const contexts = [];
  const till = (page, test, arg) => page.waitForFunction(test, arg, { timeout: 6000 }).catch(() => {});
  const shown = (page, id) => page.evaluate(id => getComputedStyle(document.getElementById(id)).display !== 'none', id);
  const word = on => on ? 'open' : 'closed';
  // What "nothing changed" compares: the speed, the view, the panel, the sound, the tour, whether full
  // screen was asked for, and which dialogs are up
  const FIELDS = ['speed', 'zoom', 'x', 'y', 'panel', 'muted', 'touring', 'fullscreen', 'menu', 'keys', 'settings', 'tutorial'];
  const moved = (a, b) => FIELDS.filter(k => a[k] !== b[k]);
  // What the listeners that come after the dialogs' make of a key: marked used by whoever took it, or not
  const watchKeys = page => page.evaluate(() => {
    window.keysSeen = [];
    window.addEventListener('keydown', e => window.keysSeen.push(`${e.key} ${e.defaultPrevented ? 'used' : 'unused'}`));
  });
  const lastKey = page => page.evaluate(() => window.keysSeen.at(-1));

  // A page of its own, with full screen stubbed so that asking for it can be counted (the real one is kept
  // as window.realFullscreen). `before` runs in the page ahead of the game's own scripts; `device` is more
  // of the context's options (a touch screen).
  const visit = async (query, viewport = VIEWPORT, before = null, device = {}) => {
    const context = await browser.newContext({ viewport, reducedMotion: 'no-preference', ...device });
    contexts.push(context);
    const page = await context.newPage();
    errors.push(watch(page));
    await page.addInitScript(() => {
      window.fullscreenAsked = 0;
      window.realFullscreen = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = () => { window.fullscreenAsked++; return Promise.resolve(); };
    });
    if (before) await page.addInitScript(before);
    await page.goto(`${base}${query}`);
    return page;
  };
  // A debug page with the colony on screen. The "founding" overlay is gone (Esc is not for the menu while
  // it is up), the view has settled, so that an unmoved view is the same numbers, and the tour is off.
  const fresh = async (query, viewport = VIEWPORT, device = {}) => {
    const page = await visit(query, viewport, null, device);
    await page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
    await page.waitForSelector('#founding.hidden', { state: 'attached', timeout: 10_000 });
    await page.evaluate(() => { window.__pa.director.auto = false; });
    await till(page, () => {
      const c = window.__pa.camera;
      return Math.abs(c.inset - c.insetTarget) < 0.5 && (!c.fitted || Math.abs(c.zoom - c.fitZoom()) < 0.002);
    });
    return page;
  };
  // What the player sees, and what the game is doing about it
  const look = page => page.evaluate(() => {
    const { gameLoop, camera, hud, director, settings, sim } = window.__pa;
    const up = id => getComputedStyle(document.getElementById(id)).display !== 'none';
    return {
      menu: up('pause'), keys: up('keys'), settings: up('settings'), tutorial: up('tutorial'),
      note: document.getElementById('pause-note').textContent,
      focus: document.activeElement?.id || document.activeElement?.tagName,
      speed: gameLoop.speed, tick: sim.world.tick, time: performance.now(),
      zoom: camera.zoom, x: camera.x, y: camera.y,
      panel: hud.panel, muted: settings.get('muted'), touring: director.active, fullscreen: window.fullscreenAsked,
    };
  });
  // A modal has the whole page under it: at the middle of the panel and of the toolbar (where they are on
  // screen), what a click would reach must be the dialog or in it
  const covers = (page, id) => page.evaluate(id => {
    const dialog = document.getElementById(id);
    return ['dashboard', 'toolbar'].filter(other => {
      const r = document.getElementById(other).getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
      return x >= 0 && y >= 0 && x < innerWidth && y < innerHeight && !dialog.contains(document.elementFromPoint(x, y));
    });
  }, id);
  // The box of a dialog is whole on the screen, nothing sticks out of it sideways, and its last button can
  // be reached (the box scrolls if it has to)
  const fit = (page, box, last) => page.evaluate(([box, last]) => {
    const el = document.querySelector(box), r = el.getBoundingClientRect();
    const out = e => e.offsetParent && (e.getBoundingClientRect().left < r.left - 1 || e.getBoundingClientRect().right > r.right + 1);
    const end = document.getElementById(last);
    end.scrollIntoView({ block: 'nearest' });
    const b = end.getBoundingClientRect();
    return {
      box: [r.left, r.top, r.right, r.bottom].map(Math.round), win: [innerWidth, innerHeight],
      wide: document.documentElement.scrollWidth, sideways: el.scrollWidth - el.clientWidth,
      stray: [...el.querySelectorAll('button, dt, dd')].filter(out).map(e => e.id || e.textContent),
      reach: end.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)),
    };
  }, [box, last]);
  const checkFit = (f, what) => {
    check(f.box[0] >= 0 && f.box[1] >= 0 && f.box[2] <= f.win[0] && f.box[3] <= f.win[1],
      `${what}: the box spans ${f.box.join(', ')} (left, top, right, bottom) on a ${f.win.join('x')} screen`);
    check(f.wide <= f.win[0] && f.sideways <= 0, `${what}: it scrolls sideways (the page is ${f.wide} wide, the box ${f.sideways}px too wide)`);
    check(!f.stray.length, `${what}: ${f.stray.join(', ')} stick out of the box`);
    check(f.reach, `${what}: the last button cannot be reached`);
  };

  try {
    // ── Zen: Esc holds the farm still, and Esc again lets it go at the speed it had ──
    const farm = await fresh('?debug&new&mode=screensaver');
    let s = await look(farm);
    let bad;
    check(!s.menu && !s.keys, 'the pause menu or the key list is up before anyone asked');
    const help = await farm.evaluate(() => document.querySelector('.dash-help').textContent.replace(/\s+/g, ' '));
    check(/Esc menu/.test(help) && /\? all the keys/.test(help), `the panel's help says "${help.trim()}", wanted it to tell about Esc and ?`);
    // With Ctrl, Alt or Meta a key is the browser's or the system's, as it is for the farm's own keys
    for (const combo of ['Control+Escape', 'Alt+Escape', 'Meta+Escape', 'Control+?', 'Alt+?']) {
      await farm.keyboard.press(combo);
      s = await look(farm);
      check(!s.menu && !s.keys, `${combo} opened the ${s.menu ? 'pause menu' : 'key list'}, wanted keys held with Ctrl, Alt or Meta left alone`);
    }

    await farm.keyboard.press(']');
    await farm.keyboard.press(']');
    s = await look(farm);
    check(s.speed === 4, `test setup: ] ] left the farm at ${s.speed}×, wanted 4×`);
    // Esc and ? are used up by the dialogs: the listeners after them, and the browser, are told so
    await watchKeys(farm);
    await farm.keyboard.press('Escape');
    s = await look(farm);
    const held = s.tick;
    check(s.menu && !s.keys, `Esc left the pause menu ${word(s.menu)} and the key list ${word(s.keys)}`);
    check(await lastKey(farm) === 'Escape used', `the listeners after the pause menu saw its Esc as "${await lastKey(farm)}", wanted "Escape used": a key nobody marked used is the browser's too`);
    check(s.speed === 0, `with the pause menu open the farm runs at ${s.speed}×, wanted it held at 0×`);
    check(s.focus === 'pause-resume', `the keyboard is on ${s.focus} when the menu opens, wanted Resume`);
    const over = await covers(farm, 'pause');
    check(!over.length, `something covers the open pause menu: at the middle of ${over.join(', ')} a click would not reach it`);
    const marks = await farm.evaluate(() => {
      const el = id => document.getElementById(id);
      const mark = id => [el(id).getAttribute('role'), el(id).getAttribute('aria-modal'), el(el(id).getAttribute('aria-labelledby'))?.textContent].join();
      return { pause: mark('pause'), keys: mark('keys'), items: [...el('pause').querySelectorAll('button')].map(b => b.textContent) };
    });
    check(marks.pause === 'dialog,true,Paused', `the pause menu is marked up as "${marks.pause}", wanted a modal dialog titled Paused`);
    check(marks.keys === 'dialog,true,Keyboard', `the key list is marked up as "${marks.keys}", wanted a modal dialog titled Keyboard`);
    check(marks.items.filter(t => t !== 'Keyboard').join() === 'Resume,Settings,Save,How to play,Main menu',
      `the pause menu offers ${marks.items.join(', ')}, wanted Resume, Settings, Save, How to play, Main menu (and Keyboard)`);
    await shot(farm, 'pause-menu');

    await farm.waitForTimeout(2500);
    s = await look(farm);
    check(s.tick === held, `the farm ran ${s.tick - held} ticks behind the open menu, wanted none`);
    await farm.click('#pause-title');   // the keyboard off Resume: a button that has it turns Space into a click
    const still = await look(farm);
    check(still.menu && still.speed === 0, `a click on the title of the menu left it ${word(still.menu)} and the farm at ${still.speed}×, wanted it open and held: only a click outside the box closes it`);
    for (const key of [' ', 'h', ']', '[', 'm', '+', '-', '0', 'c', 'f', 'ArrowRight', 'd']) await farm.keyboard.press(key);
    bad = moved(still, await look(farm));
    check(!bad.length, `keys pressed behind the open menu changed ${bad.join(', ')}`);

    await farm.keyboard.press('Escape');
    const back = await look(farm);
    check(!back.menu, 'Esc did not close the pause menu');
    check(back.speed === 4, `after Esc, Esc the farm runs at ${back.speed}×, wanted the 4× it had`);
    check(back.focus === 'BODY', `the keyboard is left on ${back.focus} after the menu closes, wanted the page: a button that has it turns Space into a click`);
    await farm.waitForTimeout(500);
    s = await look(farm);
    const ran = s.tick - back.tick, secs = (s.time - back.time) / 1000;
    check(ran >= 20 && ran <= secs * 250 * 1.5 + 30,
      `the farm ran ${ran} ticks in the ${secs.toFixed(2)} s after the menu closed; 4× is about ${Math.round(secs * 250)}, so it stood still or made up for the time it was held`);
    await farm.keyboard.press(' ');
    check((await look(farm)).speed === 0, 'Space did not pause the farm once the menu was closed');

    // A farm paused by hand stays paused through Esc, Esc; and the menu that was closed opens again
    await farm.keyboard.press('Escape');
    check((await look(farm)).menu, 'Esc did not open the pause menu a second time, after it had been opened and closed once');
    await farm.keyboard.press('Escape');
    s = await look(farm);
    check(!s.menu && s.speed === 0, `a farm paused with Space, then Esc, Esc: the menu is ${word(s.menu)} and the farm runs at ${s.speed}×, wanted it closed and still paused`);

    // A click outside the box closes the menu, and is not also a click on the farm behind
    const food = () => farm.evaluate(() => window.__pa.sim.world.foodAmount.reduce((a, b) => a + b, 0));
    const [spotX, spotY] = await foodSpot(farm);
    await farm.keyboard.press('Escape');
    const fed = await food();
    await farm.mouse.click(spotX, spotY);
    s = await look(farm);
    check(!s.menu && s.speed === 0, `a click outside the menu left it ${word(s.menu)} and the farm at ${s.speed}×, wanted it closed and still paused`);
    check(await food() === fed, 'the click that closed the menu also dropped food on the farm behind it');
    await till(farm, () => performance.now() >= window.__pa.hud.controls.mutedUntil);   // a click that wakes the farm from a tour is muted for a moment
    await farm.mouse.click(spotX, spotY);   // the same click, with the menu gone, feeds the colony: so the check above could have failed
    check(await food() > fed, `test setup: a click on the farm dropped no food${await noFoodBecause(farm, spotX, spotY)}`);
    await farm.keyboard.press(' ');
    check((await look(farm)).speed === 4, 'Space did not carry on at the speed the farm had');

    // A held key sends the same key again, marked as a repeat: it must not undo the press that opened the menu
    await farm.keyboard.down('Escape');
    await farm.keyboard.down('Escape');
    await farm.keyboard.up('Escape');
    s = await look(farm);
    check(s.menu && s.speed === 0, `a held Esc left the menu ${word(s.menu)} and the farm at ${s.speed}×: the repeat undid the press that opened it`);

    // Tab goes round the menu and never out to the farm; Enter on Resume and a click on it both let the farm go
    const order = [];
    for (let i = 0; i < 7; i++) {
      await farm.keyboard.press('Tab');
      order.push((await look(farm)).focus);
    }
    check(order.join() === 'pause-settings,pause-save,pause-howto,pause-keys,pause-leave,pause-resume,pause-settings',
      `Tab went ${order.join(', ')} from Resume, wanted it round the menu and back to Resume`);
    await farm.focus('#pause-resume');
    await farm.keyboard.press('Shift+Tab');
    s = await look(farm);
    check(s.focus === 'pause-leave', `Shift+Tab from Resume went to ${s.focus}, wanted the last button, Main menu`);
    // With the keyboard on one of the farm's own controls behind the menu (as when the player tabs back into the page
    // from the address bar), Tab and Shift+Tab pull it into the menu: the browser's own order would go on to the next
    // control of the page, or out of it
    for (const [key, wanted, what] of [['Tab', 'pause-resume', 'the first button, Resume'], ['Shift+Tab', 'pause-leave', 'the last, Main menu']]) {
      await farm.focus('#btn-zoom-in');
      await farm.keyboard.press(key);
      s = await look(farm);
      check(s.focus === wanted, `${key} with the keyboard on a control of the farm behind the menu went to ${s.focus}, wanted ${what}`);
    }
    // Where the keyboard is is read as the press is handled: Chromium takes it off a button that has been hidden at
    // the next frame, but Firefox and Safari leave it there, and Space would then press the hidden Resume
    await farm.evaluate(() => document.getElementById('pause-resume').addEventListener('click', () => queueMicrotask(() => {
      window.focusAfterResume = document.activeElement?.id || document.activeElement?.tagName;
    }), { once: true }));
    await farm.focus('#pause-resume');
    await farm.keyboard.press('Enter');
    s = await look(farm);
    const resumed = await farm.evaluate(() => window.focusAfterResume);
    check(!s.menu && s.speed === 4 && s.focus === 'BODY' && resumed === 'BODY',
      `Enter on Resume left the menu ${word(s.menu)}, the farm at ${s.speed}× and the keyboard on ${resumed} (then ${s.focus}), wanted it closed, 4× and the keyboard on the page`);
    await farm.keyboard.press('Escape');
    await farm.click('#pause-resume');
    s = await look(farm);
    check(!s.menu && s.speed === 4, `a click on Resume left the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted it closed and back at 4×`);

    // Settings opens over the menu and gives it back, whichever way it is left; the farm stays held throughout,
    // and the keyboard is back on the menu's Settings button (a press on the dark outside the box must not
    // take it off again, as a press on a page does)
    const keyboard = 'pause-settings';
    for (const [how, leave] of [
      ['Esc', () => farm.keyboard.press('Escape')],
      ['Close', () => farm.click('#set-close')],
      ['a click outside the box', () => farm.mouse.click(40, 450)],
    ]) {
      await farm.keyboard.press('Escape');
      await farm.click('#pause-settings');
      s = await look(farm);
      check(s.settings && !s.menu && s.speed === 0 && s.focus === 'set-volume',
        `Settings from the menu: the dialog is ${word(s.settings)}, the menu ${word(s.menu)}, the farm at ${s.speed}× and the keyboard on ${s.focus}; wanted it open over a closed menu, held, on the volume slider`);
      await leave();
      s = await look(farm);
      check(!s.settings && s.menu && s.speed === 0 && s.focus === keyboard,
        `leaving Settings with ${how}: the dialog is ${word(s.settings)}, the menu ${word(s.menu)}, the farm at ${s.speed}× and the keyboard on ${s.focus}; wanted the menu back, the farm still held and the keyboard on ${keyboard}`);
      await farm.keyboard.press('Escape');
      s = await look(farm);
      check(!s.menu && !s.settings && s.speed === 4, `Esc after Settings (left with ${how}) left the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted it closed and back at 4×`);
    }
    // Settings from the gear is the gear's own: closing it does not bring the menu up
    await farm.click('#btn-settings');
    await farm.keyboard.press('?');
    s = await look(farm);
    check(s.settings && !s.keys, 'the settings dialog does not keep ? to itself: the key list opened over it');
    await farm.keyboard.press('Escape');
    s = await look(farm);
    check(!s.settings && !s.menu && s.speed === 4, `Settings from the gear, closed with Esc: the menu is ${word(s.menu)} and the farm at ${s.speed}×, wanted the menu closed and the farm untouched`);
    // ...and with the menu up, the gear can't open it (the mouse can't reach it, Enter on it could)
    await farm.keyboard.press('Escape');
    await farm.evaluate(() => document.getElementById('btn-settings').click());
    s = await look(farm);
    check(!s.settings && s.menu, 'the settings dialog opened over the pause menu');
    await farm.keyboard.press('Escape');

    // ── ? lists the keys: from the farm, and from the menu ──
    await farm.keyboard.press('?');
    s = await look(farm);
    check(s.keys && !s.menu, `? left the key list ${word(s.keys)} and the menu ${word(s.menu)}`);
    check(await lastKey(farm) === '? used', `the listeners after the key list saw its ? as "${await lastKey(farm)}", wanted "? used": a key nobody marked used is the browser's too`);
    check(s.speed === 0, `with the key list open the farm runs at ${s.speed}×, wanted it held at 0×`);
    check(s.focus === 'keys-close', `the keyboard is on ${s.focus} when the key list opens, wanted its Close button`);
    const listOver = await covers(farm, 'keys');
    check(!listOver.length, `something covers the open key list: at the middle of ${listOver.join(', ')} a click would not reach it`);
    await farm.evaluate(() => document.getElementById('btn-settings').click());
    s = await look(farm);
    check(!s.settings && s.keys, 'the settings dialog opened over the key list');
    await farm.keyboard.press('Tab');
    check((await look(farm)).focus === 'keys-close', 'Tab in the key list went out of it');
    await farm.keyboard.press('Shift+Tab');
    check((await look(farm)).focus === 'keys-close', 'Shift+Tab in the key list went out of it');
    await farm.click('#keys-title');   // the keyboard off its Close button, as for the menu above
    const listStill = await look(farm);
    for (const key of [' ', 'h', ']', '[', 'm', '+', '-', '0', 'c', 'f', 'ArrowRight', 'd']) await farm.keyboard.press(key);
    bad = moved(listStill, await look(farm));
    check(!bad.length, `keys pressed behind the open key list changed ${bad.join(', ')}`);
    await farm.keyboard.press('Tab');
    check((await look(farm)).focus === 'keys-close', 'Tab from the page, with the key list up, did not go into it');
    await farm.focus('#btn-zoom-in');
    await farm.keyboard.press('Tab');
    check((await look(farm)).focus === 'keys-close', 'Tab with the keyboard on a control of the farm behind the key list did not go into it');
    const listed = await farm.evaluate(() => import('/src/ui/hud.js').then(m => m.SHORTCUTS));
    const rows = await farm.evaluate(() => [...document.querySelectorAll('#keys-list .keys-row')]
      .map(row => [row.querySelector('dt').textContent, row.querySelector('dd').textContent]));
    check(JSON.stringify(rows) === JSON.stringify(listed), `the list shows ${rows.length} rows, ${listed.length} keys are listed in hud.js, and they differ`);
    await shot(farm, 'keys-help');
    await farm.keyboard.press('?');
    s = await look(farm);
    check(!s.keys && !s.menu && s.speed === 4 && s.focus === 'BODY',
      `? again left the list ${word(s.keys)}, the menu ${word(s.menu)}, the farm at ${s.speed}× and the keyboard on ${s.focus}, wanted it all closed, 4× and the keyboard on the page`);
    await farm.keyboard.press('?');
    await farm.keyboard.press('Escape');
    s = await look(farm);
    check(!s.keys && !s.menu && s.speed === 4, `Esc in the key list opened from the farm left the list ${word(s.keys)}, the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted it back on the farm at 4×`);
    // from the menu, closing the list goes back to the menu, however it is closed
    await farm.keyboard.press('Escape');
    await farm.click('#pause-keys');
    s = await look(farm);
    check(s.keys && !s.menu && s.speed === 0, `Keyboard in the menu left the list ${word(s.keys)}, the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted the list open over a closed menu, held`);
    await farm.keyboard.press('Enter');   // on its Close button
    s = await look(farm);
    check(!s.keys && s.menu && s.speed === 0 && s.focus === 'pause-keys', `Close on the list left it ${word(s.keys)}, the menu ${word(s.menu)}, the farm at ${s.speed}× and the keyboard on ${s.focus}, wanted the menu back on its Keyboard button, held`);
    await farm.keyboard.press('?');
    await farm.keyboard.press('Escape');
    s = await look(farm);
    check(!s.keys && s.menu && s.speed === 0, `? in the menu, then Esc, left the list ${word(s.keys)}, the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted the menu back, held`);
    await farm.keyboard.press('?');
    await farm.mouse.click(40, 450);
    s = await look(farm);
    check(!s.keys && s.menu && s.speed === 0 && s.focus === 'pause-keys',
      `a click outside the list left it ${word(s.keys)}, the menu ${word(s.menu)} and the keyboard on ${s.focus}, wanted the menu back, held, on its Keyboard button`);
    await farm.keyboard.press('Escape');
    check((await look(farm)).speed === 4, 'after the list, the menu did not let the farm go at 4×');

    // ── Save, and Main menu ──
    await farm.keyboard.press('Escape');
    const before = await farm.evaluate(() => Date.now());
    await farm.click('#pause-save');
    s = await look(farm);
    check(s.note === 'Saved' && s.menu && s.speed === 0, `Save left the note "${s.note}", the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted "Saved", the menu open, held`);
    const dash = page => page.evaluate(() => document.getElementById('save-status').textContent);
    check(/^Saved/.test(await dash(farm)), `after Save the panel says "${await dash(farm)}", wanted it to say the colony was saved`);
    const stored = () => farm.evaluate(() => { try { return JSON.parse(localStorage.getItem('pixelants_screensaver'))?.ts; } catch { return null; } });
    check(await stored() >= before, `after Save the stored colony is from ${await stored()}, wanted one saved at ${before} or later`);
    await farm.keyboard.press('Escape');
    await farm.keyboard.press('Escape');
    check((await look(farm)).note === '', 'the menu still says "Saved" when it is opened again');
    // The page also saves as it goes hidden, on the way out whatever Main menu did, so a colony stored by then proves
    // nothing. Each write of the colony is noted with whether the page was still showing: Main menu must have saved first.
    await farm.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (/screensaver$/.test(key)) set.call(sessionStorage, 'saved-while', `${sessionStorage.getItem('saved-while') ?? ''} ${document.visibilityState}`);
        return set.call(this, key, value);
      };
      sessionStorage.removeItem('saved-while');
    });
    const clicked = await farm.evaluate(() => Date.now());
    await farm.click('#pause-leave');
    await farm.waitForSelector('#mode-select:not(.hidden)', { timeout: 15_000 })
      .catch(() => { throw new Error('Main menu did not take the page to the mode menu'); });
    check(new URL(farm.url()).search === '', `Main menu went to ${farm.url()}, wanted the page without ?debug or ?mode`);
    check(await farm.evaluate(() => { try { return JSON.parse(localStorage.getItem('pixelants_screensaver'))?.ts; } catch { return null; } }) >= clicked,
      'Main menu left without saving the colony');
    const savedWhile = await farm.evaluate(() => sessionStorage.getItem('saved-while') ?? '');
    check(/visible/.test(savedWhile), `Main menu left without saving the colony before the page went (the colony was written while the page was:${savedWhile || ' never'})`);
    await farm.context().close();

    // ── The key list: every row is a key that works, and no key left out of it does anything ──
    const pad = await fresh('?debug&new&mode=screensaver');
    const rowsOf = await pad.evaluate(() => import('/src/ui/hud.js').then(m => m.SHORTCUTS));
    const press = async (key, ms = 0) => {
      await pad.keyboard.down(key);
      if (ms) await pad.waitForTimeout(ms);
      await pad.keyboard.up(key);
    };
    // [the row, the key, what it must do, how long to hold it, how to tell]. A row of the list with no step
    // here fails, and so does a step for a row the list does not show. Esc and ? are worked above.
    const left = (a, b) => b.x < a.x && b.y === a.y, right = (a, b) => b.x > a.x && b.y === a.y;
    const up = (a, b) => b.y < a.y && b.x === a.x, down = (a, b) => b.y > a.y && b.x === a.x;
    const ARROWS = 'Arrows, W A S D';
    const STEPS = [
      ['Space', ' ', 'pause the farm', 0, (a, b) => a.speed === 1 && b.speed === 0],
      ['Space', ' ', 'carry on', 0, (a, b) => a.speed === 0 && b.speed === 1],
      ['[ ]', ']', 'speed the farm up', 0, (a, b) => b.speed > a.speed],
      ['[ ]', '[', 'slow the farm down', 0, (a, b) => b.speed < a.speed],
      ['+ −', '+', 'zoom in', 0, (a, b) => b.zoom > a.zoom],
      ['+ −', '=', 'zoom in', 0, (a, b) => b.zoom > a.zoom],
      ['+ −', '-', 'zoom out', 0, (a, b) => b.zoom < a.zoom],
      ['+ −', '_', 'zoom out', 0, (a, b) => b.zoom < a.zoom],
      [ARROWS, 'ArrowLeft', 'move the view left', 200, left], [ARROWS, 'ArrowRight', 'move the view right', 200, right],
      [ARROWS, 'ArrowUp', 'move the view up', 200, up], [ARROWS, 'ArrowDown', 'move the view down', 200, down],
      [ARROWS, 'a', 'move the view left', 200, left], [ARROWS, 'd', 'move the view right', 200, right],
      [ARROWS, 'w', 'move the view up', 200, up], [ARROWS, 's', 'move the view down', 200, down],
      ['H', 'h', 'hide the panel', 0, (a, b) => a.panel && !b.panel],
      ['H', 'h', 'show the panel', 0, (a, b) => !a.panel && b.panel],
      ['M', 'm', 'turn the sound off', 0, (a, b) => !a.muted && b.muted],
      ['M', 'm', 'turn the sound on', 0, (a, b) => a.muted && !b.muted],
      ['F', 'f', 'ask for full screen', 0, (a, b) => b.fullscreen === a.fullscreen + 1],
      ['C', 'c', 'start the camera tour', 0, (a, b) => !a.touring && b.touring],
      ['C', 'c', 'stop the camera tour', 0, (a, b) => a.touring && !b.touring],
    ];
    const labels = new Set([...STEPS.map(step => step[0]), '0 (zero)', 'Esc', '?']);
    for (const [label] of rowsOf) check(labels.has(label), `the key list has a row for ${label} and this test works no such key: add its steps to STEPS`);
    for (const label of labels) check(rowsOf.some(([row]) => row === label), `this test works the key ${label} and the key list has no row for it`);

    const home = await look(pad);
    for (const [label, key, does, hold, ok] of STEPS) {
      const a = await look(pad);
      await press(key, hold);
      const b = await look(pad);
      check(ok(a, b), `${key} (${label} in the list) did not ${does}; it changed ${moved(a, b).join(', ') || 'nothing'}`);
    }
    // 0 brings the view back from wherever it has been taken
    await press('+');
    await press('+');
    await press('ArrowLeft', 300);
    const away = await look(pad);
    check(away.zoom > home.zoom && away.x < home.x, 'test setup: the view did not move off');
    await press('0');
    await till(pad, home => {
      const c = window.__pa.camera;
      return Math.abs(c.zoom - home.zoom) < 0.01 && Math.abs(c.x - home.x) < 1 && Math.abs(c.y - home.y) < 1;
    }, home);
    s = await look(pad);
    check(Math.abs(s.zoom - home.zoom) < 0.01 && Math.abs(s.x - home.x) < 1 && Math.abs(s.y - home.y) < 1,
      `0 left the view at zoom ${s.zoom.toFixed(2)}, x ${s.x.toFixed(0)}, y ${s.y.toFixed(0)}; wanted the whole farm: zoom ${home.zoom.toFixed(2)}, x ${home.x.toFixed(0)}, y ${home.y.toFixed(0)}`);

    // Every other key does nothing. The view is let go first, so that it is not easing back to the whole farm.
    await pad.evaluate(() => { window.__pa.camera.fitted = false; });
    const used = new Set([...STEPS.map(step => step[1]), '0', 'Escape', '?']);
    const spare = [
      ...Array.from({ length: 94 }, (_, i) => String.fromCharCode(33 + i)).filter(c => c < 'A' || c > 'Z'),   // ! to ~, the capitals being the letters again
      'Enter', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'Insert',
    ].filter(key => !used.has(key));
    let idle = await look(pad);
    for (const key of spare) {
      await press(key, 120);
      const now = await look(pad);
      const did = moved(idle, now);
      check(!did.length, `the key ${key} changed ${did.join(', ')} and is not in the key list: add a row for it to SHORTCUTS in hud.js, and work it here`);
      idle = now;
    }

    // The tutorial is for a new visitor, once; only How to play (the second argument) shows it to one who has seen it
    const again = await pad.evaluate(async () => {
      const { Tutorial } = await import('/src/ui/tutorial.js');
      const tutorial = new Tutorial(), box = document.getElementById('tutorial');
      localStorage.setItem('pixelants_tutorial_done', '1');
      tutorial.show('screensaver');
      const unasked = !box.classList.contains('hidden');
      tutorial.show('screensaver', true);
      return { unasked, asked: !box.classList.contains('hidden') };
    });
    check(!again.unasked, 'the tutorial showed itself again to a visitor who had seen it');
    check(again.asked, 'Tutorial.show(mode, true) did not show the tutorial to a visitor who had seen it');
    await pad.context().close();

    // ── Survival: the same, at another speed; nothing to pause while a colony is founded or over; small screens ──
    const hard = await fresh('?debug&new&mode=survival');
    await hard.keyboard.press('[');
    s = await look(hard);
    check(s.speed === 0.5, `test setup: [ left Survival at ${s.speed}×, wanted 0.5×`);
    await hard.keyboard.press('Escape');
    s = await look(hard);
    check(s.menu && s.speed === 0, `Survival: Esc left the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted it open and held`);
    await hard.keyboard.press('Escape');
    s = await look(hard);
    check(!s.menu && s.speed === 0.5, `Survival: Esc, Esc left the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted it closed and back at 0.5×`);

    // as it is while a colony is founded, and as the mode menu would be if it ever came up over a farm
    for (const [id, when] of [['founding', 'while the colony was being founded'], ['mode-select', 'with the mode menu up']]) {
      await hard.evaluate(id => document.getElementById(id).classList.remove('hidden'), id);
      await hard.keyboard.press('Escape');
      await hard.keyboard.press('?');
      s = await look(hard);
      check(!s.menu && !s.keys && s.speed === 0.5, `${when} Esc and ? left the menu ${word(s.menu)}, the list ${word(s.keys)} and the farm at ${s.speed}×, wanted nothing to open`);
      await hard.evaluate(id => document.getElementById(id).classList.add('hidden'), id);
    }

    await hard.evaluate(() => { window.__pa.gameLoop.setSpeed(0); window.__pa.sim.queen.health = 0; });   // held still, so no tick heals her before a frame sees her
    await hard.waitForSelector('#gameover:not(.hidden)', { timeout: 15_000 });
    await hard.keyboard.press('Escape');
    await hard.keyboard.press('?');
    s = await look(hard);
    check(!s.menu && !s.keys, `at the end of a colony Esc and ? left the menu ${word(s.menu)} and the list ${word(s.keys)}, wanted nothing to open over it`);
    await hard.evaluate(() => document.getElementById('gameover').classList.add('hidden'));
    await hard.keyboard.press('Escape');
    check((await look(hard)).menu, 'test setup: Esc did not open the menu once the end-of-colony screen was gone');
    // Settings won't open over that screen (it can only come up behind a menu in a game that was not held, but
    // the menu must not hand the screen to a dialog that isn't there and leave the farm held behind nothing)
    await hard.evaluate(() => document.getElementById('gameover').classList.remove('hidden'));
    await hard.click('#pause-settings');
    s = await look(hard);
    check(s.menu && !s.settings && s.speed === 0, `Settings that would not open left the menu ${word(s.menu)}, Settings ${word(s.settings)} and the farm at ${s.speed}×, wanted the menu back, held`);
    await hard.evaluate(() => document.getElementById('gameover').classList.add('hidden'));

    await hard.setViewportSize({ width: 360, height: 640 });
    await hard.waitForTimeout(400);
    checkFit(await fit(hard, '.pause-box', 'pause-leave'), 'the pause menu on a 360x640 screen');
    await shot(hard, 'pause-menu-narrow');
    await hard.click('#pause-keys');
    checkFit(await fit(hard, '.keys-box', 'keys-close'), 'the key list on a 360x640 screen');
    await shot(hard, 'keys-help-narrow');
    await hard.setViewportSize({ width: 640, height: 300 });
    await hard.waitForTimeout(400);
    checkFit(await fit(hard, '.keys-box', 'keys-close'), 'the key list on a 640x300 screen');
    await hard.keyboard.press('Escape');
    checkFit(await fit(hard, '.pause-box', 'pause-leave'), 'the pause menu on a 640x300 screen');
    await hard.context().close();

    // ── Without Esc: the toolbar's menu button, by mouse and on a touch screen; AltGr; full screen; the tour ──
    const more = await fresh('?debug&new&mode=screensaver');
    const button = await more.evaluate(() => {
      const b = document.getElementById('btn-menu');
      return b && [b.getAttribute('aria-label'), b.title].join();
    });
    check(button === 'Menu,Menu (Esc)', `the toolbar's menu button is ${button ? `labelled "${button}"` : 'missing'}, wanted Menu, with Esc in its tip`);
    await more.click('#btn-menu');
    s = await look(more);
    check(s.menu && s.speed === 0 && s.focus === 'pause-resume',
      `the menu button left the menu ${word(s.menu)}, the farm at ${s.speed}× and the keyboard on ${s.focus}, wanted it open, held, on Resume`);
    await more.keyboard.press('Escape');
    check(!(await look(more)).menu && (await look(more)).speed === 1, 'Esc did not close the menu that the menu button opened');

    // AltGr is how some layouts type [ ] and ?. Windows sends it as Ctrl+Alt, which the farm's keys otherwise
    // leave to the browser. (Synthetic: a test's keyboard cannot hold AltGr.)
    const altGr = (page, key, graph = true) => page.evaluate(([key, graph]) => document.body.dispatchEvent(new KeyboardEvent('keydown',
      { key, ctrlKey: true, altKey: true, modifierAltGraph: graph, bubbles: true, cancelable: true })), [key, graph]);
    await altGr(more, '?', false);
    check(!(await look(more)).keys, 'Ctrl+Alt+? (not AltGr) opened the key list, wanted it left to the browser');
    await altGr(more, '?');
    s = await look(more);
    check(s.keys && s.speed === 0, `? typed with AltGr left the key list ${word(s.keys)} and the farm at ${s.speed}×, wanted it open and held`);
    await altGr(more, '?');
    check(!(await look(more)).keys, '? typed with AltGr did not close the key list');
    await altGr(more, ']');
    s = await look(more);
    check(s.speed === 2, `] typed with AltGr (as on a German keyboard) left the farm at ${s.speed}×, wanted 2×`);
    await more.keyboard.press('[');

    // Full screen keeps Esc for the page where the browser allows it (Chrome's keyboard lock). The test's key
    // presses reach the page even without the lock, so this shows the lock is asked for and let go, and that
    // Esc in full screen opens the menu without leaving full screen.
    await more.evaluate(() => {
      Element.prototype.requestFullscreen = window.realFullscreen;
      const kb = navigator.keyboard, lock = kb.lock.bind(kb), unlock = kb.unlock.bind(kb);
      window.locks = [];
      kb.lock = keys => { window.locks.push(`lock ${keys}`); return lock(keys); };
      kb.unlock = () => { window.locks.push('unlock'); return unlock(); };
    });
    const full = () => more.evaluate(() => ({ full: !!document.fullscreenElement, locks: window.locks.join() }));
    await more.keyboard.press('f');
    await till(more, () => !!document.fullscreenElement && window.locks.length > 0);   // the lock follows the change of screen
    let screen = await full();
    check(screen.full && screen.locks === 'lock Escape', `F gave full screen ${screen.full ? 'on' : 'off'} with the keyboard locks "${screen.locks}", wanted full screen, with Esc kept for the page`);
    await more.keyboard.press('Escape');
    s = await look(more);
    screen = await full();
    check(s.menu && screen.full, `Esc in full screen left the menu ${word(s.menu)} and full screen ${screen.full ? 'on' : 'off'}, wanted the menu open, still full screen`);
    await more.keyboard.press('Escape');
    await more.keyboard.press('f');
    await till(more, () => !document.fullscreenElement && window.locks.length > 1);
    screen = await full();
    check(!screen.full && screen.locks === 'lock Escape,unlock', `F again left full screen ${screen.full ? 'on' : 'off'} with the keyboard locks "${screen.locks}", wanted it off and Esc let go`);

    // A tour ends when the menu opens, does not start while it is up, and comes back after the idle time once
    // it is closed (2 s here, 20 s in the game)
    await more.evaluate(() => { const d = window.__pa.director; d.idleAfter = 2; d.auto = true; });
    await more.keyboard.press('c');
    check((await look(more)).touring, 'test setup: C did not start the camera tour');
    await more.keyboard.press('Escape');
    await till(more, () => !window.__pa.director.active);
    await more.waitForTimeout(3000);
    s = await look(more);
    check(s.menu && !s.touring, `with the menu open for longer than the idle time the tour is ${s.touring ? 'running' : 'off'}, wanted it off`);
    await more.keyboard.press('Escape');
    const closed = Date.now();
    check(!(await look(more)).touring, 'the tour started again the moment the menu closed, wanted it to wait the idle time');
    await till(more, () => window.__pa.director.active);
    const after = (Date.now() - closed) / 1000;
    check((await look(more)).touring && after >= 1.5, `once the menu closed the tour ${(await look(more)).touring ? `came back after ${after.toFixed(1)} s` : 'did not come back'}, wanted it back after the idle time, 2 s`);
    await more.context().close();

    // A phone: the toolbar's button is the only way in, and a tap on it works
    const phone = await fresh('?debug&new&mode=screensaver', { width: 360, height: 640 }, { hasTouch: true, isMobile: true });
    await phone.tap('#btn-menu');
    s = await look(phone);
    check(s.menu && s.speed === 0, `a tap on the menu button on a phone left the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted it open and held`);
    await phone.tap('#pause-resume');
    s = await look(phone);
    check(!s.menu && s.speed === 1, `a tap on Resume on a phone left the menu ${word(s.menu)} and the farm at ${s.speed}×, wanted it closed and back at 1×`);
    await shot(phone, 'menu-button-phone');
    await phone.context().close();

    // ── The first visit: the tutorial has the keyboard until it is closed, and How to play brings it back ──
    const intro = await visit('?mode=screensaver');
    await intro.waitForSelector('#tutorial:not(.hidden)', { timeout: 60_000 });
    await intro.waitForSelector('#founding.hidden', { state: 'attached', timeout: 10_000 });
    await watchKeys(intro);
    await intro.keyboard.press('?');
    check(!await shown(intro, 'keys') && await shown(intro, 'tutorial'), '? opened the key list over the tutorial');
    check(await lastKey(intro) === '? unused', `the listeners after the pause menu saw a ? over the tutorial as "${await lastKey(intro)}", wanted "? unused": a key it does not act on is for whoever has the keyboard`);
    await intro.keyboard.press('Escape');
    check(!await shown(intro, 'tutorial') && !await shown(intro, 'pause'),
      `the Esc that closes the tutorial left the tutorial ${word(await shown(intro, 'tutorial'))} and the pause menu ${word(await shown(intro, 'pause'))}, wanted both closed`);
    check(await intro.evaluate(() => localStorage.getItem('pixelants_tutorial_done')) === '1', 'closing the tutorial did not note that it had been seen');
    await intro.keyboard.press('Escape');
    check(await shown(intro, 'pause'), 'Esc did not open the pause menu once the tutorial was closed');
    await intro.click('#pause-howto');
    check(await shown(intro, 'tutorial') && !await shown(intro, 'pause'), 'How to play did not show the tutorial again, now that it has been seen');
    for (let step = 0; step < 12 && await shown(intro, 'tutorial'); step++) {
      const last = await intro.evaluate(() => document.getElementById('tut-next').textContent === 'Got it');
      if (last) check(await intro.evaluate(() => document.getElementById('tut-title').textContent) === 'Zen mode', "the last step of How to play is not the mode's own");
      await intro.click('#tut-next');
    }
    check(!await shown(intro, 'tutorial') && await shown(intro, 'pause'),
      `after the last step of How to play the tutorial is ${word(await shown(intro, 'tutorial'))} and the menu ${word(await shown(intro, 'pause'))}, wanted the tutorial closed and the menu back`);
    await intro.click('#pause-howto');
    await intro.click('#tut-skip');
    check(!await shown(intro, 'tutorial') && await shown(intro, 'pause'), 'Skip in How to play did not bring the menu back');
    await intro.keyboard.press('Escape');
    check(!await shown(intro, 'pause'), 'Esc did not close the pause menu after How to play');
    await intro.context().close();

    // A browser that will not keep the note that the tutorial was seen: it still closes
    const forgetful = await visit('?mode=screensaver', VIEWPORT, () => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'pixelants_tutorial_done') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    await forgetful.waitForSelector('#tutorial:not(.hidden)', { timeout: 60_000 });
    await forgetful.click('#tut-skip');
    check(!await shown(forgetful, 'tutorial'), 'Skip left the tutorial open in a browser that would not keep the note that it had been seen');
    await forgetful.context().close();

    // ── Before there is a colony ──
    const title = await visit('');
    await title.waitForSelector('#mode-select:not(.hidden)', { timeout: 15_000 });
    await title.keyboard.press('Escape');
    await title.keyboard.press('?');
    check(!await shown(title, 'pause') && !await shown(title, 'keys'), 'Esc or ? opened a dialog on the mode menu, where there is no farm to pause');
    await title.context().close();

    // ── A browser that will not keep the colony: Save says so, and Main menu asks twice before it leaves ──
    const broken = await fresh('?debug&new&mode=screensaver');
    const refusals = errors[errors.length - 1];
    await broken.evaluate(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (/screensaver$/.test(key)) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return set.call(this, key, value);
      };
    });
    await broken.keyboard.press('Escape');
    await broken.click('#pause-save');
    s = await look(broken);
    check(/couldn.t save/i.test(s.note), `Save in a browser that keeps nothing says "${s.note}", wanted it to say it could not`);
    check(await dash(broken) === 'Save failed', `after a Save that failed the panel says "${await dash(broken)}", wanted "Save failed"`);
    await broken.click('#pause-leave');
    await broken.waitForTimeout(600);   // long enough for a page that is leaving to have gone
    if (new URL(broken.url()).search === '') throw new Error(`Main menu in a browser that keeps nothing went to ${broken.url()}, wanted it to stay and say it asks again`);
    s = await look(broken);
    check(s.menu && /again/i.test(s.note),
      `Main menu in a browser that keeps nothing left the menu ${word(s.menu)} with the note "${s.note}", wanted it open and saying it asks again`);
    await broken.keyboard.press('Escape');
    await broken.keyboard.press('Escape');
    await broken.click('#pause-leave');
    await broken.waitForTimeout(600);
    check(new URL(broken.url()).search !== '', 'Main menu left on the first press after the menu had been closed and opened again: the second-press permission was kept');
    await broken.click('#pause-leave');
    await broken.waitForSelector('#mode-select:not(.hidden)', { timeout: 15_000 })
      .catch(() => { throw new Error('the second Main menu did not take the page to the mode menu'); });
    check(new URL(broken.url()).search === '', `the second Main menu went to ${broken.url()}, wanted the page without ?debug or ?mode`);
    // The failed saves are the point of this page, so their console errors are not failures
    const saidSo = refusals.filter(e => e.startsWith('console.error: Save failed')).length;
    check(saidSo > 0, 'test setup: the saves in the page that keeps nothing did not fail');
    refusals.splice(0, refusals.length, ...refusals.filter(e => !e.startsWith('console.error: Save failed')));
  } catch (e) {
    problems.push(`stopped: ${e.message.split('\n')[0]}`);
  }
  problems.push(...errors.flat());
  for (const c of contexts) await c.close().catch(() => {});
  report('pause', problems, 'Esc and ?, hold and resume, each button, every key, small screens');
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
// Rare moments (T2.8): the choice keeps a long run varied, a moment plays, the tour cuts to it, it ends, the
// days they last ran are saved, and Survival has none
async function runMoments() {
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const info = [];
  const ctx = await browser.newContext({ viewport: VIEWPORT });
  const seen = [];
  const open = async query => {
    const page = await ctx.newPage();
    seen.push(watch(page));
    await page.goto(`${base}${query}`);
    await page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
    return page;
  };
  // Midnight of the day it is now, so the sky is dark and no dawn comes for a while
  const night = page => page.evaluate(() => {
    const { sky, CONFIG } = { sky: window.__pa.sim.sky, CONFIG: window.__pa.CONFIG };
    sky.time = (sky.day - 1) * CONFIG.DAY_TICKS + CONFIG.DAY_TICKS * 0.02;
    sky.weather = 'clear'; sky.rain = 0; sky.overcast = 0;
    sky._calc();
  });
  // Noon of the same day, clear
  const noon = page => page.evaluate(() => {
    const { sky, CONFIG } = { sky: window.__pa.sim.sky, CONFIG: window.__pa.CONFIG };
    sky.time = (sky.day - 1) * CONFIG.DAY_TICKS + CONFIG.DAY_TICKS * 0.5;
    sky.weather = 'clear'; sky.rain = 0; sky.overcast = 0;
    sky._calc();
  });
  // The tour is on moment `id` and has been for a moment
  const filmed = (page, id) => page.waitForFunction(kind => {
    const s = window.__pa.director.shot;
    return s?.kind === kind && s.age > s.zt + 1;
  }, 'moment:' + id, { timeout: 30_000 }).then(() => true, () => false);
  // With the colony held still (speed 0), plays the active moment to its end; ticks it took. Speed 0
  // stops the tour, so it is started again at 1× afterwards
  const finish = page => page.evaluate(() => {
    const { sim, gameLoop, director } = window.__pa;
    gameLoop.setSpeed(0);
    let n = 0;
    while (sim.moments.active && n < 20000) { sim.moments.update(sim); n++; }
    gameLoop.setSpeed(1);
    director.start();
    return sim.moments.active ? -1 : n;
  });
  try {
    const page = await open('?debug&new&mode=screensaver');

    // The choice, on its own: 120 days (eight hours at 1×) of rolls with the rows of the finished table
    const pick = await page.evaluate(async () => {
      const { pickMoment } = await import('/src/simulation/moments/index.js');
      const rows = [['fireflies', 3, 2], ['earthworm', 3, 3], ['beetle', 2, 6], ['bloom', 2, 4], ['flood', 1, 8]]
        .map(([id, weight, gapDays]) => ({ id, weight, gapDays }));
      const last = {}, count = {}, early = [];
      let total = 0, quiet = 99;
      for (let day = 1; day <= 120; day++) {
        for (let roll = 0; roll < 12; roll++, quiet++) {
          if (quiet < 6 || Math.random() >= 0.08) continue;
          const row = pickMoment(rows, last, day);
          if (!row) continue;
          if (last[row.id] !== undefined && day - last[row.id] < row.gapDays) early.push(`${row.id} on day ${day}`);
          last[row.id] = day;
          count[row.id] = (count[row.id] || 0) + 1;
          total++; quiet = 0;
        }
      }
      const none = pickMoment(rows, Object.fromEntries(rows.map(r => [r.id, 10])), 10);
      return { count, total, early, none: none?.id ?? null };
    });
    for (const id of ['fireflies', 'earthworm', 'beetle', 'bloom', 'flood']) {
      check(pick.count[id] > 0, `in 120 days ${id} was never picked`);
      check((pick.count[id] || 0) <= 0.45 * pick.total, `in 120 days ${id} was ${pick.count[id]} of the ${pick.total} picks`);
    }
    check(pick.early.length === 0, `picked again too soon: ${pick.early.slice(0, 3).join(', ')}`);
    check(pick.none === null, `with every moment run today, ${pick.none} was picked`);
    info.push(`${pick.total} in 120 days`);

    // Fireflies, forced at night: the tour cuts to them, captioned, and they end
    await page.evaluate(() => { window.__pa.director.start(); });
    await night(page);
    const started = await page.evaluate(async () => {
      const { on } = await import('/src/events.js');
      window.__momentLog = [];
      on('moment', e => window.__momentLog.push(['moment', e.id]));
      on('momentEnd', e => window.__momentLog.push(['end', e.id]));
      const { sim } = window.__pa;
      return sim.moments.force('fireflies', sim);
    });
    check(started, 'fireflies would not start');
    const cut = await page.waitForFunction(() => {
      const s = window.__pa.director.shot;
      return s?.kind === 'moment:fireflies' && s.age > s.zt + 1;
    }, null, { timeout: 30_000 }).then(() => true, () => false);
    check(cut, `the tour did not cut to the fireflies (it is on ${await page.evaluate(() => window.__pa.director.shot?.kind)})`);
    const during = await page.evaluate(() => ({
      title: window.__pa.director.shot?.title,
      caption: document.getElementById('cap-title')?.textContent ?? null,
      flies: window.__pa.sim.moments.active?.m.flies.length ?? 0,
    }));
    check(during.title === 'Fireflies', `the shot is called "${during.title}"`);
    check(during.caption === 'Fireflies', `the caption says "${during.caption}"`);
    check(during.flies >= 10, `the swarm has ${during.flies} fireflies`);
    await shot(page, 'moment-fireflies');

    // they light the night: the screen is brighter with them than without
    const glow = await page.evaluate(async () => {
      const { renderer, camera, sim } = window.__pa;
      const c = renderer.canvas, g = c.getContext('2d');
      const sum = () => { const d = g.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 1; i < d.length; i += 4) s += d[i]; return s; };
      const a = sim.moments.active;
      for (const f of a.m.flies) f.phase = 0;            // all lit at once at t = 0 (see renderMoments.js)
      const t = renderer.t;
      // no time passes in these frames (frameMs 0), so only what is drawn differs
      const frame = () => { renderer.t = 0.2; renderer.render(camera, sim, 1, 0, 0); return sum(); };
      sim.moments.active = null; const dark = frame();
      sim.moments.active = a; const lit = frame();
      sim.moments.active = null; const dark2 = frame();
      sim.moments.active = a; renderer.t = t;
      return { lit, dark, noise: Math.abs(dark - dark2) };
    });
    check(glow.lit - glow.dark > Math.max(2000, 10 * glow.noise), `the screen is no brighter with the fireflies (${glow.lit} against ${glow.dark}, frames differ by ${glow.noise} anyway)`);

    await page.evaluate(() => window.__pa.gameLoop.setSpeed(8));
    const ended = await page.waitForFunction(() => !window.__pa.sim.moments.active, null, { timeout: 30_000 }).then(() => true, () => false);
    check(ended, 'the fireflies were still out after 30 s at 8×');
    const log = await page.evaluate(() => window.__momentLog.map(e => e.join(' ')).join(', '));
    check(log === 'moment fireflies, end fireflies', `the bus heard "${log}", wanted "moment fireflies, end fireflies"`);

    // An earthworm crosses the glass, filmed, and changes no tile on the way. At 1×, so it is still
    // crossing when the tour gets to it (news waits out the hold on the fireflies first)
    await page.evaluate(() => window.__pa.gameLoop.setSpeed(1));
    check(await page.evaluate(() => {
      const { sim } = window.__pa;
      if (!sim.moments.force('earthworm', sim)) return false;
      window.__worm = sim.moments.active.m;
      return true;
    }), 'the earthworm would not start');
    check(await filmed(page, 'earthworm'), `the tour did not cut to the earthworm (it is on ${await page.evaluate(() => window.__pa.director.shot?.kind)})`);
    check(await page.evaluate(() => window.__pa.director.shot?.title) === 'An earthworm passes the glass', 'the earthworm shot has the wrong title');
    await page.waitForTimeout(1500);
    await shot(page, 'moment-earthworm');
    await page.evaluate(() => { window.__tiles = window.__pa.sim.world.tiles.slice(); });
    const wormTicks = await finish(page);
    const wormAfter = await page.evaluate(() => {
      const { sim } = window.__pa, m = window.__worm, a = window.__tiles, b = sim.world.tiles;
      let changed = 0;
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) changed++;
      return { changed, went: m.went, run: m.run };
    });
    check(wormTicks > 0, 'the earthworm never ended');
    check(wormAfter.changed === 0, `the earthworm changed ${wormAfter.changed} tiles`);
    check(wormAfter.went >= wormAfter.run, `the earthworm sank after ${wormAfter.went.toFixed(1)} of its ${wormAfter.run.toFixed(1)} tiles`);

    // A burrowing beetle digs a real tunnel into the nest, through soil only, and the nest reaches it
    await noon(page);
    const beetle = await page.evaluate(() => {
      const { sim } = window.__pa;
      window.__tiles = sim.world.tiles.slice();
      if (!sim.moments.force('beetle', sim)) return false;
      window.__beetle = sim.moments.active.m;
      return true;
    });
    check(beetle, 'the beetle found no tunnel to dig toward');
    if (beetle) {
      check(await filmed(page, 'beetle'), `the tour did not cut to the beetle (it is on ${await page.evaluate(() => window.__pa.director.shot?.kind)})`);
      await page.waitForFunction(() => window.__beetle.dug >= 4, null, { timeout: 30_000 }).catch(() => {});
      await shot(page, 'moment-beetle');
      check(await finish(page) >= 0, 'the beetle never climbed out');
      const dug = await page.evaluate(() => {
        const { sim, CONFIG } = window.__pa, { world } = sim, m = window.__beetle, a = window.__tiles;
        const top = CONFIG.SURFACE_ROW + CONFIG.MOMENT_BEETLE_CAP;
        const tiles = m.path.filter(([, y]) => y >= top).map(([x, y]) => Math.floor(y) * world.width + Math.floor(x));
        const bad = tiles.filter(i => a[i] !== 2 && a[i] !== 3).map(i => a[i]);   // TILE.SOIL, TILE.TUNNEL
        const shut = tiles.filter(i => !world.isOpen(i % world.width, Math.floor(i / world.width))).length;
        const cap = [...Array(CONFIG.MOMENT_BEETLE_CAP).keys()].filter(k => world.isOpen(Math.floor(m.path[0][0]), CONFIG.SURFACE_ROW + k)).length;
        // can the queen be walked to from the end of it?
        const q = Math.floor(sim.queen.y) * world.width + Math.floor(sim.queen.x);
        world.nav.drop('p' + q);
        const far = world.nav.point(q).dist[tiles[tiles.length - 1]];
        return { dug: m.dug, broke: m.broke, bad, shut, cap, far };
      });
      check(dug.dug > 0, 'the beetle dug nothing');
      check(dug.bad.length === 0, `the beetle went through tiles that were not soil (${dug.bad.join(', ')})`);
      check(dug.shut === 0, `${dug.shut} tiles of the beetle's tunnel are closed`);
      check(dug.cap === 0, 'the beetle opened a second entrance through the turf');
      check(!dug.broke || dug.far < 0xFFFF, 'the beetle broke into the tunnels but the queen cannot be reached from its tunnel');
      info.push(`beetle dug ${dug.dug}${dug.broke ? ' and broke in' : ', gave up'}`);
    }

    // The day they last ran is kept with the colony
    const day = await page.evaluate(() => window.__pa.sim.moments.last.fireflies);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await page.close();
    const again = await open('?debug&mode=screensaver');
    const kept = await again.evaluate(() => window.__pa.sim.moments.last.fireflies);
    check(Number.isFinite(day) && kept === day, `after a reload fireflies last ran on day ${kept}, was ${day}`);

    // Left to itself with the dice loaded, a Zen night starts a moment
    await again.evaluate(() => { const { CONFIG } = window.__pa; CONFIG.MOMENT_CHANCE = 1; CONFIG.MOMENT_MIN_GAP_TICKS = 0; window.__pa.sim.moments.last = {}; });
    await night(again);
    await again.evaluate(() => window.__pa.gameLoop.setSpeed(8));
    const natural = await again.waitForFunction(() => window.__pa.sim.moments.active, null, { timeout: 20_000 }).then(() => true, () => false);
    check(natural, 'a Zen night with every roll a hit started no moment');
    await again.close();

    // Survival has none, however loaded the dice
    const surv = await open('?debug&new&mode=survival');
    await surv.evaluate(() => { const { CONFIG } = window.__pa; CONFIG.MOMENT_CHANCE = 1; CONFIG.MOMENT_MIN_GAP_TICKS = 0; });
    await night(surv);
    const from = await surv.evaluate(() => { window.__pa.gameLoop.setSpeed(8); return window.__pa.sim.world.tick; });
    const rolled = await surv.waitForFunction(n => window.__pa.sim.world.tick > n + 3 * 1200, from, { timeout: 30_000 }).then(() => true, () => false);
    check(rolled, 'Survival did not run long enough to have rolled');
    const quiet = await surv.evaluate(() => ({ active: !!window.__pa.sim.moments.active, last: Object.keys(window.__pa.sim.moments.last).length }));
    check(!quiet.active && quiet.last === 0, 'Survival started a moment');
    await surv.close();
    info.push('fireflies, earthworm');
  } catch (e) {
    problems.push(`stopped: ${e.message}`);
  }
  problems.push(...seen.flat());
  await ctx.close();
  report('moments', problems, info.join(', '));
}

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

// ── Sound ─────────────────────────────────────────────────────────────────────
// The sound (src/audio/) is a soundscape that the sky drives, and a few one-shot effects, all made
// with WebAudio. What can be known without listening is measured here. The mix (src/audio/mix.js)
// and the noise (src/audio/noise.js) are plain functions, called straight. The recipes (each layer,
// each effect) are rendered offline with the game's own buildGraph and measured, and the notes and
// clicks that book() asks for are counted. Real pages then show that nothing sounds before the first
// click, that the sound comes up once the colony is on screen, that the layers follow the sky and
// the camera, that M mutes, and that a sound that breaks can never stop the game. What no test can
// say is how it sounds: that takes listening.

const seeded = seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const pct = x => `${(x * 100).toFixed(1)}%`;

// The mix and the noise, which need no browser
function soundMix(check) {
  const C = CONFIG, TS = C.TILE_SIZE;
  const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

  // Where a sound is heard from: the middle of the view is the middle, the edges stop short of the extremes
  check(near(panAt(500, 1000), 0), `the middle of the view is heard from ${panAt(500, 1000)}, not the middle`);
  const edge = panAt(1000, 1000);
  check(near(panAt(0, 1000), -edge) && edge > 0.5 && edge < 1, `the edges of the view are heard from ${panAt(0, 1000)} and ${edge}`);
  check(panAt(-300, 1000) === panAt(0, 1000) && panAt(1300, 1000) === edge, 'past the edge of the view a sound is pushed further out');
  check(panAt(250, 1000) < panAt(400, 1000) && panAt(600, 1000) < panAt(750, 1000), 'a sound further right is not heard further right');

  // What is close enough to hear, and in view
  const cam = new Camera(1600, 900);
  const look = (zoom, x, y) => { cam.fitted = false; cam.zoom = zoom; cam.x = x * TS; cam.y = y * TS; };
  const heard = (x, y) => heardAt(cam, x, y);
  look(C.AUDIO_CLOSE_ZOOM, 100, 60);
  check(near(heard(100, 60), 0, 0.01), `a thing in the middle of the view is heard from ${heard(100, 60)}`);
  check(heard(110, 60) > heard(100, 60) && heard(90, 60) < heard(100, 60), 'a thing to the right is not heard from the right of one to the left');
  check(heard(2000, 60) === null && heard(100, 2000) === null && heard(-2000, 60) === null, 'a thing far off screen is heard');
  const reach = cam.cw / 2 / (TS * cam.zoom);   // tiles from the middle of the view to its edge
  check(heard(100 + reach * 0.95, 60) !== null && heard(100 + reach * 1.05, 60) === null, 'the edge of the view is not where hearing stops');
  look(C.AUDIO_CLOSE_ZOOM - 0.01, 100, 60);
  check(heard(100, 60) === null, `a thing is heard from a zoom of ${C.AUDIO_CLOSE_ZOOM - 0.01}, below the close zoom ${C.AUDIO_CLOSE_ZOOM}`);
  look(1, 100, 60);
  check(heard(100, 60) === null, 'a thing is heard from a distance');
  look(C.AUDIO_CLOSE_ZOOM, 100, 60);
  cam.inset = 400;   // the dashboard covers the strip on the right: the view is what is left
  check(near(heard(100, 60), 0, 0.01) && heard(170, 60) !== null && heard(180, 60) === null, 'what is under the dashboard is heard');
  cam.inset = 0;

  // What the camera is looking at
  const ants = [
    { x: 100, y: 60, state: STATE.DIGGING }, { x: 104, y: 62, state: STATE.DIGGING },
    { x: 101, y: 61, state: STATE.IDLE }, { x: 900, y: 60, state: STATE.DIGGING },
  ];
  const sim = { antSystem: { ants } };
  look(C.AUDIO_CLOSE_ZOOM, 100, 60);
  const view = watchView(sim, cam);
  check(view.diggers.length === 2, `${view.diggers.length} diggers in view, wanted the 2 that dig in view (of 4 ants)`);
  check(view.diggers[1] > view.diggers[0], 'diggers are not heard from where they are');
  look(C.AUDIO_CLOSE_ZOOM - 0.01, 100, 60);
  check(watchView(sim, cam).diggers.length === 0, 'diggers are heard from just under the close zoom');
  look(C.AUDIO_CLOSE_ZOOM, 100, 60);
  cam.inset = 400;   // the dashboard covers the strip on the right: a digger at 170 is in what is left, one at 180 is under it
  const covered = watchView({ antSystem: { ants: [{ x: 170, y: 60, state: STATE.DIGGING }, { x: 180, y: 60, state: STATE.DIGGING }] } }, cam);
  check(covered.diggers.length === 1 && near(covered.diggers[0], heard(170, 60), 1e-9),
    `${covered.diggers.length} diggers heard (at ${covered.diggers.map(p => p.toFixed(2))}) with the dashboard open, wanted the one in view, at ${heard(170, 60)?.toFixed(2)}`);
  cam.inset = 0;
  const buried = row => { look(1, 100, 0); cam.y = row * TS + cam.cy / cam.zoom; return watchView(sim, cam).buried; };
  check(buried(0) < 0.05 && buried(C.SURFACE_ROW) < 0.05, 'a view of the sky is buried');
  check(near(buried(C.SURFACE_ROW + C.AUDIO_BURY_ROWS / 2), 0.5, 0.05), `half way down the view is ${pct(buried(C.SURFACE_ROW + C.AUDIO_BURY_ROWS / 2))} buried`);
  check(buried(C.SURFACE_ROW + C.AUDIO_BURY_ROWS) > 0.95 && buried(C.SURFACE_ROW + 4 * C.AUDIO_BURY_ROWS) === 1, 'a view deep in the soil is not buried');
  check(buried(C.SURFACE_ROW + 1) < 0.6 && buried(C.SURFACE_ROW + 30) === 1,   // in rows, whatever CONFIG says: the sky just out of view is not yet the depths, and 30 rows down it is
    `a view with its top edge a row under the ground is ${pct(buried(C.SURFACE_ROW + 1))} buried and one 30 rows under it ${pct(buried(C.SURFACE_ROW + 30))}, wanted under 60% and all of it`);

  // How loud each layer should be
  const sky = (o = {}) => ({ phase: 0.5, light: 1, overcast: 0, rain: 0, weather: 'clear', ...o });
  const clear = { buried: 0, diggers: [] };
  const targets = (o, v = clear) => layerTargets(sky(o), v);
  const noon = targets();
  check(near(noon.wind, C.AUDIO_WIND) && noon.rain === 0 && noon.night === 0 && noon.birds === 0 && noon.soil === 0,
    `a clear noon sounds ${JSON.stringify(noon)}, wanted only the wind, at ${C.AUDIO_WIND}`);
  check(near(targets({ overcast: 1 }).wind, C.AUDIO_WIND + C.AUDIO_WIND_OVERCAST) && near(targets({ overcast: 0.5 }).wind, C.AUDIO_WIND + C.AUDIO_WIND_OVERCAST / 2),
    'the wind does not rise with the cloud');
  check(near(targets({}, { buried: 1, diggers: [] }).wind, C.AUDIO_WIND * C.AUDIO_WIND_BURIED) && near(targets({}, { buried: 0.5, diggers: [] }).wind, C.AUDIO_WIND * (1 + C.AUDIO_WIND_BURIED) / 2),
    'the wind is not quieter underground');
  check(near(targets({ rain: 1, weather: 'rain' }).rain, C.AUDIO_RAIN) && near(targets({ rain: 0.4, weather: 'rain' }).rain, 0.4 * C.AUDIO_RAIN), 'the rain is not as loud as the rain');
  check(near(targets({ light: 0 }).night, C.AUDIO_NIGHT) && near(targets({ light: 0.7 }).night, 0.3 * C.AUDIO_NIGHT) && targets({ light: 1 }).night === 0, 'the night insects do not follow the dark');
  const songs = (phase, weather = 'clear') => targets({ phase, weather }).birds;
  const mid = (C.AUDIO_BIRDS_FROM + C.AUDIO_BIRDS_TO) / 2;
  check([C.AUDIO_BIRDS_FROM, mid, C.AUDIO_BIRDS_TO].every(p => songs(p) === C.AUDIO_BIRDS), `the dawn birds do not sing from ${C.AUDIO_BIRDS_FROM} to ${C.AUDIO_BIRDS_TO}`);
  check([C.AUDIO_BIRDS_FROM - 0.01, C.AUDIO_BIRDS_TO + 0.01, 0, 0.5, 0.75].every(p => songs(p) === 0), 'the birds sing at another time of day');
  check(C.AUDIO_BIRDS_FROM >= 0.15 && C.AUDIO_BIRDS_FROM <= 0.25 && C.AUDIO_BIRDS_TO >= 0.25 && C.AUDIO_BIRDS_TO <= 0.4, `the dawn birds sing from ${C.AUDIO_BIRDS_FROM} to ${C.AUDIO_BIRDS_TO}, wanted about 0.2 to 0.32 (the sun rises at 0.25)`);
  check(songs(mid, 'gathering') === 0 && songs(mid, 'rain') === 0, 'the birds sing under a clouded sky');
  check(targets({}, { buried: 0, diggers: [0] }).soil === C.AUDIO_SOIL && targets({}, { buried: 0, diggers: [0, 0.5] }).soil === C.AUDIO_SOIL && noon.soil === 0, 'the soil clicks do not follow the diggers');
  check(soilRate(0, 1) === 0 && near(soilRate(1, 1), C.AUDIO_SOIL_RATE) && near(soilRate(5, 1), 5 * C.AUDIO_SOIL_RATE) && near(soilRate(2, 2), soilRate(4, 1)),
    `the soil clicks ${soilRate(1, 1)} a second for one digger and ${soilRate(5, 1)} for five`);
  check(soilRate(3, 0) === 0 && soilRate(1000, 8) === C.AUDIO_SOIL_MAX_RATE, `the soil clicks ${soilRate(3, 0)} a second paused and ${soilRate(1000, 8)} with a thousand diggers at 8×`);

  // The noise: white hisses, brown rumbles, and a loop of brown has no click where it comes round
  const white = whiteNoise(new Float32Array(30000), seeded(3));
  let lo = 1, hi = -1, sum = 0, energy = 0, along = 0;
  white.forEach((v, i) => { lo = Math.min(lo, v); hi = Math.max(hi, v); sum += v; energy += v * v; if (i) along += v * white[i - 1]; });
  check(lo >= -1 && hi <= 1 && lo < -0.99 && hi > 0.99, `white noise runs from ${lo.toFixed(3)} to ${hi.toFixed(3)}`);
  check(Math.abs(sum / white.length) < 0.02 && Math.abs(energy / white.length - 1 / 3) < 0.02 && Math.abs(along / energy) < 0.03,
    `white noise has a mean of ${(sum / white.length).toFixed(3)}, a power of ${(energy / white.length).toFixed(3)} (wanted 1/3) and ${(along / energy).toFixed(3)} of one sample in the next`);
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const brown = brownNoise(new Float32Array(48000 * 4), 0.3, seeded(seed));
    let e = 0, next = 0, step = 0, peak = 0;
    brown.forEach((v, i) => { e += v * v; peak = Math.max(peak, Math.abs(v)); if (i) { next += v * brown[i - 1]; step = Math.max(step, Math.abs(v - brown[i - 1])); } });
    const seam = Math.abs(brown[0] - brown.at(-1));
    check(Math.abs(Math.sqrt(e / brown.length) - 0.3) < 0.005 && peak <= 1, `brown noise has a loudness of ${Math.sqrt(e / brown.length).toFixed(3)}, wanted 0.3 (seed ${seed})`);
    check(next / e > 0.9, `brown noise: a sample is ${(next / e).toFixed(2)} of the one before, wanted a slow rumble (seed ${seed})`);
    check(seam <= step, `a loop of brown noise jumps ${seam.toFixed(4)} where it comes round, more than the largest step elsewhere, ${step.toFixed(4)} (seed ${seed})`);
  }
}

// The recipes, rendered offline with the game's own buildGraph and measured: each layer on its own,
// each effect, whole scenes through the real limiter, and the notes and clicks that book() asks for,
// counted. It returns plain numbers; judgeLab says what they should be.
const soundLab = page => page.evaluate(async () => {
  const { buildGraph, book, SFX } = window.__pa.audio;
  const { layerTargets } = await import('/src/audio/mix.js');
  const RATE = 48000, N = 8192;

  // A power spectrum averaged over Hann-windowed frames, and what is read off it
  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const angle = -2 * Math.PI / len, wr = Math.cos(angle), wi = Math.sin(angle);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
        }
      }
    }
  };
  const spectrum = d => {
    const pow = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
    for (let s = 0; s + N <= d.length; s += N / 2) {
      for (let i = 0; i < N; i++) { re[i] = d[s + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; }
      fft(re, im);
      for (let k = 1; k < N / 2; k++) pow[k] += re[k] * re[k] + im[k] * im[k];
    }
    return pow;
  };
  const share = (pow, lo, hi) => {   // the part of the power that lies between lo and hi Hz
    let all = 0, part = 0;
    for (let k = 1; k < pow.length; k++) { const f = k * RATE / N; all += pow[k]; if (f >= lo && f < hi) part += pow[k]; }
    return all ? part / all : 0;
  };
  const peakHz = pow => { let best = 1; for (let k = 2; k < pow.length; k++) if (pow[k] > pow[best]) best = k; return best * RATE / N; };
  const centroid = pow => { let all = 0, weighed = 0; for (let k = 1; k < pow.length; k++) { all += pow[k]; weighed += pow[k] * k * RATE / N; } return weighed / all; };
  const stats = (d, from = 0, to = d.length) => {
    let energy = 0, peak = 0;
    for (let i = from; i < to; i++) { energy += d[i] * d[i]; peak = Math.max(peak, Math.abs(d[i])); }
    return { rms: Math.sqrt(energy / (to - from)), peak };
  };
  const lastAbove = (d, level = 0.01) => { let last = 0; for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > level) last = i; return last / RATE; };
  const measure = (d, from, bands) => {
    const pow = spectrum(d.subarray(from)), r = { ...stats(d, from), hz: peakHz(pow), centroid: centroid(pow) };
    for (const [name, [lo, hi]] of Object.entries(bands)) r[name] = share(pow, lo, hi);
    return r;
  };

  // A graph rendered in a second of work for every second of sound. The limiter is taken out of the
  // way unless a scene wants it, since the recipes are what is being measured.
  const left = [];   // oscillators and looping sources that a recipe started and never stopped: they would run for as long as the page does
  const bare = async (seconds, setup, neutral = true) => {
    const off = new OfflineAudioContext(2, RATE * seconds, RATE);
    const g = buildGraph(off);
    const made = [];
    for (const kind of ['createOscillator', 'createBufferSource']) {   // the permanent layers are made by buildGraph, before this
      const create = off[kind].bind(off);
      off[kind] = () => { const node = create(), stop = node.stop.bind(node); node.stop = (...args) => { node.stopped = true; stop(...args); }; made.push(node); return node; };
    }
    if (neutral) { g.limiter.threshold.value = 0; g.limiter.ratio.value = 1; }
    g.master.gain.value = 1;
    g.fade.gain.value = 1;
    setup(g);
    const rendered = await off.startRendering();
    left.push(...made.filter(node => !node.stopped && node.loop !== false));   // a source that does not loop ends with its buffer
    const ear = rendered.getChannelData(0);
    ear.right = rendered.getChannelData(1);   // the other ear, for where a sound is heard from
    return ear;
  };
  const leftShare = (d, from = 0, to = d.length) => {   // how much of the sound is in the left ear: 1 for all of it, 0 for none
    let l = 0, r = 0;
    for (let i = from; i < to; i++) { l += d[i] * d[i]; r += d.right[i] * d.right[i]; }
    return l + r ? l / (l + r) : 0.5;
  };
  const panSpread = d => {   // the left ear's share in each tenth of a second that has a sound in it: the least and the most
    const shares = [], win = RATE / 10;
    let loudest = 0;
    for (let s = 0; s + win <= d.length; s += win) loudest = Math.max(loudest, stats(d, s, s + win).rms);
    for (let s = 0; s + win <= d.length; s += win) if (stats(d, s, s + win).rms > 0.2 * loudest) shares.push(leftShare(d, s, s + win));
    return { windows: shares.length, min: Math.min(...shares), max: Math.max(...shares) };
  };
  const only = (name, level = 1) => ({ night: 0, birds: 0, soil: 0, [name]: level });   // targets with one event layer on
  const drive = (g, seconds, targets, view = { buried: 0, diggers: [0] }, speed = 1) => {   // what updateAudio does, four times a second
    for (let t = 0; t <= seconds; t += 0.25) book(g, targets, view, speed, t);
  };
  const out = { layers: {}, sfx: {}, scenes: {}, booked: {} };

  // Each layer on its own, at a gain of 1
  out.layers.wind = measure(await bare(6, g => { g.layers.wind.gain.value = 1; }), RATE, { lt20: [0, 20], lt40: [0, 40], lt200: [0, 200], gt600: [600, 24000] });
  out.layers.rain = measure(await bare(6, g => { g.layers.rain.gain.value = 1; }), RATE, { mid: [1500, 6000], lt800: [0, 800], gt8k: [8000, 24000] });
  out.layers.night = measure(await bare(8, g => { g.layers.night.gain.value = 1; drive(g, 7.4, only('night')); }), 0, { band: [3500, 5600] });
  out.layers.birds = measure(await bare(14, g => { g.layers.birds.gain.value = 1; drive(g, 13.4, only('birds')); }), 0, { band: [1500, 4500] });
  const soilAt = pan => bare(8, g => { g.layers.soil.gain.value = 1; drive(g, 7.4, only('soil'), { buried: 0, diggers: Array(10).fill(pan) }); });   // ten diggers, so that there are clicks enough to measure
  out.layers.soil = measure(await soilAt(0), 0, { band: [1500, 6000] });

  // Where from: the left ear's share of a sound that is panned to the left, the middle and the right; of the clicks of diggers at either side
  // of the screen; and of the crickets, whose bursts each come from somewhere else
  const hatchAt = async pan => leftShare(await bare(1, g => SFX.hatch(g, 0.1, pan)));
  out.pan = {
    hatch: [await hatchAt(-0.8), await hatchAt(0), await hatchAt(0.8)],
    soil: [leftShare(await soilAt(-0.8)), leftShare(await soilAt(0.8))],
    night: panSpread(await bare(30, g => { g.layers.night.gain.value = 1; drive(g, 29.4, only('night')); })),   // some forty bursts
  };

  // Each effect, played at 0.1 s
  const play = (name, seconds = 3) => bare(seconds, g => SFX[name](g, 0.1, 0));
  const place = await play('place'), unlock = await play('unlock'), hatch = await play('hatch'), over = await play('gameover');
  const moment = await play('moment');
  const window8k = (d, at) => spectrum(d.subarray(Math.round(at * RATE), Math.round(at * RATE) + N));
  out.sfx.place = { ...measure(place, 0, {}), length: lastAbove(place) };
  out.sfx.unlock = { ...measure(unlock, 0, { n659: [600, 720], n988: [920, 1060] }), length: lastAbove(unlock) };
  out.sfx.hatch = { ...measure(hatch, 0, {}), length: lastAbove(hatch) };
  out.sfx.moment = { ...measure(moment, 0, { n880: [820, 940], n1320: [1240, 1400] }), length: lastAbove(moment) };
  out.sfx.gameover = { ...measure(over, 0, {}), length: lastAbove(over), startHz: peakHz(window8k(over, 0.02)), endHz: peakHz(window8k(over, 1.2)) };
  const thunder = { loudest: [], loudAt: [], peak: [], lt40: [], last: [], tail: [] };
  for (let run = 0; run < 8; run++) {
    const d = await bare(8, g => SFX.thunder(g, 0.1, 0));
    const win = RATE / 4;
    let loudest = 0, at = 0;
    for (let s = 0; s + win <= d.length; s += win / 2) {
      const { rms } = stats(d, s, s + win);
      if (rms > loudest) { loudest = rms; at = (s + win / 2) / RATE; }
    }
    thunder.loudest.push(loudest); thunder.loudAt.push(at); thunder.peak.push(stats(d).peak);
    thunder.lt40.push(share(spectrum(d), 0, 40)); thunder.last.push(lastAbove(d)); thunder.tail.push(stats(d, 6 * RATE, 7 * RATE).rms);
  }
  out.sfx.thunder = Object.fromEntries(Object.entries(thunder).map(([name, a]) => [name, { min: Math.min(...a), max: Math.max(...a) }]));

  // Whole scenes, as the sky would ask for them, at the player's volume and through the real limiter
  const volume = window.__pa.settings.get('volume');
  const sky = o => ({ phase: 0.5, light: 1, overcast: 0, rain: 0, weather: 'clear', ...o });
  const none = { buried: 0, diggers: [] };
  const scene = async (o, view = none) => {
    const targets = layerTargets(sky(o), view);
    const d = await bare(8, g => {
      g.master.gain.value = volume;
      for (const name of Object.keys(g.layers)) g.layers[name].gain.value = targets[name];
      drive(g, 7.4, targets, view);
    }, false);
    return stats(d, RATE);
  };
  out.scenes.volume = volume;
  out.scenes.noon = await scene({});
  out.scenes.overcast = await scene({ overcast: 1, light: 0.6 });
  out.scenes.rain = await scene({ overcast: 1, rain: 1, weather: 'rain', light: 0.5 });
  out.scenes.dusk = await scene({ phase: 0.8, light: 0 });
  out.scenes.buried = await scene({}, { buried: 1, diggers: [] });
  out.scenes.digging = await scene({}, { buried: 0, diggers: [0, 0.4, -0.4] });
  out.targets = {   // the gains the sky asks of the layers in those scenes: what a layer adds to the mix is its gain times its own level at a gain of 1
    noon: layerTargets(sky({}), none),
    rain: layerTargets(sky({ overcast: 1, rain: 1, weather: 'rain', light: 0.5 }), none),
    dusk: layerTargets(sky({ phase: 0.8, light: 0 }), none),
    dawn: layerTargets(sky({ phase: 0.26, light: 0.5 }), none),
    digging: layerTargets(sky({}), { buried: 0, diggers: [0, 0.4, -0.4] }),
  };
  const loudest = [];   // everything at its loudest at once, at full volume, with the colony at 8×
  for (let run = 0; run < 4; run++) {
    const d = await bare(8, g => {
      const targets = { wind: 0.24, rain: 0.5, night: 0.15, birds: 0, soil: 0.1 };
      for (const name of Object.keys(g.layers)) g.layers[name].gain.value = targets[name];
      drive(g, 7.4, targets, { buried: 0, diggers: [0, 0.5, -0.5, 0.2] }, 8);
      SFX.thunder(g, 0.5, 0); SFX.place(g, 2, 0); SFX.hatch(g, 2.5, 0);
    }, false);
    loudest.push(stats(d).peak);
  }
  out.scenes.worstPeak = Math.max(...loudest);

  // The notes and clicks booked, counted in a context that is never rendered
  const tally = () => {
    const off = new OfflineAudioContext(2, RATE, RATE);
    const g = buildGraph(off);
    const log = { osc: [], buf: [] };
    const oscillator = off.createOscillator.bind(off), source = off.createBufferSource.bind(off);
    off.createOscillator = () => { const o = oscillator(), start = o.start.bind(o); o.start = (t = 0) => { log.osc.push(t); start(t); }; return o; };
    off.createBufferSource = () => { const s = source(), start = s.start.bind(s); s.start = (t = 0, ...rest) => { log.buf.push(t); start(t, ...rest); }; return s; };
    return { g, log };
  };
  const clusters = (starts, apart) => {   // runs of starts, a new run when the gap is over `apart`
    const runs = [];
    for (const t of [...starts].sort((a, b) => a - b)) {
      const run = runs.at(-1);
      if (run && t - run.at(-1) <= apart) run.push(t); else runs.push([t]);
    }
    return runs;
  };
  const cadence = (starts) => starts.slice(1).map((t, i) => t - starts[i]);
  const spread = a => ({ min: Math.min(...a), max: Math.max(...a) });
  {
    const { g, log } = tally();
    drive(g, 60, only('night', 0.15));   // chirps come three at a time
    const bursts = clusters(log.osc, 0.1);
    out.booked.night = { seconds: 60.6, bursts: bursts.length, chirps: spread(bursts.map(b => b.length)), gap: spread(cadence(bursts.map(b => b[0]))) };
  }
  {
    const { g, log } = tally();
    drive(g, 120, only('birds', 0.18));   // a song is two or three sweeps
    const songs = clusters(log.osc, 0.5);
    out.booked.birds = { seconds: 120.6, songs: songs.length, sweeps: spread(songs.map(s => s.length)), gap: spread(cadence(songs.map(s => s[0]))) };
  }
  const clicks = (diggers, speed) => {
    const { g, log } = tally();
    drive(g, 60, only('soil', 0.1), { buried: 0, diggers: Array(diggers).fill(0) }, speed);
    return log.buf.length;
  };
  out.booked.soil = { seconds: 60.6, one: clicks(1, 1), ten: clicks(10, 1), paused: clicks(5, 0), crowd: clicks(1000, 8) };
  {
    const { g, log } = tally();   // a chirp is booked a little ahead of the clock (the frame loop can stutter), never behind it
    let late = 0, ahead = 0;
    for (let t = 0; t <= 20; t += 0.25) {
      const before = log.osc.length;
      book(g, only('night', 0.15), none, 1, t);
      for (const start of log.osc.slice(before)) { if (start < t) late++; ahead = Math.max(ahead, start - t); }
    }
    out.booked.timing = { late, ahead };
  }
  {
    const quiet = tally();
    drive(quiet.g, 30, only('night', 0.004));   // under what is worth booking for
    const recorded = tally();
    recorded.g.recorded.add('night');           // a recording has taken the layer over
    drive(recorded.g, 30, only('night', 0.15));
    const gap = tally();
    drive(gap.g, 10, only('night', 0.15));
    const before = gap.log.osc.length;
    book(gap.g, only('night', 0.15), none, 1, 600);   // the game froze for ten minutes: the missed chirps are not played in a heap
    const afterFreeze = gap.log.osc.length - before;
    book(gap.g, only('night', 0), none, 1, 601);
    const beforeOn = gap.log.osc.length;
    book(gap.g, only('night', 0.15), none, 1, 700);   // and nor are those of a layer that was off for a while
    out.booked.held = { quiet: quiet.log.osc.length, recorded: recorded.log.osc.length, afterFreeze, afterOff: gap.log.osc.length - beforeOn };
  }
  out.left = { loops: left.filter(node => node.loop).length, oscillators: left.filter(node => !node.loop).length };
  return out;
});

// What the lab's numbers should be (see soundLab). The wanted figures are kept well inside what was measured
// when the sound was made, so that retuning it does not break the test but breaking it does.
function judgeLab(lab, check, info) {
  const { layers, sfx, scenes, booked, left, pan } = lab;
  const between = (what, v, lo, hi) => check(v >= lo && v <= hi, `${what} is ${+v.toFixed(3)}, wanted ${lo} to ${hi}`);
  const across = (what, { min, max }, lo, hi) => check(min >= lo && max <= hi, `${what} runs from ${+min.toFixed(3)} to ${+max.toFixed(3)}, wanted ${lo} to ${hi}`);

  // The layers, each at a gain of 1: where in the spectrum the power lies, and the two noises against each other
  between('the share of the wind below 200 Hz', layers.wind.lt200, 0.7, 1);
  between('the share of the wind below 40 Hz, which only a large speaker plays', layers.wind.lt40, 0, 0.15);
  between('the share of the wind below 20 Hz', layers.wind.lt20, 0, 0.05);
  between('the share of the wind above 600 Hz', layers.wind.gt600, 0, 0.05);
  between('the pitch the wind is centred on (Hz)', layers.wind.centroid, 40, 250);
  between('the share of the rain between 1.5 and 6 kHz', layers.rain.mid, 0.5, 1);
  between('the share of the rain below 800 Hz', layers.rain.lt800, 0, 0.1);
  between('the level of the wind', layers.wind.rms, 0.2, 0.7);
  between('the level of the rain', layers.rain.rms, 0.33, 0.5);
  between('the rain against the wind at the same gain', layers.rain.rms / layers.wind.rms, 0.8, 1.4);
  between('the share of the crickets between 3.5 and 5.6 kHz', layers.night.band, 0.9, 1);
  between('the share of the birds between 1.5 and 4.5 kHz', layers.birds.band, 0.9, 1);
  between('the share of the soil clicks between 1.5 and 6 kHz', layers.soil.band, 0.6, 1);
  between('the level of the crickets', layers.night.rms, 0.015, 0.11);
  between('the level of the birds', layers.birds.rms, 0.015, 0.1);
  between('the level of the soil clicks', layers.soil.rms, 0.008, 0.06);
  between('the peak of a cricket chirp', layers.night.peak, 0.4, 1.5);
  between('the peak of a bird sweep', layers.birds.peak, 0.35, 1.5);
  between('the peak of a soil click', layers.soil.peak, 0.5, 2.5);

  // The effects, played alone
  between('the pitch of the sound of placing (Hz)', sfx.place.hz, 500, 720);
  between('the length of the sound of placing (s)', sfx.place.length, 0.1, 0.6);
  between('the share of the chime at 659 Hz', sfx.unlock.n659, 0.2, 1);
  between('the share of the chime at 988 Hz', sfx.unlock.n988, 0.2, 1);
  between('the length of the chime (s)', sfx.unlock.length, 0.4, 1.6);
  between('the length of the hatching pop (s)', sfx.hatch.length, 0, 0.25);
  between('the peak of the hatching pop', sfx.hatch.peak, 0, 0.5);
  between('the share of the moment chime at 880 Hz', sfx.moment.n880, 0.2, 1);
  between('the share of the moment chime at 1320 Hz', sfx.moment.n1320, 0.15, 1);
  between('the length of the moment chime (s)', sfx.moment.length, 0.4, 1.2);
  between('the peak of the moment chime', sfx.moment.peak, 0.02, 0.35);
  check(sfx.gameover.startHz > 1.5 * sfx.gameover.endHz, `the game-over tone goes from ${Math.round(sfx.gameover.startHz)} Hz to ${Math.round(sfx.gameover.endHz)} Hz, wanted it to fall by half again`);
  between('the length of the game-over tone (s)', sfx.gameover.length, 0.8, 2.2);
  between('the pitch the game-over tone is centred on (Hz)', sfx.gameover.centroid, 80, 400);
  const thunder = sfx.thunder;
  across('the loudest quarter-second of thunder', thunder.loudest, 0.15, 0.6);
  across('the time it takes thunder to peak (s)', thunder.loudAt, 0.5, 2);
  across('the peak of thunder', thunder.peak, 0.3, 1.8);
  across('the share of thunder below 40 Hz', thunder.lt40, 0, 0.2);
  across('the time thunder is last heard (s)', thunder.last, 2.5, 5.3);
  check(thunder.tail.max < 0.05 * thunder.loudest.min, `thunder still has a level of ${thunder.tail.max.toFixed(4)} six seconds on, against ${thunder.loudest.min.toFixed(3)} at its loudest`);

  // Where from: a sound panned to a side is nearly all in that ear, one panned to the middle is in both, and each burst of crickets comes from somewhere else
  between('the share of a hatching panned to the left that is in the left ear', pan.hatch[0], 0.9, 1);
  between('the share of a hatching panned to the middle that is in the left ear', pan.hatch[1], 0.45, 0.55);
  between('the share of a hatching panned to the right that is in the left ear', pan.hatch[2], 0, 0.1);
  between('the share of the clicks of diggers at the left of the screen that is in the left ear', pan.soil[0], 0.9, 1);
  between('the share of the clicks of diggers at the right of the screen that is in the left ear', pan.soil[1], 0, 0.1);
  check(pan.night.windows >= 20 && pan.night.max - pan.night.min > 0.5,
    `the bursts of crickets (${pan.night.windows} tenths of a second of them) go from ${+pan.night.min.toFixed(2)} to ${+pan.night.max.toFixed(2)} of the way into the left ear, wanted them spread from side to side`);

  // Whole scenes at the player's volume, through the limiter: gentle by day, the rain plain to hear, and nothing that clips
  between('the level of a clear noon', scenes.noon.rms, 0.01, 0.12);
  between('an overcast day against a clear one', scenes.overcast.rms / scenes.noon.rms, 1.4, 3.5);
  between('the rain against a clear noon', scenes.rain.rms / scenes.noon.rms, 2, 10);
  between('the rain against the same cloud without it', scenes.rain.rms / scenes.overcast.rms, 1.5, 5);   // the cloud's wind alone brings the rain scene to twice a clear noon
  between('the soil, where the sky is out of view, against a clear noon', scenes.buried.rms / scenes.noon.rms, 0.1, 0.6);
  // What each layer adds to the mix against the wind of a clear day: its gain at the sky's asking times its own level at a gain of 1 (for the soil,
  // which is clicks, the peak). The targets are right and the recipes are right whatever CONFIG says, so these are what pin the levels in it
  const { targets } = lab, wind = targets.noon.wind * layers.wind.rms;
  between('the rain against the wind of a clear day', targets.rain.rain * layers.rain.rms / wind, 2, 10);
  between('the crickets of the dark against the wind of a clear day', targets.dusk.night * layers.night.rms / wind, 0.07, 0.6);
  between('the dawn birds against the wind of a clear day', targets.dawn.birds * layers.birds.rms / wind, 0.04, 0.6);
  between('the peak of the soil clicks against the peak of the wind of a clear day', targets.digging.soil * layers.soil.peak / (targets.noon.wind * layers.wind.peak), 0.25, 2);
  for (const name of ['noon', 'overcast', 'rain', 'dusk', 'buried', 'digging']) between(`the peak of ${name}`, scenes[name].peak, 0, 1.1);
  between('the loudest moment of everything at once', scenes.worstPeak, 0, 1.1);
  info.push(`rain ${(scenes.rain.rms / scenes.noon.rms).toFixed(1)}× a clear day, loudest peak ${scenes.worstPeak.toFixed(2)}`);

  // The notes and clicks booked: how many, and how they are spaced
  const { night, birds, soil, held, timing } = booked;
  check(timing.late === 0 && timing.ahead >= 0.3,
    `${timing.late} chirps were booked to start before the clock had got to them, and the furthest ahead was ${+timing.ahead.toFixed(2)} s, wanted none late and some booked at least 0.3 s ahead`);
  between(`the bursts of crickets in ${night.seconds} s`, night.bursts, 65, 95);
  across('the chirps in a burst', night.chirps, 3, 3);
  across('the time between bursts of crickets (s)', night.gap, 0.29, 1.21);
  between(`the songs of birds in ${birds.seconds} s`, birds.songs, 32, 58);
  across('the sweeps in a song', birds.sweeps, 2, 3);
  across('the time between songs (s)', birds.gap, 1.19, 4.21);
  between(`the clicks of one digger in ${soil.seconds} s`, soil.one, 12, 60);
  between('the clicks of ten diggers', soil.ten, 284, 436);
  between('the clicks of a thousand diggers at 8×', soil.crowd, 724, 956);
  check(soil.paused === 0, `${soil.paused} soil clicks were booked with the colony paused`);
  check(held.quiet === 0 && held.recorded === 0, `crickets were booked below what is worth booking for (${held.quiet}) and over a recording (${held.recorded})`);
  check(held.afterFreeze <= 6 && held.afterOff <= 6, `${held.afterFreeze} chirps were booked at once after a freeze and ${held.afterOff} after a layer was off a while, wanted a burst or two at most`);

  // Nothing a recipe starts is left running: a looping source or an oscillator that is never stopped plays for as long as the page does
  check(left.loops === 0 && left.oscillators === 0, `${left.loops} looping sources and ${left.oscillators} oscillators were started by the recipes and never stopped`);
}

// The sound as a whole (src/audio/, src/main.js, src/ui/hud.js): the recipes and the mix on a lab page, then
// real pages. One is Survival started muted with the clock in our hands: nothing sounds before the first
// key, the sound comes up with the colony, the layers follow the sky and the camera, the effects play where
// and when they should, M mutes, and the end of a colony is heard once. One is the screensaver started with
// a click on the menu and its real frame loop, whose level is measured, and then a sound that breaks. The
// last is a browser with no WebAudio at all.
async function runSound() {
  const FADE_IN = 1;   // seconds, in place of CONFIG.AUDIO_FADE_IN, to keep the check short
  const problems = [];
  const check = (ok, msg) => { if (!ok) problems.push(msg); };
  const info = [];
  const errors = [];
  const contexts = [];
  const C = CONFIG, TS = CONFIG.TILE_SIZE;
  const pause = ms => new Promise(done => setTimeout(done, ms));
  const ready = page => page.waitForFunction(() => window.__pa, null, { timeout: 60_000 });
  // Waits for a sleeping sound to wake. If it does not, the run stops there and says when: the audio clock stands
  // still, so every wait for it that follows would run out, and none of what they found would mean anything
  const running = (page, when) => page.waitForFunction(() => window.__pa.audio.audioGraph().ctx.state === 'running', null, { timeout: 5000 })
    .catch(() => { throw new Error(`the sound did not wake ${when}`); });
  // Waits for the sound to get where it is going. The audio thread runs behind when the machine is busy, so a fixed wait
  // flakes; if it never gets there, the check that follows says what it did instead
  const till = (page, test, arg) => page.waitForFunction(test, arg, { timeout: 6000 }).catch(() => {});
  const masterIs = (page, level) => till(page, v => Math.abs(window.__pa.audio.audioGraph().graph.master.gain.value - v) < 0.03, level);
  const asleep = page => till(page, () => { const a = window.__pa.audio.audioGraph(); return a.ctx.state === 'suspended' && a.graph.master.gain.value < 0.01; });

  // A fresh page. The audio contexts it makes are counted (window.__contexts), and it can start muted or without WebAudio
  const open = async (query, { muted = false, webAudio = true } = {}) => {
    const context = await browser.newContext({ viewport: VIEWPORT });
    contexts.push(context);
    const page = await context.newPage();
    const seen = watch(page);
    errors.push(seen);
    await page.addInitScript(({ muted, webAudio }) => {
      try { if (muted) localStorage.setItem('pixelants_settings', '{"muted":true}'); } catch { /* no storage: it starts unmuted */ }
      if (!webAudio) { delete window.AudioContext; delete window.webkitAudioContext; }
      window.__contexts = 0;
      const Real = window.AudioContext;
      if (Real) window.AudioContext = class extends Real { constructor(...args) { super(...args); window.__contexts++; } };
    }, { muted, webAudio });
    await page.goto(`${base}${query}`);
    return { page, seen, context };
  };
  // What the sound is doing now
  const sound = page => page.evaluate(() => {
    const a = window.__pa.audio.audioGraph();
    return {
      contexts: window.__contexts, made: Boolean(a), state: a?.ctx.state, started: a?.started, dead: a?.dead,
      master: a?.graph.master.gain.value, fade: a?.graph.fade.gain.value,
      layers: a ? Object.fromEntries(Object.entries(a.graph.layers).map(([name, node]) => [name, node.gain.value])) : {},
      played: a ? { ...a.played } : {}, muted: window.__pa.settings.get('muted'),
      toast: document.getElementById('toast').textContent,
    };
  });
  const sky = (o = {}) => ({ phase: 0.5, light: 1, overcast: 0, rain: 0, weather: 'clear', ...o });

  try {
    // The recipes, offline
    soundMix(check);
    const lab = await open('?debug&new&mode=survival');
    await ready(lab.page);
    await lab.page.evaluate(() => window.__pa.gameLoop.stop());
    const numbers = await soundLab(lab.page);
    judgeLab(numbers, check, info);

    // Survival, muted at the start, with the clock in our hands: every call to updateAudio re-aims at once
    const A = await open('?debug&new&mode=survival', { muted: true });
    const page = A.page;
    await ready(page);
    await pause(1000);   // the frame loop runs for a moment first: the sound has not been asked for, and must not stir
    const [fadeIn, every, glide] = await page.evaluate(() => { const { CONFIG } = window.__pa; return [CONFIG.AUDIO_FADE_IN, CONFIG.AUDIO_UPDATE_MS, CONFIG.AUDIO_GLIDE]; });   // the ticket's numbers, before they are changed to keep this short
    check(fadeIn >= 2 && fadeIn <= 5, `the sound comes up over ${fadeIn} s, wanted about 3`);
    check(every >= 100 && every <= 500, `the layers are re-aimed every ${every} ms, wanted about 250`);
    check(glide >= 0.4 && glide <= 1.6, `a layer takes ${glide} s to settle on a new loudness, wanted about 0.8`);
    await page.evaluate(fade => {
      const { gameLoop, director, CONFIG } = window.__pa;
      gameLoop.stop();
      director.auto = false;
      Object.assign(CONFIG, { AUDIO_UPDATE_MS: 0, AUDIO_GLIDE: 0.01, AUDIO_FADE_IN: fade });
    }, FADE_IN);

    // Before anyone has touched the page
    await page.mouse.move(400, 300);   // moving the mouse is not a gesture
    await pause(300);
    let s = await sound(page);
    check(s.contexts === 0 && !s.made, `the sound started before any click or key: ${s.contexts} audio contexts`);
    check(!(await page.evaluate(() => window.__pa.audio.playSfx('place'))), 'an effect played before any click or key');

    // The first key makes the context, and only the one is ever made. Muted, it goes to sleep
    await page.keyboard.press('Shift');
    await page.waitForFunction(() => window.__pa.audio.audioGraph(), null, { timeout: 5000 });
    await page.keyboard.press('Shift');
    await page.keyboard.press('Control');
    await asleep(page);
    s = await sound(page);
    check(s.contexts === 1, `${s.contexts} audio contexts after three key presses, wanted the one`);
    check(s.master < 0.01 && s.fade === 0 && Object.values(s.layers).every(v => v === 0),
      `a muted start has a master volume of ${s.master}, a fade of ${s.fade} and layers at ${JSON.stringify(s.layers)}`);
    check(s.state === 'suspended' && !s.started, `a muted start has the context ${s.state} and started ${s.started}, wanted it asleep and not started`);
    check(!(await page.evaluate(() => window.__pa.audio.playSfx('place'))), 'an effect played while muted');

    // M turns the sound on, and the colony on screen brings it up from nothing
    const volume = await page.evaluate(() => window.__pa.settings.get('volume'));
    await page.keyboard.press('m');
    await running(page, 'when M turned it on');
    await masterIs(page, volume);
    s = await sound(page);
    check(!s.muted && /sound on/i.test(s.toast), `M on a muted start: muted is ${s.muted}, the toast says "${s.toast}"`);
    check(Math.abs(s.master - volume) < 0.03, `the master volume is ${s.master} after M, wanted the player's ${volume}`);
    check(s.fade === 0 && !s.started, `the sound came up before the colony asked for it: a fade of ${s.fade}, started ${s.started}`);
    check(!(await page.evaluate(() => window.__pa.audio.playSfx('place'))), 'an effect played before the colony was on screen');
    const ramp = await page.evaluate(async () => {
      const { audio, sim, camera } = window.__pa;
      const { ctx, graph } = audio.audioGraph();
      const make = ctx.createOscillator.bind(ctx);
      window.__oscillators = 0;
      ctx.createOscillator = () => { window.__oscillators++; return make(); };   // counts the chirps booked
      audio.updateAudio(sim, camera, 1);   // the first frame of the colony
      const t0 = ctx.currentTime, samples = [];
      for (const at of [0.15, 0.6, 1.8]) {   // by the audio clock, which the fade follows and which runs slow when the machine is busy
        for (const give = performance.now() + 8000; ctx.currentTime - t0 < at && performance.now() < give; ) await new Promise(done => setTimeout(done, 5));
        samples.push(graph.fade.gain.value);
      }
      return { started: audio.audioGraph().started, samples };
    });
    const [early, midway, late] = ramp.samples;
    check(ramp.started, 'the first frame of the colony did not start the sound');
    check(early < 0.5 && midway > early && midway < 0.97 && late > 0.99,
      `the fade-in is at ${ramp.samples.map(v => v.toFixed(2)).join(', ')} after 0.15, 0.6 and 1.8 s of a ${FADE_IN} s fade`);

    // The night, birds and soil layers have only the short events booked into them for input, and Chromium
    // stops updating the value of a gain that nothing has played into for a while: a layer on its way down
    // would be read at the level it had when its last chirp or click died away. A source of silence keeps
    // them awake. (It changes nothing that is heard.)
    await page.evaluate(() => {
      const { ctx, graph } = window.__pa.audio.audioGraph();
      for (const node of Object.values(graph.layers)) {
        const keep = ctx.createConstantSource();
        keep.offset.value = 0;
        keep.connect(node);
        keep.start();
      }
    });

    // The layers follow the sky and the camera. What each should be is worked out here from CONFIG
    const dawn =(C.AUDIO_BIRDS_FROM + C.AUDIO_BIRDS_TO) / 2;
    const want = (o = {}) => ({ wind: C.AUDIO_WIND, rain: 0, night: 0, birds: 0, soil: 0, ...o });
    const sky0 = { zoom: 1, topRow: 0 };   // the camera looks along the top of the ground
    const scenes = [
      { name: 'a clear noon', sky: sky(), look: sky0, want: want(), chirps: false },
      { name: 'a rainy afternoon', sky: sky({ overcast: 1, rain: 1, weather: 'rain', light: 0.5 }), look: sky0,
        want: want({ wind: C.AUDIO_WIND + C.AUDIO_WIND_OVERCAST, rain: C.AUDIO_RAIN, night: 0.5 * C.AUDIO_NIGHT }) },
      { name: 'dusk', sky: sky({ phase: 0.8, light: 0 }), look: sky0, want: want({ night: C.AUDIO_NIGHT }), chirps: true },
      { name: 'dawn', sky: sky({ phase: dawn, light: 0.5 }), look: sky0, want: want({ night: 0.5 * C.AUDIO_NIGHT, birds: C.AUDIO_BIRDS }) },
      { name: 'a clouded dawn', sky: sky({ phase: dawn, light: 0.5, overcast: 0.5, weather: 'gathering' }), look: sky0,
        want: want({ wind: C.AUDIO_WIND + 0.5 * C.AUDIO_WIND_OVERCAST, night: 0.5 * C.AUDIO_NIGHT }) },
      { name: 'deep in the soil', sky: sky(), look: { zoom: 1, topRow: C.SURFACE_ROW + 4 * C.AUDIO_BURY_ROWS },
        want: want({ wind: C.AUDIO_WIND * C.AUDIO_WIND_BURIED }) },
      { name: 'a digger in close view', sky: sky(), look: { zoom: 3 }, dig: true, want: { rain: 0, night: 0, birds: 0, soil: C.AUDIO_SOIL } },
      { name: 'a digger from afar', sky: sky(), look: { zoom: 1 }, dig: true, want: { soil: 0 } },
      { name: 'a digger out of view', sky: sky(), look: { zoom: 3, away: 300 }, dig: true, want: { soil: 0 } },
    ];
    for (const sc of scenes) {
      const got = await page.evaluate(async ({ sc, STATE }) => {
        const { audio, sim, camera, CONFIG } = window.__pa;
        const ants = sim.antSystem.ants, lead = ants[0];
        Object.assign(sim.sky, sc.sky);
        for (const ant of ants) ant.state = STATE.IDLE;
        if (sc.dig) lead.state = STATE.DIGGING;
        camera.fitted = false;
        camera.zoom = sc.look.zoom;
        camera.x = (lead.x + (sc.look.away ?? 0)) * CONFIG.TILE_SIZE;
        camera.y = sc.look.topRow === undefined ? lead.y * CONFIG.TILE_SIZE : sc.look.topRow * CONFIG.TILE_SIZE + camera.cy / camera.zoom;
        window.__oscillators = 0;
        const off = layers => Object.entries(sc.want).filter(([name, v]) => Math.abs(layers[name] - v) > 0.004 + 0.05 * v);
        const t0 = performance.now();
        let layers;
        do {   // as the frame loop would: aim, wait a moment, aim. Long enough to hear whether chirps were booked, and, if the machine is busy and the audio clock slow, for the levels to arrive
          audio.updateAudio(sim, camera, 1);
          await new Promise(done => setTimeout(done, 100));
          layers = {};
          for (const [name, node] of Object.entries(audio.audioGraph().graph.layers)) layers[name] = node.gain.value;
        } while (performance.now() - t0 < (sc.chirps === undefined ? 300 : 1600)
          || ((off(layers).length || (sc.chirps === true && window.__oscillators < 3)) && performance.now() - t0 < 5000));
        return { layers, off: off(layers), oscillators: window.__oscillators };
      }, { sc, STATE });
      const off = got.off;
      check(off.length === 0, `${sc.name}: ${off.map(([name, v]) => `${name} is ${got.layers[name].toFixed(3)}, wanted ${v.toFixed(3)}`).join('; ')}`);
      if (sc.chirps === true) check(got.oscillators >= 3, `${sc.name}: no chirps were booked`);
      if (sc.chirps === false) check(got.oscillators === 0, `${sc.name}: ${got.oscillators} oscillators were made, wanted a quiet day`);
    }

    // The effects: where and when they play, and the game's own events that call for them
    const fx = await page.evaluate(async ({ TS }) => {
      const { audio, sim, camera, hud } = window.__pa;
      const { emit } = await import('/src/events.js');
      const { heardAt } = await import('/src/audio/mix.js');
      const wait = ms => new Promise(done => setTimeout(done, ms));
      const later = async seconds => {   // by the audio clock, which holds an effect off for a gap and runs slow when the machine is busy
        const { ctx } = audio.audioGraph(), end = ctx.currentTime + seconds, give = performance.now() + 5000;
        while (ctx.currentTime < end && performance.now() < give) await wait(10);
      };
      const played = () => ({ ...audio.audioGraph().played });
      const at = (x, y) => ({ x, y });
      const out = {};
      camera.fitted = false; camera.zoom = 3; camera.x = 100 * TS; camera.y = 60 * TS;   // close in on the tile (100, 60)
      audio.updateAudio(sim, camera, 1);   // it is told where the camera is
      out.place = [audio.playSfx('place'), audio.playSfx('place')];   // twice in the same instant: once
      await later(0.1);
      out.place.push(audio.playSfx('place'));
      out.unknown = audio.playSfx('nonsense');
      out.unlock = audio.playSfx('unlock');
      const pans = [], hatch = audio.SFX.hatch;   // where each hatching that plays is heard from
      audio.SFX.hatch = (g, when, pan) => { pans.push(pan); return hatch(g, when, pan); };
      out.hatchNear = audio.playSfx('hatch', at(80, 60));   // twenty tiles left of the middle of the screen
      await later(0.1);   // one at a time, so that it is the place that decides and not the gap between two effects
      out.hatchFar = audio.playSfx('hatch', at(700, 60));
      await later(0.1);
      camera.zoom = 1;
      audio.updateAudio(sim, camera, 1);
      out.hatchWide = audio.playSfx('hatch', at(100, 60));   // zoomed out: too far off to hear
      camera.zoom = 3;
      audio.updateAudio(sim, camera, 1);
      await later(0.1);
      const before = played();
      emit('hatch', at(120, 60));   // twenty tiles right of the middle
      await later(0.1);
      emit('hatch', at(700, 60));
      emit('rainStart');
      const after = played();
      audio.SFX.hatch = hatch;
      out.pans = { heard: pans, wanted: [heardAt(camera, 80, 60), heardAt(camera, 120, 60)] };
      out.bus = { hatch: (after.hatch ?? 0) - (before.hatch ?? 0), thunder: (after.thunder ?? 0) - (before.thunder ?? 0) };
      await later(0.1);
      const placed = played().place;   // and the player dropping food
      for (let x = 60; x < 140 && played().place === placed; x++) { hud.controls.handleTileClick(x, 10, sim.world); await wait(20); }
      out.hook = played().place > placed;
      await later(0.1);
      const watered = played().place;   // and water
      hud.controls.activeTool = 'water';
      for (let x = 70; x < 140 && played().place === watered; x++) { hud.controls.handleTileClick(x, 10, sim.world); await wait(20); }
      out.waterHook = played().place > watered;
      hud.controls.activeTool = 'food';
      out.played = played();
      return out;
    }, { TS });
    check(fx.place.join() === 'true,false,true', `place played ${fx.place.join()}: once, not twice in an instant, and again a moment later`);
    check(fx.unknown === false && fx.unlock === true, `an unknown effect gave ${fx.unknown}, unlock gave ${fx.unlock}`);
    check(fx.hatchNear === true && fx.hatchFar === false && fx.hatchWide === false,
      `a hatching was heard ${fx.hatchNear} up close, ${fx.hatchFar} off screen and ${fx.hatchWide} from afar`);
    check(fx.bus.hatch === 1 && fx.bus.thunder === 1, `the game's events played ${fx.bus.hatch} hatchings (of one near, one far) and ${fx.bus.thunder} claps of thunder (of one rainStart)`);
    check(fx.pans.heard.length === 2 && fx.pans.heard[0] < -0.1 && fx.pans.heard[1] > 0.1 && fx.pans.heard.every((p, i) => Math.abs(p - fx.pans.wanted[i]) < 0.05),
      `hatchings twenty tiles left and right of the middle of the screen were heard from ${JSON.stringify(fx.pans.heard)}, wanted ${JSON.stringify(fx.pans.wanted)}`);
    check(fx.hook, 'dropping food did not play the sound of it');
    check(fx.waterHook, 'dropping water did not play the sound of it');
    const total = { place: 4, unlock: 1, hatch: 2, thunder: 1 };
    check(Object.keys(total).every(name => fx.played[name] === total[name]) && Object.keys(fx.played).length === 4,
      `effects played ${JSON.stringify(fx.played)}, wanted ${JSON.stringify(total)}`);

    // A recording in place of a layer (the hook for assets/audio/): it takes over, and a bad one changes nothing
    const rec = await page.evaluate(async () => {
      const { audio } = window.__pa;
      const { graph } = audio.audioGraph();
      const wav = (frames, rate) => {   // a mono 16-bit file of a tone
        const bytes = new ArrayBuffer(44 + frames * 2), v = new DataView(bytes);
        const tag = (at, text) => [...text].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
        tag(0, 'RIFF'); v.setUint32(4, 36 + frames * 2, true); tag(8, 'WAVEfmt ');
        v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        tag(36, 'data'); v.setUint32(40, frames * 2, true);
        for (let i = 0; i < frames; i++) v.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 12000), true);
        return bytes;
      };
      const good = URL.createObjectURL(new Blob([wav(4000, 8000)], { type: 'audio/wav' }));
      const bad = URL.createObjectURL(new Blob([new Uint8Array(500).fill(7)], { type: 'audio/wav' }));
      let ended = false;
      graph.sources.wind.onended = () => { ended = true; };
      const out = {};
      out.unknown = await audio.useRecording('nonsense', good);
      out.bad = await audio.useRecording('rain', bad);
      out.rainRecorded = graph.recorded.has('rain');
      out.good = await audio.useRecording('wind', good);
      for (const give = performance.now() + 5000; !ended && performance.now() < give; ) await new Promise(done => setTimeout(done, 20));   // it ends on the audio thread
      out.windRecorded = graph.recorded.has('wind');
      out.madeSoundStopped = ended;
      return out;
    });
    check(rec.unknown === false && rec.bad === false && !rec.rainRecorded, `a recording that could not be used gave ${rec.unknown} and ${rec.bad}, and recorded rain ${rec.rainRecorded}`);
    check(rec.good === true && rec.windRecorded && rec.madeSoundStopped, `a recording of the wind: took over ${rec.good}, recorded ${rec.windRecorded}, the made wind stopped ${rec.madeSoundStopped}`);

    // M mutes, with a word on screen, and holding it down is one press, not several (a held key repeats). A muted or unseen page is silent, and asleep
    await page.keyboard.down('m');
    await page.keyboard.down('m');
    await page.keyboard.up('m');
    await pause(150);
    s = await sound(page);
    check(s.muted && /sound off/i.test(s.toast), `M held down: muted is ${s.muted}, the toast says "${s.toast}"`);
    await shot(page, 'sound-muted');
    await asleep(page);
    s = await sound(page);
    check(s.master < 0.01 && s.state === 'suspended', `muted, the master volume is ${s.master} and the context ${s.state}`);
    check(!(await page.evaluate(() => window.__pa.audio.playSfx('place'))), 'an effect played while muted');
    await page.keyboard.press('m');
    await running(page, 'when M turned it on again');
    await masterIs(page, volume);
    s = await sound(page);
    check(!s.muted && /sound on/i.test(s.toast) && Math.abs(s.master - volume) < 0.03, `M again: muted is ${s.muted}, the toast says "${s.toast}", the master volume is ${s.master}`);
    // Just muted, the context is awake for another 0.4 s before it sleeps, and the setting alone must keep an effect quiet
    const hush = await page.evaluate(() => {
      const { audio, settings } = window.__pa;
      const { ctx } = audio.audioGraph();
      settings.set('muted', true);
      const out = { state: ctx.state, played: audio.playSfx('place') };
      settings.set('muted', false);   // all in one breath: the context never gets to sleep
      return out;
    });
    check(hush.state === 'running' && hush.played === false, `an effect asked for just after M muted the sound: the context is ${hush.state} and it played ${hush.played}, wanted it awake and quiet`);
    await masterIs(page, volume);
    await page.evaluate(() => window.__pa.settings.set('volume', 0.25));
    await masterIs(page, 0.25);
    check(Math.abs((await sound(page)).master - 0.25) < 0.03, 'the volume setting does not move the master volume');
    await page.evaluate(v => window.__pa.settings.set('volume', v), volume);
    const hide = hidden => page.evaluate(h => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await hide(true);
    await till(page, () => window.__pa.audio.audioGraph().ctx.state === 'suspended');
    check((await sound(page)).state === 'suspended', 'a hidden tab keeps its sound running');
    await hide(false);
    await running(page, 'when the tab came back');

    // The end of a colony is heard once
    await page.evaluate(() => { window.__pa.gameLoop.start(); window.__pa.sim.queen.health = -1e9; });   // she heals a little every tick, so well below nothing
    await page.waitForFunction(() => window.__pa.GameState.over, null, { timeout: 10_000 });
    await pause(300);
    s = await sound(page);
    check(s.played.gameover === 1, `the end of the colony played ${s.played.gameover ?? 0} game-over sounds, wanted one`);

    // The screensaver, started with a click on the menu, and the real frame loop doing the aiming
    const B = await open('?debug');
    const pb = B.page;
    await pb.waitForSelector('#btn-mode-screensaver', { timeout: 20_000 });
    check((await pb.evaluate(() => window.__contexts)) === 0, 'the menu made an audio context before anyone clicked');
    await pb.click('#btn-mode-screensaver');
    await ready(pb);
    await pb.waitForFunction(() => window.__pa.audio.audioGraph()?.started, null, { timeout: 15_000 });
    s = await sound(pb);
    check(s.contexts === 1, `${s.contexts} audio contexts after a click on the menu, wanted the one`);
    check(Object.keys(s.played).length === 0, `effects played while the colony was being founded: ${JSON.stringify(s.played)}`);
    await pb.evaluate(() => {
      const { gameLoop, director, CONFIG, camera } = window.__pa;
      director.auto = false;
      gameLoop.setSpeed(0);   // no ticks, but every frame is drawn, and the sound is aimed
      CONFIG.AUDIO_GLIDE = 0.15;
      camera.fitted = false; camera.zoom = 1; camera.x = 200 * CONFIG.TILE_SIZE; camera.y = camera.cy;   // the sky in view
    });
    const weather = o => pb.evaluate(o => Object.assign(window.__pa.sim.sky, o), o);
    const level = ms => pb.evaluate(async ms => {   // the loudness of what is coming out, over `ms`
      const { graph, ctx } = window.__pa.audio.audioGraph();
      if (!window.__analyser) {   // the left ear only, as the lab hears it: an analyser mixes the ears down, which takes a third off noise that differs between them
        const left = ctx.createChannelSplitter(2);
        window.__analyser = ctx.createAnalyser();
        window.__analyser.fftSize = 2048;
        graph.limiter.connect(left);
        left.connect(window.__analyser, 0);
      }
      const an = window.__analyser, buf = new Float32Array(an.fftSize);
      let energy = 0, n = 0;
      for (const end = performance.now() + ms; performance.now() < end; await new Promise(done => setTimeout(done, 40))) {
        an.getFloatTimeDomainData(buf);
        for (const v of buf) { energy += v * v; n++; }
      }
      return Math.sqrt(energy / n);
    }, ms);
    await weather(sky());
    await till(pb, () => window.__pa.audio.audioGraph().graph.fade.gain.value > 0.99);   // the fade-in is over
    await pause(2000);
    const noon = await level(2000);
    await weather(sky({ overcast: 1, rain: 1, weather: 'rain', light: 0.5 }));
    await pause(1500);
    const rain = await level(2000);
    info.push(`live level ${noon.toFixed(3)} in the day, ${rain.toFixed(3)} in the rain`);
    check(noon > 0.004, `a clear noon is silent: a level of ${noon.toFixed(4)}`);
    check(rain > 1.5 * noon, `the rain is ${(rain / noon).toFixed(1)}× the level of a clear noon, wanted at least 1.5`);
    check(noon > numbers.scenes.noon.rms / 2 && noon < numbers.scenes.noon.rms * 2,
      `a clear noon has a level of ${noon.toFixed(3)} on the page and ${numbers.scenes.noon.rms.toFixed(3)} in the lab`);

    // A colony that is paused is not heard digging, though the diggers are in view: the frame loop tells the sound the speed
    const still = await pb.evaluate(async ({ STATE }) => {
      const { audio, sim, camera, CONFIG } = window.__pa;
      const { watchView } = await import('/src/audio/mix.js');
      const { ctx } = audio.audioGraph();
      const ants = sim.antSystem.ants, lead = ants[0];
      for (const ant of ants) { ant.state = STATE.DIGGING; ant.x = lead.x; ant.y = lead.y; }
      camera.fitted = false; camera.zoom = 3; camera.x = lead.x * CONFIG.TILE_SIZE; camera.y = lead.y * CONFIG.TILE_SIZE;
      const make = ctx.createBufferSource.bind(ctx);
      let clicks = 0;
      ctx.createBufferSource = () => { clicks++; return make(); };   // every soil click is one
      await new Promise(done => setTimeout(done, 1500));
      ctx.createBufferSource = make;
      const diggers = watchView(sim, camera).diggers.length;
      for (const ant of ants) ant.state = STATE.IDLE;
      return { diggers, clicks };
    }, { STATE });
    check(still.diggers >= 5 && still.clicks === 0, `${still.clicks} soil clicks were booked in 1.5 s with the colony paused and ${still.diggers} diggers in view, wanted none (and at least five diggers)`);

    // A sound that breaks must not take the game with it, and says so once
    await pb.evaluate(() => window.__pa.gameLoop.setSpeed(1));
    const ticks = () => pb.evaluate(() => window.__pa.sim.world.tick);
    const t0 = await ticks();
    await pb.evaluate(() => {
      window.__pa.audio.audioGraph().graph.layers.wind.gain.setTargetAtTime = () => { throw new Error('the sound broke'); };
    });
    await pause(1500);
    await till(pb, () => { const a = window.__pa.audio.audioGraph(); return a.dead && a.ctx.state === 'closed'; });
    s = await sound(pb);
    const t1 = await ticks();
    check(s.dead && s.state === 'closed', `a sound that threw: dead ${s.dead}, context ${s.state}`);
    check(t1 - t0 > 30, `the game ran ${t1 - t0} ticks in the 1.5 s after the sound broke, wanted it to carry on`);
    const stopped = B.seen.filter(e => e.includes('Sound stopped:'));
    check(stopped.length === 1, `${stopped.length} reports of the sound stopping, wanted one`);
    B.seen.splice(0, B.seen.length, ...B.seen.filter(e => !e.includes('Sound stopped:')));   // the one that was wanted
    await pb.keyboard.press('m');
    check(!(await pb.evaluate(() => window.__pa.audio.playSfx('place'))), 'an effect played after the sound broke');

    // A browser with no WebAudio: the game does not notice
    const D = await open('?debug&new&mode=survival', { webAudio: false });
    await ready(D.page);
    const d0 = await D.page.evaluate(() => window.__pa.sim.world.tick);
    await D.page.keyboard.press('Shift');
    await D.page.keyboard.press('m');
    await pause(1500);
    const d = await D.page.evaluate(() => ({
      graph: window.__pa.audio.audioGraph(), place: window.__pa.audio.playSfx('place'), tick: window.__pa.sim.world.tick,
      muted: window.__pa.settings.get('muted'), toast: document.getElementById('toast').textContent,
    }));
    check(d.graph === null && d.place === false, 'a browser with no WebAudio has a sound');
    check(d.tick - d0 > 30, `the game ran ${d.tick - d0} ticks in 1.5 s with no WebAudio, wanted it to carry on`);
    check(d.muted && /sound off/i.test(d.toast), `M with no WebAudio: muted is ${d.muted}, the toast says "${d.toast}"`);
  } catch (e) {
    problems.push(`stopped: ${e.message}`);
  }
  problems.push(...errors.flat());
  for (const c of contexts) await c.close();
  report('sound', problems, info.join(', '));
}

try {
  if (wanted('boot')) await runBoot();
  if (wanted('title')) await runTitle();
  if (wanted('crash')) await runCrash();
  if (wanted('settings')) await runSettings();
  if (wanted('settingsmenu')) await runSettingsMenu();
  if (wanted('pause')) await runPause();
  if (wanted('saves')) await runSaves();
  if (wanted('events')) await runEvents();
  if (wanted('moments')) await runMoments();
  if (wanted('fastforward')) await runFastForward();
  if (wanted('performance')) await runPerformance();
  if (wanted('sound')) await runSound();
  for (const mode of MODES) if (wanted(mode)) await runMode(mode);
} finally {
  await browser.close();
  server.close();
}
console.log(`${anyFailed ? 'FAILED' : 'All passed'}${only.length ? ` (just ${only.join(', ')})` : ''} - screenshots in tests/out/`);
process.exit(anyFailed ? 1 : 0);
