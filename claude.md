# Pixel Ants — Claude Code Instructions

A pixel-art ant farm: a living screensaver (Zen), a casual sandbox (Keeper) and a
survival game. Vanilla JavaScript ES modules + Canvas, served as static files.
Live demo: https://pixelant.netlify.app/ (auto-deploys from `master`).

## The plan
Work comes from `docs/gameplan/`. Start at `docs/gameplan/README.md`, pick the next
unticked ticket, and read ONLY that milestone's file. Do one ticket at a time.

## Rules
* Never use the 1M context tool. Keep context usage small.
* Do not read `src/simulation/ants.js` or `src/simulation/world.js` whole (1,300+ lines
  each). Grep for the function the ticket names and read around it.
* Use targeted file reads and edits. Match the style of the surrounding code.
* The game ships as plain static files: no build step, no bundler, no TypeScript, no
  framework, no runtime dependencies. Dev-only tools (`package.json` devDependencies such
  as Playwright, and the `desktop/` Electron wrapper) are allowed but the game must never
  import them.
* Tunable numbers go in `src/config.js` (`CONFIG`), not inline.
* Mode-specific behaviour goes through `rules()` from `src/modes.js` — never add new
  `GameState.mode === '...'` checks; add a field to the mode's row instead.
* Player options (volume, frame cap, theme, …) live in `src/settings.js`: read with
  `settings.get(key)`, react with `settings.onChange`. Add a new option to its `DEFAULTS`
  rather than adding another localStorage key. A default that depends on the mode (the frame
  cap) is a field in the mode's row in `src/modes.js`, offered with `settings.setDefault`, which
  never stores it and never overrides what the player chose. Each option also has a row in the
  settings dialog (`#settings` in `index.html`: a control with `data-setting="key"` is all
  `src/ui/settingsMenu.js` needs), `hidden` until something reads the option; the `settingsmenu`
  check in `tests/smoke.mjs` fails for an option with no row and for a visible row it doesn't work.
* Sound is made with WebAudio in `src/audio/`: no sound files. A new effect is a function in `SFX` in
  `audio.js`, played with `playSfx(name)`; what makes a layer louder or quieter is in `mix.js`, and the
  numbers are `AUDIO_*` in `CONFIG`. It is optional: `playSfx` and `updateAudio` do nothing before the
  first click or when WebAudio is missing, and anything that throws inside them is caught (`guard`), so
  never call the audio context from anywhere else in the frame.
* If you change what a save contains, follow the save rules in `src/saveLoad.js` (bump
  VERSION and add a migration) so existing colonies still load. `tests/fixtures/` holds a real
  old save that `npm test` must keep resuming.
* Preserve the playable game. After every change:
  1. `npm test` (smoke test: every mode loads, runs, throws no errors)
  2. Look at the screenshots it writes to `tests/out/` to check visuals.
* `npm run serve` starts a local server. Add `?debug` to the URL to get `window.__pa`
  (`sim`, `gameLoop`, `camera`, `renderer`, `director`, `hud`, `GameState`, `CONFIG`, `settings`, `audio`
  (`src/audio/audio.js`: `audioGraph()` shows the live context and what has played), and
  `startup`: what the start-up fast-forward did), a frame-rate read-out at the top left, and to skip
  the tutorial; `window.__pa` appears once the colony is ready, so wait for it.
  `?debug&new&mode=<mode>` also skips the menu and starts a fresh colony.
* `npm run perf` reports the processor time the browser uses at each frame cap and quality (about
  two minutes; headless Chromium, so read the ratios, not the percentages). Run it after touching
  the render loop or the renderer, and don't run it while `npm test` is running.
* Pushing to `master` publishes to the live site. Work on a branch per ticket; merge to
  `master` only when the user asks.
