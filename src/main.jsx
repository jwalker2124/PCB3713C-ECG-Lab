import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter as BrowserRouter } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { ModeProvider } from './context/ModeContext'
import './index.css'
import App from './App'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      {/* AuthProvider wraps ModeProvider because ModeProvider reads the user from AuthContext */}
      <AuthProvider>
        <ModeProvider>
          <App />
        </ModeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
)
