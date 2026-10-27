import { CONFIG } from '../config.js';

// Runs sim ticks in small slices so the page stays responsive.
//   step()         runs one sim tick
//   maxTicks       stop after this many ticks
//   until()        stop as soon as this is true; it is asked before every tick, so keep it cheap
//   budgetMs       stop after this long on the clock, however far it got
//   onProgress(f)  f runs 0..1: how close it is to whichever of maxTicks and budgetMs it will hit
//                  first. The last call is always 1.
// Resolves to the number of ticks run. If step() throws, so does the promise, and no more ticks run.
export async function fastForward({ step, maxTicks, until = () => false, budgetMs = 8000,
                                    sliceMs = CONFIG.FF_SLICE_MS, onProgress }) {
  const t0 = performance.now();
  let ticks = 0;
  for (;;) {
    const sliceEnd = performance.now() + sliceMs;
    let now;
    do {   // at least one tick a slice, so it always gets somewhere
      now = performance.now();
      if (ticks >= maxTicks || now - t0 >= budgetMs || until()) {
        onProgress?.(1);
        return ticks;
      }
      step();
      ticks++;
    } while (now < sliceEnd);
    onProgress?.(Math.min(1, Math.max(ticks / maxTicks, (now - t0) / budgetMs)));
    await new Promise(r => setTimeout(r));   // let the page paint and answer input
  }
}
