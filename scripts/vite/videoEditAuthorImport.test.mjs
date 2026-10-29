import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer, build } from 'vite'

test('作者原生导入经真实 Vite 开发转换与生产构建均不带窗口客户端，并能加载标准模块', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const entry = 'src/features/videoEdit/engine/videoEditAuthorModule.ts'
  const config = { root, configFile: false, logLevel: 'silent', resolve: { alias: { '@': path.join(root, 'src') } } }
  const server = await createServer({ ...config, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } })
  try {
    const transformed = await server.transformRequest(`/${entry}`)
    assert.ok(transformed)
    assert.doesNotMatch(transformed.code, /\/@vite\/client|__vite__injectQuery|createHotContext/)
    // 模块图也必须没有窗口客户端，不能只把首行注入换成间接引用。
    const module = await server.moduleGraph.getModuleByUrl(`/${entry}`)
    assert.ok(![...module.importedModules].some(module => module.url.includes('/@vite/client')))
  } finally { await server.close() }
  // 生产产物里加载作者模块要先过信任闸；闸由 Worker 安装，这里把安装入口和加载入口打进同一个产物。
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-author-import-'))
  const probe = path.join(temp, 'entry.ts')
  const trust = path.join(root, 'src/features/videoEdit/engine/videoEditAuthorTrust.ts')
  await fs.writeFile(probe, `export { loadAuthorModule } from ${JSON.stringify(path.join(root, entry))}\nexport { installAuthorTrustGate } from ${JSON.stringify(trust)}\n`)
  let code
  try {
    const result = await build({ ...config, build: { write: false, minify: false, lib: { entry: probe, formats: ['es'] } } })
    code = (Array.isArray(result) ? result[0] : result).output.find(output => output.type === 'chunk' && output.isEntry).code
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
  assert.doesNotMatch(code, /\/@vite\/client|__vite__injectQuery|createHotContext/)
  const { loadAuthorModule, installAuthorTrustGate } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  installAuthorTrustGate(async () => {})
  const author = 'export default { name: "原生模块", draw() {} }'
  assert.equal((await loadAuthorModule(`data:text/javascript;base64,${Buffer.from(author).toString('base64')}`)).name, '原生模块')
})
