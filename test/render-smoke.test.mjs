// Render smoke test: bundles the real app and server-renders it once.
// Exists because build + unit suites are blind to render-time crashes — a
// forward reference in a hook's dependency array (TDZ) shipped green through
// everything and would have white-screened every user. SSR executes every
// component/hook body (not effects), which is exactly the layer that broke.
// Run: node --test test/render-smoke.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import esbuild from 'esbuild'

const here = fileURLToPath(new URL('.', import.meta.url))

test('WrkApp renders without throwing (SSR, hooks execute)', async () => {
  // CJS output: react-dom/server's node build require()s node builtins, which
  // an ESM-format bundle can't satisfy. Output can live in tmp — only the
  // ENTRY's location matters for module resolution (see ssr-entry.jsx).
  const out = join(mkdtempSync(join(tmpdir(), 'wrk-ssr-')), 'bundle.cjs')
  await esbuild.build({
    entryPoints: [join(here, 'ssr-entry.jsx')],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    outfile: out,
    jsx: 'automatic',
    loader: { '.js': 'jsx' },
    logLevel: 'silent',
  })
  const mod = await import(pathToFileURL(out).href)
  const html = (mod.render || mod.default.render)()
  assert.ok(typeof html === 'string' && html.length > 500, 'app rendered non-trivial HTML')
  assert.ok(html.includes('WRK'), 'renders the WRK brand')
})
