import { useEffect, useRef, useState } from 'react'
import {
  RHYTHMS,
  RHYTHM_ORDER,
  cycleLengthMs,
  ekgVoltage,
  measureIntervals,
  expectedQtMs,
} from '../../lib/ekgEngine'

// ── Visual tuning constants ──────────────────────────────────────────────
const CANVAS_WIDTH  = 900
const CANVAS_HEIGHT = 320
const PIXELS_PER_MS = 0.25   // horizontal scale: how many px = 1 ms of trace
const PIXELS_PER_MV = 80     // vertical scale:   how many px = 1 mV of signal
const BASELINE_FRAC = 0.6    // baseline (0 mV) sits 60% down the canvas —
                             // leaves headroom above for the tall R wave and
                             // room below for the Q/S dips

const GRID_MINOR_MS = 40     // faint grid line every 40 ms  (≈ 1 small EKG box)
const GRID_MAJOR_MS = 200    // bright grid line every 200 ms (≈ 1 large EKG box)

const SIGNAL_COLOR     = '#10b981' // emerald — the app's "EKG signal" accent color
const GRID_MINOR_COLOR = 'rgba(16, 185, 129, 0.06)'
const GRID_MAJOR_COLOR = 'rgba(16, 185, 129, 0.16)'
const BASELINE_COLOR   = 'rgba(255, 255, 255, 0.12)'

// Draws the faint monitor-style grid: minor lines every 40 ms and every
// 0.5 mV, with brighter major lines every 200 ms — mirroring the small/large
// boxes printed on real EKG paper.
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
//
// For every pixel column we work out how long ago (in ms) that column
// represents, subtract that from the current elapsed time to get an actual
// sample time, and ask the engine what the voltage was at that instant.
function drawWaveform(ctx, width, height, elapsedMs, cycleMs, waves) {
  const baselineY = height * BASELINE_FRAC

  ctx.beginPath()
  for (let x = 0; x <= width; x++) {
    const ageMs      = (width - x) / PIXELS_PER_MS
    const sampleAtMs = elapsedMs - ageMs
    const voltageMv  = ekgVoltage(sampleAtMs, cycleMs, waves)
    const y          = baselineY - voltageMv * PIXELS_PER_MV

    if (x === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.strokeStyle = SIGNAL_COLOR
  ctx.lineWidth   = 2
  ctx.lineJoin    = 'round'
  ctx.stroke()
}

/**
 * EKGWaveformPrototype — standalone Canvas test bench for the EKG engine.
 *
 * This is intentionally NOT one of the four module pages. It's a development
 * tool: a place to watch the Gaussian-sum model run continuously and check
 * its measured intervals against the Boron & Boulpaep reference ranges,
 * before this drawing logic gets adapted into Module 3's three-panel
 * simulator (where it will share a master clock with the conduction
 * animation and the cardiac vector).
 */
export default function EKGWaveformPrototype() {
  const canvasRef = useRef(null)
  const [rhythmId, setRhythmId] = useState('normalSinus')
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

  // The render loop (below) reads the active rhythm through this ref rather
  // than capturing it in the effect's closure. That lets switching the
  // dropdown change what's drawn on the very next frame — instantly, mid-
  // scroll — without tearing down and restarting the animation loop (which
  // would reset the clock and make the strip jump).
  const activeRhythmRef = useRef(RHYTHMS[rhythmId])
  useEffect(() => {
    activeRhythmRef.current = RHYTHMS[rhythmId]
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

      const rhythm  = activeRhythmRef.current
      const cycleMs = cycleLengthMs(rhythm.heartRateBpm)

      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
      drawGrid(ctx, CANVAS_WIDTH, CANVAS_HEIGHT)
      drawWaveform(ctx, CANVAS_WIDTH, CANVAS_HEIGHT, frozenElapsedMs, cycleMs, rhythm.waves)

      animationFrameId = requestAnimationFrame(render)
    }

    animationFrameId = requestAnimationFrame(render)

    // Stop the loop on unmount — otherwise it keeps redrawing (and burning
    // CPU) on a canvas that's no longer on screen.
    return () => cancelAnimationFrame(animationFrameId)
  }, [])

  const rhythm    = RHYTHMS[rhythmId]
  const intervals = measureIntervals(rhythm.waves)

  // QT's "normal" value depends on heart rate (Bazett's correction) — so
  // instead of comparing against one fixed number, we compute what we'd
  // *expect* to see at this rhythm's rate and check how close we landed.
  const expectedQt   = expectedQtMs(rhythm.heartRateBpm)
  const qtToleranceMs = 30

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto" style={{ backgroundColor: '#0a0e1a' }}>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white mb-1">EKG Waveform Engine — Prototype</h1>
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
          Lead I is a placeholder until Module 3 adds a lead selector;
          the time/voltage scales describe THIS canvas's grid spacing
          (see GRID_MINOR_MS / GRID_MAJOR_MS / PIXELS_PER_MV above). */}
      <div className="flex flex-wrap gap-2 mb-3">
        <LegendBadge label="Lead" value="Lead I" />
        <LegendBadge label="Time scale" value={`${GRID_MINOR_MS} ms / small square · ${GRID_MAJOR_MS} ms / large square`} />
        <LegendBadge label="Voltage scale" value="0.5 mV / square" />
      </div>

      <div className="rounded-2xl bg-gray-900 border border-gray-800 p-4 mb-6">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="w-full rounded-lg"
          style={{ backgroundColor: '#0a0e1a' }}
        />
      </div>

      {/* Measured intervals — compare these against the B&B reference ranges
          while tuning the wave parameters in ekgEngine.js.
          NOTE: for the pathological rhythms (1st-degree block, LBBB, RBBB),
          seeing PR or QRS read amber here is CORRECT — that's the model
          reproducing the very finding that defines the rhythm. */}
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
          label="QT interval"
          value={intervals.qtIntervalMs}
          reference={`Expected ~${Math.round(expectedQt)} ms at ${rhythm.heartRateBpm} bpm (Bazett)`}
          inRange={Math.abs(intervals.qtIntervalMs - expectedQt) <= qtToleranceMs}
        />
      </div>
    </div>
  )
}

function LegendBadge({ label, value }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-900 border border-gray-800">
      <span className="text-xs uppercase tracking-widest text-gray-500">{label}</span>
      <span className="text-xs text-gray-300 font-medium">{value}</span>
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
