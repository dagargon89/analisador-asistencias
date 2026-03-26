import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import KioskShell from './KioskShell.tsx'
import { AuthProvider } from './auth/AuthContext.tsx'
import AuthGate from './auth/AuthGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.startsWith('/kiosk') ? (
      <KioskShell />
    ) : (
      <AuthProvider>
        <AuthGate>
          <App />
        </AuthGate>
      </AuthProvider>
    )}
  </StrictMode>,
)
