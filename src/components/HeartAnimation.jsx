import { useEffect, useRef, useMemo } from 'react'

// ─── Conduction map builder ──────────────────────────────────────────────────
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
    const tOff = beatOffset + (has('T') ? off('T') : 430)
    const rCtr = beatOffset + (has('R') ? w('R').center : 284)
    const rSig = has('R') ? w('R').sigma : 12

    const entries = []

    if (!hideSA && !ectopicAtria && !pacerBeat)
      entries.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40,           state })
    if (!hideAtria && !ectopicAtria && !pacerBeat) {
      entries.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,               state })
      // Bachmann's bundle: explicit right-to-left interatrial pathway
      entries.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32,           state })
      entries.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,               state })
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

    // Ventricular repolarization: base-to-apex (opposite direction to depolarization)
    entries.push({ id: 'repolLV', onsetMs: sOff + 10, offsetMs: tOff, state: 'repol' })
    entries.push({ id: 'repolRV', onsetMs: sOff + 10, offsetMs: tOff, state: 'repol' })

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

    case 'vtach':
      return beatWindows(0, { hideSA: true, hideAtria: true, hideAV: true, hideBundles: true, state: 'ectopic' })

    case 'thirdDegreeBlock': {
      const map = []
      const pWaves = waves.filter(wv => wv.name === 'P')
      pWaves.forEach(pw => {
        const pOn  = pw.center - 2 * pw.sigma
        const pOff = pw.center + 2 * pw.sigma
        map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
        map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
        map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
        map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
      })
      map.push({ id: 'av', onsetMs: 0, offsetMs: 9999, state: 'blocked' })
      const qEsc = waves.find(wv => wv.name === 'Q')
      if (qEsc) {
        const qOn  = qEsc.center - 2 * qEsc.sigma
        const sWave = waves.find(wv => wv.name === 'S')
        const sOff  = sWave ? sWave.center + 2 * sWave.sigma : qOn + 80
        const tWave = waves.find(wv => wv.name === 'T')
        const tOff  = tWave ? tWave.center + 2 * tWave.sigma : sOff + 130
        const rW    = waves.find(wv => wv.name === 'R')
        map.push({ id: 'rv',      onsetMs: qOn + 15,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 15,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 30,  offsetMs: sOff + 20, state: 'active' })
        map.push({ id: 'repolLV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
        map.push({ id: 'repolRV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
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
        const tWave = waves.reduce((best, wv) => {
          if (wv.name !== 'T') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 20 })
        const tOff = tWave.center < 9999 ? tWave.center + 2 * tWave.sigma : sOff + 130
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
        map.push({ id: 'repolLV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
        map.push({ id: 'repolRV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
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
        const nearT = waves.reduce((best, wv) => {
          if (wv.name !== 'T') return best
          return Math.abs(wv.center - qw.center) < Math.abs(best.center - qw.center) ? wv : best
        }, { center: 9999, sigma: 20 })
        const sOff = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
        const tOff = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
        map.push({ id: 'av',      onsetMs: qOn - 80,  offsetMs: qOn,       state: 'active' })
        map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
        map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
        map.push({ id: 'repolLV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
        map.push({ id: 'repolRV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
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
      const tWaves = waves.filter(wv => wv.name === 'T')
      qWaves.forEach((qw, idx) => {
        const qOn   = qw.center - 2 * qw.sigma
        const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - qw.center) < Math.abs(b.center - qw.center) ? rv : b, { center: 9999, sigma: 12 })
        const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - qw.center) < Math.abs(b.center - qw.center) ? sv : b, { center: 9999, sigma: 10 })
        const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - qw.center) < Math.abs(b.center - qw.center) ? tv : b, { center: 9999, sigma: 20 })
        const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
        const tOff  = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
        const isPVC = idx === 3
        if (!isPVC) {
          const nearP = pWaves.reduce((b, pv) => Math.abs(pv.center - qw.center) < Math.abs(b.center - qw.center) ? pv : b, { center: 9999, sigma: 25 })
          if (nearP.center < 9999) {
            const pOn  = nearP.center - 2 * nearP.sigma
            const pOff = nearP.center + 2 * nearP.sigma
            map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
            map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
            map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
            map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
            map.push({ id: 'av',       onsetMs: pOff,      offsetMs: qOn,      state: 'active' })
            map.push({ id: 'his',      onsetMs: qOn,       offsetMs: qOn + 20, state: 'active' })
            map.push({ id: 'rbundle',  onsetMs: qOn + 10,  offsetMs: qOn + 45, state: 'active' })
            map.push({ id: 'lbundle',  onsetMs: qOn + 10,  offsetMs: qOn + 45, state: 'active' })
          }
        }
        map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: isPVC ? 'ectopic' : 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: isPVC ? 'ectopic' : 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: isPVC ? 'ectopic' : 'active' })
        map.push({ id: 'repolLV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol' })
        map.push({ id: 'repolRV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol' })
        if (nearR.center < 9999) map.push({ id: '_rwave', onsetMs: nearR.center, offsetMs: nearR.center, rCenter: nearR.center, rSigma: nearR.sigma, state: 'meta' })
      })
      return map
    }

    case 'pacs': {
      const map = []
      const qWaves = waves.filter(wv => wv.name === 'Q')
      const rWaves = waves.filter(wv => wv.name === 'R')
      const sWaves = waves.filter(wv => wv.name === 'S')
      const tWaves = waves.filter(wv => wv.name === 'T')
      const pWaves = waves.filter(wv => wv.name === 'P')
      qWaves.forEach((qw, idx) => {
        const qOn   = qw.center - 2 * qw.sigma
        const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - qw.center) < Math.abs(b.center - qw.center) ? rv : b, { center: 9999, sigma: 12 })
        const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - qw.center) < Math.abs(b.center - qw.center) ? sv : b, { center: 9999, sigma: 10 })
        const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - qw.center) < Math.abs(b.center - qw.center) ? tv : b, { center: 9999, sigma: 20 })
        const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
        const tOff  = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
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
            map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
            map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
            map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
            map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
          }
          map.push({ id: 'av', onsetMs: pOff, offsetMs: qOn, state: 'active' })
        }
        map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
        map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
        map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
        map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
        map.push({ id: 'repolLV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
        map.push({ id: 'repolRV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
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
      const tWaves = waves.filter(wv => wv.name === 'T')
      const avStates = ['active', 'delayed', 'blocked_flash']
      pWaves.forEach((pw, idx) => {
        const pOn  = pw.center - 2 * pw.sigma
        const pOff = pw.center + 2 * pw.sigma
        map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
        map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
        map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
        map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
        const nearQ = qWaves.reduce((b, qv) => {
          if (qv.center < pw.center) return b
          return (b.center > pw.center && qv.center < b.center) ? qv : b
        }, { center: 9999, sigma: 8 })
        if (nearQ.center < 9999 && idx < 3) {
          const qOn   = nearQ.center - 2 * nearQ.sigma
          const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? rv : b, { center: 9999, sigma: 12 })
          const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? sv : b, { center: 9999, sigma: 10 })
          const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? tv : b, { center: 9999, sigma: 20 })
          const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
          const tOff  = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
          map.push({ id: 'av',      onsetMs: pOff,      offsetMs: qOn,       state: avStates[idx] ?? 'delayed' })
          map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
          map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
          map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
          map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
          map.push({ id: 'repolLV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
          map.push({ id: 'repolRV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
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
      const tWaves = waves.filter(wv => wv.name === 'T')
      pWaves.forEach((pw, idx) => {
        const pOn  = pw.center - 2 * pw.sigma
        const pOff = pw.center + 2 * pw.sigma
        map.push({ id: 'sa',       onsetMs: pOn,       offsetMs: pOn + 40, state: 'active' })
        map.push({ id: 'ra',       onsetMs: pOn + 10,  offsetMs: pOff,     state: 'active' })
        map.push({ id: 'bachmann', onsetMs: pOn + 12,  offsetMs: pOn + 32, state: 'active' })
        map.push({ id: 'la',       onsetMs: pOn + 25,  offsetMs: pOff,     state: 'active' })
        const nearQ = qWaves.reduce((b, qv) => {
          if (qv.center < pw.center) return b
          return (b.center > pw.center && qv.center < b.center) ? qv : b
        }, { center: 9999, sigma: 8 })
        if (nearQ.center < 9999 && idx < 2) {
          const qOn   = nearQ.center - 2 * nearQ.sigma
          const nearR = rWaves.reduce((b, rv) => Math.abs(rv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? rv : b, { center: 9999, sigma: 12 })
          const nearS = sWaves.reduce((b, sv) => Math.abs(sv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? sv : b, { center: 9999, sigma: 10 })
          const nearT = tWaves.reduce((b, tv) => Math.abs(tv.center - nearQ.center) < Math.abs(b.center - nearQ.center) ? tv : b, { center: 9999, sigma: 20 })
          const sOff  = nearS.center < 9999 ? nearS.center + 2 * nearS.sigma : qOn + 80
          const tOff  = nearT.center < 9999 ? nearT.center + 2 * nearT.sigma : sOff + 130
          map.push({ id: 'av',      onsetMs: pOff,      offsetMs: qOn,       state: 'delayed' })
          map.push({ id: 'his',     onsetMs: qOn,       offsetMs: qOn + 20,  state: 'active' })
          map.push({ id: 'rbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'lbundle', onsetMs: qOn + 10,  offsetMs: qOn + 45,  state: 'active' })
          map.push({ id: 'rv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
          map.push({ id: 'lv',      onsetMs: qOn + 20,  offsetMs: sOff,      state: 'active' })
          map.push({ id: 'apex',    onsetMs: qOn + 35,  offsetMs: sOff + 20, state: 'active' })
          map.push({ id: 'repolLV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
          map.push({ id: 'repolRV', onsetMs: sOff + 10, offsetMs: tOff,      state: 'repol'  })
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
      const tWave     = waves.find(wv => wv.name === 'T')
      const map = []
      if (spikeWave) {
        const spikeOn = spikeWave.center - 2 * spikeWave.sigma
        map.push({ id: 'pacer', onsetMs: spikeOn, offsetMs: spikeOn + 25, state: 'ectopic' })
      }
      if (qWave) {
        const qOn  = qWave.center - 2 * qWave.sigma
        const sOff = sWave ? sWave.center + 2 * sWave.sigma : qOn + 130
        const tOff = tWave ? tWave.center + 2 * tWave.sigma : sOff + 130
        map.push({ id: 'rv',      onsetMs: qOn + 10,  offsetMs: sOff,      state: 'ectopic' })
        map.push({ id: 'lv',      onsetMs: qOn + 40,  offsetMs: sOff + 40, state: 'ectopic' })
        map.push({ id: 'apex',    onsetMs: qOn,        offsetMs: qOn + 30,  state: 'ectopic' })
        map.push({ id: 'repolLV', onsetMs: sOff + 10,  offsetMs: tOff,     state: 'repol'   })
        map.push({ id: 'repolRV', onsetMs: sOff + 10,  offsetMs: tOff,     state: 'repol'   })
        if (rWave) map.push({ id: '_rwave', onsetMs: rWave.center, offsetMs: rWave.center, rCenter: rWave.center, rSigma: rWave.sigma, state: 'meta' })
      }
      return map
    }

    default:
      return beatWindows(0)
  }
}

// ─── Color / state helpers ────────────────────────────────────────────────────
// Colorblind-safe: blue=depol, amber=repol, purple=block (no red-green)
const STATE_FILL = {
  active:        '#3b82f6',  // blue  — depolarization
  delayed:       '#f59e0b',  // amber — slow conduction
  blocked:       '#a855f7',  // purple — block
  blocked_flash: '#a855f7',  // purple — block flash
  ectopic:       '#818cf8',  // indigo — ectopic focus
  shimmer:       '#3b82f6',  // blue  — fibrillatory shimmer
  repol:         '#f59e0b',  // amber — repolarization
  hidden:        '#1e293b',
  meta:          null,
}
const INACTIVE_FILL   = '#1e293b'
const INACTIVE_STROKE = '#334155'

function computeIntensity(progress) {
  const RISE = 0.40
  const FALL = 0.75
  if (progress <= 0 || progress >= 1) return 0
  if (progress < RISE) return progress / RISE
  if (progress > FALL) return (1 - progress) / (1 - FALL)
  return 1.0
}

// ─── Depolarization sweep table (top-to-bottom clip rect) ─────────────────────
const SWEEP_TABLE = {
  la:      { overlayId: 'la_overlay',      clipId: 'la_clipRect',      fullH: 66,  useStroke: false },
  ra:      { overlayId: 'ra_overlay',      clipId: 'ra_clipRect',      fullH: 66,  useStroke: false },
  lv:      { overlayId: 'lv_overlay',      clipId: 'lv_clipRect',      fullH: 133, useStroke: false },
  rv:      { overlayId: 'rv_overlay',      clipId: 'rv_clipRect',      fullH: 133, useStroke: false },
  lbundle: { overlayId: 'lbundle_overlay', clipId: 'lbundle_clipRect', fullH: 51,  useStroke: true  },
  rbundle: { overlayId: 'rbundle_overlay', clipId: 'rbundle_clipRect', fullH: 51,  useStroke: true  },
}

// ─── Repolarization sweep table (bottom-to-top clip rect — base-to-apex) ──────
const REPOL_TABLE = {
  repolLV: { overlayId: 'lv_repol_overlay', clipId: 'lv_repol_clipRect', topY: 95, fullH: 133 },
  repolRV: { overlayId: 'rv_repol_overlay', clipId: 'rv_repol_clipRect', topY: 95, fullH: 133 },
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
      const tMs = nativeCycleMs !== null
        ? tInCycle * (nativeCycleMs / cycleMs)
        : tInCycle

      const map = mapRef.current
      const els = elRefs.current

      // Reset all depol sweep overlays
      Object.values(SWEEP_TABLE).forEach(({ overlayId, clipId }) => {
        const ov = els[overlayId]
        const cr = els[clipId]
        if (ov) ov.style.opacity = '0'
        if (cr) cr.setAttribute('height', '0')
      })

      // Reset all repol sweep overlays (start at bottom, height=0)
      Object.values(REPOL_TABLE).forEach(({ overlayId, clipId, topY, fullH }) => {
        const ov = els[overlayId]
        const cr = els[clipId]
        if (ov) ov.style.opacity = '0'
        if (cr) {
          cr.setAttribute('y', String(topY + fullH))
          cr.setAttribute('height', '0')
        }
      })

      const activeIds = new Set()
      let rEnvelope = 0

      map.forEach(entry => {
        if (entry.state === 'meta') {
          const dt = tMs - entry.rCenter
          rEnvelope = Math.max(rEnvelope, Math.exp(-(dt * dt) / (2 * entry.rSigma * entry.rSigma)))
          return
        }

        if (entry.state === 'blocked' || entry.state === 'blocked_flash') {
          const el = els[entry.id]
          if (el) {
            const isBundlePath = entry.id === 'lbundle' || entry.id === 'rbundle'
            if (isBundlePath) el.setAttribute('stroke', STATE_FILL.blocked)
            else              el.setAttribute('fill',   STATE_FILL.blocked)
            el.setAttribute('filter', 'url(#ECG-glow-purple)')
            activeIds.add(entry.id + '_blocked')
          }
          return
        }

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
          el.setAttribute('filter', opacity > 0.6 ? 'url(#ECG-glow)' : 'none')
          activeIds.add(entry.id + '_shimmer')
          return
        }

        if (tMs >= entry.onsetMs && tMs <= entry.offsetMs) {
          const windowMs  = entry.offsetMs - entry.onsetMs
          const progress  = windowMs > 0 ? (tMs - entry.onsetMs) / windowMs : 1
          const intensity = computeIntensity(progress)

          // Repolarization: bottom-to-top sweep (base-to-apex)
          if (entry.state === 'repol') {
            const repDef = REPOL_TABLE[entry.id]
            if (repDef) {
              const overlay  = els[repDef.overlayId]
              const clipRect = els[repDef.clipId]
              if (clipRect) {
                const sweepH = repDef.fullH * progress
                const sweepY = repDef.topY + repDef.fullH - sweepH
                clipRect.setAttribute('y', String(sweepY))
                clipRect.setAttribute('height', String(sweepH))
              }
              if (overlay) {
                overlay.style.opacity = intensity
                overlay.setAttribute('fill', STATE_FILL.repol)
                overlay.setAttribute('filter', 'url(#ECG-glow-amber)')
              }
            }
            return
          }

          const fill   = STATE_FILL[entry.state] ?? STATE_FILL.active
          const filter = entry.state === 'ectopic' ? 'url(#ECG-glow-indigo)'
                       : entry.state === 'delayed' ? 'url(#ECG-glow-amber)'
                       : 'url(#ECG-glow)'

          const swpDef = SWEEP_TABLE[entry.id]
          if (swpDef) {
            const overlay  = els[swpDef.overlayId]
            const clipRect = els[swpDef.clipId]
            if (clipRect) clipRect.setAttribute('height', progress * swpDef.fullH)
            if (overlay) {
              overlay.style.opacity = intensity
              overlay.setAttribute('filter', filter)
              if (swpDef.useStroke) overlay.setAttribute('stroke', fill)
              else                  overlay.setAttribute('fill',   fill)
            }
          } else {
            const el = els[entry.id]
            if (el) {
              // Bachmann's bundle is stroke-based
              if (entry.id === 'bachmann') el.setAttribute('stroke', fill)
              else                         el.setAttribute('fill',   fill)
              el.setAttribute('filter', filter)
              el.style.opacity = intensity
              activeIds.add(entry.id)
            }
          }
        }
      })

      // Reset inactive elements to dormant appearance
      Object.entries(els).forEach(([id, el]) => {
        if (!el) return
        if (id.endsWith('_overlay') || id.endsWith('_clipRect')) return
        if (activeIds.has(id) || activeIds.has(id + '_blocked') || activeIds.has(id + '_shimmer')) return

        const isBundlePath = id === 'lbundle' || id === 'rbundle' || id === 'bachmann'
        if (isBundlePath) el.setAttribute('stroke', INACTIVE_STROKE)
        else              el.setAttribute('fill',   INACTIVE_FILL)
        el.setAttribute('filter', 'none')
        el.style.opacity = '1'
      })

      // Ventricular contraction pulse
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
          {/* Blue glow for depolarization */}
          <filter id="ECG-glow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Purple glow for blocks */}
          <filter id="ECG-glow-purple" x="-40%" y="-40%" width="180%" height="180%">
            <feFlood floodColor="#a855f7" floodOpacity="0.4" result="color" />
            <feComposite in="color" in2="SourceGraphic" operator="in" result="tinted" />
            <feGaussianBlur in="tinted" stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Amber glow for delayed/repolarization */}
          <filter id="ECG-glow-amber" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {/* Indigo glow for ectopic */}
          <filter id="ECG-glow-indigo" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>

          {/* ── Depol clip paths (top-to-bottom) ──
               Anatomical layout: RA/RV on LEFT (x<100), LA/LV on RIGHT (x>100)
               Clip rects must match the physical region each element occupies. */}
          <clipPath id="clip-ra">
            <rect ref={ref('ra_clipRect')} x="56" y="24" width="44" height="0" />
          </clipPath>
          <clipPath id="clip-la">
            <rect ref={ref('la_clipRect')} x="100" y="24" width="42" height="0" />
          </clipPath>
          <clipPath id="clip-rv">
            <rect ref={ref('rv_clipRect')} x="35" y="95" width="70" height="0" />
          </clipPath>
          <clipPath id="clip-lv">
            <rect ref={ref('lv_clipRect')} x="100" y="95" width="70" height="0" />
          </clipPath>
          <clipPath id="clip-rbundle">
            <rect ref={ref('rbundle_clipRect')} x="55" y="119" width="50" height="0" />
          </clipPath>
          <clipPath id="clip-lbundle">
            <rect ref={ref('lbundle_clipRect')} x="100" y="119" width="50" height="0" />
          </clipPath>
          {/* Repol clip paths (bottom-to-top, initial y at bottom) */}
          <clipPath id="clip-rv-repol">
            <rect ref={ref('rv_repol_clipRect')} x="35" y="228" width="70" height="0" />
          </clipPath>
          <clipPath id="clip-lv-repol">
            <rect ref={ref('lv_repol_clipRect')} x="100" y="228" width="70" height="0" />
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

        {/* ── RIGHT ATRIUM — left side of SVG (patient's right = viewer's left) */}
        <path
          ref={ref('ra')}
          d="M 62 42 Q 62 28 80 26 Q 98 24 98 42 Q 98 75 70 88 Q 58 80 58 65 Z"
          fill={INACTIVE_FILL}
          stroke={INACTIVE_STROKE}
          strokeWidth="1"
        />
        <path
          ref={ref('ra_overlay')}
          d="M 62 42 Q 62 28 80 26 Q 98 24 98 42 Q 98 75 70 88 Q 58 80 58 65 Z"
          fill={INACTIVE_FILL}
          stroke="none"
          clipPath="url(#clip-ra)"
          style={{ opacity: 0 }}
        />

        {/* ── LEFT ATRIUM — right side of SVG ─────────────────────── */}
        <path
          ref={ref('la')}
          d="M 102 42 Q 102 24 120 26 Q 138 28 138 42 Q 138 65 130 80 Q 118 88 102 75 Z"
          fill={INACTIVE_FILL}
          stroke={INACTIVE_STROKE}
          strokeWidth="1"
        />
        <path
          ref={ref('la_overlay')}
          d="M 102 42 Q 102 24 120 26 Q 138 28 138 42 Q 138 65 130 80 Q 118 88 102 75 Z"
          fill={INACTIVE_FILL}
          stroke="none"
          clipPath="url(#clip-la)"
          style={{ opacity: 0 }}
        />

        {/* ── SVC stub above SA node (RA is on LEFT) ────────────────── */}
        <line x1="70" y1="7" x2="70" y2="16" stroke="#334155" strokeWidth="1.5" strokeDasharray="2,2" />
        <text x="52" y="11" fontSize="6" fill="#475569" fontFamily="monospace">SVC</text>

        {/* ── SA node at high RA / SVC junction (LEFT side) ─────────── */}
        <circle ref={ref('sa')} cx="70" cy="18" r="6" fill={INACTIVE_FILL} stroke={INACTIVE_STROKE} strokeWidth="1" />
        <text x="78" y="22" fontSize="7" fill="#64748b" fontFamily="monospace">SA</text>

        {/* ── Bachmann's bundle: RA→LA, travels LEFT to RIGHT ──────── */}
        <path
          ref={ref('bachmann')}
          d="M 76 22 Q 100 20 124 28"
          fill="none"
          stroke={INACTIVE_STROKE}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="3,2"
        />

        {/* ── Ectopic atrial focus (PAC — in LA, right side) ────────── */}
        <circle ref={ref('ectopicFocus')} cx="125" cy="55" r="4" fill={INACTIVE_FILL} stroke="none" />

        {/* ── AV node ──────────────────────────────────────────────── */}
        <circle ref={ref('av')} cx="100" cy="97" r="6" fill={INACTIVE_FILL} stroke={INACTIVE_STROKE} strokeWidth="1" />
        <text x="108" y="101" fontSize="7" fill="#64748b" fontFamily="monospace">AV</text>

        {/* ── Bundle of His ─────────────────────────────────────────── */}
        <rect ref={ref('his')} x="97" y="103" width="6" height="16" rx="2"
          fill={INACTIVE_FILL} stroke={INACTIVE_STROKE} strokeWidth="1" />

        {/* ── Ventricular septum ───────────────────────────────────── */}
        <line x1="100" y1="95" x2="100" y2="225" stroke="#1e3a5f" strokeWidth="1" />

        {/* ── RIGHT BUNDLE BRANCH — left side, toward RV ───────────── */}
        <path
          ref={ref('rbundle')}
          d="M 97 119 Q 80 130 65 148 Q 58 158 62 170"
          fill="none"
          stroke={INACTIVE_STROKE}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          ref={ref('rbundle_overlay')}
          d="M 97 119 Q 80 130 65 148 Q 58 158 62 170"
          fill="none"
          stroke={INACTIVE_STROKE}
          strokeWidth="3"
          strokeLinecap="round"
          clipPath="url(#clip-rbundle)"
          style={{ opacity: 0 }}
        />

        {/* ── LEFT BUNDLE BRANCH — right side, toward LV ───────────── */}
        <path
          ref={ref('lbundle')}
          d="M 103 119 Q 120 130 135 148 Q 142 158 138 170"
          fill="none"
          stroke={INACTIVE_STROKE}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          ref={ref('lbundle_overlay')}
          d="M 103 119 Q 120 130 135 148 Q 142 158 138 170"
          fill="none"
          stroke={INACTIVE_STROKE}
          strokeWidth="3"
          strokeLinecap="round"
          clipPath="url(#clip-lbundle)"
          style={{ opacity: 0 }}
        />

        {/* ── Ventricles (scale group for contraction pulse) ────────── */}
        <g ref={ventGroupRef}>
          {/* RIGHT VENTRICLE — left side of SVG */}
          <path
            ref={ref('rv')}
            d="M 58 95 Q 42 110 40 140 Q 38 170 60 190 Q 80 210 100 228
               Q 98 200 95 175 Q 90 148 88 125 Q 80 105 70 97 Z"
            fill={INACTIVE_FILL}
            stroke={INACTIVE_STROKE}
            strokeWidth="1"
          />
          <path
            ref={ref('rv_overlay')}
            d="M 58 95 Q 42 110 40 140 Q 38 170 60 190 Q 80 210 100 228
               Q 98 200 95 175 Q 90 148 88 125 Q 80 105 70 97 Z"
            fill={INACTIVE_FILL}
            stroke="none"
            clipPath="url(#clip-rv)"
            style={{ opacity: 0 }}
          />
          <path
            ref={ref('rv_repol_overlay')}
            d="M 58 95 Q 42 110 40 140 Q 38 170 60 190 Q 80 210 100 228
               Q 98 200 95 175 Q 90 148 88 125 Q 80 105 70 97 Z"
            fill={INACTIVE_FILL}
            stroke="none"
            clipPath="url(#clip-rv-repol)"
            style={{ opacity: 0 }}
          />

          {/* LEFT VENTRICLE — right side of SVG */}
          <path
            ref={ref('lv')}
            d="M 142 95 Q 158 110 160 140 Q 162 170 140 190 Q 120 210 100 228
               Q 102 200 105 175 Q 110 148 112 125 Q 120 105 130 97 Z"
            fill={INACTIVE_FILL}
            stroke={INACTIVE_STROKE}
            strokeWidth="1"
          />
          <path
            ref={ref('lv_overlay')}
            d="M 142 95 Q 158 110 160 140 Q 162 170 140 190 Q 120 210 100 228
               Q 102 200 105 175 Q 110 148 112 125 Q 120 105 130 97 Z"
            fill={INACTIVE_FILL}
            stroke="none"
            clipPath="url(#clip-lv)"
            style={{ opacity: 0 }}
          />
          <path
            ref={ref('lv_repol_overlay')}
            d="M 142 95 Q 158 110 160 140 Q 162 170 140 190 Q 120 210 100 228
               Q 102 200 105 175 Q 110 148 112 125 Q 120 105 130 97 Z"
            fill={INACTIVE_FILL}
            stroke="none"
            clipPath="url(#clip-lv-repol)"
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

        {/* ── Labels: RA/RV on left, LA/LV on right ────────────────── */}
        <text x="34"  y="150" fontSize="7.5" fill="#475569" fontFamily="monospace" textAnchor="middle">RV</text>
        <text x="166" y="150" fontSize="7.5" fill="#475569" fontFamily="monospace" textAnchor="middle">LV</text>
        <text x="72"  y="52"  fontSize="7.5" fill="#475569" fontFamily="monospace" textAnchor="middle">RA</text>
        <text x="128" y="52"  fontSize="7.5" fill="#475569" fontFamily="monospace" textAnchor="middle">LA</text>
      </svg>

      <RhythmBadge rhythmId={rhythmId} />

      {/* Color legend */}
      <div className="flex gap-3 mt-2">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#3b82f6' }} />
          <span className="text-gray-500" style={{ fontSize: '10px' }}>Depol</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#f59e0b' }} />
          <span className="text-gray-500" style={{ fontSize: '10px' }}>Repol</span>
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: '#a855f7' }} />
          <span className="text-gray-500" style={{ fontSize: '10px' }}>Block</span>
        </span>
      </div>
    </div>
  )
}

function RhythmBadge({ rhythmId }) {
  const BADGES = {
    firstDegreeBlock:   { text: 'Prolonged AV delay',                         color: 'text-amber-400'  },
    lbbb:               { text: 'Left bundle blocked',                         color: 'text-violet-400' },
    rbbb:               { text: 'Right bundle blocked',                        color: 'text-violet-400' },
    thirdDegreeBlock:   { text: 'Complete AV block',                           color: 'text-violet-400' },
    atrialFlutter:      { text: 'Re-entrant atrial circuit · 2:1 conduction',  color: 'text-amber-400'  },
    atrialFibrillation: { text: 'Chaotic atrial activity',                     color: 'text-amber-400'  },
    pvcs:               { text: 'Ventricular ectopic focus',                   color: 'text-indigo-400' },
    pacs:               { text: 'Atrial ectopic focus',                        color: 'text-indigo-400' },
    mobitzI:            { text: 'Progressive AV delay → block',                color: 'text-amber-400'  },
    mobitzII:           { text: 'Sudden AV block (fixed PR)',                  color: 'text-violet-400' },
    ventricularPaced:   { text: 'Pacemaker stimulus',                          color: 'text-indigo-400' },
    vtach:              { text: 'Ventricular ectopic tachycardia',             color: 'text-indigo-400' },
  }
  const badge = BADGES[rhythmId]
  if (!badge) return null
  return (
    <p className={`text-xs mt-2 text-center leading-tight ${badge.color}`}>{badge.text}</p>
  )
}
