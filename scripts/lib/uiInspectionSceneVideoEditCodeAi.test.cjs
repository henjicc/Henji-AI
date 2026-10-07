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

test('v3 夹具经正式编译器编译与求值，入场后标题中心实际命中 title', async () => {
  // esbuild 内存打包正式 TS 纯逻辑；不启动 Vite 服务、GPU 或 Electron，不执行作者源码。
  const Module = require('node:module')
  const bundle = await require('esbuild').build({ stdin: { contents: `
    export { compileCodeMaterial } from './src/core/videoEdit/codeMaterial/compiler';
    export { evaluateCodeMaterial, hitTestCodeMaterial } from './src/core/videoEdit/codeMaterial/evaluate';
    export { layoutCodeText } from './src/core/videoEdit/codeMaterial/textLayout';`, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'cjs', platform: 'node', packages: 'external', alias: { '@': path.resolve('src') }, logLevel: 'silent' })
  const loaded = new Module(path.join(__dirname, 'codeAiProbe.cjs'))
  loaded.filename = path.join(__dirname, 'codeAiProbe.cjs')
  loaded.paths = Module._nodeModulePaths(__dirname)
  loaded._compile(bundle.outputFiles[0].text, loaded.filename)
  const { compileCodeMaterial, evaluateCodeMaterial, hitTestCodeMaterial, layoutCodeText } = loaded.exports
    const program = compileCodeMaterial(CODE_AI_SOURCE)
    assert.equal(program.languageVersion, 3)
    const context = { time: 25 / 30, localTime: 25 / 30, sequenceTime: 25 / 30, width: 1920, height: 1080, frame: 25, fps: 30 }
    const options = { measureText: request => layoutCodeText(request, (text, font) => Array.from(text).length * .6 * Number(font.match(/([\d.]+)px/)[1])) }
    const commands = evaluateCodeMaterial(program, context, {}, options)
    assert.equal(commands[0].kind, 'shader'); assert.equal(commands[0].elementId, 'sky')
    assert.equal(commands[1].kind, 'group')
    assert.deepEqual(commands[1].children.map(child => child.elementId), ['plate', 'title'])
    const hit = hitTestCodeMaterial(program, context, {}, { x: 960, y: 540 }, options)
    assert.equal(hit?.elementId, 'title', '入场后的点击坐标必须命中标题，不能落到底板或背景')
    assert.match(CODE_AI_SOURCE.slice(hit.sourceSpan.start, hit.sourceSpan.end), /id:"title"/)
})

test('Reality 场景登记唯一 id 且声明会写隔离资料', () => {
  assert.equal(createVideoEditCodeAiScene().id, 'video-edit-code-ai')
  assert.equal(createVideoEditCodeAiScene().writesUserData, true)
  const { createUiInspectionScenes } = require('./uiInspectionScenes.cjs')
  assert.equal(createUiInspectionScenes({ canvasFixtureProjectId: 'fixture', settlePage: async () => {} })
    .filter(scene => scene.id === 'video-edit-code-ai').length, 1)
})
