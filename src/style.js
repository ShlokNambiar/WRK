// Parse a CSS declaration string ("a:b;c:d") into a React style object.
// Splits only on top-level ';' / ':' so url(...), gradients and data-URIs
// (which contain ';' ':' ',') survive intact.
const camel = (k) => k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())

export function s(str) {
  const out = {}
  let depth = 0
  let key = ''
  let buf = ''
  let readingKey = true
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '(') { depth++; buf += ch; continue }
    if (ch === ')') { depth--; buf += ch; continue }
    if (ch === ':' && depth === 0 && readingKey) {
      key = buf.trim(); buf = ''; readingKey = false; continue
    }
    if (ch === ';' && depth === 0) {
      if (key) out[camel(key)] = buf.trim()
      key = ''; buf = ''; readingKey = true; continue
    }
    buf += ch
  }
  if (key && buf.trim()) out[camel(key)] = buf.trim()
  return out
}
