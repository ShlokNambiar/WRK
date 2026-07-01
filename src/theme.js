// Shared design tokens (pulled from the original HQ design — reused for WRK)
export const C = {
  ink: '#1a1a1a',
  // muted/faint darkened to pass WCAG AA (4.5:1) on the light paper for small
  // text; inkSoft nudged down to keep three visibly distinct steps.
  inkSoft: '#5f5f57',
  muted: '#6f6e63',
  faint: '#717066',
  line: '#e4e3dc',
  paper: '#f7f7f4',
  paper2: '#f0efe9',
  blue: '#1a18f0',
  red: '#ff3b30',
  pink: '#ff3d97',
  green: '#1f8a5b',
  amber: '#f5a623',
  card: '#fff',
}

export const FONT_SERIF = "'Newsreader',serif"
export const FONT_SANS =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"
export const FONT_MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace'

// Spring presets for framer-motion
export const SPRING = { type: 'spring', stiffness: 420, damping: 32, mass: 0.8 }
export const SPRING_SOFT = { type: 'spring', stiffness: 260, damping: 26 }
export const SPRING_POP = { type: 'spring', stiffness: 600, damping: 18 }
