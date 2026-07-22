// Entry for the render smoke test. Lives INSIDE the repo so every import —
// including react-dom/server — resolves from this project's node_modules; an
// entry in the OS temp dir walks up into stray home-directory node_modules
// and pairs mismatched React copies.
import { renderToString } from 'react-dom/server'
import React from 'react'
import WrkApp from '../src/WrkApp.jsx'

export function render() {
  return renderToString(React.createElement(WrkApp))
}
