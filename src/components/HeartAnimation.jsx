import { useEffect, useRef, useMemo } from 'react'

// ─── Conduction map builder ──────────────────────────────────────────────────
// Derives activation windows from the rhythm's wave geometry so timing stays
// in sync with the EKG strip automatically when wave params are tuned.
//
// Each entry: { id, onsetMs, offsetMs, state }
// state: 'active' | 'blocked' | 'delayed' | 'ectopic' | 'shimmer' | 'hidden'
//
// For Tier-2 rhythms, multiple beats are encoded as separate entries sharing
// the same station id — the animation loop checks all windows each frame.
// ─────────────────────────────────────────────────────────────────────────────
export function buildConductionMap(rhythmId, waves) {
  const w   = name => waves.find(wv => wv.name === name)
  const has  = name => !!w(name)
  const on   = name => has(name) ? w(name).center - 2 * w(name).sigma : 0
  const off  = name => has(name) ? w(name).center + 2 * w(name).sigma : 0

  const beatWindows = (beatOffset, opts = {}) => {
    const {
      state        = 'active',
      hideSA       = false,
      hideAtria    = false,
      hideAV       = false,
      hideBundles  = false,
      lbundleState = 'active',
      rbundleState = 'active',
      avState      = 'active',
      ectopicAtria = false,
      pacerBeat    = false,
      lvDelay      = 0,
      rvDelay      = 0,
    } = opts

    const pOn  = beatOffset + (has('P') ? on('P')  : 30)
    const pOff = beatOffset + (has('P') ? off('P') : 130)
    const qOn  = beatOffset + (has('Q') ? on('Q')  : 250)
    const sOff = beatOffset + (has('S') ? off('S') : 320)
    const rCtr = beatOffset + (has('R') ? w('R').center : 284)
    const rSig = has('R') ? w('R').sigma : 12

    const entries = []

    if (!hideSA && !ectopicAtria && !pacerBeat)
      entries.push({ id: 'sa',      onsetMs: pOn,       offsetMs: pOn + 40,           state })
    if (!hideAtria && !ectopicAtria && !pacerBeat) {
      entries.push({ id: 'ra',      onsetMs: pOn + 10,  offsetMs: pOff,               state })
      entries.push({ id: 'la',      onsetMs: pOn + 25,  offsetMs: pOff,               state })
    }
    if (ectopicAtria && !pacerBeat) {
      entries.push({ id: 'ectopicFocus', onsetMs: pOn,      offsetMs: pOn + 40,       state: 'ectopic' })
      entries.push({ id: 'ra',           onsetMs: pOn + 15, offsetMs: pOff,           state: 'ectopic' })
      entries.push({ id: 'la',           onsetMs: pOn,      offsetMs: pOff,           state: 'ectopic' })
    }
    if (!hideAV && !pacerBeat)
      entries.push({ id: 'av',      onsetMs: pOff,      offsetMs: qOn,                state: avState })
    if (!hideBundles && !pacerBeat) {
      entries.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,           state })
      entries.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45 + rvDelay, state: rbundleState })
      entries.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45 + lvDelay, state: lbundleState })
    }

    if (pacerBeat)
      entries.push({ id: 'pacer', onsetMs: beatOffset + 188, offsetMs: beatOffset + 210, state: 'ectopic' })

    const rvOn = pacerBeat ? (beatOffset + 200) : (qOn + (hideBundles ? 10 : 20) + rvDelay)
    const lvOn = pacerBeat ? (beatOffset + 200) : (qOn + (hideBundles ? 10 : 20) + lvDelay)
    entries.push({ id: 'rv',   onsetMs: rvOn,                      offsetMs: sOff + rvDelay,             state: pacerBeat ? 'ectopic' : state })
    entries.push({ id: 'lv',   onsetMs: lvOn,                      offsetMs: sOff + lvDelay,             state: pacerBeat ? 'ectopic' : state })
    entries.push({ id: 'apex', onsetMs: Math.max(rvOn, lvOn) + 15, offsetMs: sOff + Math.max(rvDelay, lvDelay) + 20, state: pacerBeat ? 'ectopic' : state })
    entries.push({ id: '_rwave', onsetMs: rCtr, offsetMs: rCtr, rCenter: rCtr, rSigma: rSig, state: 'meta' })

    return entries
  }

  switch (rhythmId) {
    case 'normalSinus':
    case 'sinusTachycardia':
    case 'sinusBradycardia':
      return beatWindows(0)

    case 'firstDegreeBlock':
      return beatWindows(0, { avState: 'delayed' })

    case 'lbbb':
      return beatWindows(0, { lbundleState: 'blocked', lvDelay: 60 })

    case 'rbbb':
      return beatWindows(0, { rbundleState: 'blocked', rvDelay: 60 })

    case 'thirdDegreeBlock': {
      const map = []
      const pWaves = waves.filter(wv => wv.name === 'P')
      pWaves.forEach(pw => {
        const pOn  = pw.center - 2 * pw.sigma
        const pOff = pw.center + 2 * pw.sigma
        map.push({ id: 'sa', onsetMs: pOn,      offsetMs: pOn + 40, state: 'active' })
        map.push({ id: 'ra', onsetMs: pOn + 10, offsetMs: pOff,     state: 'active' })
        map.push({ id: 'la', onsetMs: pOn + 25, offsetMs: pOff,     state: 'active' })
      })
      map.push({ id: 'av', onsetMs: 0, offsetMs: 9999, state: 'blocked' })
      const qEsc = waves.find(wv => wv.name === 'Q')
      if (qEsc) {
        const qOn  = qEsc.center - 2 * qEsc.sigma
        const sWave = waves.find(wv => wv.name === 'S')
        const sOff  = sWave ? sWave.center + 2 * sWave.sigma : qOn + 80
        const rW    = waves.find(wv => wv.name === 'R')
        map.push({ id: 'rv',   onsetMs: qOn + 15, offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',   onsetMs: qOn + 15, offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex', onsetMs: qOn + 30, offsetMs: sOff + 20, state: 'active' })
        if (rW) map.push({ id: '_rwave', onsetMs: rW.center, offsetMs: rW.center, rCenter: rW.center, rSigma: rW.sigma, state: 'meta' })
      }
      return map
    }

    case 'atrialFlutter': {
      const map = []
      map.push({ id: 'ra', onsetMs: 0, offsetMs: 9999, state: 'shimmer', shimmerFreq: 0.016 })
      map.push({ id: 'la', onsetMs: 0, offsetMs: 9999, state: 'shimmer', shimmerFreq: 0.016 })
      const qWaves = waves.filter(wv => wv.name === 'Q')
      qWaves.forEach(qw => {
        const qOn  = qw.center - 2 * qw.sigma
        const sWave = waves.reduce((best, wv) => {
          if (wv.name !== 'S') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 10 })
        const sOff = sWave.center + 2 * sWave.sigma
        const rWave = waves.reduce((best, wv) => {
          if (wv.name !== 'R') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 12 })
        map.push({ id: 'av',      onsetMs: qOn - 100, offsetMs: qOn,       state: 'active' })
        map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
        map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
        if (rWave.center < 9999) map.push({ id: '_rwave', onsetMs: rWave.center, offsetMs: rWave.center, rCenter: rWave.center, rSigma: rWave.sigma, state: 'meta' })
      })
      return map
    }

    case 'atrialFibrillation': {
      const map = []
      map.push({ id: 'ra', onsetMs: 0, offsetMs: 9999, state: 'shimmer', shimmerFreq: 0.08,  shimmerFreq2: 0.053 })
      map.push({ id: 'la', onsetMs: 0, offsetMs: 9999, state: 'shimmer', shimmerFreq: 0.071, shimmerFreq2: 0.047 })
      const qWaves = waves.filter(wv => wv.name === 'Q')
      qWaves.forEach(qw => {
        const qOn   = qw.center - 2 * qw.sigma
        const nearR = waves.reduce((best, wv) => {
          if (wv.name !== 'R') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 12 })
        const nearS = waves.reduce((best, wv) => {
          if (wv.name !== 'S') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 10 })
        const sOff = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
        map.push({ id: 'av',      onsetMs: qOn - 80,  offsetMs: qOn,       state: 'active' })
        map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
        map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
        if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
      })
      return map
    }

    case 'pvcs': {
      const map = []
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const pWaves = waves.filter(wv => wv.name === 'P')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      qWaves.forEach((qw, idx) => {
        const qOn   = qw.center - 2 * qw.sigma
        const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - qw.center) < Math.abs(b.center - qw.center) ? rv : b, { center: 9999, sigma: 12 })
        const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - qw.center) < Math.abs(b.center - qw.center) ? sv : b, { center: 9999, sigma: 10 })
        const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
        const isPVC = idx === 3
        if (!isPVC) {
          const nearP = pWaves.reduce((b, pv) => Math.abs(pv.center - qw.center) < Math.abs(b.center - qw.center) ? pv : b, { center: 9999, sigma: 25 })
          if (nearP.center < 9999) {
            const pOn  = nearP.center - 2 * nearP.sigma
            const pOff = nearP.center + 2 * nearP.sigma
            map.push({ id: 'sa',      onsetMs: pOn,      offsetMs: pOn + 40, state: 'active' })
            map.push({ id: 'ra',      onsetMs: pOn + 10, offsetMs: pOff,     state: 'active' })
            map.push({ id: 'la',      onsetMs: pOn + 25, offsetMs: pOff,     state: 'active' })
            map.push({ id: 'av',      onsetMs: pOff,     offsetMs: qOn,      state: 'active' })
            map.push({ id: 'his',     onsetMs: qOn,      offsetMs: qOn + 20, state: 'active' })
            map.push({ id: 'rbundle', onsetMs: qOn + 10, offsetMs: qOn + 45, state: 'active' })
            map.push({ id: 'lbundle', onsetMs: qOn + 10, offsetMs: qOn + 45, state: 'active' })
          }
        }
        map.push({ id: 'rv',   onsetMs: qOn + 20, offsetMs: sOff,      state: isPVC ? 'ectopic' : 'active' })
        map.push({ id: 'lv',   onsetMs: qOn + 20, offsetMs: sOff,      state: isPVC ? 'ectopic' : 'active' })
        map.push({ id: 'apex', onsetMs: qOn + 35, offsetMs: sOff + 20, state: isPVC ? 'ectopic' : 'active' })
        if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
      })
      return map
    }

    case 'pacs': {
      const map = []
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      const pWaves = waves.filter(wv => wv.name === 'P')
      qWaves.forEach((qw, idx) => {
        const qOn   = qw.center - 2 * qw.sigma
        const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - qw.center) < Math.abs(b.center - qw.center) ? rv : b, { center: 9999, sigma: 12 })
        const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - qw.center) < Math.abs(b.center - qw.center) ? sv : b, { center: 9999, sigma: 10 })
        const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
        const isPAC = idx === 2
        const nearP = pWaves.reduce((b, pv) => Math.abs(pv.center - qw.center) < Math.abs(b.center - qw.center) ? pv : b, { center: 9999, sigma: 25 })
        if (nearP.center < 9999) {
          const pOn  = nearP.center - 2 * nearP.sigma
          const pOff = nearP.center + 2 * nearP.sigma
          if (isPAC) {
            map.push({ id: 'ectopicFocus', onsetMs: pOn,      offsetMs: pOn + 40, state: 'ectopic' })
            map.push({ id: 'ra',           onsetMs: pOn + 15, offsetMs: pOff,     state: 'ectopic' })
            map.push({ id: 'la',           onsetMs: pOn,      offsetMs: pOff,     state: 'ectopic' })
          } else {
            map.push({ id: 'sa', onsetMs: pOn,      offsetMs: pOn + 40, state: 'active' })
            map.push({ id: 'ra', onsetMs: pOn + 10, offsetMs: pOff,     state: 'active' })
            map.push({ id: 'la', onsetMs: pOn + 25, offsetMs: pOff,     state: 'active' })
          }
          map.push({ id: 'av', onsetMs: pOff, offsetMs: qOn, state: 'active' })
        }
        map.push({ id: 'his',     onsetMs: qOn,      offsetMs: qOn + 20,  state: 'active' })
        map.push({ id: 'rbundle', onsetMs: qOn + 10, offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'lbundle', onsetMs: qOn + 10, offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'rv',      onsetMs: qOn + 20, offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20, offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35, offsetMs: sOff + 20, state: 'active' })
        if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
      })
      return map
    }

    case 'mobitzI': {
      const map = []
      const pWaves = waves.filter(wv => wv.name === 'P')
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      const avStates = ['active', 'delayed', 'blocked_flash']
      pWaves.forEach((pw, idx) => {
        const pOn  = pw.center - 2 * pw.sigma
        const pOff = pw.center + 2 * pw.sigma
        map.push({ id: 'sa', onsetMs: pOn,      offsetMs: pOn + 40, state: 'active' })
        map.push({ id: 'ra', onsetMs: pOn + 10, offsetMs: pOff,     state: 'active' })
        map.push({ id: 'la', onsetMs: pOn + 25, offsetMs: pOff,     state: 'active' })
        const nearQ = qWaves.reduce((b, qv) => {
          if (qv.center < pw.center) return b
          return (b.center > pw.center && qv.center < b.center) ? qv : b
        }, { center: 9999, sigma: 8 })
        if (nearQ.center < 9999 && idx < 3) {
          const qOn   = nearQ.center - 2 * nearQ.sigma
          const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? rv : b, { center: 9999, sigma: 12 })
          const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? sv : b, { center: 9999, sigma: 10 })
          const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
          map.push({ id: 'av',      onsetMs: pOff,     offsetMs: qOn,       state: avStates[idx] ?? 'delayed' })
          map.push({ id: 'his',     onsetMs: qOn,      offsetMs: qOn + 20,  state: 'active' })
          map.push({ id: 'rbundle', onsetMs: qOn + 10, offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'lbundle', onsetMs: qOn + 10, offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'rv',      onsetMs: qOn + 20, offsetMs: sOff,      state: 'active' })
          map.push({ id: 'lv',      onsetMs: qOn + 20, offsetMs: sOff,      state: 'active' })
          map.push({ id: 'apex',    onsetMs: qOn + 35, offsetMs: sOff + 20, state: 'active' })
          if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
        } else if (idx === 3) {
          map.push({ id: 'av', onsetMs: pOff, offsetMs: pOff + 200, state: 'blocked' })
        }
      })
      return map
    }

    case 'mobitzII': {
      const map = []
      const pWaves = waves.filter(wv => wv.name === 'P')
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      pWaves.forEach((pw, idx) => {
        const pOn  = pw.center - 2 * pw.sigma
        const pOff = pw.center + 2 * pw.sigma
        map.push({ id: 'sa', onsetMs: pOn,      offsetMs: pOn + 40, state: 'active' })
        map.push({ id: 'ra', onsetMs: pOn + 10, offsetMs: pOff,     state: 'active' })
        map.push({ id: 'la', onsetMs: pOn + 25, offsetMs: pOff,     state: 'active' })
        const nearQ = qWaves.reduce((b, qv) => {
          if (qv.center < pw.center) return b
          return (b.center > pw.center && qv.center < b.center) ? qv : b
        }, { center: 9999, sigma: 8 })
        if (nearQ.center < 9999 && idx < 2) {
          const qOn   = nearQ.center - 2 * nearQ.sigma
          const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? rv : b, { center: 9999, sigma: 12 })
          const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? sv : b, { center: 9999, sigma: 10 })
          const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
          map.push({ id: 'av',      onsetMs: pOff,     offsetMs: qOn,       state: 'delayed' })
          map.push({ id: 'his',     onsetMs: qOn,      offsetMs: qOn + 20,  state: 'active' })
          map.push({ id: 'rbundle', onsetMs: qOn + 10, offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'lbundle', onsetMs: qOn + 10, offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'rv',      onsetMs: qOn + 20, offsetMs: sOff,      state: 'active' })
          map.push({ id: 'lv',      onsetMs: qOn + 20, offsetMs: sOff,      state: 'active' })
          map.push({ id: 'apex',    onsetMs: qOn + 35, offsetMs: sOff + 20, state: 'active' })
          if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
        } else if (idx === 2) {
          map.push({ id: 'av', onsetMs: pOff, offsetMs: pOff + 200, state: 'blocked' })
        }
      })
      return map
    }

    case 'ventricularPaced': {
      const spikeWave = waves.find(wv => wv.name === 'Spike')
      const qWave     = waves.find(wv => wv.name === 'Q')
      const rWave     = waves.find(wv => wv.name === 'R')
      const sWave     = waves.find(wv => wv.name === 'S')
      const map = []
      if (spikeWave) {
        const spikeOn = spikeWave.center - 2 * spikeWave.sigma
        map.push({ id: 'pacer', onsetMs: spikeOn, offsetMs: spikeOn + 25, state: 'ectopic' })
      }
      if (qWave) {
        const qOn  = qWave.center - 2 * qWave.sigma
        const sOff = sWave ? sWave.center + 2 * sWave.sigma : qOn + 130
        map.push({ id: 'rv',   onsetMs: qOn + 10, offsetMs: sOff,      state: 'ectopic' })
        map.push({ id: 'lv',   onsetMs: qOn + 40, offsetMs: sOff + 40, state: 'ectopic' })
        map.push({ id: 'apex', onsetMs: qOn,       offsetMs: qOn + 30,  state: 'ectopic' })
        if (rWave) map.push({ id: '_rwave', onsetMs: rWave.center, offsetMs: rWave.center, rCenter: rWave.center, rSigma: rWave.sigma, state: 'meta' })
      }
      return map
    }

    default:
      return beatWindows(0)
  }
}

// ─── Color / state helpers ────────────────────────────────────────────────────
const STATE_FILL = {
  active:        '#10b981',
  delayed:       '#f59e0b',
  blocked:       '#ef4444',
  blocked_flash: '#ef4444',
  ectopic:       '#818cf8',
  shimmer:       '#10b981',
  hidden:        '#1e293b',
  meta:          null,
}
const INACTIVE_FILL   = '#1e293b'
const INACTIVE_STROKE = '#334155'

// ─── Smooth wavefront intensity (0→1 rise, plateau, 1→0 fall) ────────────────
function computeIntensity(progress) {
  const RISE = 0.40
  const FALL = 0.75
  if (progress <= 0 || progress >= 1) return 0
  if (progress < RISE) return progress / RISE
  if (progress > FALL) return (1 - progress) / (1 - FALL)
  return 1.0
}

// ─── Stations that get a top-to-bottom clip-rect sweep overlay ────────────────
// useStroke: true → the overlay path is stroke-based (bundle branches)
const SWEEP_TABLE = {
  la:      { overlayId: 'la_overlay',      clipId: 'la_clipRect',      fullH: 66,  useStroke: false },
  ra:      { overlayId: 'ra_overlay',      clipId: 'ra_clipRect',      fullH: 66,  useStroke: false },
  lv:      { overlayId: 'lv_overlay',      clipId: 'lv_clipRect',      fullH: 133, useStroke: false },
  rv:      { overlayId: 'rv_overlay',      clipId: 'rv_clipRect',      fullH: 133, useStroke: false },
  lbundle: { overlayId: 'lbundle_overlay', clipId: 'lbundle_clipRect', fullH: 51,  useStroke: true  },
  rbundle: { overlayId: 'rbundle_overlay', clipId: 'rbundle_clipRect', fullH: 51,  useStroke: true  },
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function HeartAnimation({ clockRef, rhythmId, rhythm, className = '' }) {
  const elRefs        = useRef({})
  const ventGroupRef  = useRef(null)
  const conductionMap = useMemo(() => buildConductionMap(rhythmId, rhythm.waves), [rhythmId, rhythm])

  const mapRef = useRef(conductionMap)
  mapRef.current = conductionMap

  useEffect(() => {
    let rafId

    const frame = () => {
      const { tInCycle, cycleMs, nativeCycleMs } = clockRef.current
      // Fix 1: map scaled tInCycle back to native ms so Tier-2 HR changes work
      const tMs = nativeCycleMs !== null
        ? tInCycle * (nativeCycleMs / cycleMs)
        : tInCycle

      const map = mapRef.current
      const els = elRefs.current

      // Reset all sweep overlays to invisible at the start of each frame;
      // active entries will re-show them below.
      Object.values(SWEEP_TABLE).forEach(({ overlayId, clipId }) => {
        const ov = els[overlayId]
        const cr = els[clipId]
        if (ov) ov.style.opacity = '0'
        if (cr) cr.setAttribute('height', '0')
      })

      const activeIds = new Set()
      let rEnvelope = 0

      map.forEach(entry => {
        // R-wave Gaussian for the contraction scale pulse
        if (entry.state === 'meta') {
          const dt = tMs - entry.rCenter
          rEnvelope = Math.max(rEnvelope, Math.exp(-(dt * dt) / (2 * entry.rSigma * entry.rSigma)))
          return
        }

        // Blocked nodes: persistent colored state, no sweep
        if (entry.state === 'blocked' || entry.state === 'blocked_flash') {
          const el = els[entry.id]
          if (el) {
            const isBundlePath = entry.id === 'lbundle' || entry.id === 'rbundle'
            if (isBundlePath) el.setAttribute('stroke', STATE_FILL.blocked)
            else              el.setAttribute('fill',   STATE_FILL.blocked)
            el.setAttribute('filter', 'url(#ekg-glow-red)')
            activeIds.add(entry.id + '_blocked')
          }
          return
        }

        // Shimmer nodes (AFib/flutter atria): chaotic opacity on background path
        if (entry.state === 'shimmer') {
          const el = els[entry.id]
          if (!el) return
          const f1 = entry.shimmerFreq  ?? 0.016
          const f2 = entry.shimmerFreq2 ?? 0
          const osc = f2
            ? Math.abs(Math.sin(tMs * f1) * Math.sin(tMs * f2))
            : (0.5 + 0.5 * Math.sin(tMs * f1))
          const opacity = 0.25 + 0.6 * osc
          el.setAttribute('fill', STATE_FILL.shimmer)
          el.style.opacity = opacity
          el.setAttribute('filter', opacity > 0.6 ? 'url(#ekg-glow)' : 'none')
          activeIds.add(entry.id + '_shimmer')
          return
        }

        // Normal timed activation
        if (tMs >= entry.onsetMs && tMs <= entry.offsetMs) {
          const windowMs  = entry.offsetMs - entry.onsetMs
          const progress  = windowMs > 0 ? (tMs - entry.onsetMs) / windowMs : 1
          const intensity = computeIntensity(progress)
          const fill   = STATE_FILL[entry.state] ?? STATE_FILL.active
          const filter = entry.state === 'ectopic' ? 'url(#ekg-glow-indigo)'
                       : entry.state === 'delayed' ? 'url(#ekg-glow-amber)'
                       : 'url(#ekg-glow)'

          const swpDef = SWEEP_TABLE[entry.id]
          if (swpDef) {
            // Directional sweep: grow clip rect + fade in/out overlay
            const overlay  = els[swpDef.overlayId]
            const clipRect = els[swpDef.clipId]
            if (clipRect) clipRect.setAttribute('height', progress * swpDef.fullH)
            if (overlay) {
              overlay.style.opacity = intensity
              overlay.setAttribute('filter', filter)
              if (swpDef.useStroke) overlay.setAttribute('stroke', fill)
              else                  overlay.setAttribute('fill',   fill)
            }
            // Background path stays dark (no entry in activeIds → reset loop clears it)
          } else {
            // Point / small element: opacity ramp only, no sweep
            const el = els[entry.id]
            if (el) {
              el.setAttribute('fill', fill)
              el.setAttribute('filter', filter)
              el.style.opacity = intensity
              activeIds.add(entry.id)
            }
          }
        }
      })

      // Reset inactive regular elements to dormant appearance
      Object.entries(els).forEach(([id, el]) => {
        if (!el) return
        // Overlays and clip rects are managed entirely by the SWEEP reset above
        if (id.endsWith('_overlay') || id.endsWith('_clipRect')) return
        // Skip if this element was explicitly activated this frame
        if (activeIds.has(id) || activeIds.has(id + '_blocked') || activeIds.has(id + '_shimmer')) return

        const isBundlePath = id === 'lbundle' || id === 'rbundle'
        if (isBundlePath) el.setAttribute('stroke', INACTIVE_STROKE)
        else              el.setAttribute('fill',   INACTIVE_FILL)
        el.setAttribute('filter', 'none')
        el.style.opacity = '1'
      })

      // Ventricular contraction pulse: subtle scale at R-wave peak
      if (ventGroupRef.current) {
        const scale = 1 + 0.045 * rEnvelope
        ventGroupRef.current.style.transform       = `scale(${scale})`
        ventGroupRef.current.style.transformOrigin = '100px 175px'
      }

      rafId = requestAnimationFrame(frame)
    }

    rafId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(rafId)
  }, [clockRef])

  const ref = id => el => { elRefs.current[id] = el }

  return (
    <div className={`flex flex-col items-center ${className}`}>
      <p className="text-xs uppercase tracking-widest text-gray-500 mb-2">Conduction System</p>
      <svg viewBox="0 0 200 260" width="200" height="260" style={{ overflow: 'visible' }}>
        <defs>
          {/* Glow filters */}
          <filter id="ekg-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="ekg-glow-red" x="-40%" y="-40%" width="180%" height="180%">
            <feFlood floodColor="#ef4444" floodOpacity="0.4" result="color" />
            <feComposite in="color" in2="SourceGraphic" operator="in" result="tinted" />
            <feGaussianBlur in="tinted" stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="ekg-glow-amber" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="ekg-glow-indigo" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>

          {/* Clip paths for directional sweep overlays */}
          <clipPath id="clip-la">
            <rect ref={ref('la_clipRect')} x="56" y="24" width="44" height="0" />
          </clipPath>
          <clipPath id="clip-ra">
            <rect ref={ref('ra_clipRect')} x="100" y="24" width="42" height="0" />
          </clipPath>
          <clipPath id="clip-lv">
            <rect ref={ref('lv_clipRect')} x="35" y="95" width="70" height="0" />
          </clipPath>
          <clipPath id="clip-rv">
            <rect ref={ref('rv_clipRect')} x="100" y="95" width="70" height="0" />
          </clipPath>
          <clipPath id="clip-lbundle">
            <rect ref={ref('lbundle_clipRect')} x="55" y="119" width="50" height="0" />
          </clipPath>
          <clipPath id="clip-rbundle">
            <rect ref={ref('rbundle_clipRect')} x="100" y="119" width="50" height="0" />
          </clipPath>
        </defs>

        {/* ── Heart silhouette outline ──────────────────────────────── */}
        <path
          d="M 55 95 Q 30 70 35 45 Q 40 22 60 22 Q 80 22 100 42
             Q 120 22 140 22 Q 160 22 165 45 Q 170 70 145 95
             L 100 230 Z"
          fill="#0a0e1a"
          stroke="#1e3a5f"
          strokeWidth="1.5"
        />

        {/* ── Atrial septum divider ─────────────────────────────────── */}
        <line x1="100" y1="42" x2="100" y2="95" stroke="#1e3a5f" strokeWidth="1" />

        {/* ── Left atrium (background + sweep overlay) ─────────────── */}
        <path
          ref={ref('la')}
          d="M 62 42 Q 62 28 80 26 Q 98 24 98 42 Q 98 75 70 88 Q 58 80 58 65 Z"
          fill={INACTIVE_FILL}
          stroke={INACTIVE_STROKE}
          strokeWidth="1"
        />
        <path
          ref={ref('la_overlay')}
          d="M 62 42 Q 62 28 80 26 Q 98 24 98 42 Q 98 75 70 88 Q 58 80 58 65 Z"
          fill={INACTIVE_FILL}
          stroke="none"
          clipPath="url(#clip-la)"
          style={{ opacity: 0 }}
        />

        {/* ── Right atrium (background + sweep overlay) ────────────── */}
        <path
          ref={ref('ra')}
          d="M 102 42 Q 102 24 120 26 Q 138 28 138 42 Q 138 65 130 80 Q 118 88 102 75 Z"
          fill={INACTIVE_FILL}
          stroke={INACTIVE_STROKE}
          strokeWidth="1"
        />
        <path
          ref={ref('ra_overlay')}
          d="M 102 42 Q 102 24 120 26 Q 138 28 138 42 Q 138 65 130 80 Q 118 88 102 75 Z"
          fill={INACTIVE_FILL}
          stroke="none"
          clipPath="url(#clip-ra)"
          style={{ opacity: 0 }}
        />

        {/* ── SA node ──────────────────────────────────────────────── */}
        <circle ref={ref('sa')} cx="128" cy="30" r="6" fill={INACTIVE_FILL} stroke={INACTIVE_STROKE} strokeWidth="1" />
        <text x="136" y="34" fontSize="7" fill="#64748b" fontFamily="monospace">SA</text>

        {/* ── Ectopic atrial focus (PAC source) ────────────────────── */}
        <circle ref={ref('ectopicFocus')} cx="75" cy="55" r="4" fill={INACTIVE_FILL} stroke="none" />

        {/* ── AV node ──────────────────────────────────────────────── */}
        <circle ref={ref('av')} cx="100" cy="97" r="6" fill={INACTIVE_FILL} stroke={INACTIVE_STROKE} strokeWidth="1" />
        <text x="108" y="101" fontSize="7" fill="#64748b" fontFamily="monospace">AV</text>

        {/* ── Bundle of His ─────────────────────────────────────────── */}
        <rect ref={ref('his')} x="97" y="103" width="6" height="16" rx="2"
          fill={INACTIVE_FILL} stroke={INACTIVE_STROKE} strokeWidth="1" />

        {/* ── Ventricular septum ───────────────────────────────────── */}
        <line x1="100" y1="95" x2="100" y2="225" stroke="#1e3a5f" strokeWidth="1" />

        {/* ── Left bundle branch (background + sweep overlay) ──────── */}
        <path
          ref={ref('lbundle')}
          d="M 97 119 Q 80 130 65 148 Q 58 158 62 170"
          fill="none"
          stroke={INACTIVE_STROKE}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          ref={ref('lbundle_overlay')}
          d="M 97 119 Q 80 130 65 148 Q 58 158 62 170"
          fill="none"
          stroke={INACTIVE_STROKE}
          strokeWidth="3"
          strokeLinecap="round"
          clipPath="url(#clip-lbundle)"
          style={{ opacity: 0 }}
        />

        {/* ── Right bundle branch (background + sweep overlay) ─────── */}
        <path
          ref={ref('rbundle')}
          d="M 103 119 Q 120 130 135 148 Q 142 158 138 170"
          fill="none"
          stroke={INACTIVE_STROKE}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          ref={ref('rbundle_overlay')}
          d="M 103 119 Q 120 130 135 148 Q 142 158 138 170"
          fill="none"
          stroke={INACTIVE_STROKE}
          strokeWidth="3"
          strokeLinecap="round"
          clipPath="url(#clip-rbundle)"
          style={{ opacity: 0 }}
        />

        {/* ── Ventricles (scale group for contraction pulse) ────────── */}
        <g ref={ventGroupRef}>
          {/* Left ventricle background + sweep overlay */}
          <path
            ref={ref('lv')}
            d="M 58 95 Q 42 110 40 140 Q 38 170 60 190 Q 80 210 100 228
               Q 98 200 95 175 Q 90 148 88 125 Q 80 105 70 97 Z"
            fill={INACTIVE_FILL}
            stroke={INACTIVE_STROKE}
            strokeWidth="1"
          />
          <path
            ref={ref('lv_overlay')}
            d="M 58 95 Q 42 110 40 140 Q 38 170 60 190 Q 80 210 100 228
               Q 98 200 95 175 Q 90 148 88 125 Q 80 105 70 97 Z"
            fill={INACTIVE_FILL}
            stroke="none"
            clipPath="url(#clip-lv)"
            style={{ opacity: 0 }}
          />

          {/* Right ventricle background + sweep overlay */}
          <path
            ref={ref('rv')}
            d="M 142 95 Q 158 110 160 140 Q 162 170 140 190 Q 120 210 100 228
               Q 102 200 105 175 Q 110 148 112 125 Q 120 105 130 97 Z"
            fill={INACTIVE_FILL}
            stroke={INACTIVE_STROKE}
            strokeWidth="1"
          />
          <path
            ref={ref('rv_overlay')}
            d="M 142 95 Q 158 110 160 140 Q 162 170 140 190 Q 120 210 100 228
               Q 102 200 105 175 Q 110 148 112 125 Q 120 105 130 97 Z"
            fill={INACTIVE_FILL}
            stroke="none"
            clipPath="url(#clip-rv)"
            style={{ opacity: 0 }}
          />

          {/* Apex / Purkinje fan */}
          <path
            ref={ref('apex')}
            d="M 70 195 Q 85 220 100 228 Q 115 220 130 195 Q 110 210 100 215 Q 90 210 70 195 Z"
            fill={INACTIVE_FILL}
            stroke={INACTIVE_STROKE}
            strokeWidth="1"
          />
        </g>

        {/* ── Pacemaker lead tip ────────────────────────────────────── */}
        <circle ref={ref('pacer')} cx="100" cy="215" r="5" fill={INACTIVE_FILL} stroke="none" />

        {/* ── Labels ───────────────────────────────────────────────── */}
        <text x="34"  y="150" fontSize="7.5" fill="#475569" fontFamily="monospace" textAnchor="middle">LV</text>
        <text x="166" y="150" fontSize="7.5" fill="#475569" fontFamily="monospace" textAnchor="middle">RV</text>
        <text x="72"  y="52"  fontSize="7.5" fill="#475569" fontFamily="monospace" textAnchor="middle">LA</text>
        <text x="128" y="52"  fontSize="7.5" fill="#475569" fontFamily="monospace" textAnchor="middle">RA</text>
      </svg>

      <RhythmBadge rhythmId={rhythmId} />
    </div>
  )
}

function RhythmBadge({ rhythmId }) {
  const BADGES = {
    firstDegreeBlock:   { text: 'Prolonged AV delay',                    color: 'text-amber-400'  },
    lbbb:               { text: 'Left bundle blocked',                    color: 'text-red-400'    },
    rbbb:               { text: 'Right bundle blocked',                   color: 'text-red-400'    },
    thirdDegreeBlock:   { text: 'Complete AV block',                      color: 'text-red-400'    },
    atrialFlutter:      { text: 'Re-entrant atrial circuit · 2:1 conduction', color: 'text-amber-400'  },
    atrialFibrillation: { text: 'Chaotic atrial activity',                color: 'text-amber-400'  },
    pvcs:               { text: 'Ventricular ectopic focus',               color: 'text-indigo-400' },
    pacs:               { text: 'Atrial ectopic focus',                    color: 'text-indigo-400' },
    mobitzI:            { text: 'Progressive AV delay → block',            color: 'text-amber-400'  },
    mobitzII:           { text: 'Sudden AV block (fixed PR)',               color: 'text-red-400'    },
    ventricularPaced:   { text: 'Pacemaker stimulus',                      color: 'text-indigo-400' },
  }
  const badge = BADGES[rhythmId]
  if (!badge) return null
  return (
    <p className={`text-xs mt-2 text-center leading-tight ${badge.color}`}>{badge.text}</p>
  )
}
