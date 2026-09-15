import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource/atkinson-hyperlegible/400.css'
import '@fontsource/atkinson-hyperlegible/700.css'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import App from './App'
import './index.css'
import '@luminatick/ui/styles.css'
import { AuthQueryBoundary } from './components/auth/AuthQueryBoundary'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AuthQueryBoundary>
      <App />
    </AuthQueryBoundary>
  </React.StrictMode>,
)
