import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
const ROOT = 'D:/VibeCode/Henji-AI'
const { videoEditRenderEngineVersion } = await import(pathToFileURL(path.join(ROOT, 'scripts/vite/renderEngineVersion.mjs')).href)
const here = path.dirname(fileURLToPath(import.meta.url)).replaceAll('\\', '/')
export default {
  root: ROOT,
  cacheDir: path.join(ROOT, '.tmp/vite-test-cache-audit'),
  plugins: [{ name: 'wgsl', enforce: 'pre', load(id) { const f = id.split('?')[0]; return f.endsWith('.wgsl') ? `export default ${JSON.stringify(readFileSync(f, 'utf8'))}` : null } },
    { name: 'vendor-url', transform(code, id) { if (!/[\\/]resources[\\/]video-edit-author[\\/]vendor[\\/].+\.mjs$/.test(id) || !code.includes('import.meta.url')) return null; return { code: code.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(id).href)), map: null } } },
    videoEditRenderEngineVersion({ fixed: 'test' })],
  resolve: { alias: { '@': path.join(ROOT, 'src') } },
  server: { fs: { strict: false } },
  test: { globals: true, include: [`${here}/*.test.ts`], dir: here, maxWorkers: 1, minWorkers: 1,
    env: { HENJI_DATA_ROOT: path.join(ROOT, '.tmp/test-data-root') } },
}
