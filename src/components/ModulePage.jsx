import { useNavigate } from 'react-router-dom'
import { useMode, MODULE_ORDER } from '../context/ModeContext'

/**
 * ModulePage — the visual shell every module page renders inside.
 *
 * Props:
 *   moduleId    — 'physics' | 'cardiac' | 'ekg' | 'scenarios'
 *   number      — 1-4
 *   title       — display title
 *   objective   — the single "aha moment" statement for this module
 *   description — a paragraph describing what the module covers
 *   children    — the interactive content (p5.js canvas, EKG strip, etc.)
 *                 When null, shows a "coming soon" placeholder
 */
export default function ModulePage({ moduleId, number, title, objective, description, children }) {
  const { mode, progress, markComplete } = useMode()
  const navigate = useNavigate()

  const isLabMode  = mode === 'lab'
  const isComplete = progress.has(moduleId)
  const accent     = isLabMode ? '#818cf8' : '#2dd4bf'

  const nextId   = MODULE_ORDER[MODULE_ORDER.indexOf(moduleId) + 1]
  const nextPath = nextId ? `/${isLabMode ? 'lab' : 'play'}/${nextId}` : null

  const handleMarkComplete = async () => {
    await markComplete(moduleId)
    if (isLabMode && nextPath) navigate(nextPath)
  }

  return (
    <div className="min-h-screen p-8 max-w-4xl mx-auto">

      {/* ── Module header ── */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          {/* Module number pill */}
          <span
            className="text-xs font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full"
            style={{
              color:           accent,
              backgroundColor: accent + '18',
              border:          `1px solid ${accent}35`,
            }}
          >
            Module {number}
          </span>

          {isComplete && (
            <span className="text-xs text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2.5 py-1 rounded-full">
              ✓ Completed
            </span>
          )}
        </div>

        <h1 className="text-2xl font-bold text-white mb-5">{title}</h1>

        {/* Learning objective box — the "aha moment" */}
        <div
          className="rounded-xl p-4 border"
          style={{ backgroundColor: accent + '0c', borderColor: accent + '30' }}
        >
          <p
            className="text-xs uppercase tracking-widest font-semibold mb-2"
            style={{ color: accent + 'aa' }}
          >
            Learning objective
          </p>
          <p className="text-sm text-gray-200 leading-relaxed">{objective}</p>
        </div>
      </div>

      {/* ── Module description ── */}
      <p className="text-gray-400 text-sm leading-relaxed mb-8">{description}</p>

      {/* ── Interactive content ── */}
      <div className="mb-10">
        {children ?? (
          <div className="rounded-2xl bg-gray-900 border border-gray-800 border-dashed p-16 text-center">
            <div
              className="w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ backgroundColor: accent + '15' }}
            >
              <svg className="w-7 h-7" style={{ color: accent + 'aa' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round"
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>
              </svg>
            </div>
            <p className="text-gray-500 text-sm font-medium">Interactive content coming in Step 2+</p>
            <p className="text-gray-600 text-xs mt-1">
              The physics simulations, EKG engine, and patient cases will live here
            </p>
          </div>
        )}
      </div>

      {/* ── Lab Mode: mark complete / advance ── */}
      {isLabMode && (
        <div className="border-t border-gray-800 pt-6 flex items-center justify-between">
          <p className="text-xs text-gray-600">
            {isComplete
              ? 'This module is complete.'
              : 'Work through the material above, then mark this module complete to unlock the next one.'}
          </p>

          {!isComplete ? (
            <button
              onClick={handleMarkComplete}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all hover:opacity-90"
              style={{
                backgroundColor: accent + '20',
                color:           accent,
                border:          `1px solid ${accent}40`,
              }}
            >
              Mark complete
              {nextPath && (
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
                </svg>
              )}
            </button>
          ) : nextPath ? (
            <button
              onClick={() => navigate(nextPath)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-gray-300 bg-gray-800 hover:bg-gray-700 transition-colors"
            >
              Continue to next module
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7"/>
              </svg>
            </button>
          ) : (
            <span className="text-sm text-emerald-400">All modules complete!</span>
          )}
        </div>
      )}
    </div>
  )
}
