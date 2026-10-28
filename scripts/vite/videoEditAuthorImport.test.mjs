import test from 'node:test'
import assert from 'node:assert/strict'
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
  const result = await build({ ...config, build: { write: false, minify: false, lib: { entry: path.join(root, entry), formats: ['es'] } } })
  const code = (Array.isArray(result) ? result[0] : result).output.find(output => output.type === 'chunk' && output.isEntry).code
  assert.doesNotMatch(code, /\/@vite\/client|__vite__injectQuery|createHotContext/)
  const { loadAuthorModule } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
  const author = 'export default { name: "原生模块", draw() {} }'
  assert.equal((await loadAuthorModule(`data:text/javascript;base64,${Buffer.from(author).toString('base64')}`)).name, '原生模块')
})
