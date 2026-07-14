import { useEffect, useRef, useState } from 'react'
import { ekgVoltage, buildRhythmFromParams } from '../lib/ekgEngine'

// ── Canvas sizes ──────────────────────────────────────────────────────────────
const BW = 500, BH = 330    // body canvas
const EW = 500, EH = 110    // ekg strip canvas

// Cardiac dipole origin (center of chest in body canvas coords)
const CX = 250, CY = 158

// How many px = 1 mV on the body diagram dipole arrow
const DIPOLE_SCALE = 52

// EKG strip constants
const PX_MS = 0.20
const PX_MV = 58
const BL    = 0.55          // baseline y-fraction in EKG canvas

// Pre-built rhythm (normal sinus, constant — only lead axis changes)
const RHYTHM = buildRhythmFromParams({
  saNodeRate: 70, avConductionRatio: 'all', prInterval: 160,
  qrsDuration: 80, qtInterval: 380, pWaveMode: 'present', escapeRhythm: 'none',
})

// Standard Einthoven electrode positions on body canvas
const EIN = {
  RA: { x: 138, y: 105 },
  LA: { x: 362, y: 105 },
  LL: { x: 250, y: 293 },
}
const EIN_LEADS = [
  { a: 'RA', b: 'LA', label: 'I',   color: '#60a5fa' },
  { a: 'RA', b: 'LL', label: 'II',  color: '#34d399' },
  { a: 'LA', b: 'LL', label: 'III', color: '#f472b6' },
]

// ── Drawing helpers ───────────────────────────────────────────────────────────
function buildTorsoPath(ctx) {
  ctx.beginPath()
  ctx.moveTo(224, 70)
  ctx.bezierCurveTo(198, 76, 148, 82, 120, 108)
  ctx.bezierCurveTo(108, 145, 114, 188, 130, 298)
  ctx.lineTo(370, 298)
  ctx.bezierCurveTo(386, 188, 392, 145, 380, 108)
  ctx.bezierCurveTo(352, 82, 302, 76, 276, 70)
  ctx.closePath()
}

function drawTorso(ctx) {
  // Fill
  buildTorsoPath(ctx)
  ctx.fillStyle = '#0d1b2e'
  ctx.fill()
  // Outline
  buildTorsoPath(ctx)
  ctx.strokeStyle = '#1e3a5f'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Head
  ctx.beginPath()
  ctx.ellipse(250, 38, 30, 36, 0, 0, Math.PI * 2)
  ctx.fillStyle = '#0d1b2e'
  ctx.fill()
  ctx.strokeStyle = '#1e3a5f'
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Subtle rib lines
  ctx.strokeStyle = 'rgba(30,58,95,0.6)'
  ctx.lineWidth = 1
  for (let i = 0; i < 4; i++) {
    const y = 128 + i * 32
    ctx.beginPath()
    ctx.moveTo(158 - i * 3, y)
    ctx.bezierCurveTo(200, y + 8, 300, y + 8, 342 + i * 3, y)
    ctx.stroke()
  }
}

function drawArrow(ctx, x1, y1, x2, y2, color, width, glow) {
  const dx = x2 - x1, dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 2) return
  const ux = dx / len, uy = dy / len
  const headLen = Math.min(14, len * 0.35)

  if (glow) {
    ctx.shadowColor  = color
    ctx.shadowBlur   = 10
  }

  ctx.strokeStyle = color
  ctx.lineWidth   = width
  ctx.lineCap     = 'round'
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2 - headLen * ux * 0.6, y2 - headLen * uy * 0.6)
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(x2 - headLen * (ux + 0.42 * uy), y2 - headLen * (uy - 0.42 * ux))
  ctx.lineTo(x2 - headLen * (ux - 0.42 * uy), y2 - headLen * (uy + 0.42 * ux))
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()

  ctx.shadowBlur = 0
}

function projectPointOntoLine(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: ax, y: ay, t: 0 }
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  return { x: ax + t * dx, y: ay + t * dy, t }
}

function drawGrid(ctx, w, h) {
  const by = h * BL
  const step = 40 * PX_MS
  ctx.lineWidth = 1
  let i = 0
  for (let x = 0; x <= w; x += step) {
    ctx.strokeStyle = i % 5 === 0 ? 'rgba(16,185,129,0.18)' : 'rgba(16,185,129,0.07)'
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); i++
  }
  const mvStep = 0.5 * PX_MV
  ctx.strokeStyle = 'rgba(16,185,129,0.07)'
  for (let y = by; y <= h; y += mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  for (let y = by; y >= 0; y -= mvStep) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke() }
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(w, by); ctx.stroke()
}

// ── Main component ────────────────────────────────────────────────────────────
export default function LeadPlacementLab() {
  const bodyRef = useRef(null)
  const ekgRef  = useRef(null)

  // Live info panel refs (avoid state re-renders)
  const angleRef    = useRef(null)
  const dotRef      = useRef(null)
  const projRef     = useRef(null)

  // Electrode positions (mutable ref — no re-render on drag)
  const elec = useRef({
    plus:  { x: 330, y: 272 },
    minus: { x: 138, y: 105 },
  })
  const dragging   = useRef(null)   // 'plus' | 'minus' | null
  const t0Ref      = useRef(null)

  const [showEinthoven, setShowEinthoven] = useState(true)

  // Track showEinthoven in a ref for use inside rAF
  const showERef = useRef(showEinthoven)
  useEffect(() => { showERef.current = showEinthoven }, [showEinthoven])

  useEffect(() => {
    const bodyCanvas = bodyRef.current
    const ekgCanvas  = ekgRef.current
    const bCtx = bodyCanvas.getContext('2d')
    const eCtx = ekgCanvas.getContext('2d')
    let animId

    const { waves, cycleMs, nativeCycleMs } = RHYTHM

    const frame = (ts) => {
      if (t0Ref.current === null) t0Ref.current = ts
      const elapsed = ts - t0Ref.current
      const tMs = elapsed % cycleMs

      const { plus, minus } = elec.current
      const dx = plus.x - minus.x
      const dy = plus.y - minus.y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const ux = dx / dist, uy = dy / dist
      const leadAxisDeg = Math.atan2(dy, dx) * 180 / Math.PI

      // Cardiac vector components (Lead I=x, aVF=y)
      const Vx = ekgVoltage(tMs, cycleMs, waves, 0,  nativeCycleMs)
      const Vy = ekgVoltage(tMs, cycleMs, waves, 90, nativeCycleMs)

      // Dot product = projection of cardiac vector onto lead axis
      const dotProd = Vx * ux + Vy * uy

      // Angle between cardiac vector and lead axis
      const vMag   = Math.sqrt(Vx * Vx + Vy * Vy)
      const cosTheta = vMag > 0.001 ? Math.max(-1, Math.min(1, dotProd / vMag)) : 0
      const thetaDeg = Math.acos(cosTheta) * 180 / Math.PI

      // ── Body canvas ────────────────────────────────────────────────────
      bCtx.clearRect(0, 0, BW, BH)
      drawTorso(bCtx)

      // Einthoven triangle
      if (showERef.current) {
        EIN_LEADS.forEach(({ a, b, label, color }) => {
          bCtx.strokeStyle = color + '55'
          bCtx.lineWidth   = 1.5
          bCtx.setLineDash([5, 4])
          bCtx.beginPath()
          bCtx.moveTo(EIN[a].x, EIN[a].y)
          bCtx.lineTo(EIN[b].x, EIN[b].y)
          bCtx.stroke()
          bCtx.setLineDash([])
          // Label at midpoint
          const mx = (EIN[a].x + EIN[b].x) / 2
          const my = (EIN[a].y + EIN[b].y) / 2
          bCtx.fillStyle = color + 'cc'
          bCtx.font = 'bold 11px monospace'
          bCtx.textAlign = 'center'
          bCtx.fillText(`Lead ${label}`, mx + (label === 'I' ? 0 : label === 'II' ? -22 : 22), my)
        })
        // Einthoven electrode dots
        Object.entries(EIN).forEach(([id, pos]) => {
          bCtx.beginPath()
          bCtx.arc(pos.x, pos.y, 5, 0, Math.PI * 2)
          bCtx.fillStyle = '#475569'
          bCtx.fill()
          bCtx.fillStyle = '#94a3b8'
          bCtx.font = '9px monospace'
          bCtx.textAlign = 'center'
          bCtx.fillText(id, pos.x, pos.y - 9)
        })
      }

      // Lead axis — extend across full canvas
      {
        const extend = 600
        const ax = minus.x - ux * extend, ay = minus.y - uy * extend
        const bx = minus.x + ux * extend, by = minus.y + uy * extend
        bCtx.strokeStyle = 'rgba(100,116,139,0.35)'
        bCtx.lineWidth   = 1
        bCtx.setLineDash([8, 6])
        bCtx.beginPath()
        bCtx.moveTo(ax, ay)
        bCtx.lineTo(bx, by)
        bCtx.stroke()
        bCtx.setLineDash([])
      }

      // ── Cardiac vector ──────────────────────────────────────────────────
      const vsx = Vx * DIPOLE_SCALE, vsy = Vy * DIPOLE_SCALE
      const tipX = CX + vsx, tipY = CY + vsy

      // Small origin circle
      bCtx.beginPath()
      bCtx.arc(CX, CY, 4, 0, Math.PI * 2)
      bCtx.fillStyle = 'rgba(99,102,241,0.4)'
      bCtx.fill()

      // Draw arrow only when magnitude is visible
      if (vMag > 0.03) {
        drawArrow(bCtx, CX, CY, tipX, tipY, '#818cf8', 2.5, true)
      }

      // ── Projection visualization ────────────────────────────────────────
      if (vMag > 0.03) {
        // Foot of perpendicular from DIPOLE TIP to lead axis
        const foot = projectPointOntoLine(tipX, tipY, minus.x, minus.y, plus.x, plus.y)

        // Origin projected onto lead axis
        const orig = projectPointOntoLine(CX, CY, minus.x, minus.y, plus.x, plus.y)

        // Dashed perpendicular from tip to foot
        bCtx.setLineDash([4, 4])
        bCtx.strokeStyle = 'rgba(148,163,184,0.55)'
        bCtx.lineWidth   = 1.5
        bCtx.beginPath()
        bCtx.moveTo(tipX, tipY)
        bCtx.lineTo(foot.x, foot.y)
        bCtx.stroke()
        bCtx.setLineDash([])

        // Projected component segment on lead axis (colored by sign)
        const projColor = dotProd >= 0 ? '#3b82f6' : '#f59e0b'
        bCtx.strokeStyle = projColor
        bCtx.lineWidth   = 5
        bCtx.lineCap     = 'round'
        bCtx.shadowColor = projColor
        bCtx.shadowBlur  = 8
        bCtx.beginPath()
        bCtx.moveTo(orig.x, orig.y)
        bCtx.lineTo(foot.x, foot.y)
        bCtx.stroke()
        bCtx.shadowBlur  = 0

        // Right-angle tick at foot
        const perpLen = 6
        bCtx.strokeStyle = 'rgba(148,163,184,0.7)'
        bCtx.lineWidth   = 1.5
        bCtx.beginPath()
        bCtx.moveTo(foot.x - perpLen * uy, foot.y + perpLen * ux)
        bCtx.lineTo(foot.x + perpLen * uy, foot.y - perpLen * ux)
        bCtx.stroke()
      }

      // ── Electrodes ─────────────────────────────────────────────────────
      const drawElectrode = (pos, label, color) => {
        bCtx.beginPath()
        bCtx.arc(pos.x, pos.y, 11, 0, Math.PI * 2)
        bCtx.fillStyle = color + '33'
        bCtx.fill()
        bCtx.strokeStyle = color
        bCtx.lineWidth   = 2
        bCtx.stroke()
        bCtx.fillStyle   = color
        bCtx.font        = 'bold 13px monospace'
        bCtx.textAlign   = 'center'
        bCtx.textBaseline = 'middle'
        bCtx.fillText(label, pos.x, pos.y)
        bCtx.textBaseline = 'alphabetic'
      }
      drawElectrode(plus,  '+', '#3b82f6')
      drawElectrode(minus, '−', '#f59e0b')

      // Electrode labels
      bCtx.font      = '10px monospace'
      bCtx.fillStyle = '#64748b'
      bCtx.textAlign = 'center'
      bCtx.fillText('(+)', plus.x, plus.y + 22)
      bCtx.fillText('(−)', minus.x, minus.y + 22)

      // ── Live info panel update ──────────────────────────────────────────
      if (angleRef.current)  angleRef.current.textContent  = `${thetaDeg.toFixed(1)}°`
      if (dotRef.current)    dotRef.current.textContent    = dotProd.toFixed(3) + ' mV'
      if (projRef.current) {
        const percent = (Math.abs(cosTheta) * 100).toFixed(0)
        projRef.current.textContent = `${percent}% of max`
      }

      // ── EKG strip ──────────────────────────────────────────────────────
      eCtx.clearRect(0, 0, EW, EH)
      eCtx.fillStyle = '#030712'
      eCtx.fillRect(0, 0, EW, EH)
      drawGrid(eCtx, EW, EH)

      const by = EH * BL
      eCtx.beginPath()
      for (let x = 0; x <= EW; x++) {
        const v = ekgVoltage(elapsed - (EW - x) / PX_MS, cycleMs, waves, leadAxisDeg, nativeCycleMs)
        const y = by - v * PX_MV
        if (x === 0) eCtx.moveTo(x, y); else eCtx.lineTo(x, y)
      }
      eCtx.strokeStyle = '#10b981'
      eCtx.lineWidth   = 2
      eCtx.lineJoin    = 'round'
      eCtx.stroke()

      animId = requestAnimationFrame(frame)
    }

    animId = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(animId)
  }, [])

  // ── Drag handling ─────────────────────────────────────────────────────────
  const HIT_R = 18

  const onMouseDown = (e) => {
    const rect = bodyRef.current.getBoundingClientRect()
    const scaleX = BW / rect.width
    const scaleY = BH / rect.height
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top)  * scaleY
    const { plus, minus } = elec.current
    const dPlus  = Math.hypot(mx - plus.x,  my - plus.y)
    const dMinus = Math.hypot(mx - minus.x, my - minus.y)
    if (dPlus  < HIT_R) dragging.current = 'plus'
    else if (dMinus < HIT_R) dragging.current = 'minus'
  }

  const onMouseMove = (e) => {
    if (!dragging.current) return
    const rect = bodyRef.current.getBoundingClientRect()
    const scaleX = BW / rect.width
    const scaleY = BH / rect.height
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top)  * scaleY
    elec.current[dragging.current] = {
      x: Math.max(10, Math.min(BW - 10, mx)),
      y: Math.max(10, Math.min(BH - 10, my)),
    }
  }

  const onMouseUp = () => { dragging.current = null }

  const onTouchStart = (e) => {
    e.preventDefault()
    onMouseDown(e.touches[0])
  }
  const onTouchMove = (e) => {
    e.preventDefault()
    onMouseMove(e.touches[0])
  }

  return (
    <div className="rounded-2xl bg-gray-950 border border-gray-800 overflow-hidden">

      {/* Header */}
      <div className="px-5 pt-5 pb-3 border-b border-gray-800">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white mb-1">Lead Placement Lab</h3>
            <p className="text-xs text-gray-400 leading-relaxed max-w-lg">
              Drag the <span className="text-blue-400 font-semibold">+ (positive)</span> and{' '}
              <span className="text-amber-400 font-semibold">− (negative)</span> electrodes anywhere
              on the body. The EKG strip updates in real time based on the{' '}
              <span className="text-white">dot product</span> of the cardiac vector with your lead axis.
            </p>
          </div>
          <button
            onClick={() => setShowEinthoven(v => !v)}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
              showEinthoven
                ? 'bg-indigo-950/60 text-indigo-300 border-indigo-700/50'
                : 'bg-gray-800 text-gray-500 border-gray-700'
            }`}
          >
            Einthoven overlay
          </button>
        </div>
      </div>

      <div className="flex gap-0">
        {/* Body canvas */}
        <div className="relative">
          <canvas
            ref={bodyRef}
            width={BW}
            height={BH}
            style={{ width: '100%', maxWidth: BW, display: 'block', cursor: 'grab', backgroundColor: '#030712' }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onMouseUp}
          />
          {/* Floating annotation */}
          <div className="absolute bottom-3 left-3 right-3 pointer-events-none">
            <p className="text-xs text-gray-600 text-center font-mono">
              drag electrodes to any position
            </p>
          </div>
        </div>

        {/* Info panel */}
        <div className="w-48 shrink-0 bg-gray-900/80 border-l border-gray-800 p-4 flex flex-col gap-5 justify-center">
          <div>
            <p className="text-xs uppercase tracking-widest text-gray-600 mb-2">Physics</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              The EKG measures the <strong className="text-white">projection</strong> of the cardiac vector onto the lead axis:
            </p>
            <p className="text-xs font-mono text-indigo-300 mt-2 text-center">
              V = A·B = |A||B|cosθ
            </p>
          </div>

          <div className="space-y-3">
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Angle θ</p>
              <p ref={angleRef} className="text-lg font-bold font-mono text-white tabular-nums">—</p>
              <p className="text-xs text-gray-600">between dipole &amp; lead axis</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Projected voltage</p>
              <p ref={dotRef} className="text-lg font-bold font-mono text-blue-400 tabular-nums">—</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-0.5">Efficiency</p>
              <p ref={projRef} className="text-lg font-bold font-mono text-emerald-400 tabular-nums">—</p>
              <p className="text-xs text-gray-600">cosθ × 100</p>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-3 space-y-1.5 text-xs text-gray-600">
            <p><span className="text-blue-400">Parallel</span> → max amplitude</p>
            <p><span className="text-gray-400">Perpendicular</span> → flat line</p>
            <p><span className="text-amber-400">Anti-parallel</span> → inverted</p>
          </div>
        </div>
      </div>

      {/* EKG strip */}
      <div className="border-t border-gray-800">
        <div className="flex items-center gap-3 px-4 pt-3 pb-1">
          <p className="text-xs uppercase tracking-widest text-gray-600">Live EKG output</p>
          <p className="text-xs text-gray-700">— amplitude scales with cosθ</p>
        </div>
        <canvas
          ref={ekgRef}
          width={EW}
          height={EH}
          style={{ width: '100%', maxWidth: EW + 192, display: 'block', backgroundColor: '#030712' }}
        />
        <p className="text-xs text-gray-700 text-right px-4 pb-2">40 ms / square · 0.5 mV / square</p>
      </div>

    </div>
  )
}
