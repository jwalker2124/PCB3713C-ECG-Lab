import { useEffect, useRef, useState } from 'react'
import ModulePage from '../../components/ModulePage'
import HeartAnimation from '../../components/HeartAnimation'
import {
  LEADS, LEAD_ORDER,
  ekgVoltage,
  buildRhythmFromParams,
} from '../../lib/ekgEngine'

// ── Canvas config ─────────────────────────────────────────────────────────────
const CW = 820, CH = 220
const PX_MS = 0.20     // horizontal: px per ms of trace
const PX_MV = 65       // vertical:   px per mV of signal
const BL    = 0.58     // baseline y-fraction (0 mV position)

const EMERALD    = '#10b981'
const GRID_MINOR = 'rgba(16,185,129,0.07)'
const GRID_MAJOR = 'rgba(16,185,129,0.18)'
const BASELINE_C = 'rgba(255,255,255,0.10)'

// ── UI param defaults ─────────────────────────────────────────────────────────
const DEFAULT = {
  saNodeRate: 75, avConductionRatio: 'all', prInterval: 160,
  qrsDuration: 80, qtInterval: 380, pWaveMode: 'present', escapeRhythm: 'none',
}

// ── Preset → UI-param mappings ────────────────────────────────────────────────
const PRESETS = {
  normalSinus:      { saNodeRate: 75,  avConductionRatio: 'all',  prInterval: 160, qrsDuration:  80, qtInterval: 380, pWaveMode: 'present',      escapeRhythm: 'none'        },
  sinusTachy:       { saNodeRate: 130, avConductionRatio: 'all',  prInterval: 140, qrsDuration:  75, qtInterval: 295, pWaveMode: 'present',      escapeRhythm: 'none'        },
  sinusBrady:       { saNodeRate: 45,  avConductionRatio: 'all',  prInterval: 170, qrsDuration:  80, qtInterval: 450, pWaveMode: 'present',      escapeRhythm: 'none'        },
  firstDegreeBlock: { saNodeRate: 75,  avConductionRatio: 'all',  prInterval: 260, qrsDuration:  80, qtInterval: 380, pWaveMode: 'present',      escapeRhythm: 'none'        },
  mobitzI:          { saNodeRate: 90,  avConductionRatio: '3:2',  prInterval: 220, qrsDuration:  80, qtInterval: 360, pWaveMode: 'present',      escapeRhythm: 'none'        },
  mobitzII:         { saNodeRate: 90,  avConductionRatio: '2:1',  prInterval: 160, qrsDuration: 120, qtInterval: 380, pWaveMode: 'present',      escapeRhythm: 'none'        },
  thirdDegreeBlock: { saNodeRate: 75,  avConductionRatio: 'none', prInterval: 160, qrsDuration: 180, qtInterval: 520, pWaveMode: 'present',      escapeRhythm: 'ventricular' },
  lbbb:             { saNodeRate: 75,  avConductionRatio: 'all',  prInterval: 160, qrsDuration: 145, qtInterval: 450, pWaveMode: 'present',      escapeRhythm: 'none'        },
  rbbb:             { saNodeRate: 75,  avConductionRatio: 'all',  prInterval: 160, qrsDuration: 140, qtInterval: 430, pWaveMode: 'present',      escapeRhythm: 'none'        },
  atrialFlutter:    { saNodeRate: 300, avConductionRatio: '2:1',  prInterval: 160, qrsDuration:  75, qtInterval: 310, pWaveMode: 'present',      escapeRhythm: 'none'        },
  aFib:             { saNodeRate: 90,  avConductionRatio: 'all',  prInterval: 160, qrsDuration:  75, qtInterval: 330, pWaveMode: 'fibrillatory', escapeRhythm: 'none'        },
  vtach:            { saNodeRate: 180, avConductionRatio: 'all',  prInterval: 160, qrsDuration: 160, qtInterval: 360, pWaveMode: 'absent',       escapeRhythm: 'none'        },
  vfib:             { saNodeRate: 300, avConductionRatio: 'none', prInterval: 160, qrsDuration: 180, qtInterval: 380, pWaveMode: 'fibrillatory', escapeRhythm: 'none'        },
}

const PRESET_GRID = [
  { key: 'normalSinus',      label: 'Normal Sinus',         sub: '60–100 bpm'           },
  { key: 'sinusTachy',       label: 'Sinus Tachycardia',    sub: '> 100 bpm'            },
  { key: 'sinusBrady',       label: 'Sinus Bradycardia',    sub: '< 60 bpm'             },
  { key: 'firstDegreeBlock', label: '1° AV Block',          sub: 'PR > 200 ms'          },
  { key: 'mobitzI',          label: 'Wenckebach',           sub: 'Mobitz I (3:2)'       },
  { key: 'mobitzII',         label: 'Mobitz II',            sub: '2:1 block'            },
  { key: 'thirdDegreeBlock', label: '3° AV Block',          sub: 'Complete block'       },
  { key: 'lbbb',             label: 'LBBB',                 sub: 'Wide QRS + LAD'       },
  { key: 'rbbb',             label: 'RBBB',                 sub: 'Wide QRS + RAD'       },
  { key: 'atrialFlutter',    label: 'Atrial Flutter',       sub: 'Sawtooth at 300 bpm'  },
  { key: 'aFib',             label: 'Atrial Fibrillation',  sub: 'Irreg. irregular'     },
  { key: 'vtach',            label: 'V-Tach',               sub: 'Wide QRS tachycardia' },
  { key: 'vfib',             label: 'V-Fib',                sub: 'No organised complexes'},
]

// ── Physiological annotation logic ───────────────────────────────────────────
function physiologicalNotes(p) {
  const { saNodeRate, avConductionRatio, prInterval, qrsDuration, pWaveMode, escapeRhythm } = p

  if (pWaveMode === 'fibrillatory' && avConductionRatio === 'none')
    return [{ text: 'Completely disorganised ventricular electrical activity — no identifiable complexes. Fatal without immediate defibrillation.', level: 'danger' }]

  if (pWaveMode === 'fibrillatory')
    return [{ text: 'Chaotic atrial firing (350–600/min) replaces organised P waves. The ventricular response is irregularly irregular because the AV node filters impulses randomly.', level: 'info' }]

  if (avConductionRatio === 'none') {
    const notes = [{ text: 'Complete AV block — no atrial impulse can cross the AV node. The atria and ventricles beat completely independently (AV dissociation).', level: 'danger' }]
    if (escapeRhythm === 'junctional')
      notes.push({ text: 'Junctional escape (≈ 50 bpm): narrow QRS because His-Purkinje conduction is still intact below the block site.', level: 'warn' })
    else if (escapeRhythm === 'ventricular')
      notes.push({ text: 'Ventricular escape (≈ 32 bpm): wide bizarre QRS because the impulse travels cell-to-cell through myocardium, not via the fast conduction system.', level: 'warn' })
    else
      notes.push({ text: 'No escape pacemaker — ventricular standstill. P waves march on but no QRS complexes form.', level: 'danger' })
    return notes
  }

  const notes = []
  if (avConductionRatio === '3:2') notes.push({ text: '3:2 AV block — 2 of every 3 P waves conduct, producing grouped beating. If the PR lengthens before the dropped beat, it\'s Mobitz I (Wenckebach). If PR is constant, it\'s Mobitz II.', level: 'warn' })
  if (avConductionRatio === '2:1') notes.push({ text: `2:1 AV block — every other P wave is blocked. Ventricular rate ≈ ${Math.round(saNodeRate / 2)} bpm regardless of how fast the SA node fires.`, level: 'warn' })
  if (avConductionRatio === '3:1') notes.push({ text: `3:1 AV block — only 1 in 3 P waves conducts. Ventricular rate ≈ ${Math.round(saNodeRate / 3)} bpm. Clinically severe bradycardia.`, level: 'danger' })
  if (pWaveMode === 'absent')      notes.push({ text: 'No P waves — the impulse does not originate in the SA node. Consider AV junctional tachycardia or ventricular tachycardia.', level: 'warn' })

  if (prInterval > 300)      notes.push({ text: `PR ${prInterval} ms — severely prolonged AV conduction. Suggests significant AV nodal disease.`, level: 'danger' })
  else if (prInterval > 200) notes.push({ text: `PR ${prInterval} ms — AV node conduction is delayed. First-degree heart block is defined as PR > 200 ms.`, level: 'warn' })
  else if (prInterval < 120) notes.push({ text: `PR ${prInterval} ms — abnormally short. Consider accessory pathway (WPW) or AV junctional rhythm.`, level: 'warn' })

  if (qrsDuration > 140)      notes.push({ text: `QRS ${qrsDuration} ms — definitely aberrant intraventricular conduction (LBBB, RBBB, paced rhythm, or ventricular origin).`, level: 'danger' })
  else if (qrsDuration > 120) notes.push({ text: `QRS ${qrsDuration} ms — bundle branch conduction is abnormal. Complete BBB is defined as QRS > 120 ms.`, level: 'warn' })

  if (!notes.length) {
    if (saNodeRate > 100)      notes.push({ text: `SA node firing at ${saNodeRate} bpm — sinus tachycardia (> 100 bpm by definition).`, level: 'info' })
    else if (saNodeRate < 60)  notes.push({ text: `SA node firing at ${saNodeRate} bpm — sinus bradycardia (< 60 bpm by definition).`, level: 'info' })
    else                       notes.push({ text: 'All parameters within normal limits — this combination represents normal sinus rhythm.', level: 'ok' })
  }
  return notes
}

function effectiveVentricularRate(p) {
  const { saNodeRate, avConductionRatio, escapeRhythm, pWaveMode } = p
  if (pWaveMode === 'fibrillatory') return saNodeRate
  if (avConductionRatio === 'none')
    return escapeRhythm === 'junctional' ? 50 : escapeRhythm === 'ventricular' ? 32 : 0
  if (avConductionRatio === '2:1') return Math.round(saNodeRate / 2)
  if (avConductionRatio === '3:1') return Math.round(saNodeRate / 3)
  if (avConductionRatio === '3:2') return Math.round((saNodeRate * 2) / 3)
  return saNodeRate
}

// Derive conduction-map rhythmId from current UI params (best-effort for animation)
function paramsToRhythmId(p) {
  const { pWaveMode, avConductionRatio, escapeRhythm, saNodeRate, qrsDuration, prInterval } = p
  if (pWaveMode === 'fibrillatory' && avConductionRatio === 'none') return 'vfib'
  if (pWaveMode === 'fibrillatory') return 'atrialFibrillation'
  if (avConductionRatio === 'none') return 'thirdDegreeBlock'
  if (avConductionRatio === '3:2') return 'mobitzI'
  if (avConductionRatio === '2:1' && saNodeRate >= 270) return 'atrialFlutter'
  if (avConductionRatio === '2:1' || avConductionRatio === '3:1') return 'mobitzII'
  if (pWaveMode === 'absent') return 'vtach'
  if (qrsDuration >= 130) return 'lbbb'
  if (prInterval > 200) return 'firstDegreeBlock'
  if (saNodeRate > 100) return 'sinusTachycardia'
  if (saNodeRate < 60)  return 'sinusBradycardia'
  return 'normalSinus'
}

// ── Canvas drawing helpers ────────────────────────────────────────────────────
function drawGrid(ctx, w, h) {
  const byY  = h * BL
  const step = 40 * PX_MS
  ctx.lineWidth = 1
  let i = 0
  for (let x = 0; x <= w; x += step) {
    ctx.strokeStyle = i % 5 === 0 ? GRID_MAJOR : GRID_MINOR
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); i++
  }
  const mvStep = 0.5 * PX_MV
  ctx.strokeStyle = GRID_MINOR
  for (let y = byY; y <= h; y += mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  for (let y = byY; y >= 0; y -= mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  ctx.strokeStyle = BASELINE_C
  ctx.beginPath(); ctx.moveTo(0, byY); ctx.lineTo(w, byY); ctx.stroke()
}

function drawTrace(ctx, w, h, elapsedMs, { waves, cycleMs, nativeCycleMs }, leadAxisDeg) {
  const byY = h * BL
  ctx.beginPath()
  for (let x = 0; x <= w; x++) {
    const v = ekgVoltage(elapsedMs - (w - x) / PX_MS, cycleMs, waves, leadAxisDeg, nativeCycleMs)
    const y = byY - v * PX_MV
    if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = EMERALD; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke()
}

// ── Small sub-components ──────────────────────────────────────────────────────
function ParamSlider({ label, value, min, max, step = 1, unit = '', color, disabled, onChange, hint }) {
  return (
    <div className={disabled ? 'opacity-40 pointer-events-none select-none' : ''}>
      <div className="flex justify-between items-center mb-1">
        <label className="text-xs text-gray-400">{label}</label>
        <span className="text-xs font-bold tabular-nums" style={{ color: color ?? '#e2e8f0' }}>
          {value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded accent-emerald-500" />
      {hint && <p className="text-xs text-gray-600 mt-1 leading-snug">{hint}</p>}
    </div>
  )
}

function SegBtn({ options, value, disabled, onChange }) {
  return (
    <div className={`flex rounded-lg overflow-hidden border border-gray-700 ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      {options.map(o => (
        <button key={o.value} onClick={() => onChange(o.value)}
          className={`flex-1 px-1.5 py-1.5 text-xs transition-colors leading-tight ${
            value === o.value
              ? 'bg-emerald-600/35 text-emerald-300 font-medium'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
          }`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function NoteChip({ level }) {
  const map = {
    ok:     { color: '#10b981', label: 'Normal'   },
    info:   { color: '#60a5fa', label: 'Note'     },
    warn:   { color: '#f59e0b', label: 'Abnormal' },
    danger: { color: '#ef4444', label: 'Critical' },
  }
  const { color, label } = map[level] ?? map.info
  return (
    <span className="shrink-0 text-xs font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded"
      style={{ color, backgroundColor: color + '1a', border: `1px solid ${color}40` }}>
      {label}
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function EKGSimulator() {
  const [params, setParams]   = useState(DEFAULT)
  const [leadId, setLeadId]   = useState('II')
  const [animRhythm, setAnimRhythm] = useState(() => buildRhythmFromParams(DEFAULT))
  const canvasRef     = useRef(null)
  const heartClockRef = useRef({ elapsedMs: 0, cycleMs: 800, tInCycle: 0, nativeCycleMs: null })
  const activeRef     = useRef({ params: DEFAULT, leadId: 'II', rhythm: buildRhythmFromParams(DEFAULT) })

  // Keep rAF ref and animation rhythm in sync with latest state
  useEffect(() => {
    const r = buildRhythmFromParams(params)
    setAnimRhythm(r)
    activeRef.current = { params, leadId, rhythm: r }
  }, [params, leadId])

  // Single rAF loop — reads rhythm from ref each frame
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    let animId, t0 = null

    const render = (ts) => {
      if (t0 === null) t0 = ts
      const { rhythm, leadId: lid } = activeRef.current
      const { cycleMs, nativeCycleMs } = rhythm
      const elapsedMs = ts - t0
      heartClockRef.current = {
        elapsedMs,
        cycleMs,
        tInCycle: elapsedMs % cycleMs,
        nativeCycleMs,
      }
      ctx.clearRect(0, 0, CW, CH)
      drawGrid(ctx, CW, CH)
      drawTrace(ctx, CW, CH, elapsedMs, rhythm, LEADS[lid].axisDeg)
      animId = requestAnimationFrame(render)
    }
    animId = requestAnimationFrame(render)
    return () => cancelAnimationFrame(animId)
  }, [])

  const set = (key, val) => setParams(p => ({ ...p, [key]: val }))

  const applyPreset = key =>
    setParams(p => ({ ...p, ...PRESETS[key] }))

  const { saNodeRate, avConductionRatio, prInterval, qrsDuration, qtInterval, pWaveMode, escapeRhythm } = params
  const isFib    = pWaveMode === 'fibrillatory'
  const isBlock  = avConductionRatio === 'none'
  const isPartial = !isFib && avConductionRatio !== 'all' && !isBlock

  const ventRate = effectiveVentricularRate(params)
  const rhythmId = paramsToRhythmId(params)
  const rrMs     = ventRate > 0 ? 60000 / ventRate : null
  const qtcMs    = rrMs ? Math.round(qtInterval / Math.sqrt(rrMs / 1000)) : null
  const notes    = physiologicalNotes(params)

  const prColor  = (prInterval > 300 || prInterval < 120) ? '#ef4444' : prInterval > 200 ? '#f59e0b' : '#10b981'
  const qrsColor = qrsDuration > 140 ? '#ef4444' : qrsDuration > 120 ? '#f59e0b' : '#10b981'
  const qtcColor = !qtcMs ? '#6b7280' : qtcMs > 500 ? '#ef4444' : qtcMs > 440 ? '#f59e0b' : '#10b981'

  const isPresetActive = key => Object.entries(PRESETS[key]).every(([k, v]) => params[k] === v)

  return (
    <ModulePage
      moduleId="ekg"
      number={3}
      title="EKG Simulator & Rhythm Library"
      objective="Cardiac arrhythmias are predictable consequences of specific failures in the conduction system. If you know which structure failed, you can derive what the EKG must look like — you don't need to memorise patterns."
      description="Use the controls below to manipulate each part of the conduction system and watch the EKG strip respond in real time. Load a preset to see the answer, then figure out which parameters produced it."
    >
      {/* ── EKG strip + conduction animation ─────────────────────────────── */}
      <div className="rounded-2xl bg-gray-950 border border-gray-800 p-4 mb-4">
        <div className="flex items-center justify-between mb-2.5">
          {/* Lead buttons */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-600 uppercase tracking-widest">Lead</span>
            <div className="flex gap-1">
              {LEAD_ORDER.map(id => (
                <button key={id} onClick={() => setLeadId(id)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    leadId === id
                      ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-700/50'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}>
                  {id}
                </button>
              ))}
            </div>
          </div>
          {/* Live rate + QTc readout */}
          <div className="flex items-center gap-4 text-xs">
            {ventRate > 0 ? (
              <span className="text-gray-500">
                Ventricular rate{' '}
                <span className="text-white font-bold tabular-nums">{ventRate}</span> bpm
              </span>
            ) : (
              <span className="text-red-400 font-medium">Ventricular standstill</span>
            )}
            {qtcMs && (
              <span className="text-gray-500">
                QTc (Bazett){' '}
                <span className="font-bold tabular-nums" style={{ color: qtcColor }}>{qtcMs} ms</span>
              </span>
            )}
          </div>
        </div>
        <div className="flex gap-4 items-start">
          <HeartAnimation
            clockRef={heartClockRef}
            rhythmId={rhythmId}
            rhythm={animRhythm}
            className="shrink-0"
          />
          <div className="flex-1 min-w-0">
            <canvas ref={canvasRef} width={CW} height={CH} className="w-full rounded-lg"
              style={{ backgroundColor: '#030712' }} />
            <p className="text-xs text-gray-700 mt-2 text-right">40 ms / small square · 0.5 mV / square</p>
          </div>
        </div>
      </div>

      {/* ── Physiological annotation panel ─────────────────────────────────── */}
      <div className="rounded-xl bg-gray-900/70 border border-gray-800 p-4 mb-6 space-y-2.5">
        <p className="text-xs uppercase tracking-widest text-gray-600 mb-1">Physiological interpretation</p>
        {notes.map((n, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <NoteChip level={n.level} />
            <p className="text-sm text-gray-300 leading-relaxed">{n.text}</p>
          </div>
        ))}
      </div>

      {/* ── Two-column layout ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-5">

        {/* ── SECTION A: Conduction System Parameters (3 cols) ─────────────── */}
        <div className="col-span-3 rounded-2xl bg-gray-900 border border-gray-800 p-5">
          <div className="flex items-baseline gap-2 mb-5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
            <h2 className="text-sm font-semibold text-white">Conduction System Parameters</h2>
            <span className="text-xs text-gray-600">— derive any rhythm from here</span>
          </div>

          <div className="space-y-5">

            {/* P Wave mode */}
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">P Wave</label>
              <SegBtn value={pWaveMode} onChange={v => set('pWaveMode', v)} options={[
                { label: 'Present',      value: 'present'      },
                { label: 'Absent',       value: 'absent'       },
                { label: 'Fibrillatory', value: 'fibrillatory' },
              ]} />
              <p className="text-xs text-gray-600 mt-1.5 leading-snug">
                {pWaveMode === 'present'      && 'Organised atrial depolarisation from the SA node — normal P wave morphology.'}
                {pWaveMode === 'absent'       && 'No organised atrial activity. Impulse originates below the SA node (junctional or ventricular).'}
                {pWaveMode === 'fibrillatory' && 'Chaotic atrial activity replaces discrete P waves. Combined with AV ratio = None → VFib.'}
              </p>
            </div>

            {/* SA Node Rate */}
            <ParamSlider
              label={isFib ? 'Mean Ventricular Rate' : 'SA Node Rate'}
              value={saNodeRate} min={20} max={300} unit=" bpm"
              disabled={isBlock && !isFib}
              onChange={v => set('saNodeRate', v)}
              hint={
                isBlock && !isFib ? 'SA node rate has no effect on ventricles in complete block — set escape rhythm below.' :
                isFib ? 'Controls the average ventricular response rate (SA node is overridden by chaotic atrial firing).' : null
              }
            />

            {/* AV Conduction Ratio */}
            <div>
              <label className="text-xs text-gray-400 block mb-1.5">AV Node Conduction Ratio</label>
              <select
                value={avConductionRatio}
                disabled={isFib}
                onChange={e => {
                  const v = e.target.value
                  set('avConductionRatio', v)
                  if (v !== 'none') set('escapeRhythm', 'none')
                }}
                className={`w-full bg-gray-800 border border-gray-700 text-sm rounded-lg px-3 py-2 text-white
                  focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40
                  ${isFib ? 'opacity-40 pointer-events-none' : ''}`}
              >
                <option value="all">1:1 — Every impulse conducts normally</option>
                <option value="3:2">3:2 — 2 of every 3 impulses conduct</option>
                <option value="2:1">2:1 — Every other impulse is blocked</option>
                <option value="3:1">3:1 — Only 1 of every 3 impulses conducts</option>
                <option value="none">None — Complete AV block</option>
              </select>
              <p className="text-xs text-gray-600 mt-1.5 leading-snug">
                {avConductionRatio === 'all'  && 'Normal AV nodal conduction — every atrial impulse reaches the ventricles.'}
                {avConductionRatio === '3:2'  && 'Intermittent AV block — grouped beating pattern on the trace.'}
                {avConductionRatio === '2:1'  && 'Ventricular rate = atrial rate ÷ 2. Two P waves visible per QRS complex.'}
                {avConductionRatio === '3:1'  && 'Severe block. Three P waves visible per QRS complex.'}
                {avConductionRatio === 'none' && 'AV node is completely non-conducting. Select an escape rhythm below.'}
              </p>
            </div>

            {/* Escape Rhythm — conditional on complete block */}
            {isBlock && (
              <div>
                <label className="text-xs text-gray-400 block mb-1.5">Escape Rhythm</label>
                <select
                  value={escapeRhythm}
                  onChange={e => set('escapeRhythm', e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 text-sm rounded-lg px-3 py-2 text-white
                    focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40"
                >
                  <option value="none">None — ventricular standstill (P waves only)</option>
                  <option value="junctional">Junctional escape — narrow QRS, ≈ 50 bpm</option>
                  <option value="ventricular">Ventricular escape — wide bizarre QRS, ≈ 32 bpm</option>
                </select>
                <p className="text-xs text-gray-600 mt-1.5 leading-snug">
                  {escapeRhythm === 'none'        && 'No subsidiary pacemaker fires. P waves present but no QRS.'}
                  {escapeRhythm === 'junctional'  && 'AV junction takes over. His-Purkinje intact → narrow QRS, independent of P waves.'}
                  {escapeRhythm === 'ventricular' && 'Ventricular myocardium self-excites. Cell-to-cell conduction → wide, slurred, bizarre QRS.'}
                </p>
              </div>
            )}

            {/* PR Interval */}
            <ParamSlider
              label="PR Interval"
              value={prInterval} min={80} max={400} step={10} unit=" ms" color={prColor}
              disabled={isFib || isBlock || pWaveMode === 'absent'}
              onChange={v => set('prInterval', v)}
              hint={
                prInterval > 200 ? `${prInterval - 200} ms above upper limit of normal (200 ms) — 1st-degree AV block` :
                prInterval < 120 ? 'Below normal — consider pre-excitation (WPW) or junctional rhythm' :
                'Normal range: 120–200 ms'
              }
            />

            {/* QRS Duration */}
            <ParamSlider
              label="QRS Duration"
              value={qrsDuration} min={60} max={200} step={5} unit=" ms" color={qrsColor}
              disabled={isBlock}
              onChange={v => set('qrsDuration', v)}
              hint={
                qrsDuration > 140 ? 'Definitely abnormal — LBBB, RBBB, ventricular origin, or paced rhythm' :
                qrsDuration > 120 ? 'Above 120 ms = complete bundle branch block by definition' :
                'Normal < 120 ms — His-Purkinje conduction intact'
              }
            />

            {/* QT Interval */}
            <div>
              <ParamSlider
                label="QT Interval"
                value={qtInterval} min={200} max={600} step={10} unit=" ms"
                disabled={isBlock}
                onChange={v => set('qtInterval', v)}
              />
              {qtcMs && (
                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-500">Bazett QTc =</span>
                  <span className="text-xs font-bold tabular-nums" style={{ color: qtcColor }}>{qtcMs} ms</span>
                  <span className="text-xs text-gray-600">
                    {qtcMs > 500 ? '— critically prolonged (torsades de pointes risk)' :
                     qtcMs > 440 ? '— above normal upper limit (≤ 440 ms)' :
                     '— within normal range (≤ 440 ms)'}
                  </span>
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── SECTION B: Rhythm Presets (2 cols) ───────────────────────────── */}
        <div className="col-span-2 rounded-2xl bg-gray-900 border border-gray-800 p-5 flex flex-col">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="inline-block w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
            <h2 className="text-sm font-semibold text-white">Rhythm Presets</h2>
          </div>
          <p className="text-xs text-gray-600 leading-relaxed mb-4">
            Each card auto-populates Section A. The goal: after clicking a preset, understand
            <em> which parameter change</em> defines it.
          </p>
          <div className="grid grid-cols-2 gap-1.5 flex-1">
            {PRESET_GRID.map(({ key, label, sub }) => {
              const active = isPresetActive(key)
              return (
                <button key={key} onClick={() => applyPreset(key)}
                  className={`text-left p-2.5 rounded-xl border transition-all
                    hover:border-emerald-700/50 hover:bg-emerald-950/20
                    ${active
                      ? 'border-emerald-600/50 bg-emerald-950/30'
                      : 'border-gray-800 bg-gray-800/30'}`}
                >
                  <p className={`text-xs font-semibold leading-tight ${active ? 'text-emerald-300' : 'text-gray-300'}`}>
                    {label}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5 leading-tight">{sub}</p>
                </button>
              )
            })}
          </div>
        </div>

      </div>
    </ModulePage>
  )
}
