import { Outlet, Navigate } from 'react-router-dom'
import { useMode } from '../../context/ModeContext'
import Sidebar from './Sidebar'

export function LabLayout() {
  const { mode, loadingMode } = useMode()
  if (loadingMode) return null
  // If they saved "free" mode last time, redirect them there
  if (mode === 'free') return <Navigate to="/play/physics" replace />

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#0a0e1a' }}>
      <Sidebar isLabMode={true} />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}

export function FreePlayLayout() {
  const { mode, loadingMode } = useMode()
  if (loadingMode) return null
  if (mode === 'lab') return <Navigate to="/lab/physics" replace />

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: '#0a0e1a' }}>
      <Sidebar isLabMode={false} />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
