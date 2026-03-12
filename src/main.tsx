import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './globals.css'
// Import the theme store early so the saved theme is applied before first paint
import '@/store/theme'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
