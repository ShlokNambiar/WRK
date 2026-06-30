import React from 'react'
import { createRoot } from 'react-dom/client'

// Bundled font (no Google CDN dependency — works offline / when packaged)
import '@fontsource/newsreader/400.css'
import '@fontsource/newsreader/500.css'
import '@fontsource/newsreader/600.css'
import '@fontsource/newsreader/400-italic.css'
import '@fontsource/newsreader/600-italic.css'
import '@fontsource/newsreader/700-italic.css'

import './index.css'
import WrkApp from './WrkApp.jsx'
import { initNative } from './lib/native.js'

initNative()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <WrkApp />
  </React.StrictMode>,
)
