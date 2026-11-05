# Pixel Ants — Commercial Gameplan

Goal: turn the current build into a **$3.99 product** with three ways to play:

| Mode | Pitch | Status today |
|---|---|---|
| **Zen** (screensaver) | "A living ant farm for your screen." Leave it running for hours; it never dies, always has something to watch. The hero product. | Works (`screensaver` mode, director camera, day/night, weather) |
| **Keeper** (casual) | "Your farm, your way." Add food, decorations and soil; unlock items as the colony grows. | Not built |
| **Survival** | "Keep them alive." Limited supplies, droughts, raiders and cold snaps; pick upgrades each dawn; scored runs. | Basic (queen can die, game-over screen) |

---

## How to work through this plan (read this first, every session)

1. Open this file, find the **first unticked ticket** in the checklist below.
2. Read **only** that milestone's file (`M0-foundations.md`, …). Each ticket says which
   files to touch, the steps, and how to know it's done.
3. Make a branch `t<ticket>-short-name`, implement, run `npm test`, look at
   `tests/out/*.png`, commit with the ticket id in the message.
4. Tick the box here in the same commit.
5. Don't merge to `master` unless the user asks — `master` deploys live.

**Model tags.** `[H]` = Haiku can do it: UI, HTML/CSS, config, copy, small new modules
with a clear spec. `[S]` = use Sonnet: touches the simulation (`ants.js`, `world.js`,
`queen.js`), cross-cutting refactors, performance, packaging. If a `[H]` ticket turns out
to need changes in `ants.js`/`world.js`, stop and hand it to Sonnet.

**Dependencies.** Do M0 first — every later ticket assumes the test harness (T0.2), the
mode rules table (T0.3), settings (T0.4) and save migrations (T0.5) exist. After M0,
M1–M5 can be interleaved; the order below is the recommended one.

---

## What "commercial grade" means here (the bar every ticket is held to)

- Runs **8 hours** unattended with no crash, slowdown or memory growth.
- **60 fps** with 300 ants on a 2019-era laptop; under ~15% CPU in Zen at the 30 fps cap.
- Never shows a black screen or a raw error. Saves survive refresh, tab close and crash.
- The **first 30 seconds** look great (a new Zen colony starts already busy).
- Readable at 1080p and 4K. Every action is reachable by mouse and keyboard.
- Has sound (that can be muted), settings, a pause menu, credits.

---

## Product decisions (already made — don't re-decide in tickets)

- **Price:** $3.99 one-time. No ads, no in-app purchases, no accounts, no server.
- **Editions:** the web build on Netlify is the **free demo** — Zen mode with the Classic
  theme. The **full** edition adds Keeper, Survival, all themes, and the desktop/
  screensaver build. Controlled by one flag in `src/edition.js` (T6.1). No DRM: at $3.99
  goodwill + convenience beats copy protection.
- **Where to sell:** itch.io first (no upfront fee; sells HTML + desktop downloads). Steam
  second, once there are reviews (one-off app fee). Optional later: Microsoft Store,
  mobile via Capacitor.
- **Desktop/screensaver:** Electron wrapper in `desktop/`, producing a Windows `.scr`
  screensaver and a normal app (M3). macOS gets the app; a true `.saver` is a stretch goal.
- **Name:** working title "Pixel Ants" (the repo is `antarium`). Pick the final name and
  check itch/Steam/app stores for clashes before M6.
- **Repo visibility:** the GitHub repo is public, so anyone could flip the edition flag.
  Acceptable at this price; make the repo private before launch if that matters (Netlify
  keeps deploying from a private repo).

---

## Ticket checklist

### M0 — Foundations (make the codebase safe for small models) → `M0-foundations.md`
- [x] T0.1 [H] Rewrite `claude.md` for this project
- [x] T0.2 [H] Debug hook, URL params, `package.json`, local server, smoke test
- [x] T0.3 [S] Mode rules table (`src/modes.js`) replacing scattered mode checks
- [x] T0.4 [H] Settings store (`src/settings.js`)
- [x] T0.5 [S] Save migrations + per-mode extra state
- [x] T0.6 [S] Soak test (100 in-game days, headless)
- [x] T0.7 [H] Tiny event bus (`on`/`emit`) in `src/events.js`

### M1 — Commercial polish → `M1-polish.md`
- [x] T1.1 [S] Fast-forward engine (instant catch-up + pre-grown new colonies)
- [x] T1.2 [S] Frame cap, power saving, pause when hidden
- [x] T1.3 [S] Ambient soundscape (WebAudio, driven by the sky)
- [x] T1.4 [H] Settings menu UI
- [x] T1.5 [H] Pause menu (Esc) and keyboard help (?)
- [x] T1.6 [H] Title screen polish, credits, version
- [x] T1.7 [H] Crash safety: error toast, save on close
- [ ] T1.8 [S] 8-hour stability pass (fix whatever the soak finds)
- [ ] T1.9 [H] Accessibility pass

### M2 — Zen screensaver features → `M2-zen.md`
- [ ] T2.1 [H] Screensaver URL mode (`?zen`) — straight in, no UI
- [ ] T2.2 [H] Clock / info overlay
- [ ] T2.3 [S] Farm themes (Classic, Desert Sand, Red Clay, Blue Gel, Night Glow)
- [ ] T2.4 [H] Photo mode (P)
- [ ] T2.5 [S] Seasons
- [ ] T2.6 [S] Director: cut to every story beat
- [ ] T2.7 [S] (Optional) Sky follows the real clock
- [x] T2.8 [S] Moments engine + director news queue + fireflies
- [x] T2.9 [S] Moments: earthworm, burrowing beetle
- [ ] T2.10 [S] Moments: mushroom bloom, storm flood
- [ ] T2.11 [S] Time-lapse: record the nest once a day
- [ ] T2.12 [H] Time-lapse: playback (T key, auto every 10 days)
- [ ] T2.13 [S] Ant life stories: the story keeper (names, beats, memorial)
- [ ] T2.14 [H] Ant life stories: captions, name tags, Stories dialog
- [ ] T2.15 [S] Music that follows the colony
- [ ] T2.16 [S] Live-wallpaper and stream URL modes (`?wallpaper`, `?stream`) — needs T2.1
- [ ] T2.17 [S] Wallpaper Engine + Lively packages — needs T3.3

### M3 — Desktop & real screensaver → `M3-desktop.md`
- [ ] T3.1 [S] Electron wrapper (`desktop/`) with `app://` protocol
- [ ] T3.2 [S] Windows `.scr` behaviour (`/s`, `/c`, `/p`), multi-monitor
- [ ] T3.3 [H] Release script → `dist/` zips
- [ ] T3.4 [S] Installer + "set as screensaver"; macOS app build

### M4 — Keeper mode (casual) → `M4-keeper.md`
- [ ] T4.1 [H] Add the `keeper` mode (menu button, rules, tutorial)
- [ ] T4.2 [S] Decorations: data, placement tool, rendering, save
- [ ] T4.3 [H] Keeper tool tray (hotbar)
- [ ] T4.4 [S] Food types (honey, apple, cricket, seeds)
- [ ] T4.5 [H] Milestones → unlocks + Collection screen
- [ ] T4.6 [H] Name the colony; ant cards + follow cam
- [ ] T4.7 [S] Soil choice for a new farm

### M5 — Survival game → `M5-survival.md`
- [ ] T5.1 [S] Run state (difficulty, tokens, mods, history) saved with the colony
- [ ] T5.2 [H] Supply tokens: limited food/water drops, refilled at dawn
- [ ] T5.3 [S] Threats framework + Drought, Cold Snap, Raiders
- [ ] T5.4 [H] Dawn upgrade cards (pick 1 of 3)
- [ ] T5.5 [H] Daily history, score, high scores, better game-over
- [ ] T5.6 [S] Alerts + director cuts to trouble
- [ ] T5.7 [S] Balance pass with a bot player
- [ ] T5.8 [S] Scenarios with star ratings

### M6 — Launch → `M6-launch.md`
- [ ] T6.1 [H] Edition flag + demo gating + "Get the full version"
- [ ] T6.2 [H] Offline web demo (service worker)
- [ ] T6.3 [H] Store screenshots + trailer capture script
- [ ] T6.4 [H] Store page copy, press kit, credits, privacy
- [ ] T6.5 [H] Launch QA checklist run

### M7 — Free updates after launch (simulation depth) → `M7-depth.md`
Each is a post-launch "free update" that keeps the store page alive. All `[S]`; have a
stronger model write a detailed spec per update before Sonnet builds it.
- [ ] U1 Brood & nursing (egg → larva → pupa → callow)
- [ ] U2 Trails that form (scouting + recruitment instead of all-knowing food maps)
- [ ] U3 Real food (carried, stored in chambers, shared mouth to mouth)
- [ ] U4 Self-organizing jobs (age + need, replacing role sliders)
- [ ] U5 Microclimate (moisture, temperature, condensation; heat mat & mister tools)
- [ ] U6 Hygiene (middens, corpse removal, mold, disease)
- [ ] U7 Species packs (harvester, carpenter, leafcutter)

### M8 — Wars of nature (Zen part three) → `M8-wars.md`
A second farm on the shelf, a rival black tribe, wars as short films on a five-level
disaster ladder (skirmish → breach → flood → devastation → exodus; the colony in Zen never
dies), and the wars of the meadow. Needs T2.8–T2.9; Survival tickets (T8.20–T8.23) need M5.
- [ ] T8.1 [S] The neighbours' farm on the shelf (light sim, cached render, shelf wide shot)
- [ ] T8.2 [S] Tribes and palettes; the neighbours' crowd
- [ ] T8.3 [S] The tube, warriors, and the scouts moment
- [ ] T8.4 [S] Fights that read in pixels (duels, gang-ups, spray, the fallen)
- [ ] T8.5 [S] The war as a film (acts, letterbox, level 1 script)
- [ ] T8.6 [S] The ladder, the Zen guarantees and the `wars` setting
- [ ] T8.7 [S] Level 2 groundwork: war in the tunnels, brood evacuation
- [ ] T8.8 [S] Level 2: the nursery falls, rubble, the rebuild (save bump)
- [ ] T8.9 [S] Level 3: the flood, the dead carried to the midden (save bump)
- [ ] T8.10 [S] Level 4: devastation, tunnel cave-ins and re-routing, the queen attacked
- [ ] T8.11 [S] Level 5 (suggested, confirm first): the exodus
- [ ] T8.12 [S] The days after (recovery arc)
- [ ] T8.13 [S] The sound of war
- [ ] T8.14 [S] Nature war: the marauders (army-ant sweep, plugging the gate)
- [ ] T8.15 [S] Nature war: the aphid ranch and the ladybug
- [ ] T8.16 [S] Small wars of nature (antlion, spider wasp, dragonflies, mantis)
- [ ] T8.17 [S] Our turn: the counter-raid
- [ ] T8.18 [H] The chronicle of the shelf
- [ ] T8.19 [S] Stability and performance pass for wars
- [ ] T8.20 [S] Survival: the neighbours are hostile (the ladder by day, no guarantees)
- [ ] T8.21 [H] Survival: war tools and cards
- [ ] T8.22 [S] Survival: counter-raid and conquest scenarios
- [ ] T8.23 [H] Survival: nature as threats

### M9 — Biome (the colony in the open) → `M9-biome.md`
A third mode between Zen and Survival: the same calm colony out of the glass, in a long
strip of country (woodland, meadow, pond, sand, stones), each stretch with its own soil,
plants, creatures and moments. Zen stays the tank. Needs T2.8–T2.9; T9.11 needs T8.1–T8.6.
- [x] T9.1 [S] World size per mode (mode `world` field, lazy size constants)
- [x] T9.2 [S] The simulation at three times the size (measure; nav budget, saves, redraws)
- [ ] T9.3 [S] The Biome mode (mode row, title button, open frame, height-fit camera)
- [ ] T9.4 [S] The shape of the land: hills, banks and ponds (`terrainH`, save bump)
- [ ] T9.5 [S] Biomes: the table and the seeded layout (soil per biome)
- [ ] T9.6 [S] Dressing the land: plants, parallax ridges, fog at the ends
- [ ] T9.7 [S] Filming a wide world: place shots and journeys
- [ ] T9.8 [S] Who lives where: creatures and food per biome
- [ ] T9.9 [S] Moments of the land (frog chorus, dragonfly hatch, leaf fall, …)
- [ ] T9.10 [S] Release into the wild (copy a Zen colony into Biome)
- [ ] T9.11 [S] Wars in the open (needs T8.1–T8.6)
- [ ] T9.12 [S] Stability and performance pass for Biome

---

## Code map (where things live)

| Area | File | Notes |
|---|---|---|
| Boot, mode select, game loop wiring, game over, autosave | `src/main.js` | `pickMode()`, `createSim()`, `triggerGameOver()` |
| Current mode | `src/gameState.js` | `GameState.mode` is `'screensaver'` or `'survival'` |
| Constants | `src/config.js` | `TILE`, `ROLE`, `STATE`, `CARRY`, `ROOM`, `CONFIG` |
| Tile world, digging, items, food spawn, stores | `src/simulation/world.js` | `update()`, `placeFood()`, `placeWater()`, `addPuddle()`, `save()/load()` |
| Ants (all behaviour) | `src/simulation/ants.js` | `AntSystem.update()`, `_act()` dispatch, `_eat()`, `startNuptialFlight()` |
| Queen + egg laying | `src/simulation/queen.js` | `update()`, `_lay()` |
| Clock, weather, dew, nuptial flights | `src/simulation/sky.js` | `_dawn()`, `_weather()`, `_flight()` |
| Flow-field navigation | `src/simulation/nav.js` | |
| Surface creatures | `src/simulation/creatures.js` | `_trySpawn()` |
| Moments (fireflies, earthworm, beetle, …) | `src/simulation/moments/` | `index.js` lists `MOMENTS`; one file per moment |
| Wars (M8, planned) | `src/simulation/war/` | `tribes.js`, `rivalFarm.js` (`sim.rival`), `army.js` (`sim.war`), `ladder.js`, `campaign.js`, `damage.js` |
| Biome land (M9, planned) | `src/simulation/land/` | `biomes.js` (`BIOMES`), `layout.js`, `terrain.js` (`world.terrainH`, `world.lift(x)`), `flora.js`, `release.js` |
| Stats for the dashboard | `src/simulation/stats.js` | |
| Fixed-step loop, speed | `src/app/gameLoop.js` | `SIM_STEP` 16 ms, `setSpeed(0..8)` |
| Camera / cinematic tour | `src/app/camera.js`, `src/app/director.js` | |
| Input | `src/app/input.js` | clicks → `controls.handleTileClick()` |
| Drawing | `src/rendering/*.js` | `renderer.js` orchestrates; everything procedural (no sprite sheets used) |
| Side panel, tools, sliders | `src/ui/dashboard.js`, `src/ui/controls.js` | |
| Toolbar, keys, panel hide, toasts, captions | `src/ui/hud.js` | keys: C tour, F fullscreen, H panel, Space pause |
| Tutorial | `src/ui/tutorial.js` | |
| Save/load | `src/saveLoad.js` | localStorage key `pixelants_<mode>`, version inside the save; `MIGRATIONS` upgrade old saves |
| Page structure | `index.html`, `styles/main.css` | |
