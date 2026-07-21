import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth }  from './context/AuthContext'
import { useMode }  from './context/ModeContext'

import ProtectedRoute                from './components/layout/ProtectedRoute'
import LabGuard                      from './components/layout/LabGuard'
import { LabLayout, FreePlayLayout } from './components/layout/Layouts'

import ECGWaveformPrototype from './pages/dev/ECGWaveformPrototype'
import Login              from './pages/Login'
import ModeSelect         from './pages/ModeSelect'
import PhysicsFoundations from './pages/modules/PhysicsFoundations'
import CardiacBridge      from './pages/modules/CardiacBridge'
import ECGSimulator       from './pages/modules/ECGSimulator'
import PatientScenarios   from './pages/modules/PatientScenarios'

// Smart redirect from "/" based on auth state + saved mode preference
function RootRedirect() {
  const { user, loading }     = useAuth()
  const { mode, loadingMode } = useMode()
  if (loading || loadingMode) return null
  if (!user)           return <Navigate to="/login"        replace />
  if (mode === 'lab')  return <Navigate to="/lab/physics"  replace />
  if (mode === 'free') return <Navigate to="/play/physics" replace />
  return                      <Navigate to="/mode"         replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/"     element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />

      {/* Dev-only: standalone test bench for the ECG waveform engine.
          Remove this route once the engine is tuned and folded into Module 3. */}
      <Route path="/dev/ECG-prototype" element={<ProtectedRoute><ECGWaveformPrototype /></ProtectedRoute>} />
      <Route path="/mode"  element={<ProtectedRoute><ModeSelect /></ProtectedRoute>} />

      {/* Lab Mode — linear, gated */}
      <Route path="/lab" element={<ProtectedRoute><LabLayout /></ProtectedRoute>}>
        <Route index        element={<Navigate to="physics" replace />} />
        <Route path="physics"   element={<PhysicsFoundations />} />
        <Route path="cardiac"   element={<LabGuard moduleId="cardiac">  <CardiacBridge  /></LabGuard>} />
        <Route path="ECG"       element={<LabGuard moduleId="ECG">      <ECGSimulator   /></LabGuard>} />
        <Route path="scenarios" element={<LabGuard moduleId="scenarios"><PatientScenarios /></LabGuard>} />
      </Route>

      {/* Free Play — open access */}
      <Route path="/play" element={<ProtectedRoute><FreePlayLayout /></ProtectedRoute>}>
        <Route index        element={<Navigate to="physics" replace />} />
        <Route path="physics"   element={<PhysicsFoundations />} />
        <Route path="cardiac"   element={<CardiacBridge />} />
        <Route path="ECG"       element={<ECGSimulator />} />
        <Route path="scenarios" element={<PatientScenarios />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
