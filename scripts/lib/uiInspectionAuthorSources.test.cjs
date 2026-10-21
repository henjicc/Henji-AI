const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const sources = require('./uiInspectionAuthorSources.cjs')

test('验收场景的作者原代码夹具都能作为正式作者模块加载并解析参数', async () => {
  // esbuild 内存打包正式 TS 纯逻辑；不启动 Vite、GPU 或 Electron。
  const Module = require('node:module')
  const bundle = await require('esbuild').build({ stdin: { contents: `
    export { testAuthorModule } from './src/features/videoEdit/engine/videoEditAuthorTestFixtures';
    export { authorEffectMetadata } from './src/features/videoEdit/engine/videoEditAuthorParameters';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', alias: { '@': path.resolve('src') }, logLevel: 'silent' })
  const loaded = new Module(path.join(__dirname, 'authorSourcesProbe.cjs'))
  loaded.filename = path.join(__dirname, 'authorSourcesProbe.cjs')
  loaded.paths = Module._nodeModulePaths(__dirname)
  loaded._compile(bundle.outputFiles[0].text, loaded.filename)
  const { testAuthorModule, authorEffectMetadata } = loaded.exports
  const all = {
    dynamic: sources.trackTitleSource(), dynamicBase: sources.trackTitleSource({ withControls: false }),
    static: sources.staticCardSource(), staticBase: sources.staticCardSource({ withLogo: false }),
    agent: sources.AGENT_COLOR_SOURCE, asset: sources.ASSET_SOURCE, assetFilter: sources.redGainFilter('可编辑资产滤镜', 1, false),
    compositeFilter: sources.redGainFilter('原创红色处理', .8, true), generator: sources.PERFORMANCE_GENERATOR, filter: sources.PERFORMANCE_FILTER,
    ...sources.OBSERVATION_SOURCES,
  }
  for (const [name, source] of Object.entries(all)) {
    const metadata = authorEffectMetadata(testAuthorModule(source))
    assert.ok(metadata.name, name)
  }
  assert.ok(all.dynamic.includes('const x='), '源码错误验收依赖稳定插入点')
  assert.ok(all.compositeFilter.includes('c.g,c.b'), '滤镜修订验收依赖稳定替换点')
  assert.deepEqual(authorEffectMetadata(testAuthorModule(all.dynamic)).parameters.map(parameter => parameter.key), ['speed', 'ink', 'enabled', 'shape', 'label'])
  assert.equal(authorEffectMetadata(testAuthorModule(all.compositeFilter)).kind, 'filter')
})
