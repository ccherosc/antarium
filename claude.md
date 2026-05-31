# Afterwind Claude Code Instructions

This project is a lightweight vanilla JavaScript browser game.

Important:

* Never use the 1M context tool.
* Keep context usage small.
* Do not scan the whole repo unless necessary.
* Use targeted file reads and edits.
* Preserve the playable game state.
* Run the game locally after changes.
* Use available browser/screenshot tools to verify visuals and gameplay.
* Use Kenney Pixel Shmup assets from the `assets` folder.
* Keep the project static-host friendly for GitHub Pages or Cloudflare Pages.

Primary goal:
Build a playable 2D airplane action game where the player’s flight path creates tomorrow’s weather.

Core loop:
Fly → record path → analyze path → generate weather → survive the next day.

Tech:
HTML, CSS, vanilla JavaScript, Canvas.

Avoid:
React, TypeScript, build tools, backend services, and unnecessary dependencies unless explicitly requested.
