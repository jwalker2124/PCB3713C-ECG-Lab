// ekgEngine.js
//
// Rebuilt architecture: each cardiac complex is generated INDEPENDENTLY from
// physiological parameters. Heart rate controls only the RR interval — how
// often a complex fires — NOT the shape or duration of any wave component.
//
// Reference: Boron & Boulpaep, Medical Physiology, 3rd ed.
//   PR interval:  120–200 ms (normal)
//   QRS duration: < 120 ms  (normal)
//   QTc (Bazett): ≤ 440 ms  (normal)
//   QT at 75 bpm: ~380 ms

// ─── Core math ────────────────────────────────────────────────────────────────

function gaussian(t, amplitude, center, sigma) {
  return amplitude * Math.exp(-((t - center) ** 2) / (2 * sigma ** 2))
}

function projectionFactor(sourceAxisDeg, leadAxisDeg) {
  return Math.cos(((sourceAxisDeg - leadAxisDeg) * Math.PI) / 180)
}

function ekgNoise(tMs) {
  return (
    0.012 * Math.sin(tMs * 0.0157 + 1.7) +
    0.008 * Math.sin(tMs * 0.0421 + 4.1) +
    0.005 * Math.sin(tMs * 0.1093 + 0.3)
  )
}

// Seeded PRNG (mulberry32) — used where we want reproducible-but-realistic
// chaos without a fixed pattern. Seed once per builder call, not per sample.
function mulberry32(seed) {
  let s = seed
  return function () {
    s = (s + 0x6D2B79F5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function warpTime(tMs) {
  return (
    tMs +
    30 * Math.sin(tMs * 0.00073 + 0.9) +
    12 * Math.sin(tMs * 0.00211 + 3.4)
  )
}

// ─── Lead system ──────────────────────────────────────────────────────────────

export const LEADS = {
  I:   { id: 'I',   label: 'Lead I',   axisDeg:    0 },
  II:  { id: 'II',  label: 'Lead II',  axisDeg:   60 },
  III: { id: 'III', label: 'Lead III', axisDeg:  120 },
  aVR: { id: 'aVR', label: 'aVR',      axisDeg: -150 },
  aVL: { id: 'aVL', label: 'aVL',      axisDeg:  -30 },
  aVF: { id: 'aVF', label: 'aVF',      axisDeg:   90 },
}
export const LEAD_ORDER    = ['I', 'II', 'III', 'aVR', 'aVL', 'aVF']
export const DEFAULT_LEAD_ID = 'II'

// ─── Complex timing layout ────────────────────────────────────────────────────
// From physiological intervals → Gaussian {center, sigma} for each wave.
// Convention: t=0 is the start of the complex (P wave onset, or isoelectric
// lead-in if there is no P wave). All values in milliseconds.

function layoutComplex(p) {
  const {
    hasPWave    = true,
    pDuration   = 80,    // ±2σ effective P width
    prInterval  = 160,   // P onset → QRS onset
    qrsDuration = 80,    // QRS onset → QRS offset (±2σ of S wave)
    qtInterval  = 380,   // QRS onset → T wave end (±2σ of T wave)
    tDuration   = 160,   // ±2σ effective T width
    qrsLeadIn   = 20,    // isoelectric before QRS when hasPWave=false
  } = p

  const pSigma = pDuration / 4
  const tSigma = tDuration / 4

  // Sub-wave sigmas: chosen so Q/R/S overlap naturally within qrsDuration
  const qSigma = Math.max(3, qrsDuration * 0.09)
  const rSigma = Math.max(5, qrsDuration * 0.16)
  const sSigma = Math.max(4, qrsDuration * 0.12)

  const qrsOnset = hasPWave ? prInterval : qrsLeadIn

  return {
    pCenter:         hasPWave ? pDuration / 2 : null,
    pSigma,
    qrsOnset,
    qCenter:         qrsOnset + qrsDuration * 0.22,
    qSigma,
    rCenter:         qrsOnset + qrsDuration * 0.48,
    rSigma,
    sCenter:         qrsOnset + qrsDuration * 0.80,
    sSigma,
    qrsOffset:       qrsOnset + qrsDuration,
    tCenter:         qrsOnset + qtInterval - 2 * tSigma,
    tSigma,
    complexDuration: qrsOnset + qtInterval + tDuration / 2 + 25,
  }
}

// ─── Wave array builder ───────────────────────────────────────────────────────
// Produces the [{name, amplitude, center, sigma, axisDeg}] array that
// cycleVoltage / measureIntervals / HeartAnimation all consume.

function buildWaveArray(params) {
  const {
    hasPWave       = true,
    pAmplitude     = 0.25,
    pAxis          = 60,
    qAmplitude     = -0.10,
    rAmplitude     = 1.50,
    sAmplitude     = -0.25,
    qrsAxis        = 60,
    stElevation    = 0,
    tAmplitude     = 0.35,
    tAxis          = 45,
    hasPacerSpike  = false,
    spikeAmplitude = 2.50,
    spikeDuration  = 6,
    spikeQrsDelay  = 18,
  } = params

  const pos   = layoutComplex(params)
  const waves = []

  if (hasPacerSpike) {
    const spikeSigma  = spikeDuration / 4
    const spikeCenter = pos.qrsOnset - spikeQrsDelay
    waves.push({ name: 'Spike', amplitude: spikeAmplitude, center: spikeCenter, sigma: spikeSigma, axisDeg: 0 })
  }

  if (hasPWave) {
    waves.push({ name: 'P', amplitude: pAmplitude, center: pos.pCenter, sigma: pos.pSigma, axisDeg: pAxis })
  }

  waves.push({ name: 'Q', amplitude: qAmplitude, center: pos.qCenter, sigma: pos.qSigma, axisDeg: qrsAxis })
  waves.push({ name: 'R', amplitude: rAmplitude, center: pos.rCenter, sigma: pos.rSigma, axisDeg: qrsAxis })
  waves.push({ name: 'S', amplitude: sAmplitude, center: pos.sCenter, sigma: pos.sSigma, axisDeg: qrsAxis })
  waves.push({ name: 'T', amplitude: tAmplitude, center: pos.tCenter, sigma: pos.tSigma, axisDeg: tAxis })

  if (stElevation !== 0) {
    const stCenter = pos.qrsOffset + (pos.tCenter - pos.qrsOffset) / 2
    waves.push({ name: 'ST', amplitude: stElevation, center: stCenter, sigma: 40, axisDeg: qrsAxis })
  }

  return waves
}

// ─── generateComplex — the new public API ────────────────────────────────────
// Returns [{time, voltage}] for one complete PQRST complex.
// Each wave has its own electrical axis; `leadAxisDeg` sets the viewing lead.

export function generateComplex(params, leadAxisDeg = LEADS.II.axisDeg) {
  const waves        = buildWaveArray(params)
  const pos          = layoutComplex(params)
  const sampleRateMs = params.sampleRateMs ?? 2
  const points       = []

  for (let t = 0; t <= pos.complexDuration; t += sampleRateMs) {
    let v = 0
    for (const w of waves) {
      v += gaussian(t, w.amplitude, w.center, w.sigma) *
           projectionFactor(w.axisDeg, leadAxisDeg)
    }
    points.push({ time: t, voltage: v })
  }
  return points
}

// complexWaves: exported alias — returns the wave-definition array
// (used by HeartAnimation, measureIntervals, etc.)
export function complexWaves(params) {
  return buildWaveArray(params)
}

// ─── RHYTHM_PRESETS ───────────────────────────────────────────────────────────
// Physiologically accurate parameter objects for 16 cardiac rhythms.
// Simple rhythms (no complexType) produce a single repeating complex.
// Complex rhythms (complexType set) require macro-cycle builders below.

export const RHYTHM_PRESETS = {

  normalSinus: {
    label:        'Normal Sinus Rhythm',
    description:  'Regular SA-node origin, normal AV conduction, all intervals within reference range.',
    hr:            75,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 160,  tAxis:   45,
    qtInterval:    380,
  },

  sinusTachycardia: {
    label:        'Sinus Tachycardia',
    description:  'Normal SA-node morphology at >100 bpm. QT shortens with rate (Bazett).',
    hr:            130,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  70,  pAxis:   60,
    prInterval:    140,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   75,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.30,  tDuration: 120,  tAxis:   45,
    qtInterval:    295,    // Bazett: ~295 ms at 130 bpm (QTc ≈ 400 ms)
  },

  sinusBradycardia: {
    label:        'Sinus Bradycardia',
    description:  'Normal SA-node morphology at <60 bpm. QT lengthens with slow rate.',
    hr:            45,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  90,  pAxis:   60,
    prInterval:    170,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 190,  tAxis:   45,
    qtInterval:    450,    // Bazett: ~450 ms at 45 bpm
  },

  firstDegreeBlock: {
    label:        '1st-Degree AV Block',
    description:  'Every impulse conducts but with fixed prolonged AV delay. PR > 200 ms by definition.',
    hr:            75,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    260,    // diagnostic criterion: >200 ms
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 160,  tAxis:   45,
    qtInterval:    380,
  },

  lbbb: {
    label:        'Left Bundle Branch Block',
    description:  'LV depolarizes cell-to-cell (slow). QRS > 120 ms, left axis deviation, discordant T wave.',
    hr:            75,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.05,  rAmplitude: 1.00, sAmplitude: -0.45,
    qrsDuration:   145,   qrsAxis:   -45,   // left axis deviation
    stElevation:  -0.08,
    tAmplitude:    0.35,  tDuration: 185,  tAxis:  135,  // discordant
    qtInterval:    450,
  },

  rbbb: {
    label:        'Right Bundle Branch Block',
    description:  'RV depolarizes late via slow myocardial spread. QRS > 120 ms, right axis, discordant T.',
    hr:            75,
    hasPWave:      true,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.08,  rAmplitude: 0.90, sAmplitude: -0.50,
    qrsDuration:   140,   qrsAxis:    90,   // right axis deviation
    stElevation:   0,
    tAmplitude:    0.30,  tDuration: 175,  tAxis:  -90,  // discordant
    qtInterval:    430,
  },

  vtach: {
    label:        'Ventricular Tachycardia',
    description:  'Rapid ventricular-origin rhythm. Wide bizarre QRS, no P waves, AV dissociation.',
    hr:            180,
    hasPWave:      false,
    qAmplitude:   -0.15,  rAmplitude: 1.20, sAmplitude: -0.60,
    qrsDuration:   160,   qrsAxis:  -120,   // extreme axis — ventricular ectopic
    stElevation:   0,
    tAmplitude:   -0.50,  tDuration: 140,  tAxis:   60,  // discordant
    qtInterval:    360,
    qrsLeadIn:     15,
  },

  ventricularPaced: {
    label:        'Ventricular-Paced Rhythm',
    description:  "Pacemaker drives each beat. Spike → wide QRS (RV apex pacing), discordant T, no native P wave.",
    hr:            70,
    hasPWave:      false,
    hasPacerSpike: true,
    spikeAmplitude: 2.50,
    spikeDuration:   6,
    spikeQrsDelay:  18,
    qAmplitude:   -0.20,  rAmplitude: 0.85, sAmplitude: -0.30,
    qrsDuration:   150,   qrsAxis:   -75,
    stElevation:   0,
    tAmplitude:    0.40,  tDuration: 200,  tAxis:  105,  // discordant
    qtInterval:    460,
    qrsLeadIn:     25,
  },

  // ── Irregular / macro-cycle rhythms (complexType required) ────────────────

  mobitzI: {
    label:        'Mobitz I (Wenckebach)',
    description:  'Progressive PR lengthening until one P wave fails to conduct. Cycle resets. Grouped beating pattern.',
    complexType:  'mobitzI',
    atrialRate:    90,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    // Diminishing PR increments (+80, +30) → RR shortens each beat before drop.
    // Classic Wenckebach: largest increment first, smaller each successive beat.
    prIntervals:   [160, 240, 270],   // 4:3 conduction — 3 beats then blocked P
    qAmplitude:   -0.10,  rAmplitude: 1.20, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.30,  tDuration: 150,  tAxis:   45,
    qtInterval:    360,
  },

  mobitzII: {
    label:        'Mobitz II',
    description:  'Fixed PR on conducted beats; sudden dropped QRS without warning. More dangerous than Wenckebach.',
    complexType:  'mobitzII',
    atrialRate:    90,
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,    // constant — key distinguishing feature from Mobitz I
    conductionRatio: [2, 1],   // 2:1 — every other P drops (most dramatic pattern)
    // Slightly wide QRS: Mobitz II block is typically at bundle branch level
    qAmplitude:   -0.08,  rAmplitude: 1.10, sAmplitude: -0.30,
    qrsDuration:   120,   qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.28,  tDuration: 150,  tAxis:   45,
    qtInterval:    380,
  },

  thirdDegreeBlock: {
    label:        '3rd-Degree (Complete) AV Block',
    description:  'Complete AV dissociation. P waves march independently at atrial rate; slow wide ventricular escape.',
    complexType:  'thirdDegreeBlock',
    atrialRate:    75,     // independent SA node (~75 bpm)
    ventricularRate: 32,   // slow idioventricular escape pacemaker (20–40 bpm)
    pAmplitude:    0.22,  pDuration:  80,  pAxis:   60,
    // Wide bizarre QRS: ventricular origin, no His-Purkinje conduction
    // No Q wave (absent in ventricular escapes). Axis: extreme left axis deviation.
    // qrsAxis -75° → in Lead II: R projects ×cos(-135°)=-0.71 → net complex NEGATIVE
    rAmplitude:    0.90,  sAmplitude: -0.22,
    qrsDuration:   180,   qrsAxis:   -75,
    stElevation:   0,
    // Discordant T: tAxis 105° → in Lead II projects ×cos(45°)=+0.71 → T POSITIVE
    // (opposite polarity to the predominantly negative QRS in Lead II)
    tAmplitude:    0.65,  tDuration: 230,  tAxis:  105,
    qtInterval:    520,
  },

  atrialFlutter: {
    label:        'Atrial Flutter (2:1)',
    description:  'Reentrant circuit ≈ 300 bpm. Sawtooth flutter waves; every other wave conducts (2:1) → ≈ 150 bpm.',
    complexType:  'atrialFlutter',
    flutterRate:         300,
    ventricularRate:     150,
    flutterAmplitude:    0.15,
    flutterAxis:         -15,
    qAmplitude:   -0.10,  rAmplitude: 1.10, sAmplitude: -0.20,
    qrsDuration:   75,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.25,  tDuration: 130,  tAxis:   45,
    qtInterval:    310,
  },

  atrialFibrillation: {
    label:        'Atrial Fibrillation',
    description:  'Chaotic atrial activity. No P waves — fibrillatory baseline. Irregularly irregular ventricular response.',
    complexType:  'atrialFibrillation',
    meanVentricularRate:  90,
    rrVariability:        0.22,    // ±22% deterministic variation around mean RR
    fibrillatoryAmplitude: 0.07,
    qAmplitude:   -0.10,  rAmplitude: 1.10, sAmplitude: -0.20,
    qrsDuration:   75,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.25,  tDuration: 130,  tAxis:   45,
    qtInterval:    330,
  },

  pvcs: {
    label:        'Premature Ventricular Contractions',
    description:  'Ventricular ectopic beat: wide bizarre QRS, no preceding P, discordant T, fully compensatory pause.',
    complexType:  'pvcs',
    sinusRate:     75,
    multifocal:    true,     // show two different PVC morphologies to simulate different ectopic foci
    // Normal sinus beat params
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 160,  tAxis:   45,
    qtInterval:    380,
    // Focus 1 PVC params (left ventricular origin)
    pvcRAmplitude:   1.40,
    pvcSAmplitude:  -0.55,
    pvcQrsDuration:  155,
    pvcQrsAxis:     -100,
    pvcTAmplitude:  -0.45,   // discordant (opposite polarity to QRS)
    pvcTAxis:        80,
    pvcQtInterval:   390,
    pvcCoupling:     0.65,   // fires at 65% of normal RR (premature)
    // Focus 2 PVC params (right ventricular origin — different axis/morphology)
    pvc2RAmplitude:  1.10,
    pvc2SAmplitude: -0.80,
    pvc2QrsDuration: 160,
    pvc2QrsAxis:     130,    // right axis (RV origin)
    pvc2TAmplitude: -0.35,
    pvc2TAxis:      -50,
    pvc2QtInterval:  400,
    pvc2Coupling:    0.70,   // slightly later coupling than focus 1
  },

  pacs: {
    label:        'Premature Atrial Contractions',
    description:  'Ectopic atrial beat: different P morphology, normal QRS-T, non-compensatory pause.',
    complexType:  'pacs',
    sinusRate:     75,
    // Normal sinus beat params
    pAmplitude:    0.25,  pDuration:  80,  pAxis:   60,
    prInterval:    160,
    qAmplitude:   -0.10,  rAmplitude: 1.50, sAmplitude: -0.25,
    qrsDuration:   80,    qrsAxis:    60,
    stElevation:   0,
    tAmplitude:    0.35,  tDuration: 160,  tAxis:   45,
    qtInterval:    380,
    // PAC P wave params (ectopic atrial origin)
    pacPAmplitude:  0.13,
    pacPDuration:   60,
    pacPAxis:       30,     // different axis from normal sinus P (+60°)
    pacPrInterval:  145,    // slightly shorter PR
    pacCoupling:    0.72,   // fires at 72% of normal RR
  },

  vfib: {
    label:        'Ventricular Fibrillation',
    description:  'Completely chaotic ventricular electrical activity. No identifiable complexes. Fatal without immediate defibrillation.',
    complexType:  'vfib',
    amplitude:     0.6,
  },
}

// ─── Macro-cycle builders ─────────────────────────────────────────────────────

function placeBeat(onsetMs, waveArray) {
  return waveArray.map(w => ({ ...w, center: w.center + onsetMs }))
}

// Build a QRS-T only template at t=0 from the preset's QRS/T params.
function qrstTemplate(preset) {
  const pos = layoutComplex({
    hasPWave:    false,
    qrsDuration: preset.qrsDuration,
    qtInterval:  preset.qtInterval,
    tDuration:   160,
    qrsLeadIn:   0,
  })
  return [
    { name: 'Q', amplitude: preset.qAmplitude, center: pos.qCenter, sigma: pos.qSigma, axisDeg: preset.qrsAxis },
    { name: 'R', amplitude: preset.rAmplitude, center: pos.rCenter, sigma: pos.rSigma, axisDeg: preset.qrsAxis },
    { name: 'S', amplitude: preset.sAmplitude, center: pos.sCenter, sigma: pos.sSigma, axisDeg: preset.qrsAxis },
    { name: 'T', amplitude: preset.tAmplitude, center: pos.tCenter, sigma: pos.tSigma, axisDeg: preset.tAxis },
  ]
}

function pTemplate(preset) {
  const sigma = preset.pDuration / 4
  return [{ name: 'P', amplitude: preset.pAmplitude, center: preset.pDuration / 2, sigma, axisDeg: preset.pAxis }]
}

function buildMobitzIWaves(preset) {
  const { atrialRate, prIntervals } = preset
  const pInterval = 60000 / atrialRate
  const numP      = prIntervals.length + 1   // +1 for the dropped beat P

  const waves = []
  for (let i = 0; i < numP; i++)
    waves.push(...placeBeat(i * pInterval, pTemplate(preset)))
  for (let i = 0; i < prIntervals.length; i++)
    waves.push(...placeBeat(i * pInterval + prIntervals[i], qrstTemplate(preset)))

  const cycleMs     = numP * pInterval
  const heartRateBpm = Math.round((prIntervals.length / numP) * atrialRate)
  return { waves, cycleMs, heartRateBpm }
}

function buildMobitzIIWaves(preset) {
  const { atrialRate, prInterval, conductionRatio = [3, 2] } = preset
  const [pCount, qrsCount] = conductionRatio
  const pInterval = 60000 / atrialRate

  const waves = []
  for (let i = 0; i < pCount; i++)
    waves.push(...placeBeat(i * pInterval, pTemplate(preset)))
  for (let i = 0; i < qrsCount; i++)
    waves.push(...placeBeat(i * pInterval + prInterval, qrstTemplate(preset)))

  const cycleMs      = pCount * pInterval
  const heartRateBpm = Math.round((qrsCount / pCount) * atrialRate)
  return { waves, cycleMs, heartRateBpm }
}

function buildThirdDegreeWaves(preset) {
  const { atrialRate, ventricularRate } = preset
  const atrialInterval      = 60000 / atrialRate
  const ventricularInterval = 60000 / ventricularRate
  const cycleMs             = Math.round(ventricularInterval * 3)

  // Ventricular escape: no Q wave (absent in myocardial origin beats).
  // Wide slurred R, discordant T. Both R and T use independent axes so the
  // discordance is correctly axis-projected across all leads.
  const tDuration = preset.tDuration ?? 230
  const escapePos = layoutComplex({
    hasPWave:    false,
    qrsDuration: preset.qrsDuration,
    qtInterval:  preset.qtInterval,
    tDuration,
    qrsLeadIn:   0,
  })
  const escapeTemplate = [
    { name: 'R', amplitude: preset.rAmplitude,  center: escapePos.rCenter, sigma: escapePos.rSigma * 1.15, axisDeg: preset.qrsAxis },
    { name: 'S', amplitude: preset.sAmplitude,  center: escapePos.sCenter, sigma: escapePos.sSigma,        axisDeg: preset.qrsAxis },
    { name: 'T', amplitude: preset.tAmplitude,  center: escapePos.tCenter, sigma: escapePos.tSigma,        axisDeg: preset.tAxis   },
  ]

  const waves = []
  // P waves march independently (0.3 × PP offset so first P isn't at t=0)
  let pt = atrialInterval * 0.3
  while (pt < cycleMs) {
    waves.push(...placeBeat(pt, pTemplate(preset)))
    pt += atrialInterval
  }
  // Ventricular escape beats, phase-shifted so PR varies visibly across beats
  const escapeStart = ventricularInterval * 0.35
  for (let i = 0; i < 3; i++)
    waves.push(...placeBeat(escapeStart + i * ventricularInterval, escapeTemplate))

  return { waves, cycleMs, heartRateBpm: ventricularRate }
}

function buildAtrialFlutterWaves(preset) {
  const { flutterRate, ventricularRate, flutterAmplitude, flutterAxis } = preset
  const flutterInterval     = 60000 / flutterRate     // e.g., 200 ms at 300 bpm
  const ventricularInterval = 60000 / ventricularRate // e.g., 400 ms at 150 bpm
  const cycleMs             = ventricularInterval      // one ventricular beat per cycle

  const flutterWave = [
    { name: 'F', amplitude:  flutterAmplitude,        center: 20, sigma: 12, axisDeg: flutterAxis },
    { name: 'F', amplitude: -flutterAmplitude * 0.85, center: 55, sigma: 14, axisDeg: flutterAxis },
  ]

  const waves = []
  for (let t = 0; t < cycleMs; t += flutterInterval)
    waves.push(...placeBeat(t, flutterWave))
  waves.push(...placeBeat(flutterInterval, qrstTemplate(preset)))

  return { waves, cycleMs, heartRateBpm: ventricularRate }
}

function buildAFibWaves(preset) {
  const { meanVentricularRate, fibrillatoryAmplitude } = preset
  const meanRR = 60000 / meanVentricularRate

  // True randomly-irregular RR intervals — baked in at build time so the
  // macro-cycle is constant within a session but differs each page load.
  // Physiologic AFib: RR varies ±~35% around the mean, min ~350ms.
  const numBeats = 24
  const qrsOnsets = []
  let t = meanRR * 0.25
  for (let i = 0; i < numBeats; i++) {
    qrsOnsets.push(Math.round(t))
    const jitter = (Math.random() - 0.5) * meanRR * 0.70   // ±35% variation
    t += Math.max(350, Math.min(1400, meanRR + jitter))
  }
  const cycleMs = Math.round(t + meanRR * 0.3)

  // Fibrillatory baseline: 350–600 undulations per minute = every 100–170 ms.
  // Amplitude ±0.05–0.10 mV, random axis to simulate chaotic atrial activation.
  const fbWaves = []
  let ft = 0
  while (ft < cycleMs) {
    const spacing = 100 + Math.random() * 70               // 100–170 ms
    const polarity = Math.random() > 0.5 ? 1 : -1
    const amp      = polarity * (0.05 + Math.random() * 0.05)  // ±0.05–0.10 mV
    const axis     = Math.random() * 360 - 180
    fbWaves.push({ name: 'f', amplitude: amp, center: ft, sigma: 9, axisDeg: axis })
    ft += spacing
  }

  const waves = [...fbWaves, ...qrsOnsets.flatMap(onset => placeBeat(onset, qrstTemplate(preset)))]
  return { waves, cycleMs, heartRateBpm: meanVentricularRate }
}

function makePvcTemplate(p, rAmp, sAmp, tAmp, qrsDuration, qrsAxis, qtInterval, tAxis) {
  const pos = layoutComplex({ hasPWave: false, qrsDuration, qtInterval, tDuration: 170, qrsLeadIn: 15 })
  return [
    { name: 'R', amplitude: rAmp, center: pos.rCenter, sigma: pos.rSigma, axisDeg: qrsAxis },
    { name: 'S', amplitude: sAmp, center: pos.sCenter, sigma: pos.sSigma, axisDeg: qrsAxis },
    { name: 'T', amplitude: tAmp, center: pos.tCenter, sigma: pos.tSigma, axisDeg: tAxis  },
  ]
}

function buildPVCsWaves(preset) {
  const normalRR       = 60000 / preset.sinusRate
  const normalTemplate = buildWaveArray(preset)

  // Focus 1: unifocal PVC morphology
  const pvcTemplate1 = makePvcTemplate(
    preset,
    preset.pvcRAmplitude,  preset.pvcSAmplitude,  preset.pvcTAmplitude,
    preset.pvcQrsDuration, preset.pvcQrsAxis,      preset.pvcQtInterval, preset.pvcTAxis
  )
  // Focus 2: different axis / amplitude (simulates second ectopic focus)
  const pvcTemplate2 = makePvcTemplate(
    preset,
    preset.pvc2RAmplitude,  preset.pvc2SAmplitude,  preset.pvc2TAmplitude,
    preset.pvc2QrsDuration, preset.pvc2QrsAxis,      preset.pvc2QtInterval, preset.pvc2TAxis
  )

  // PVC 1 coupling: e.g. 0.65 × normalRR after beat 3
  const pvc1FiringMs = normalRR * 2 + normalRR * preset.pvcCoupling
  // Compensatory pause: next sinus beat resumes on its original schedule (beat 4 = 4×RR)
  // ∴ interval before PVC + interval after = pvcCoupling×RR + (2-pvcCoupling)×RR = 2×RR ✓

  // R-on-T detection: does PVC fire during the T wave of the preceding beat?
  const normalPos       = layoutComplex({ hasPWave: true, prInterval: preset.prInterval, qrsDuration: preset.qrsDuration, qtInterval: preset.qtInterval, tDuration: 160 })
  const beat3Onset      = normalRR * 2
  const tWaveStart      = beat3Onset + normalPos.tCenter - 2 * normalPos.tSigma
  const tWaveEnd        = beat3Onset + normalPos.tCenter + 2 * normalPos.tSigma
  const isROnT          = pvc1FiringMs >= tWaveStart && pvc1FiringMs <= tWaveEnd

  const annotations = isROnT
    ? [{ tMs: pvc1FiringMs, label: '⚠ R-on-T', type: 'warning' }]
    : []

  if (!preset.multifocal) {
    // Unifocal: single PVC in a 5-beat cycle
    return {
      waves: [
        ...placeBeat(0,            normalTemplate),
        ...placeBeat(normalRR,     normalTemplate),
        ...placeBeat(normalRR * 2, normalTemplate),
        ...placeBeat(pvc1FiringMs, pvcTemplate1),
        ...placeBeat(normalRR * 4, normalTemplate),   // compensatory: resumes original schedule
      ],
      cycleMs: normalRR * 5,
      heartRateBpm: preset.sinusRate,
      annotations,
    }
  }

  // Multifocal: two different PVC morphologies in a longer cycle.
  // Layout: 3 normal → PVC(focus1, comp pause) → 3 normal → PVC(focus2, comp pause)
  const pvc2FiringMs = normalRR * 6 + normalRR * preset.pvc2Coupling   // after beat 7 (index 6)
  const cycleMs      = normalRR * 10   // 10 RR cycle: 3+PVC+comp + 3+PVC+comp

  return {
    waves: [
      ...placeBeat(0,                normalTemplate),
      ...placeBeat(normalRR,         normalTemplate),
      ...placeBeat(normalRR * 2,     normalTemplate),
      ...placeBeat(pvc1FiringMs,     pvcTemplate1),
      ...placeBeat(normalRR * 4,     normalTemplate),  // resumes on schedule
      ...placeBeat(normalRR * 5,     normalTemplate),
      ...placeBeat(normalRR * 6,     normalTemplate),
      ...placeBeat(pvc2FiringMs,     pvcTemplate2),
      ...placeBeat(normalRR * 8,     normalTemplate),  // compensatory
      ...placeBeat(normalRR * 9,     normalTemplate),
    ],
    cycleMs,
    heartRateBpm: preset.sinusRate,
    annotations,
  }
}

function buildPACsWaves(preset) {
  const normalRR = 60000 / preset.sinusRate
  const normalTemplate = buildWaveArray(preset)

  const pacFiringMs = normalRR * 2 * preset.pacCoupling
  const pacPSigma   = preset.pacPDuration / 4

  const pacPos = layoutComplex({ hasPWave: true, pDuration: preset.pacPDuration, prInterval: preset.pacPrInterval, qrsDuration: preset.qrsDuration, qtInterval: preset.qtInterval, tDuration: 160 })
  const pacTemplate = [
    { name: 'P', amplitude: preset.pacPAmplitude, center: pacPos.pCenter, sigma: pacPSigma, axisDeg: preset.pacPAxis },
    { name: 'Q', amplitude: preset.qAmplitude, center: pacPos.qCenter, sigma: pacPos.qSigma, axisDeg: preset.qrsAxis },
    { name: 'R', amplitude: preset.rAmplitude, center: pacPos.rCenter, sigma: pacPos.rSigma, axisDeg: preset.qrsAxis },
    { name: 'S', amplitude: preset.sAmplitude, center: pacPos.sCenter, sigma: pacPos.sSigma, axisDeg: preset.qrsAxis },
    { name: 'T', amplitude: preset.tAmplitude, center: pacPos.tCenter, sigma: pacPos.tSigma, axisDeg: preset.tAxis },
  ]

  // Non-compensatory pause: next sinus beat ≈ one full RR after PAC
  const nextSinusOnset = pacFiringMs + pacPos.complexDuration + 190
  const cycleMs        = Math.round(normalRR * 4)

  return {
    waves: [
      ...placeBeat(0,            normalTemplate),
      ...placeBeat(normalRR,     normalTemplate),
      ...placeBeat(pacFiringMs,  pacTemplate),
      ...placeBeat(nextSinusOnset, normalTemplate),
    ],
    cycleMs,
    heartRateBpm: preset.sinusRate,
  }
}

// VFib: chaotic sum of incommensurate sinusoids (deterministic, no wave array needed)
export function vfibVoltage(tMs) {
  const freqs  = [0.023, 0.037, 0.061, 0.089, 0.143, 0.211]
  const phases = [0.0,   1.2,   2.7,   0.8,   3.9,   1.5  ]
  const amps   = [1.0,   0.7,   0.8,   0.5,   0.6,   0.4  ]
  let v = 0
  for (let i = 0; i < freqs.length; i++)
    v += amps[i] * Math.sin(tMs * freqs[i] + phases[i])
  return 0.6 * (v / 3.5) + ekgNoise(tMs) * 3
}

function buildVFibWaves(cycleMs = 1100) {
  const waves = []
  let t = 0, i = 0
  while (t < cycleMs) {
    const spacing = 40 + 70 * Math.abs(Math.sin(i * 2.39 + 0.7))
    const amp     = 0.4 + 0.35 * Math.sin(i * 1.61 + 2.2)
    const sigma   = 10 + 18 * Math.abs(Math.sin(i * 3.17 + 0.4))
    waves.push({ name: 'f', amplitude: amp, center: t, sigma, axisDeg: 360 * Math.sin(i * 1.91 + 1.0) })
    t += spacing; i++
  }
  return waves
}

// ─── RHYTHMS — backward-compatible object ─────────────────────────────────────
// Derived from RHYTHM_PRESETS. Shape is identical to the original RHYTHMS so
// EKGWaveformPrototype.jsx and HeartAnimation.jsx require no changes.

function presetToRhythm(id, preset) {
  const base = { id, label: preset.label, description: preset.description ?? '' }

  if (!preset.complexType) {
    const measurable = preset.hasPWave !== false   // no PR interval without a P wave
    return { ...base, heartRateBpm: preset.hr, waves: buildWaveArray(preset), measurable }
  }

  const builders = {
    mobitzI:           () => buildMobitzIWaves(preset),
    mobitzII:          () => buildMobitzIIWaves(preset),
    thirdDegreeBlock:  () => buildThirdDegreeWaves(preset),
    atrialFlutter:     () => buildAtrialFlutterWaves(preset),
    atrialFibrillation:() => buildAFibWaves(preset),
    pvcs:              () => buildPVCsWaves(preset),
    pacs:              () => buildPACsWaves(preset),
    vfib:              () => ({ waves: [], cycleMs: 1100, heartRateBpm: 0 }),
  }

  const build = builders[preset.complexType]
  if (!build) return { ...base, heartRateBpm: preset.hr ?? 75, waves: [], measurable: false }

  const { waves, cycleMs, heartRateBpm } = build()
  return { ...base, heartRateBpm, cycleMs, waves, measurable: false }
}

export const RHYTHMS = Object.fromEntries(
  Object.entries(RHYTHM_PRESETS).map(([id, preset]) => [id, presetToRhythm(id, preset)])
)

export const RHYTHM_ORDER = [
  'normalSinus',
  'firstDegreeBlock',
  'lbbb',
  'rbbb',
  'thirdDegreeBlock',
  'atrialFlutter',
  'pvcs',
  'pacs',
  'mobitzI',
  'mobitzII',
  'atrialFibrillation',
  'ventricularPaced',
  'vtach',
  'vfib',
]

// ─── Utility / legacy API ─────────────────────────────────────────────────────

export function cycleLengthMs(heartRateBpm) {
  return 60000 / heartRateBpm
}

export function expectedQtMs(heartRateBpm, qtcMs = 400) {
  return qtcMs * Math.sqrt(cycleLengthMs(heartRateBpm) / 1000)
}

export function cycleVoltage(tInCycleMs, waves, leadAxisDeg = LEADS.I.axisDeg) {
  return waves.reduce((sum, wave) => {
    const axis = wave.axisDeg ?? LEADS.I.axisDeg
    return sum + gaussian(tInCycleMs, wave.amplitude, wave.center, wave.sigma) * projectionFactor(axis, leadAxisDeg)
  }, 0)
}

export function ekgVoltage(elapsedMs, cycleMs, waves, leadAxisDeg = LEADS.I.axisDeg, nativeCycleMs = null) {
  // VFib detection: no identifiable waves, just chaos
  if (!waves || waves.length === 0) return vfibVoltage(elapsedMs)

  const warpedMs   = warpTime(elapsedMs)
  const tInCycle   = ((warpedMs % cycleMs) + cycleMs) % cycleMs
  const tEvaluated = nativeCycleMs !== null ? tInCycle * (nativeCycleMs / cycleMs) : tInCycle
  return cycleVoltage(tEvaluated, waves, leadAxisDeg) + ekgNoise(elapsedMs)
}

export function measureIntervals(waves) {
  const byName    = Object.fromEntries(waves.map(w => [w.name, w]))
  const onset     = w => w.center - 2 * w.sigma
  const offset    = w => w.center + 2 * w.sigma
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

// Legacy constant — kept for any imports that reference it directly
export const NORMAL_SINUS_WAVES = buildWaveArray(RHYTHM_PRESETS.normalSinus)
export const DEFAULT_HEART_RATE_BPM = 75

// ─── buildRhythmFromParams — live synthesis from UI parameters ────────────────
// Translates EKGSimulator's parameter controls → {waves, cycleMs, nativeCycleMs}.
// Lets students derive any rhythm by understanding which parameters produce it,
// rather than selecting a pre-labelled preset.
export function buildRhythmFromParams(ui) {
  const {
    saNodeRate        = 75,
    avConductionRatio = 'all',
    prInterval        = 160,
    qrsDuration       = 80,
    qtInterval        = 380,
    pWaveMode         = 'present',
    escapeRhythm      = 'none',
  } = ui

  const PP     = 60000 / saNodeRate
  const isWide = qrsDuration > 120

  // Base QRS/T params for conducted beats — T becomes discordant when wide QRS
  const baseQRS = {
    qAmplitude:  -0.10,
    rAmplitude:   isWide ? 0.90 : 1.50,
    sAmplitude:   isWide ? -0.40 : -0.25,
    qrsDuration,
    qrsAxis:      60,
    qtInterval,
    tDuration:    isWide ? 185 : 160,
    tAmplitude:   0.35,
    tAxis:        isWide ? 135 : 45,
    stElevation:  0,
  }

  // ── VFib ──────────────────────────────────────────────────────────────────
  if (pWaveMode === 'fibrillatory' && avConductionRatio === 'none')
    return { waves: [], cycleMs: 1100, nativeCycleMs: null, measurable: false }

  // ── AFib — saNodeRate controls mean ventricular rate in this mode ─────────
  if (pWaveMode === 'fibrillatory') {
    const { waves, cycleMs } = buildAFibWaves({
      meanVentricularRate: saNodeRate, fibrillatoryAmplitude: 0.07, ...baseQRS,
    })
    return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false }
  }

  // ── Complete AV block ─────────────────────────────────────────────────────
  if (avConductionRatio === 'none') {
    const pWv = pWaveMode === 'present'
      ? pTemplate({ pAmplitude: 0.25, pDuration: 80, pAxis: 60 }) : []

    if (escapeRhythm === 'none') {
      const cycleMs = PP * 5
      const waves = []
      for (let i = 0; i < 5; i++) waves.push(...placeBeat(i * PP, pWv))
      return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false }
    }

    const isJ    = escapeRhythm === 'junctional'
    const escRR  = 60000 / (isJ ? 50 : 32)
    const escPos = layoutComplex({
      hasPWave:    false,
      qrsDuration: isJ ? 90  : 180,
      qtInterval:  isJ ? qtInterval : Math.max(qtInterval, 480),
      tDuration:   isJ ? 160 : 230,
      qrsLeadIn:   0,
    })
    const escTemplate = [
      { name: 'R', amplitude: isJ ? 1.10 : 0.90,  center: escPos.rCenter, sigma: escPos.rSigma * (isJ ? 1.0 : 1.15), axisDeg: isJ ?  60 : -75 },
      { name: 'S', amplitude: isJ ? -0.20 : -0.22, center: escPos.sCenter, sigma: escPos.sSigma,                       axisDeg: isJ ?  60 : -75 },
      { name: 'T', amplitude: isJ ?  0.28 : 0.65,  center: escPos.tCenter, sigma: escPos.tSigma,                       axisDeg: isJ ?  45 : 105 },
    ]

    const cycleMs = Math.round(escRR * 3)
    const waves   = []
    if (pWv.length) {
      let pt = PP * 0.3
      while (pt < cycleMs) { waves.push(...placeBeat(pt, pWv)); pt += PP }
    }
    for (let i = 0; i < 3; i++)
      waves.push(...placeBeat(escRR * 0.35 + i * escRR, escTemplate))

    return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false }
  }

  // ── Partial AV block (Mobitz II-style: fixed PR on conducted beats) ───────
  if (avConductionRatio !== 'all') {
    const ratioMap   = { '3:2': [3, 2], '2:1': [2, 1], '3:1': [3, 1] }
    const [pCt, qCt] = ratioMap[avConductionRatio] ?? [2, 1]
    const cycleMs    = pCt * PP
    const qrstPos    = layoutComplex({ hasPWave: false, qrsDuration, qtInterval, tDuration: baseQRS.tDuration, qrsLeadIn: 0 })
    const waves      = []

    if (pWaveMode === 'present')
      for (let i = 0; i < pCt; i++)
        waves.push({ name: 'P', amplitude: 0.25, center: i * PP + 40, sigma: 20, axisDeg: 60 })

    for (let i = 0; i < qCt; i++) {
      const o = i * PP + prInterval
      waves.push(
        { name: 'Q', amplitude: baseQRS.qAmplitude,  center: o + qrstPos.qCenter, sigma: qrstPos.qSigma, axisDeg: 60 },
        { name: 'R', amplitude: baseQRS.rAmplitude,  center: o + qrstPos.rCenter, sigma: qrstPos.rSigma, axisDeg: 60 },
        { name: 'S', amplitude: baseQRS.sAmplitude,  center: o + qrstPos.sCenter, sigma: qrstPos.sSigma, axisDeg: 60 },
        { name: 'T', amplitude: baseQRS.tAmplitude,  center: o + qrstPos.tCenter, sigma: qrstPos.tSigma, axisDeg: baseQRS.tAxis },
      )
    }
    return { waves, cycleMs, nativeCycleMs: cycleMs, measurable: false }
  }

  // ── 1:1 conduction ────────────────────────────────────────────────────────
  const hasPWave = pWaveMode === 'present'
  const waves    = complexWaves({ hasPWave, pAmplitude: 0.25, pDuration: 80, pAxis: 60, prInterval, ...baseQRS })
  return { waves, cycleMs: PP, nativeCycleMs: null, measurable: hasPWave }
}
