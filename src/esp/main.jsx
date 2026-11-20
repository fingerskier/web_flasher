import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import * as esptool from 'esptool-js'
import '@/shared/base.css'
import '@/shared/layout.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App esptool={esptool} />
  </StrictMode>,
)
