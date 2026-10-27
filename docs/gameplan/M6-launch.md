# M6 — Launch

Demo gating, offline support, store assets, page copy and the final QA run. Most of this
is `[H]`. Anything that spends money or publishes (itch.io page going live, Steam fee,
code signing) is the user's call — prepare it, don't do it.

---

## T6.1 [H] Edition flag + demo gating

**Create `src/edition.js`:**
```js
// The web demo ships with 'demo'. Release builds (tools/make-release.mjs, desktop/)
// rewrite this line to 'full'. Keep it exactly one line — the scripts replace it.
export const EDITION = 'demo';
export const isFull = () => EDITION === 'full';
export const STORE_URL = 'https://<itch-page-url>';   // set when the store page exists
```
1. Title screen: in the demo, the Keeper and Survival cards show a small "Full version"
   ribbon; clicking opens a `#buy` dialog: what the full version adds (Keeper, Survival,
   4 more themes, desktop screensaver, future updates), price $3.99, a **Get it** button
   (`window.open(STORE_URL)`) and **Keep watching** (back to the menu).
2. `main.js`: in the demo, if the URL asks for another mode without `?debug`, fall back to
   Zen.
3. Settings theme select: themes other than `classic` show 🔒 in the demo and open `#buy`.
4. Zen in the demo is complete and unlimited — no nags, no timers, no watermark. One
   subtle "Get the full version" link in the pause menu only.

**Done when:** demo = Zen + Classic only, with tasteful upsell points; flipping the flag to
`'full'` locally unlocks everything; `npm test` still passes (it uses `?debug`).

---

## T6.2 [H] Offline web demo (service worker)

1. `sw.js` at the repo root: a cache named `pixelants-<version>`; on `fetch`, answer from
   the cache, otherwise fetch from the network and put a copy in the cache; on `activate`,
   delete caches with other names.
2. Register it in `main.js` only when `location.protocol === 'https:'` (never on
   localhost — stale caches confuse development).
3. **The cache name must change every release.** Put `const CACHE = 'pixelants-0.9.0';`
   in `sw.js` and add a check to `tests/smoke.mjs` that it matches `src/version.js`.
4. `manifest.json`: name/description to match the final name; `"display": "fullscreen"`
   is nicer for a screensaver install.

**Done when:** on the deployed site, after one visit, the game loads with the network off
(DevTools → Network → Offline), and can be installed as an app from the address bar.

---

## T6.3 [H] Store screenshots + trailer capture

**Create `tests/shots.mjs`** (Playwright, 1920×1080, `?debug`):
- Shots to `tests/out/store/`: Zen noon wide; Zen night; Zen rain; nuptial flight;
  queen close-up (`camera` zoom on `sim.queen`); each theme (T2.3); Keeper farm with
  decorations (place a few via `__pa.sim.decor`); Survival with a threat pill and the
  cards dialog; the title screen.
- Set the moment through debug hooks: `sky.time` for time of day
  (`day * DAY_TICKS + phase * DAY_TICKS`), rain by setting `sky._nextRain = sky.time`,
  pregrow a big colony with `fastForward` (T1.1).
- Trailer: a Playwright context with `recordVideo: { dir, size: { width: 1920, height:
  1080 } }`, open `?zen`, speed 2, record 90 s. Output `.webm` for the user to cut.
- itch.io cover 630×500 and a ≤ 3 MB GIF are made from these by the user (or with
  ffmpeg if installed: `ffmpeg -i in.webm -vf "fps=15,scale=640:-1" out.gif`).

**Done when:** `node tests/shots.mjs` produces every shot listed, all clean (no debug
overlays, no tutorial).

---

## T6.4 [H] Store page copy, press kit, credits, privacy

Create `docs/store/`:
1. `itch.md` — page text: title, one-line tagline ("A living ant farm for your screen."),
   short description, the three modes as bullets, feature bullets (day/night, weather,
   seasons, themes, real screensaver for Windows, offline, no ads, no tracking), controls
   list, system requirements, price $3.99, link to the free web demo.
2. `presskit.md` — fact sheet (developer, release date, platforms, price), description,
   feature list, screenshot list, contact (ask the user what to put).
3. Privacy line, used in credits and the store page: "Pixel Ants collects no data. Your
   colonies are saved only on your device."
4. Ask the user before adding a `LICENSE` — the repo is public; "All rights reserved" vs
   an open license is their decision.

**Done when:** the user has copy they can paste into itch.io.

---

## T6.5 [H] Launch QA checklist

Run all of this; write results into `docs/store/qa-<version>.md`.

- [ ] `npm test` passes; 30-day Zen soak passes; 8-hour real-time run passes (T1.8)
- [ ] Chrome, Edge, Firefox on Windows; Safari + Chrome on macOS: every mode starts,
      saves, resumes; sound starts after the first click
- [ ] 1366×768 laptop, 1920×1080, 2560×1440, 4K, and a phone-size window: nothing
      overlaps, text readable
- [ ] Low-end laptop: fps at 300 ants with quality High and Low
- [ ] Desktop app: install, run, uninstall; `.scr` on 1 and 2 monitors; exits on mouse
      move; settings via Configure
- [ ] Offline: web demo loads offline after one visit
- [ ] Old save from the previous release resumes (keep one saved colony per release in
      `tests/fixtures/` and load it in the smoke test)
- [ ] Demo shows only Zen + Classic; the full zip has everything
- [ ] Every text a player sees is spelled right and uses the final name
