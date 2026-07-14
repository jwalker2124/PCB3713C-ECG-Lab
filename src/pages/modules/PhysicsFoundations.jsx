import { useEffect, useRef, useState } from 'react'
import p5 from 'p5'
import ModulePage from '../../components/ModulePage'
import LeadPlacementLab from '../../components/LeadPlacementLab'

// ── Layout helpers ────────────────────────────────────────────────────────────
function Section({ label, title, children }) {
  return (
    <div className="mb-10">
      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs font-semibold uppercase tracking-widest text-teal-500/80 bg-teal-950/40 border border-teal-800/40 px-2 py-0.5 rounded-full">
          {label}
        </span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      {children}
    </div>
  )
}

function Callout({ children, accent = '#2dd4bf' }) {
  return (
    <div
      className="rounded-xl p-4 text-sm text-gray-300 leading-relaxed mb-3"
      style={{ backgroundColor: accent + '0c', borderLeft: `3px solid ${accent}50` }}
    >
      {children}
    </div>
  )
}

function Equation({ children, label }) {
  return (
    <div className="flex items-center gap-4 my-3">
      <div className="flex-1 rounded-lg bg-gray-900 border border-gray-800 px-5 py-3 font-mono text-sm text-indigo-300 text-center">
        {children}
      </div>
      {label && <p className="text-xs text-gray-600 w-36 leading-tight">{label}</p>}
    </div>
  )
}

function ForwardLink({ children }) {
  return (
    <div className="flex items-center gap-3 mt-5 mb-1 text-xs text-gray-600">
      <div className="flex-1 h-px bg-gray-800" />
      <span className="shrink-0 px-3 py-1 rounded-full border border-gray-800 text-gray-600">
        {children}
      </span>
      <div className="flex-1 h-px bg-gray-800" />
    </div>
  )
}

function CanvasWrap({ containerRef, children }) {
  return (
    <div className="rounded-xl overflow-hidden border border-gray-800 mb-4">
      <div ref={containerRef} />
      {children}
    </div>
  )
}

function SimBar({ children }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-900/80 border-t border-gray-800 text-xs text-gray-500 flex-wrap">
      {children}
    </div>
  )
}

// ── 1A: Point charges, field lines, equipotentials ───────────────────────────
function Sim1A() {
  const containerRef = useRef()
  const showEqRef = useRef(false)
  const [showEq, setShowEq] = useState(false)

  useEffect(() => { showEqRef.current = showEq }, [showEq])

  useEffect(() => {
    const W = 540, H = 300, K = 38000, CR = 13

    const sketch = (p) => {
      const charges = [
        { x: W / 2 - 100, y: H / 2, q: 1 },
        { x: W / 2 + 100, y: H / 2, q: -1 },
      ]
      let dragging = null
      let lastTap = { t: 0, i: -1 }

      function volt(x, y) {
        let v = 0
        for (const c of charges) {
          const r = Math.max(Math.hypot(x - c.x, y - c.y), 8)
          v += K * c.q / r
        }
        return v
      }

      function fld(x, y) {
        let ex = 0, ey = 0
        for (const c of charges) {
          const dx = x - c.x, dy = y - c.y
          const r2 = Math.max(dx * dx + dy * dy, 64), r = Math.sqrt(r2)
          const f = K * c.q / (r2 * r)
          ex += f * dx; ey += f * dy
        }
        return [ex, ey]
      }

      function chargeAt(x, y) {
        for (let i = charges.length - 1; i >= 0; i--)
          if (Math.hypot(x - charges[i].x, y - charges[i].y) < CR + 5) return i
        return -1
      }

      function traceField(sx, sy) {
        const pts = [[sx, sy]]
        let x = sx, y = sy
        for (let i = 0; i < 350; i++) {
          const [ex, ey] = fld(x, y)
          const m = Math.hypot(ex, ey)
          if (m < 1) break
          x += 3 * ex / m; y += 3 * ey / m
          if (x < 0 || x > W || y < 0 || y > H) break
          let stop = false
          for (const c of charges)
            if (c.q < 0 && Math.hypot(x - c.x, y - c.y) < CR + 7) { stop = true; break }
          pts.push([x, y])
          if (stop) break
        }
        return pts
      }

      function drawCharge(c) {
        p.strokeWeight(2)
        if (c.q > 0) { p.stroke(100, 160, 255); p.fill(59, 130, 246) }
        else { p.stroke(255, 180, 60); p.fill(245, 158, 11) }
        p.circle(c.x, c.y, CR * 2)
        p.fill(255); p.noStroke()
        p.textAlign(p.CENTER, p.CENTER); p.textSize(15)
        p.text(c.q > 0 ? '+' : '−', c.x, c.y)
      }

      p.setup = () => {
        const cnv = p.createCanvas(W, H)
        cnv.elt.addEventListener('contextmenu', e => e.preventDefault())
        p.textFont('monospace')
      }

      p.draw = () => {
        p.background(15, 20, 30)

        // Voltage heatmap
        const gs = 7; p.noStroke()
        for (let x = 0; x < W; x += gs) {
          for (let y = 0; y < H; y += gs) {
            const v = volt(x + gs / 2, y + gs / 2)
            const c = Math.max(-1, Math.min(1, v / 2800))
            if (c > 0) p.fill(59, 130, 246, c * 85)
            else p.fill(245, 158, 11, -c * 85)
            p.rect(x, y, gs, gs)
          }
        }

        // Equipotential dots
        if (showEqRef.current) {
          const targets = [-2400, -1200, -400, 400, 1200, 2400]
          p.noStroke()
          for (let x = 0; x < W; x += 5) {
            for (let y = 0; y < H; y += 5) {
              const v = volt(x, y)
              for (const Vt of targets) {
                if (Math.abs(v - Vt) < Math.abs(Vt) * 0.07 + 40) {
                  p.fill(Vt > 0 ? p.color(140, 200, 255, 160) : p.color(255, 200, 100, 160))
                  p.rect(x, y, 3, 3)
                  break
                }
              }
            }
          }
        }

        // Field lines (skip during drag for performance)
        if (dragging === null) {
          p.noFill(); p.stroke(255, 255, 255, 85); p.strokeWeight(1.2)
          for (const c of charges) {
            if (c.q <= 0) continue
            for (let k = 0; k < 8; k++) {
              const a = (k / 8) * Math.PI * 2
              const pts = traceField(c.x + (CR + 5) * Math.cos(a), c.y + (CR + 5) * Math.sin(a))
              if (pts.length > 1) {
                p.beginShape()
                pts.forEach(([px, py]) => p.vertex(px, py))
                p.endShape()
              }
            }
          }
        }

        charges.forEach(drawCharge)

        // Voltage at cursor
        if (p.mouseX >= 0 && p.mouseX < W && p.mouseY >= 0 && p.mouseY < H) {
          const mv = volt(p.mouseX, p.mouseY)
          p.fill(255, 255, 255, 150); p.noStroke()
          p.textAlign(p.LEFT, p.TOP); p.textSize(10)
          p.text(`V = ${mv.toFixed(0)}`, 8, 8)
        }
      }

      p.mousePressed = () => {
        if (p.mouseX < 0 || p.mouseX > W || p.mouseY < 0 || p.mouseY > H) return
        const i = chargeAt(p.mouseX, p.mouseY)
        const now = Date.now()
        if (i >= 0) {
          if (now - lastTap.t < 320 && lastTap.i === i) {
            charges.splice(i, 1); lastTap = { t: 0, i: -1 }
          } else {
            dragging = i; lastTap = { t: now, i }
          }
          return
        }
        if (p.mouseButton === p.RIGHT) charges.push({ x: p.mouseX, y: p.mouseY, q: -1 })
        else charges.push({ x: p.mouseX, y: p.mouseY, q: 1 })
      }
      p.mouseDragged = () => {
        if (dragging !== null && charges[dragging]) {
          charges[dragging].x = p.mouseX; charges[dragging].y = p.mouseY
        }
      }
      p.mouseReleased = () => { dragging = null }
    }

    const inst = new p5(sketch, containerRef.current)
    return () => inst.remove()
  }, [])

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <span className="flex-1">Left-click: add + &nbsp;·&nbsp; Right-click: add − &nbsp;·&nbsp; Drag to move &nbsp;·&nbsp; Double-click to remove</span>
        <button
          onClick={() => setShowEq(v => !v)}
          className={`shrink-0 px-3 py-1 rounded-full border text-xs transition-colors cursor-pointer ${showEq ? 'bg-teal-900/50 border-teal-700 text-teal-300' : 'border-gray-700 text-gray-500 hover:text-gray-400'}`}
        >
          Equipotentials {showEq ? 'ON' : 'OFF'}
        </button>
      </SimBar>
    </CanvasWrap>
  )
}

// ── 1B: Dipole rotation, test-point voltage ───────────────────────────────────
function Sim1B() {
  const containerRef = useRef()

  useEffect(() => {
    const W = 480, H = 280, K = 50000, SEP = 72

    const sketch = (p) => {
      let angle = 0
      let testPt = { x: W * 0.73, y: H * 0.28 }
      let dragDipole = false, dragTest = false

      const posC = () => ({ x: W / 2 + SEP * Math.cos(angle), y: H / 2 + SEP * Math.sin(angle) })
      const negC = () => ({ x: W / 2 - SEP * Math.cos(angle), y: H / 2 - SEP * Math.sin(angle) })

      function volt(x, y) {
        const { x: px, y: py } = posC(), { x: nx, y: ny } = negC()
        const rp = Math.max(Math.hypot(x - px, y - py), 8)
        const rn = Math.max(Math.hypot(x - nx, y - ny), 8)
        return K * (1 / rp - 1 / rn)
      }

      function arrow(x1, y1, x2, y2, r, g, b, a = 220, sw = 2.5) {
        p.stroke(r, g, b, a); p.strokeWeight(sw)
        p.line(x1, y1, x2, y2)
        const ang = Math.atan2(y2 - y1, x2 - x1), hs = 11
        p.fill(r, g, b, a); p.noStroke()
        p.triangle(x2, y2,
          x2 - hs * Math.cos(ang - 0.42), y2 - hs * Math.sin(ang - 0.42),
          x2 - hs * Math.cos(ang + 0.42), y2 - hs * Math.sin(ang + 0.42))
      }

      function drawCharge(x, y, positive) {
        const R = 13
        p.strokeWeight(2)
        if (positive) { p.stroke(100, 160, 255); p.fill(59, 130, 246) }
        else { p.stroke(255, 180, 60); p.fill(245, 158, 11) }
        p.circle(x, y, R * 2)
        p.fill(255); p.noStroke()
        p.textAlign(p.CENTER, p.CENTER); p.textSize(15)
        p.text(positive ? '+' : '−', x, y)
      }

      p.setup = () => { p.createCanvas(W, H); p.textFont('monospace') }

      p.draw = () => {
        p.background(15, 20, 30)

        // Voltage heatmap
        const gs = 7; p.noStroke()
        for (let x = 0; x < W; x += gs) {
          for (let y = 0; y < H; y += gs) {
            const v = volt(x + gs / 2, y + gs / 2)
            const c = Math.max(-1, Math.min(1, v / 1800))
            if (c > 0) p.fill(59, 130, 246, c * 80)
            else p.fill(245, 158, 11, -c * 80)
            p.rect(x, y, gs, gs)
          }
        }

        const { x: px, y: py } = posC(), { x: nx, y: ny } = negC()

        // Dipole moment arrow (neg → pos)
        arrow(nx, ny, px, py, 255, 255, 255, 210, 2.5)

        // p⃗ label
        p.fill(255, 255, 255, 170); p.noStroke()
        p.textAlign(p.LEFT, p.BOTTOM); p.textSize(12)
        const la = angle - Math.PI / 2
        p.text('p⃗', px + 14 * Math.cos(la), py + 14 * Math.sin(la))

        drawCharge(px, py, true)
        drawCharge(nx, ny, false)

        // Test point
        const tv = volt(testPt.x, testPt.y)
        p.fill(52, 211, 153); p.stroke(52, 211, 153, 200); p.strokeWeight(1.5)
        p.circle(testPt.x, testPt.y, 10)
        const lbl = `V = ${tv.toFixed(0)}`
        const lw = lbl.length * 6.6 + 8
        p.fill(15, 20, 30, 200); p.noStroke()
        p.rect(testPt.x + 8, testPt.y - 8, lw, 15, 3)
        p.fill(52, 211, 153); p.textAlign(p.LEFT, p.CENTER); p.textSize(11)
        p.text(lbl, testPt.x + 10, testPt.y)

        // Instructions
        p.fill(255, 255, 255, 65); p.noStroke()
        p.textAlign(p.LEFT, p.TOP); p.textSize(10)
        p.text('Drag center region to rotate · Drag green dot to measure V', 8, 8)
      }

      p.mousePressed = () => {
        if (p.mouseX < 0 || p.mouseX > W || p.mouseY < 0 || p.mouseY > H) return
        if (Math.hypot(p.mouseX - testPt.x, p.mouseY - testPt.y) < 12) { dragTest = true; return }
        if (Math.hypot(p.mouseX - W / 2, p.mouseY - H / 2) < 100) dragDipole = true
      }
      p.mouseDragged = () => {
        if (dragTest) { testPt.x = p.mouseX; testPt.y = p.mouseY; return }
        if (dragDipole) angle = Math.atan2(p.mouseY - H / 2, p.mouseX - W / 2)
      }
      p.mouseReleased = () => { dragDipole = false; dragTest = false }
    }

    const inst = new p5(sketch, containerRef.current)
    return () => inst.remove()
  }, [])

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <span>Drag the <strong className="text-white">center region</strong> to rotate the dipole &nbsp;·&nbsp; Drag the <span className="text-emerald-400">green dot</span> to probe voltage at any point</span>
      </SimBar>
    </CanvasWrap>
  )
}

// ── 1C: Voltage difference between two probe points ───────────────────────────
function Sim1C() {
  const containerRef = useRef()
  const sepRef = useRef(80)
  const [sep, setSep] = useState(80)

  useEffect(() => { sepRef.current = sep }, [sep])

  useEffect(() => {
    const W = 480, H = 280, K = 42000, PR = 9

    const sketch = (p) => {
      let probeA = { x: W / 2 - 90, y: H / 2 - 65 }
      let probeB = { x: W / 2 + 90, y: H / 2 + 65 }
      let dragA = false, dragB = false

      function volt(x, y) {
        const s = sepRef.current
        const r1 = Math.max(Math.hypot(x - (W / 2 + s / 2), y - H / 2), 8)
        const r2 = Math.max(Math.hypot(x - (W / 2 - s / 2), y - H / 2), 8)
        return K * (1 / r1 - 1 / r2)
      }

      p.setup = () => { p.createCanvas(W, H); p.textFont('monospace') }

      p.draw = () => {
        p.background(15, 20, 30)
        const s = sepRef.current
        const px = W / 2 + s / 2, nx = W / 2 - s / 2

        // Voltage heatmap
        const gs = 7; p.noStroke()
        for (let x = 0; x < W; x += gs) {
          for (let y = 0; y < H; y += gs) {
            const v = volt(x + gs / 2, y + gs / 2)
            const c = Math.max(-1, Math.min(1, v / 2200))
            if (c > 0) p.fill(59, 130, 246, c * 80)
            else p.fill(245, 158, 11, -c * 80)
            p.rect(x, y, gs, gs)
          }
        }

        // Conductor body
        const bw = s + 60, bh = 32
        p.fill(28, 38, 52); p.stroke(70, 95, 120); p.strokeWeight(1.5)
        p.rect(W / 2 - bw / 2, H / 2 - bh / 2, bw, bh, 5)

        // Charge symbols inside conductor
        p.noStroke(); p.textAlign(p.CENTER, p.CENTER); p.textSize(12)
        p.fill(59, 130, 246)
        for (let i = -1; i <= 1; i++) p.text('+', px + i * 12, H / 2)
        p.fill(245, 158, 11)
        for (let i = -1; i <= 1; i++) p.text('−', nx + i * 12, H / 2)

        // Probe lead wires (dashed)
        p.strokeWeight(1)
        p.stroke(52, 211, 153, 70); p.drawingContext.setLineDash([4, 3])
        p.line(probeA.x, probeA.y, probeA.x, H / 2)
        p.stroke(168, 85, 247, 70)
        p.line(probeB.x, probeB.y, probeB.x, H / 2)
        p.drawingContext.setLineDash([])

        // Probe A (teal)
        p.fill(52, 211, 153); p.stroke(52, 211, 153, 180); p.strokeWeight(2)
        p.circle(probeA.x, probeA.y, PR * 2)
        // Probe B (purple)
        p.fill(168, 85, 247); p.stroke(168, 85, 247, 180)
        p.circle(probeB.x, probeB.y, PR * 2)

        // Labels
        p.noStroke()
        p.fill(52, 211, 153, 180); p.textAlign(p.CENTER, p.TOP); p.textSize(10)
        p.text('A', probeA.x, probeA.y + PR + 3)
        p.fill(168, 85, 247, 180)
        p.text('B', probeB.x, probeB.y + PR + 3)

        // ΔV display
        const vA = volt(probeA.x, probeA.y)
        const vB = volt(probeB.x, probeB.y)
        const dv = vA - vB

        p.fill(15, 20, 30, 210); p.noStroke()
        p.rect(8, 8, 210, 68, 6)
        p.textAlign(p.LEFT, p.TOP); p.textSize(11)
        p.fill(52, 211, 153); p.text(`V(A) = ${vA.toFixed(0)}`, 16, 16)
        p.fill(168, 85, 247); p.text(`V(B) = ${vB.toFixed(0)}`, 16, 30)
        p.fill(255, 255, 255, 210); p.text(`ΔV  = ${dv.toFixed(0)}`, 16, 44)
        p.fill(150, 150, 150, 100); p.textSize(9)
        p.text('(what the EKG records)', 16, 58)

        // Hint
        p.fill(255, 255, 255, 60); p.textAlign(p.LEFT, p.BOTTOM); p.textSize(10)
        p.text('Drag teal or purple probe to any position', 8, H - 6)
      }

      p.mousePressed = () => {
        if (p.mouseX < 0 || p.mouseX > W || p.mouseY < 0 || p.mouseY > H) return
        if (Math.hypot(p.mouseX - probeA.x, p.mouseY - probeA.y) < PR + 5) { dragA = true; return }
        if (Math.hypot(p.mouseX - probeB.x, p.mouseY - probeB.y) < PR + 5) dragB = true
      }
      p.mouseDragged = () => {
        if (dragA) { probeA.x = p.mouseX; probeA.y = p.mouseY }
        if (dragB) { probeB.x = p.mouseX; probeB.y = p.mouseY }
      }
      p.mouseReleased = () => { dragA = false; dragB = false }
    }

    const inst = new p5(sketch, containerRef.current)
    return () => inst.remove()
  }, [])

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <span className="shrink-0 text-gray-400">Charge separation</span>
        <input
          type="range" min="10" max="200" value={sep}
          onChange={e => setSep(+e.target.value)}
          className="flex-1 accent-teal-400"
        />
        <span className="shrink-0 font-mono text-gray-400 w-10 text-right">{sep}px</span>
      </SimBar>
    </CanvasWrap>
  )
}

// ── 1D: Draggable vectors, dot product, projection ───────────────────────────
function Sim1D() {
  const containerRef = useRef()

  useEffect(() => {
    const W = 480, H = 300
    const OX = W / 2, OY = H / 2

    const sketch = (p) => {
      let vecA = { x: 80, y: -60 }
      let vecB = { x: 115, y: 28 }
      let dragA = false, dragB = false
      const DR = 12

      function dot(a, b) { return a.x * b.x + a.y * b.y }
      function mag(v) { return Math.hypot(v.x, v.y) }
      function norm(v) { const m = mag(v) || 1; return { x: v.x / m, y: v.y / m } }

      function arrow(x1, y1, x2, y2, r, g, b, a = 220, sw = 2.5) {
        p.stroke(r, g, b, a); p.strokeWeight(sw)
        p.line(x1, y1, x2, y2)
        const ang = Math.atan2(y2 - y1, x2 - x1), hs = 11
        p.fill(r, g, b, a); p.noStroke()
        p.triangle(x2, y2,
          x2 - hs * Math.cos(ang - 0.42), y2 - hs * Math.sin(ang - 0.42),
          x2 - hs * Math.cos(ang + 0.42), y2 - hs * Math.sin(ang + 0.42))
      }

      p.setup = () => { p.createCanvas(W, H); p.textFont('monospace') }

      p.draw = () => {
        p.background(15, 20, 30)

        // Grid
        p.stroke(255, 255, 255, 11); p.strokeWeight(1)
        for (let x = OX % 40; x < W; x += 40) p.line(x, 0, x, H)
        for (let y = OY % 40; y < H; y += 40) p.line(0, y, W, y)

        // Axes
        p.stroke(255, 255, 255, 32); p.strokeWeight(1)
        p.line(0, OY, W, OY); p.line(OX, 0, OX, H)

        const bm = mag(vecB)
        const bn = norm(vecB)
        const am = mag(vecA)

        // Projection of A onto B
        if (bm > 0.1) {
          const projLen = dot(vecA, bn)
          const projX = OX + bn.x * projLen
          const projY = OY + bn.y * projLen

          // Dashed perpendicular from A tip to projection point
          p.stroke(59, 130, 246, 100); p.strokeWeight(1.2)
          p.drawingContext.setLineDash([4, 3])
          p.line(OX + vecA.x, OY + vecA.y, projX, projY)
          p.drawingContext.setLineDash([])

          // Projection segment on B axis
          p.stroke(59, 130, 246, 180); p.strokeWeight(3.5)
          p.line(OX, OY, projX, projY)

          // Projection endpoint marker
          p.fill(59, 130, 246, 200); p.noStroke()
          p.circle(projX, projY, 7)
        }

        // Resultant A+B (dashed, gray)
        const sx = OX + vecA.x + vecB.x, sy = OY + vecA.y + vecB.y
        p.stroke(150, 150, 150, 55); p.strokeWeight(1.5)
        p.drawingContext.setLineDash([5, 4])
        p.line(OX + vecA.x, OY + vecA.y, sx, sy)
        p.line(OX + vecB.x, OY + vecB.y, sx, sy)
        p.drawingContext.setLineDash([])
        arrow(OX, OY, sx, sy, 150, 150, 150, 70, 1.5)

        // Vector B (amber — the "lead axis")
        arrow(OX, OY, OX + vecB.x, OY + vecB.y, 245, 158, 11, 220, 2.5)
        const bAng = Math.atan2(vecB.y, vecB.x)
        p.fill(245, 158, 11, 190); p.noStroke()
        p.textAlign(p.CENTER, p.CENTER); p.textSize(13)
        p.text('B', OX + vecB.x + 15 * Math.cos(bAng + 0.5), OY + vecB.y + 15 * Math.sin(bAng + 0.5))

        // Vector A (blue — the "cardiac vector")
        arrow(OX, OY, OX + vecA.x, OY + vecA.y, 59, 130, 246, 220, 2.5)
        const aAng = Math.atan2(vecA.y, vecA.x)
        p.fill(59, 130, 246, 190); p.noStroke()
        p.textAlign(p.CENTER, p.CENTER); p.textSize(13)
        p.text('A', OX + vecA.x + 15 * Math.cos(aAng + 0.5), OY + vecA.y + 15 * Math.sin(aAng + 0.5))

        // Drag handles
        p.fill(59, 130, 246); p.noStroke()
        p.circle(OX + vecA.x, OY + vecA.y, DR * 2)
        p.fill(245, 158, 11)
        p.circle(OX + vecB.x, OY + vecB.y, DR * 2)

        // Info panel
        const dotVal = dot(vecA, vecB)
        const cosT = am > 0 && bm > 0 ? dotVal / (am * bm) : 0
        const theta = Math.acos(Math.max(-1, Math.min(1, cosT))) * 180 / Math.PI

        p.fill(15, 20, 30, 215); p.noStroke()
        p.rect(8, 8, 228, 80, 6)
        p.textAlign(p.LEFT, p.TOP); p.textSize(11)
        p.fill(255, 255, 255, 210); p.text(`A · B  = ${dotVal.toFixed(0)}`, 16, 16)
        p.fill(200, 200, 200, 150)
        p.text(`|A||B|cosθ = ${(am * bm * cosT).toFixed(0)}`, 16, 30)
        p.fill(180, 180, 180, 130)
        p.text(`θ = ${theta.toFixed(1)}°    cosθ = ${cosT.toFixed(3)}`, 16, 44)
        p.fill(120, 120, 120, 100)
        p.text(`|A| = ${(am / 40).toFixed(2)}    |B| = ${(bm / 40).toFixed(2)}`, 16, 58)

        // Legend
        p.fill(59, 130, 246, 150); p.textSize(9); p.textAlign(p.LEFT, p.TOP)
        p.text('—— projection of A onto B', 16, 72)

        // Hint
        p.fill(255, 255, 255, 60); p.textAlign(p.LEFT, p.BOTTOM); p.textSize(10)
        p.text('Drag blue tip (A) or amber tip (B)', 8, H - 6)
      }

      p.mousePressed = () => {
        if (p.mouseX < 0 || p.mouseX > W || p.mouseY < 0 || p.mouseY > H) return
        const mx = p.mouseX - OX, my = p.mouseY - OY
        if (Math.hypot(mx - vecA.x, my - vecA.y) < DR + 4) { dragA = true; return }
        if (Math.hypot(mx - vecB.x, my - vecB.y) < DR + 4) dragB = true
      }
      p.mouseDragged = () => {
        const mx = p.mouseX - OX, my = p.mouseY - OY
        if (dragA) { vecA.x = mx; vecA.y = my }
        if (dragB) { vecB.x = mx; vecB.y = my }
      }
      p.mouseReleased = () => { dragA = false; dragB = false }
    }

    const inst = new p5(sketch, containerRef.current)
    return () => inst.remove()
  }, [])

  return (
    <CanvasWrap containerRef={containerRef}>
      <SimBar>
        <span><span className="text-blue-400">Blue</span> = cardiac vector (A) &nbsp;·&nbsp; <span className="text-amber-400">Amber</span> = lead axis (B) &nbsp;·&nbsp; <span className="text-gray-400">Projection shown on B axis</span></span>
      </SimBar>
    </CanvasWrap>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function PhysicsFoundations() {
  return (
    <ModulePage
      moduleId="physics"
      number={1}
      title="Physics foundations"
      objective="An EKG does not directly record the heart's electrical signal. It records the projection of the net cardiac dipole vector onto a lead axis — a geometric operation you already know from Physics 2."
      description="This module rebuilds the bridge between Physics 2 and cardiology. You will interactively explore how point charges create electric fields, how a dipole emerges from charge separation, what voltage actually measures between two points, and how projecting a moving vector onto different axes produces different waveform amplitudes. By the end, Einthoven's Triangle will feel like a natural consequence of vector projection — not a memorized fact."
    >

      {/* ── 1A ──────────────────────────────────────────────────────────────── */}
      <Section label="1A" title="Point charges create an electric field and potential">
        <p className="text-sm text-gray-400 leading-relaxed mb-3">
          Add charges to the canvas. The colored background is the electric potential V at every
          point — blue = positive, amber = negative. White lines are field lines: they leave +
          charges and arrive at − charges, tracing the direction a positive test charge would move.
          Toggle equipotentials to see the iso-V contours that run perpendicular to field lines.
        </p>

        <Sim1A />

        <Callout>
          <strong className="text-white">Insight:</strong> When cardiac muscle depolarizes, positive
          ions rush into cells and a charge separation forms across the wavefront — positive charges
          ahead, negative charges behind. This is the same physics as two opposite charges on the canvas.
          The net effect at electrode distance approximates a single equivalent dipole.
        </Callout>

        <ForwardLink>continues in 1B — the dipole model</ForwardLink>
      </Section>

      {/* ── 1B ──────────────────────────────────────────────────────────────── */}
      <Section label="1B" title="A dipole: the simplest model of the heart's field">
        <p className="text-sm text-gray-400 leading-relaxed mb-3">
          A dipole is a locked +/− pair with a fixed separation. Rotate it by dragging the center.
          Move the green probe to any point and read the voltage there. Notice that V depends on both
          the probe's distance from the center <em>and</em> the angle between the probe and the dipole axis.
        </p>

        <Equation label="θ = angle between dipole axis and probe direction">
          {'V(r, θ) ≈ (kp cos θ) / r²'}
        </Equation>

        <Sim1B />

        <Callout>
          <strong className="text-white">Insight:</strong> At distances large compared to the
          charge separation (true for skin electrodes), any distribution of charge looks like a
          single dipole. The entire heart's electrical activity at each instant collapses to one
          rotating vector <strong className="text-white">p⃗</strong> — this is why the cardiac
          dipole model works.
        </Callout>

        <ForwardLink>continues in 1C — voltage difference between two points</ForwardLink>
      </Section>

      {/* ── 1C ──────────────────────────────────────────────────────────────── */}
      <Section label="1C" title="EKGs measure voltage difference, not absolute voltage">
        <p className="text-sm text-gray-400 leading-relaxed mb-3">
          Drag the two probes to different positions in the dipole field. The panel shows each
          probe's voltage and the difference ΔV between them. Use the slider to change the charge
          separation (the dipole moment) and watch ΔV scale. This is exactly what one EKG lead
          measures: the potential difference between its two electrodes.
        </p>

        <Sim1C />

        <Callout>
          <strong className="text-white">Insight:</strong> The absolute voltage at any skin point
          is large and arbitrary — what matters is the <em>difference</em> between two electrode
          positions. This is why an electrode on your right foot still picks up cardiac signal. The
          heart's dipole field extends throughout the body; each lead pair samples two points and
          reports ΔV.
        </Callout>

        <ForwardLink>continues in 1D — the dot product projects the dipole onto a measurement axis</ForwardLink>
      </Section>

      {/* ── 1D ──────────────────────────────────────────────────────────────── */}
      <Section label="1D" title="The dot product: what every lead does to the cardiac vector">
        <p className="text-sm text-gray-400 leading-relaxed mb-3">
          Vector <strong className="text-blue-400">A</strong> is the cardiac dipole at one instant.
          Vector <strong className="text-amber-400">B</strong> is the lead axis (the direction from −
          electrode to + electrode). The EKG voltage recorded by that lead is A&thinsp;·&thinsp;B.
          The dashed line shows the projection of A onto B; the thick blue segment on the B axis
          shows its signed length.
        </p>

        <Equation label="θ = angle between cardiac vector and lead axis">
          {'V_lead = A · B = |A| |B| cos θ'}
        </Equation>

        <Sim1D />

        <div className="grid grid-cols-3 gap-3 text-sm mb-3">
          {[
            { θ: '0°',   result: 'cos θ = 1',  desc: 'Lead parallel to cardiac vector → maximum positive deflection', color: '#3b82f6' },
            { θ: '90°',  result: 'cos θ = 0',  desc: 'Lead perpendicular → isoelectric (flat line)',                  color: '#6b7280' },
            { θ: '180°', result: 'cos θ = −1', desc: 'Lead anti-parallel → maximum negative (inverted waveform)',     color: '#f59e0b' },
          ].map(({ θ, result, desc, color }) => (
            <div key={θ} className="rounded-xl bg-gray-900 border border-gray-800 p-3">
              <p className="font-mono text-lg font-bold mb-1" style={{ color }}>θ = {θ}</p>
              <p className="font-mono text-xs text-gray-400 mb-2">{result}</p>
              <p className="text-xs text-gray-500 leading-snug">{desc}</p>
            </div>
          ))}
        </div>

        <Callout>
          <strong className="text-white">Insight:</strong> Every EKG lead is a fixed axis (B).
          The cardiac dipole rotates through one full arc per heartbeat (A sweeps through time).
          The waveform you see on screen is simply A&thinsp;·&thinsp;B plotted against time — the
          dot product of a rotating vector onto a stationary axis. Leads aligned with the mean
          cardiac axis see tall complexes; leads perpendicular to it see flat lines.
        </Callout>

        <ForwardLink>continues in 1E — place real electrodes on a body and see the projection live</ForwardLink>
      </Section>

      {/* ── 1E: Interactive Lead Placement Lab — the payoff ──────────────── */}
      <Section label="1E" title="Interactive: place electrodes and see the projection in real time">
        <Callout accent="#818cf8">
          <strong className="text-white">This is the conceptual payoff of sections 1A–1D.</strong>{' '}
          Drag the electrodes anywhere on the body. Watch the EKG strip respond to the dot product
          between the rotating cardiac dipole and your lead axis. Try placing your lead parallel to
          Lead II — you'll get the biggest QRS. Rotate 90° — the line goes flat. The physics is
          identical to projecting vector A onto vector B in section 1D.
        </Callout>

        <LeadPlacementLab />

        <div className="mt-4 rounded-xl bg-gray-900/70 border border-gray-800 p-4">
          <p className="text-xs uppercase tracking-widest text-gray-600 mb-3">Guided experiments</p>
          <div className="grid grid-cols-2 gap-3 text-xs text-gray-400">
            {[
              { n: '1', text: 'Place electrodes horizontally (left−right). This approximates Lead I (0°). Notice the P wave and T wave are positive, QRS tallest.' },
              { n: '2', text: 'Rotate to approximately 60° (upper-left to lower-right). This is Lead II — the axis closest to the mean cardiac vector. Maximum QRS amplitude.' },
              { n: '3', text: 'Place the axis perpendicular to Lead II (~−30°, upper-right to lower-left). The EKG approaches a flat line — pure isoelectric.' },
              { n: '4', text: 'Flip the electrodes (swap + and −). The waveform inverts. Same axis, opposite polarity — amplitude unchanged, sign flipped.' },
            ].map(({ n, text }) => (
              <div key={n} className="flex gap-2.5">
                <span className="shrink-0 w-5 h-5 rounded-full bg-teal-950/60 border border-teal-800/50 text-teal-400 text-xs font-bold flex items-center justify-center">{n}</span>
                <p className="leading-relaxed">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </Section>

    </ModulePage>
  )
}
