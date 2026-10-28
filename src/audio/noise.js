// Noise for the sound layers (src/audio/audio.js). Plain arrays in and out, so it runs without a
// browser and the tests can measure it. `random` can be swapped for a seeded one.

// White noise: every sample is a fresh draw, so it hisses. Fills `data` with values from -1 to 1.
export function whiteNoise(data, random = Math.random) {
  for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1;
  return data;
}

// Brown noise: white noise added up as it goes, so it rumbles instead of hissing. Each step lets a
// little of the total leak away, which keeps it near zero. Fills `data` with noise whose loudness
// (RMS) is `rms`.
//
// A loop of it must not click where its end meets its start. So the noise is made a little longer
// than the buffer, and the start of the buffer is crossfaded with that run-on of the end: the last
// sample then leads into the first as smoothly as any two neighbours do.
const LEAK = 0.998;
const BLEND = 4096;   // samples at the start that are crossfaded with the run-on
export function brownNoise(data, rms = 0.3, random = Math.random) {
  const n = data.length, blend = Math.min(BLEND, n >> 2);
  const run = new Float64Array(n + blend);
  let sum = 0;
  for (let i = 0; i < run.length; i++) {
    sum = sum * LEAK + (random() * 2 - 1);
    run[i] = sum;
  }

  let energy = 0;
  for (let i = 0; i < n; i++) {
    if (i < blend) {
      const turn = i / blend * Math.PI / 2;   // the run-on fades out as the start fades in; together they keep their power
      data[i] = run[n + i] * Math.cos(turn) + run[i] * Math.sin(turn);
    } else {
      data[i] = run[i];
    }
    energy += data[i] * data[i];
  }
  const scale = rms / (Math.sqrt(energy / n) || 1);
  for (let i = 0; i < n; i++) data[i] = Math.max(-1, Math.min(1, data[i] * scale));
  return data;
}
