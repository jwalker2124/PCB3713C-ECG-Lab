// ekgEngine.js
//
// The mathematical core of Module 3. Generates EKG voltage values from a
// "Gaussian-sum" model: each wave (P, Q, R, S, T) is a bell curve with its
// own height, width, and position in the cardiac cycle. Adding them together
// produces one heartbeat's worth of waveform — repeat that on a loop and you
// get a continuously scrolling EKG strip.
//
// Reference: Boron & Boulpaep, Medical Physiology — normal sinus rhythm values.

// ─────────────────────────────────────────────────────────────────────────
// gaussian — the building block for every wave on the EKG
//
//   amplitude : peak height in millivolts (negative = downward deflection,
//               like the Q and S waves)
//   center    : the time (ms) within the cycle where the peak occurs
//   sigma     : standard deviation (ms) — controls how wide the bump is.
//               About 95% of a Gaussian's area falls within ±2*sigma of its
//               center, so we use "center ± 2*sigma" as a wave's effective
//               start/end when measuring intervals like PR and QRS.
// ─────────────────────────────────────────────────────────────────────────
function gaussian(tMs, amplitude, center, sigma) {
  const exponent = -((tMs - center) ** 2) / (2 * sigma ** 2)
  return amplitude * Math.exp(exponent)
}

// ─────────────────────────────────────────────────────────────────────────
// NORMAL_SINUS_WAVES — default shape for a normal sinus rhythm at ~75 bpm
// (cycle length 800 ms). All times are milliseconds measured from the start
// of the cycle; all amplitudes are millivolts (roughly matching a Lead I trace).
//
// These five entries are the whole "personality" of the rhythm — tweak them
// and watch the measured intervals (computed by measureIntervals, below)
// move toward or away from the normal ranges:
//
//   PR interval   120 - 200 ms   →  this model measures ~149 ms
//   QRS duration  <   120 ms     →  this model measures ~71 ms
//   QT interval   ~350 - 400 ms at this heart rate → this model measures ~357 ms
//                 (QT shortens as heart rate rises — Bazett's correction
//                  predicts ~358 ms at 75 bpm for a "normal" 400 ms QTc)
// ─────────────────────────────────────────────────────────────────────────
export const NORMAL_SINUS_WAVES = [
  { name: 'P', amplitude:  0.15, center:  80, sigma: 25 },
  { name: 'Q', amplitude: -0.10, center: 195, sigma:  8 },
  { name: 'R', amplitude:  1.20, center: 213, sigma: 12 },
  { name: 'S', amplitude: -0.25, center: 230, sigma: 10 },
  { name: 'T', amplitude:  0.30, center: 440, sigma: 48 },
]

export const DEFAULT_HEART_RATE_BPM = 75

// ─────────────────────────────────────────────────────────────────────────
// RHYTHMS — the rhythm library (Tier 1: "same engine, different numbers").
//
// Each entry is fully self-contained: its own heart rate AND its own wave
// set. That keeps every rhythm independently tunable and independently
// checkable with measureIntervals() — no shared state to accidentally break
// another rhythm while tuning one.
//
// These six are all still "one regular, repeating P-QRS-T cycle" — only the
// timing and shape numbers differ. Rhythms where the cycle itself becomes
// irregular (2nd/3rd-degree block, AFib, PACs/PVCs, VTach, ...) need a
// fundamentally different generation strategy and will arrive in a later
// phase ("Tier 2").
//
// NOTE: for the pathological rhythms below, the "abnormal" reading is the
// whole point — e.g. selecting "1st-degree AV block" SHOULD make the PR
// interval card read outside the normal range. That's the model correctly
// reproducing the diagnostic finding, not a bug.
// ─────────────────────────────────────────────────────────────────────────
export const RHYTHMS = {
  normalSinus: {
    id: 'normalSinus',
    label: 'Normal sinus rhythm',
    description:
      'Regular rhythm originating in the SA node at a normal resting rate, with normal conduction through the AV node and ventricles. Every interval falls inside the textbook normal range.',
    heartRateBpm: 75,
    waves: NORMAL_SINUS_WAVES,
  },

  sinusTachycardia: {
    id: 'sinusTachycardia',
    label: 'Sinus tachycardia',
    description:
      'Same SA-node origin and normal conduction pathway as a normal sinus rhythm — just faster (>100 bpm). Every interval compresses, and the QT interval rate-corrects shorter (Bazett).',
    heartRateBpm: 130,
    waves: [
      { name: 'P', amplitude:  0.15, center:  40, sigma: 12 },
      { name: 'Q', amplitude: -0.10, center: 150, sigma:  6 },
      { name: 'R', amplitude:  1.20, center: 160, sigma:  8 },
      { name: 'S', amplitude: -0.25, center: 172, sigma:  7 },
      { name: 'T', amplitude:  0.30, center: 340, sigma: 35 },
    ],
  },

  sinusBradycardia: {
    id: 'sinusBradycardia',
    label: 'Sinus bradycardia',
    description:
      'Same SA-node origin and normal conduction pathway — just slower (<60 bpm). The extra cycle time shows up mostly as a longer pause between beats (the flat segment between T and the next P).',
    heartRateBpm: 50,
    waves: [
      { name: 'P', amplitude:  0.15, center: 100, sigma: 28 },
      { name: 'Q', amplitude: -0.10, center: 250, sigma:  9 },
      { name: 'R', amplitude:  1.20, center: 265, sigma: 12 },
      { name: 'S', amplitude: -0.25, center: 280, sigma: 11 },
      { name: 'T', amplitude:  0.30, center: 520, sigma: 65 },
    ],
  },

  firstDegreeBlock: {
    id: 'firstDegreeBlock',
    label: '1st-degree AV block',
    description:
      'Every atrial impulse still reaches the ventricles — but the AV node delays each one more than normal, by a fixed extra amount. The result: a PR interval that is constant from beat to beat, but prolonged beyond 200 ms.',
    heartRateBpm: 75,
    waves: [
      { name: 'P', amplitude:  0.15, center:  80, sigma: 25 },
      { name: 'Q', amplitude: -0.10, center: 266, sigma:  8 },
      { name: 'R', amplitude:  1.20, center: 284, sigma: 12 },
      { name: 'S', amplitude: -0.25, center: 301, sigma: 10 },
      { name: 'T', amplitude:  0.30, center: 511, sigma: 48 },
    ],
  },

  lbbb: {
    id: 'lbbb',
    label: 'Left bundle branch block',
    description:
      "The left ventricle can no longer depolarize via the fast Purkinje network — it has to activate slowly, cell-to-cell, which widens the QRS complex beyond 120 ms. (Simplified: a real LBBB also produces a notched/slurred R wave that a five-Gaussian model can't reproduce — the widening is the diagnostic feature this model captures.)",
    heartRateBpm: 75,
    waves: [
      { name: 'P', amplitude:  0.15, center:  80, sigma: 25 },
      { name: 'Q', amplitude: -0.15, center: 200, sigma: 18 },
      { name: 'R', amplitude:  1.00, center: 230, sigma: 22 },
      { name: 'S', amplitude: -0.35, center: 260, sigma: 20 },
      { name: 'T', amplitude:  0.30, center: 460, sigma: 50 },
    ],
  },

  rbbb: {
    id: 'rbbb',
    label: 'Right bundle branch block',
    description:
      "The right ventricle depolarizes late, again widening the QRS complex beyond 120 ms — typically seen as a broad, slurred terminal S wave on a lateral lead like Lead I. (Simplified: a real RBBB also produces an RSR' \"rabbit-ears\" pattern over the right side of the heart, which a single-lead model can't show.)",
    heartRateBpm: 75,
    waves: [
      { name: 'P', amplitude:  0.15, center:  80, sigma: 25 },
      { name: 'Q', amplitude: -0.08, center: 195, sigma: 10 },
      { name: 'R', amplitude:  0.90, center: 218, sigma: 14 },
      { name: 'S', amplitude: -0.40, center: 255, sigma: 22 },
      { name: 'T', amplitude:  0.30, center: 450, sigma: 48 },
    ],
  },
}

// Display order for selectors — independent of object-key iteration order,
// and groups related rhythms together (normal → rate variants → conduction defects).
export const RHYTHM_ORDER = [
  'normalSinus',
  'sinusTachycardia',
  'sinusBradycardia',
  'firstDegreeBlock',
  'lbbb',
  'rbbb',
]

// Converts a heart rate (beats per minute) into a cycle length (ms).
// 75 bpm → 800 ms per beat.
export function cycleLengthMs(heartRateBpm) {
  return 60000 / heartRateBpm
}

// Bazett's formula relates the QT interval to heart rate:
//   QTc = QT / sqrt(RR in seconds)   ⇒   QT = QTc * sqrt(RR in seconds)
// A "normal" corrected QT (QTc) is roughly 400 ms regardless of rate — but
// the *raw* QT shortens at fast heart rates and lengthens at slow ones.
// This gives us a rate-aware expected QT to compare each rhythm against,
// instead of a single fixed number that's only valid at ~60 bpm.
export function expectedQtMs(heartRateBpm, qtcMs = 400) {
  const rrSeconds = cycleLengthMs(heartRateBpm) / 1000
  return qtcMs * Math.sqrt(rrSeconds)
}

// Sums every wave's contribution at a given time within ONE cycle.
// `waves` is an array of { amplitude, center, sigma } objects.
export function cycleVoltage(tInCycleMs, waves) {
  return waves.reduce(
    (total, wave) => total + gaussian(tInCycleMs, wave.amplitude, wave.center, wave.sigma),
    0
  )
}

// The function the scrolling strip calls every frame: voltage (mV) at any
// elapsed time, looping the single-cycle waveform forever via the modulo
// operator. `waves` are defined relative to one cycle of length `cycleMs`.
//
// The double-modulo (`((x % n) + n) % n`) keeps the result positive even
// when elapsedMs is negative — handy if we ever scrub the strip backwards.
export function ekgVoltage(elapsedMs, cycleMs, waves) {
  const tInCycle = ((elapsedMs % cycleMs) + cycleMs) % cycleMs
  return cycleVoltage(tInCycle, waves)
}

// ─────────────────────────────────────────────────────────────────────────
// measureIntervals — derives the clinically-meaningful intervals (PR, QRS,
// QT) directly from the wave parameters above, using "center ± 2*sigma" as
// each wave's onset/offset. This is what lets us tune the five Gaussians by
// checking printed numbers against the B&B reference ranges instead of
// just eyeballing the curve.
//
// Assumes `waves` contains entries named 'P', 'Q', 'R', 'S', 'T'.
// ─────────────────────────────────────────────────────────────────────────
export function measureIntervals(waves) {
  const byName = Object.fromEntries(waves.map(w => [w.name, w]))
  const onset  = w => w.center - 2 * w.sigma
  const offset = w => w.center + 2 * w.sigma

  const pOnset    = onset(byName.P)
  const qrsOnset  = onset(byName.Q)
  const qrsOffset = offset(byName.S)
  const tOffset   = offset(byName.T)

  return {
    prIntervalMs:  qrsOnset - pOnset,
    qrsDurationMs: qrsOffset - qrsOnset,
    qtIntervalMs:  tOffset - qrsOnset,
  }
}
