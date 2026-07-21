import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './AuthContext'

const ModeContext = createContext(null)

// The four modules in the order they appear in Lab Mode
export const MODULE_ORDER = ['physics', 'cardiac', 'ECG', 'scenarios']

// Metadata for each module (used by Sidebar and ModulePage)
export const MODULE_INFO = {
  physics: {
    id: 'physics',
    label: 'Physics foundations',
    number: 1,
    labPath:  '/lab/physics',
    playPath: '/play/physics',
  },
  cardiac: {
    id: 'cardiac',
    label: 'Cardiac electrophysiology',
    number: 2,
    labPath:  '/lab/cardiac',
    playPath: '/play/cardiac',
  },
  ECG: {
    id: 'ECG',
    label: 'ECG simulator & rhythms',
    number: 3,
    labPath:  '/lab/ECG',
    playPath: '/play/ECG',
  },
  scenarios: {
    id: 'scenarios',
    label: 'Patient scenarios',
    number: 4,
    labPath:  '/lab/scenarios',
    playPath: '/play/scenarios',
  },
}

export function ModeProvider({ children }) {
  const { user } = useAuth()

  // 'lab' | 'free' | null (null = not chosen yet)
  const [mode, setModeState]       = useState(null)
  // Set of module IDs the student has completed (e.g. new Set(['physics', 'cardiac']))
  const [progress, setProgress]    = useState(new Set())
  const [loadingMode, setLoading]  = useState(true)

  // When the user logs in/out, load their saved mode and progress from Supabase.
  // Keyed on user?.id (a stable primitive) rather than the user object itself —
  // Supabase hands us a freshly-deserialized user object on every auth event
  // (e.g. token refresh on tab focus), so keying on the object would re-run
  // this fetch — and its 2 queries — on every one of those, not just real logins.
  useEffect(() => {
    if (!user) {
      setModeState(null)
      setProgress(new Set())
      setLoading(false)
      return
    }

    const load = async () => {
      setLoading(true)
      try {
        // Load mode preference
        const { data: profile } = await supabase
          .from('profiles')
          .select('mode')
          .eq('id', user.id)
          .single()
        if (profile?.mode) setModeState(profile.mode)

        // Load completed modules
        const { data: rows } = await supabase
          .from('user_progress')
          .select('module_id')
          .eq('user_id', user.id)
          .eq('completed', true)
        if (rows) setProgress(new Set(rows.map(r => r.module_id)))
      } catch (err) {
        console.error('Failed to load user data:', err)
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [user?.id])

  // Change mode (lab ↔ free) and persist to Supabase
  const setMode = async (newMode) => {
    setModeState(newMode)
    if (user) {
      await supabase
        .from('profiles')
        .update({ mode: newMode })
        .eq('id', user.id)
    }
  }

  // Mark a module complete — updates local state immediately, syncs to Supabase
  const markComplete = async (moduleId) => {
    setProgress(prev => new Set([...prev, moduleId]))
    if (user) {
      await supabase.from('user_progress').upsert(
        { user_id: user.id, module_id: moduleId, completed: true, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,module_id' }
      )
    }
  }

  // A module is "unlocked" in Lab Mode if every preceding module is completed.
  // Module 1 (physics) is always unlocked.
  const isUnlocked = (moduleId) => {
    const idx = MODULE_ORDER.indexOf(moduleId)
    if (idx <= 0) return true
    return MODULE_ORDER.slice(0, idx).every(id => progress.has(id))
  }

  return (
    <ModeContext.Provider value={{ mode, setMode, progress, markComplete, isUnlocked, loadingMode }}>
      {children}
    </ModeContext.Provider>
  )
}

// useMode hook — call this in any component to access mode state
export const useMode = () => {
  const ctx = useContext(ModeContext)
  if (!ctx) throw new Error('useMode must be used inside <ModeProvider>')
  return ctx
}
