import { useEffect, useRef, useState } from 'react'
import {
  RHYTHMS,
  RHYTHM_ORDER,
  LEADS,
  LEAD_ORDER,
  DEFAULT_LEAD_ID,
  cycleLengthMs,
  ECGVoltage,
  measureIntervals,
  warpTime,
} from '../../lib/ECGEngine'
import HeartAnimation from '../../components/HeartAnimation'

// ── Visual tuning constants ──────────────────────────────────────────────
const CANVAS_WIDTH  = 900
const CANVAS_HEIGHT = 320
const PIXELS_PER_MS = 0.25   // horizontal scale: how many px = 1 ms of trace
const PIXELS_PER_MV = 80     // vertical scale:   how many px = 1 mV of signal
const BASELINE_FRAC = 0.6    // baseline (0 mV) sits 60% down the canvas —
                             // leaves headroom above for the tall R wave and
                             // room below for the Q/S dips

const GRID_MINOR_MS = 40     // faint grid line every 40 ms  (≈ 1 small ECG box)
const GRID_MAJOR_MS = 200    // bright grid line every 200 ms (≈ 1 large ECG box)

const SIGNAL_COLOR     = '#10b981' // emerald — the app's "ECG signal" accent color
const GRID_MINOR_COLOR = 'rgba(16, 185, 129, 0.06)'
const GRID_MAJOR_COLOR = 'rgba(16, 185, 129, 0.16)'
const BASELINE_COLOR   = 'rgba(255, 255, 255, 0.12)'

// For each `measurable: false` rhythm, a short clause naming the specific
// thing to look for in the trace — slotted into the explanatory note that
// replaces the PR/QRS/QT cards (see the render below). Keeping these here,
// keyed by rhythm id, means adding a new irregular rhythm to ECGEngine.js
// only requires one new line here, rather than a longer if/else chain.
const WHAT_TO_WATCH = {
  thirdDegreeBlock:
    ' how the P waves drift through the QRS-T complexes with no fixed relationship between them (AV dissociation),',
  atrialFlutter:
    ' the continuous sawtooth baseline replacing distinct P waves, with every other flutter wave conducting through to the ventricles,',
  pvcs:
    ' the early, wide, bizarre complex with no preceding P wave, and the longer pause afterward before the normal rhythm resumes on schedule,',
  pacs:
    " the early beat's subtly different P wave shape (versus the normal sinus P), the otherwise-normal QRS-T behind it, and the short, non-compensatory pause that follows,",
  mobitzI:
    ' the PR interval visibly stretching longer with each beat until one P wave is left with no QRS behind it — then the pattern resetting and starting over,',
  mobitzII:
    ' the identical, unchanging PR interval on every conducted beat — right up until one drops suddenly and without warning,',
  atrialFibrillation:
    ' the fine, irregular ripple where a P wave should be, and the QRS complexes landing at constantly-changing intervals with no repeating pattern,',
  ventricularPaced:
    " the sharp, narrow pacer 'spike' immediately preceding each wide, bizarre QRS complex — and the complete absence of any native P wave before it,",
  vtach:
    ' the rapid, wide, bizarre QRS complexes with no preceding P waves — every beat is ventricular in origin, and the QRS morphology is completely different from normal conduction,',
  vfib:
    ' the chaotic, disorganized electrical activity with no identifiable P waves, QRS complexes, or T waves — there is no coordinated cardiac output during ventricular fibrillation,',
}

// Draws the faint monitor-style grid: minor lines every 40 ms and every
// 0.5 mV, with brighter major lines every 200 ms — mirroring the small/large
// boxes printed on real ECG paper.
function drawGrid(ctx, width, height) {
  ctx.lineWidth = 1
  const baselineY = height * BASELINE_FRAC

  // Vertical (time) lines
  const minorSpacingPx = GRID_MINOR_MS * PIXELS_PER_MS
  const majorEveryNth  = GRID_MAJOR_MS / GRID_MINOR_MS
  let lineIndex = 0
  for (let x = 0; x <= width; x += minorSpacingPx) {
    ctx.strokeStyle = (lineIndex % majorEveryNth === 0) ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, height)
    ctx.stroke()
    lineIndex++
  }

  // Horizontal (voltage) lines, every 0.5 mV above and below the baseline
  const mvSpacingPx = 0.5 * PIXELS_PER_MV
  ctx.strokeStyle = GRID_MINOR_COLOR
  for (let y = baselineY; y <= height; y += mvSpacingPx) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
  }
  for (let y = baselineY; y >= 0; y -= mvSpacingPx) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
  }

  // The 0 mV baseline itself, drawn brighter so it reads as "ground truth"
  ctx.strokeStyle = BASELINE_COLOR
  ctx.beginPath()
  ctx.moveTo(0, baselineY)
  ctx.lineTo(width, baselineY)
  ctx.stroke()
}

// Draws the scrolling trace. The rightmost pixel column is "now"; each
// column moving left shows a progressively older sample — exactly like a
// bedside monitor sweeping its trace from right to left.
function drawWaveform(ctx, width, height, elapsedMs, cycleMs, waves, leadAxisDeg, nativeCycleMs) {
  const baselineY = height * BASELINE_FRAC

  ctx.beginPath()
  for (let x = 0; x <= width; x++) {
    const ageMs      = (width - x) / PIXELS_PER_MS
    const sampleAtMs = elapsedMs - ageMs
    const voltageMv  = ECGVoltage(sampleAtMs, cycleMs, waves, leadAxisDeg, nativeCycleMs)
    const y          = baselineY - voltageMv * PIXELS_PER_MV

    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = SIGNAL_COLOR
  ctx.lineWidth   = 2
  ctx.lineJoin    = 'round'
  ctx.stroke()
}

// Draws vertical annotation markers (e.g. ⚠ R-on-T) at the correct scroll
// position. Each annotation is cycle-relative (tMs within the macro-cycle);
// we find how many ms ago it last occurred and convert to a canvas x-coord.
function drawAnnotations(ctx, width, height, elapsedMs, cycleMs, annotations) {
  if (!annotations?.length) return
  const cyclePos = ((elapsedMs % cycleMs) + cycleMs) % cycleMs

  for (const ann of annotations) {
    // Age in ms: how long ago did this annotation fire in the current visible window?
    let ageMs = cyclePos - ann.tMs
    if (ageMs < 0) ageMs += cycleMs   // fired in previous cycle

    // Draw for every recent occurrence visible in the window
    while (ageMs < width / PIXELS_PER_MS) {
      const x = Math.round(width - ageMs * PIXELS_PER_MS)
      if (x >= 0 && x <= width) {
        ctx.save()
        ctx.strokeStyle = '#ef4444'
        ctx.lineWidth   = 1.5
        ctx.setLineDash([5, 4])
        ctx.globalAlpha = 0.75
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = 1
        ctx.fillStyle = '#ef4444'
        ctx.font      = 'bold 11px monospace'
        ctx.fillText(ann.label, Math.max(2, x - 54), 18)
        ctx.restore()
      }
      ageMs += cycleMs   // previous cycle's occurrence
    }
  }
}

/**
 * ECGWaveformPrototype — standalone Canvas test bench for the ECG engine.
 *
 * This is intentionally NOT one of the four module pages. It's a development
 * tool: a place to watch the Gaussian-sum model run continuously and check
 * its measured intervals against the Boron & Boulpaep reference ranges,
 * before this drawing logic gets adapted into Module 3's three-panel
 * simulator (where it will share a master clock with the conduction
 * animation and the cardiac vector).
 */
export default function ECGWaveformPrototype() {
  const canvasRef = useRef(null)
  const [rhythmId, setRhythmId] = useState('normalSinus')
  const [leadId, setLeadId]     = useState(DEFAULT_LEAD_ID)
  const [hrBpm, setHrBpm]       = useState(RHYTHMS['normalSinus'].heartRateBpm)
  const [isPaused, setIsPaused] = useState(false)

  // Pausing freezes the displayed trace WITHOUT losing track of "where we
  // were" — so resuming continues smoothly instead of jumping. We do this by
  // tracking how much time has been spent paused (`pausedAccumMsRef`) and
  // subtracting it from the elapsed-time calculation. `isPausedRef` mirrors
  // `isPaused` for the render loop to read each frame (see note on
  // `activeRhythmRef` below for why a ref instead of state).
  const isPausedRef        = useRef(false)
  const pausedAccumMsRef   = useRef(0)
  const pauseStartedAtRef  = useRef(null)

  // NOTE: the pause/resume bookkeeping below deliberately happens OUTSIDE
  // the setIsPaused call, reading `isPausedRef` rather than passing an
  // updater function to setIsPaused. In development, Strict Mode calls
  // setState updater functions twice to surface impurities — and these
  // performance.now() reads + ref writes are exactly the kind of side
  // effect that breaks under double-invocation (the second call would see
  // pauseStartedAtRef already nulled out by the first, corrupting the
  // accumulated pause time). Doing it here, once, keeps it correct.
  const togglePause = () => {
    const willBePaused = !isPausedRef.current

    if (willBePaused) {
      pauseStartedAtRef.current = performance.now()
    } else {
      pausedAccumMsRef.current += performance.now() - pauseStartedAtRef.current
      pauseStartedAtRef.current = null
    }

    isPausedRef.current = willBePaused
    setIsPaused(willBePaused)
  }

  // Shared clock written each frame by the render loop and read by HeartAnimation's
  // own rAF loop for direct SVG DOM updates — zero React re-renders at 60fps.
  const heartClockRef = useRef({ elapsedMs: 0, cycleMs: 800, tInCycle: 0, nativeCycleMs: null })

  // The render loop (below) reads the active rhythm through this ref rather
  // than capturing it in the effect's closure. That lets switching the
  // dropdown change what's drawn on the very next frame — instantly, mid-
  // scroll — without tearing down and restarting the animation loop (which
  // would reset the clock and make the strip jump).
  const activeRhythmRef = useRef(RHYTHMS[rhythmId])
  useEffect(() => {
    activeRhythmRef.current = RHYTHMS[rhythmId]
  }, [rhythmId])

  // Same instant-switch pattern for the lead: the render loop reads the
  // active lead's axis through a ref so changing leads re-projects the
  // cardiac vectors on the very next frame, mid-scroll, with no restart.
  const activeLeadAxisRef = useRef(LEADS[leadId].axisDeg)
  useEffect(() => {
    activeLeadAxisRef.current = LEADS[leadId].axisDeg
  }, [leadId])

  // HR ref for the render loop — same pattern as rhythm/lead refs above.
  // When the rhythm changes, reset the slider to that rhythm's default rate.
  const activeHrRef = useRef(hrBpm)
  useEffect(() => {
    activeHrRef.current = hrBpm
  }, [hrBpm])
  useEffect(() => {
    const defaultHr = RHYTHMS[rhythmId].heartRateBpm
    setHrBpm(defaultHr)
    activeHrRef.current = defaultHr
  }, [rhythmId])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    let animationFrameId
    let startTimeMs   = null
    let frozenElapsedMs = 0 // last "live" elapsed value — held steady while paused

    // The render loop runs once per browser repaint (~60 fps). Each frame we
    // compute how much time has elapsed since the loop started (minus any
    // time spent paused), look up whichever rhythm is currently active, and
    // redraw the grid and waveform sampled at that elapsed time. Because the
    // engine is a pure function of elapsed time (not of frame count, pause
    // state, or which rhythm was active when we started), the strip scrolls
    // smoothly through rhythm switches, pauses, and frame-timing jitter alike.
    const render = (timestampMs) => {
      if (startTimeMs === null) startTimeMs = timestampMs

      // Only advance the clock while playing. While paused, keep redrawing
      // with the same frozen elapsed value so the trace holds perfectly still.
      if (!isPausedRef.current) {
        frozenElapsedMs = timestampMs - startTimeMs - pausedAccumMsRef.current
      }

      const rhythm        = activeRhythmRef.current
      const hr            = activeHrRef.current
      // Tier-2 rhythms scale their full macro-cycle proportionally with the HR
      // slider so all beats compress/expand together. nativeCycleMs is passed
      // to ECGVoltage so it can scale the time axis to match. Tier-1 rhythms
      // derive cycleMs directly from rate; no time-axis scaling needed.
      const nativeCycleMs = rhythm.cycleMs ?? null
      const cycleMs       = rhythm.cycleMs
        ? rhythm.cycleMs * (rhythm.heartRateBpm / hr)
        : cycleLengthMs(hr)

      // Write shared clock so HeartAnimation stays frame-accurate
      const warpedForClock = warpTime(frozenElapsedMs)
      const tInCycleRaw    = ((warpedForClock % cycleMs) + cycleMs) % cycleMs
      heartClockRef.current = {
        elapsedMs:    frozenElapsedMs,
        cycleMs,
        tInCycle:     tInCycleRaw,
        nativeCycleMs,
      }

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      drawGrid(ctx, CANVAS_WIDTH, CANVAS_HEIGHT)
      drawWaveform(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, frozenElapsedMs, cycleMs, rhythm.waves, activeLeadAxisRef.current, nativeCycleMs)
      drawAnnotations(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, frozenElapsedMs, cycleMs, rhythm.annotations)

      animationFrameId = requestAnimationFrame(render)
    }

    animationFrameId = requestAnimationFrame(render)

    // Stop the loop on unmount — otherwise it keeps redrawing (and burning
    // CPU) on a canvas that's no longer on screen.
    return () => cancelAnimationFrame(animationFrameId)
  }, [])

  const rhythm = RHYTHMS[rhythmId]

  // measureIntervals() assumes one P, Q, R, S, T per cycle — valid for Tier-1
  // rhythms. Tier-2 rhythms are flagged `measurable: false`; we skip them.
  const isMeasurable = rhythm.measurable !== false
  const intervals    = isMeasurable ? measureIntervals(rhythm.waves) : null

  const rrMs = cycleLengthMs(hrBpm)
  const qtcMs      = intervals ? Math.round(intervals.qtIntervalMs / Math.sqrt(rrMs / 1000)) : null

  // For normal sinus, the HR slider subsumes tachy / bradycardia classification.
  const sinusLabel = rhythmId === 'normalSinus'
    ? hrBpm > 100 ? 'Sinus Tachycardia'
    : hrBpm < 60  ? 'Sinus Bradycardia'
    : 'Normal Sinus Rhythm'
    : null

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto" style={{ backgroundColor: '#0a0e1a' }}>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white mb-1">ECG Waveform Engine — Prototype</h1>
        <p className="text-sm text-gray-500">
          Standalone test bench for tuning the Gaussian-sum model and rhythm library before it's wired into Module 3.
        </p>
      </div>

      {/* Rhythm selector + playback control */}
      <div className="mb-5 flex items-end gap-4">
        <div className="flex-1">
          <label className="block text-xs text-gray-400 mb-1.5">Rhythm</label>
          <select
            value={rhythmId}
            onChange={e => setRhythmId(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5
                       focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50"
          >
            {RHYTHM_ORDER.map(id => (
              <option key={id} value={id}>{RHYTHMS[id].label}</option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-2 leading-relaxed max-w-2xl">{rhythm.description}</p>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1.5">Lead</label>
          <select
            value={leadId}
            onChange={e => setLeadId(e.target.value)}
            className="bg-gray-800 border border-gray-700 text-white text-sm rounded-lg px-3 py-2.5
                       focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50"
          >
            {LEAD_ORDER.map(id => (
              <option key={id} value={id}>{LEADS[id].label}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5 min-w-[160px]">
          <div className="flex items-center justify-between">
            <label className="text-xs text-gray-400">Heart rate</label>
            <span className="text-xs font-bold tabular-nums text-emerald-400">
              {hrBpm} bpm
            </span>
          </div>
          <input
            type="range"
            min={30}
            max={200}
            step={5}
            value={hrBpm}
            onChange={e => setHrBpm(Number(e.target.value))}
            className="w-full accent-emerald-500"
          />
        </div>

        <button
          onClick={togglePause}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium
                     text-gray-300 bg-gray-800 border border-gray-700 hover:bg-gray-700 transition-colors"
        >
          {isPaused ? (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
              Resume
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>
              Pause
            </>
          )}
        </button>
      </div>

      {/* Trace legend — what the grid and trace actually represent.
          The time/voltage scales describe THIS canvas's grid spacing
          (see GRID_MINOR_MS / GRID_MAJOR_MS / PIXELS_PER_MV above). */}
      <div className="flex flex-wrap gap-2 mb-3">
        <LegendBadge label="Lead" value={`${LEADS[leadId].label} (axis ${LEADS[leadId].axisDeg}°)`} />
        {sinusLabel && <LegendBadge label="Classification" value={sinusLabel} highlight={sinusLabel !== 'Normal Sinus Rhythm'} />}
        <LegendBadge label="Time scale" value={`${GRID_MINOR_MS} ms / small square · ${GRID_MAJOR_MS} ms / large square`} />
        <LegendBadge label="Voltage scale" value="0.5 mV / square" />
      </div>

      <div className="flex gap-4 mb-6 items-start">
        <HeartAnimation
          clockRef={heartClockRef}
          rhythmId={rhythmId}
          rhythm={rhythm}
          className="flex-shrink-0"
        />
        <div className="rounded-2xl bg-gray-900 border border-gray-800 p-4 flex-1">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="w-full rounded-lg"
            style={{ backgroundColor: '#0a0e1a' }}
          />
        </div>
      </div>

      {/* Measured intervals — compare these against the B&B reference ranges
          while tuning the wave parameters in ECGEngine.js.
          NOTE: for the pathological-but-regular rhythms (1st-degree block,
          LBBB, RBBB), seeing PR or QRS read amber here is CORRECT — that's
          the model reproducing the very finding that defines the rhythm.

          The irregular Tier-2 rhythms (3rd-degree block, atrial flutter,
          PVCs) don't have "one PR/QRS/QT per cycle" to measure — their
          beat-to-beat variability IS the diagnostic finding — so we show an
          explanatory note instead of a number that wouldn't mean anything. */}
      {isMeasurable ? (
        <div className="grid grid-cols-3 gap-4">
          <IntervalCard
            label="PR interval"
            value={intervals.prIntervalMs}
            reference="Normal range: 120 – 200 ms"
            inRange={intervals.prIntervalMs >= 120 && intervals.prIntervalMs <= 200}
          />
          <IntervalCard
            label="QRS duration"
            value={intervals.qrsDurationMs}
            reference="Normal range: < 120 ms"
            inRange={intervals.qrsDurationMs < 120}
          />
          <IntervalCard
            label="QTc (Bazett-corrected)"
            value={qtcMs}
            reference={`Raw QT ${Math.round(intervals.qtIntervalMs)} ms · Normal QTc ≤ 440 ms`}
            inRange={qtcMs <= 440}
          />
        </div>
      ) : (
        <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
          <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">Measured intervals</p>
          <p className="text-sm text-gray-400 leading-relaxed">
            This rhythm's beats vary in timing and shape from one to the next — that
            variability is the diagnostic finding itself, so a single "PR / QRS / QT for
            this cycle" reading wouldn't be meaningful. Watch the trace instead: notice
            {WHAT_TO_WATCH[rhythmId] ?? ''}
            {' '}as described above.
          </p>
        </div>
      )}
    </div>
  )
}

function LegendBadge({ label, value, highlight = false }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${highlight ? 'bg-amber-950/40 border-amber-700/50' : 'bg-gray-900 border-gray-800'}`}>
      <span className="text-xs uppercase tracking-widest text-gray-500">{label}</span>
      <span className={`text-xs font-medium ${highlight ? 'text-amber-400' : 'text-gray-300'}`}>{value}</span>
    </div>
  )
}

function IntervalCard({ label, value, reference, inRange }) {
  const color = inRange ? '#10b981' : '#f59e0b'
  return (
    <div className="rounded-xl bg-gray-900 border border-gray-800 p-4">
      <p className="text-xs uppercase tracking-widest text-gray-500 mb-1">{label}</p>
      <p className="text-2xl font-bold" style={{ color }}>{Math.round(value)} ms</p>
      <p className="text-xs text-gray-600 mt-1">{reference}</p>
    </div>
  )
}
