import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useEffect } from 'react'

function EKGLogo() {
  return (
    <svg viewBox="0 0 64 24" className="w-14 h-6" fill="none">
      <polyline
        points="0,12 10,12 14,3 18,21 22,1 26,23 30,12 64,12"
        stroke="#10b981" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
    </svg>
  )
}

export default function Login() {
  const navigate           = useNavigate()
  const { signIn, signUp, user } = useAuth()  // ← add user here
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [isSignUp, setIsSignUp] = useState(false)
  const [error,    setError]    = useState(null)   // { type: 'error'|'info', message: string }
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    if (user) navigate('/mode')
  }, [user])

  const handleSubmit = async (e) => {
  e.preventDefault()
  setError(null)
  setLoading(true)
  try {
    if (isSignUp) {
      await signUp(email, password)
      // Immediately sign in after signup — no email confirmation needed
      await signIn(email, password)
      navigate('/mode')
    } else {
      await signIn(email, password)
      navigate('/mode')
    }
  } catch (err) {
    setError({ type: 'error', message: err.message })
  } finally {
    setLoading(false)
  }
}

  const inputClass = `
    w-full bg-gray-800 border border-gray-700 text-white text-sm rounded-lg
    px-3 py-2.5 transition-colors
    focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50
    placeholder:text-gray-600
  `

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: '#0a0e1a' }}>
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-2">
            <EKGLogo />
          </div>
          <h1 className="text-white text-lg font-semibold">EKG Learning Platform</h1>
          <p className="text-gray-500 text-sm mt-1">Cardiac electrophysiology for BME students</p>
        </div>

        {/* Card */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-6">
          <h2 className="text-white font-medium text-sm mb-5">
            {isSignUp ? 'Create an account' : 'Sign in to continue'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="your@email.com"
                className={inputClass}
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                minLength={6}
                placeholder="6+ characters"
                className={inputClass}
              />
            </div>

            {/* Error / info banner */}
            {error && (
              <div className={`text-xs px-3 py-2.5 rounded-lg border leading-relaxed ${
                error.type === 'info'
                  ? 'bg-blue-950/50 text-blue-300 border-blue-800'
                  : 'bg-red-950/50 text-red-300 border-red-800'
              }`}>
                {error.message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'Loading...' : isSignUp ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-gray-800 text-center">
            <button
              onClick={() => { setIsSignUp(s => !s); setError(null) }}
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
            >
              {isSignUp
                ? 'Already have an account? Sign in'
                : "Don't have an account? Create one"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
