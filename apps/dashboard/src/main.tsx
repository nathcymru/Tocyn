import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { AuthQueryBoundary } from './components/auth/AuthQueryBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthQueryBoundary>
      <App />
    </AuthQueryBoundary>
  </React.StrictMode>,
)
