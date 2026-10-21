const assert = require('node:assert/strict')
const { test } = require('node:test')
const path = require('node:path')
const { CODE_AI_SOURCE, authorPointToMonitor, performanceSummary, createVideoEditCodeAiScene } = require('./uiInspectionSceneVideoEditCodeAi.cjs')

test('作者坐标在不同节目尺寸和屏幕偏移下映射到标题中心，拒绝缺失画幅', () => {
  assert.deepEqual(authorPointToMonitor({ x: 200, y: 100, width: 960, height: 540 }, { x: 960, y: 540 }), { x: 680, y: 370 })
  assert.deepEqual(authorPointToMonitor({ x: 2560, y: 40, width: 384, height: 216 }, { x: 960, y: 540 }), { x: 2752, y: 148 })
  assert.throws(() => authorPointToMonitor(null, { x: 0, y: 0 }), /DOM 尺寸无效/)
  assert.throws(() => authorPointToMonitor({ x: 0, y: 0, width: 10, height: 10 }, { x: 1921, y: 0 }), /超出画布/)
})

test('性能摘要保留每步和热帧实测，缺失数据明确为 null 而非假零', () => {
  const steps = [{ id: 'code', presentation: { renderMs: 8 } }, { id: 'failed' }]
  const samples = [{ renderMs: 8 }, { renderMs: 20 }, { renderMs: NaN }]
  const summary = performanceSummary(steps, samples, [{ duration: 58 }, { duration: 77 }])
  assert.deepEqual(summary.steps, [{ id: 'code', renderMs: 8 }, { id: 'failed', renderMs: null }])
  assert.equal(summary.maxRenderMs, 20); assert.equal(summary.maxLongTaskMs, 77)
  assert.equal(performanceSummary([], [], []).maxRenderMs, null)
})

test('作者原代码夹具声明可点选图层，标题图层覆盖画面中心并定位到自身源码', async () => {
  // esbuild 内存打包正式 TS 纯逻辑；不启动 Vite 服务、GPU 或 Electron。
  const Module = require('node:module')
  const bundle = await require('esbuild').build({ stdin: { contents: `
    export { testAuthorModule } from './src/features/videoEdit/engine/videoEditAuthorTestFixtures';
    export { authorSourceLocations } from './src/features/videoEdit/engine/videoEditAuthorBundle';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', alias: { '@': path.resolve('src') }, logLevel: 'silent' })
  const loaded = new Module(path.join(__dirname, 'codeAiProbe.cjs'))
  loaded.filename = path.join(__dirname, 'codeAiProbe.cjs')
  loaded.paths = Module._nodeModulePaths(__dirname)
  loaded._compile(bundle.outputFiles[0].text, loaded.filename)
  const { testAuthorModule, authorSourceLocations } = loaded.exports
  const effect = testAuthorModule(CODE_AI_SOURCE)
  const layers = effect.layers({ size: 96 }, 1920, 1080, {}, {})
  assert.deepEqual(layers.map(layer => layer.id), ['sky', 'plate', 'title'])
  const title = layers.at(-1)
  assert.ok(title.bounds[0] <= 960 && title.bounds[2] >= 960 && title.bounds[1] <= 540 && title.bounds[3] >= 540, '标题图层必须覆盖画面中心的点击位置')
  const span = authorSourceLocations({ entry: 'main.ts', files: { 'main.ts': CODE_AI_SOURCE } }).layers.title
  assert.match(CODE_AI_SOURCE.slice(span.start, span.end), /id: "title"/)
})

test('Reality 场景登记唯一 id 且声明会写隔离资料', () => {
  assert.equal(createVideoEditCodeAiScene().id, 'video-edit-code-ai')
  assert.equal(createVideoEditCodeAiScene().writesUserData, true)
  const { createUiInspectionScenes } = require('./uiInspectionScenes.cjs')
  assert.equal(createUiInspectionScenes({ canvasFixtureProjectId: 'fixture', settlePage: async () => {} })
    .filter(scene => scene.id === 'video-edit-code-ai').length, 1)
})
