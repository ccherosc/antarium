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
  rather than adding another localStorage key.
* If you change what a save contains, follow the save rules in `src/saveLoad.js` (bump
  VERSION and add a migration) so existing colonies still load.
* Preserve the playable game. After every change:
  1. `npm test` (smoke test: every mode loads, runs, throws no errors)
  2. Look at the screenshots it writes to `tests/out/` to check visuals.
* `npm run serve` starts a local server. Add `?debug` to the URL to get `window.__pa`
  (`sim`, `gameLoop`, `camera`, `director`, `hud`, `GameState`, `CONFIG`, `settings`) and skip the
  tutorial; `?debug&new&mode=<mode>` also skips the menu and starts a fresh colony.
* Pushing to `master` publishes to the live site. Work on a branch per ticket; merge to
  `master` only when the user asks.
