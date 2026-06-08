import { Navigate } from 'react-router-dom'
import { useMode, MODULE_ORDER } from '../../context/ModeContext'

// Wraps a Lab Mode route. If the student hasn't unlocked this module yet,
// redirects them to the furthest module they can access.
export default function LabGuard({ children, moduleId }) {
  const { isUnlocked } = useMode()

  if (!isUnlocked(moduleId)) {
    // Find the last module the student can currently reach
    const accessible = MODULE_ORDER.filter(id => isUnlocked(id))
    const redirectTo = accessible.length > 0
      ? `/lab/${accessible[accessible.length - 1]}`
      : '/lab/physics'

    return <Navigate to={redirectTo} replace />
  }

  return children
}
