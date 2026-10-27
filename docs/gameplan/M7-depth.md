# M7 — Free updates after launch (simulation depth)

Each update makes the farm more like a real ant colony and gives the store page news
("Update 1.1: Brood & Nursing"). These change how ants think, mostly inside
`src/simulation/ants.js`, so they are **all `[S]`, and each needs a detailed spec first**:
before building one, have a stronger model (Opus) write `docs/gameplan/U<n>-<name>.md` in
the same ticket format as the other milestones (files, steps, done-when), split into
tickets small enough for Sonnet.

The direction for all of them: **ants act on what they can sense nearby, and resources
are physical things in the nest** — not global counters and all-knowing maps. That is
where the "I didn't tell that ant to do that" moments come from.

| Update | What changes | Why players will notice |
|---|---|---|
| **U1 Brood & nursing** | Real stages: egg → larva → pupa → callow (pale young adult that darkens). Larvae must be fed by nurses or they die; pupae are groomed; nurses sort brood into piles by stage and move it up/down the nest with temperature during the day. | The single most iconic thing you see in a real ant farm. |
| **U2 Trails that form** | Outside the nest, food is found by scouts wandering, not by the omniscient flow field (`nav.food()`); a scout that finds food lays a trail home; others follow and reinforce it; trails fade when the food runs out. Flow fields stay for travel inside tunnels. | Winding trails appear, straighten, and vanish — mesmerising on a screensaver. |
| **U3 Real food** | Replace the global `world.foodStore`/`waterStore` with food items stored in granary chambers; ants pass food mouth to mouth (trophallaxis) so food spreads ant by ant to the queen and larvae; protein for brood, sugar for workers. Keeper food types (T4.4) and Survival mods map onto it. | You can see the granaries fill and empty. |
| **U4 Self-organizing jobs** | Replace role sliders/boost buttons with age-based jobs (young nurse, middle dig, old forage) plus response thresholds (an ant switches when it senses enough need). | Kill the foragers and watch nurses step up. |
| **U5 Microclimate** | Per-tile moisture and temperature; moisture spreads through soil, wet soil darker, condensation on the glass; Keeper tools: heat mat, mister. Survival threats become physical (drought dries the soil, cold makes the colony move brood deep). | The farm visibly reacts to weather and the keeper. |
| **U6 Hygiene** | A refuse pile (midden), corpse carrying, mold on uneaten food, contact-spread sickness held back by grooming. | Stakes and chores in Keeper; new Survival threats. |
| **U7 Species packs** | Presets: harvester (seeds, big-headed majors), carpenter (wood, large workers), leafcutter (fungus garden). Each changes castes, diet, nest shape and colours. | Replay value; good paid DLC candidate later if wanted. |

Performance note for U2–U5: a big colony with local sensing may need the simulation in a
Web Worker with typed arrays. Measure with the soak test first; only move to a worker if
ms/tick at 600 ants exceeds ~4 ms.
