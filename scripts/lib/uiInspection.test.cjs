const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const { attachUiInspectionCommon } = require('./uiInspectionSceneCommon.cjs')
const { UI_AUDIT_RULES } = require('./uiAuditDom.cjs')
const {
  createExistingMultiLayerReadOnlySceneDefinition,
  readExistingMultiLayerTarget,
} = require('./uiInspectionSceneCanvasExistingMultiLayer.cjs')
const {
  createExistingMultiLayerIsolatedCpuSceneDefinition,
  detectImageMediaType,
  readExistingMultiLayerFixtureSource,
} = require('./uiInspectionExistingMultiLayerFixture.cjs')
const {
  DEFAULT_WINDOW_SIZES,
  UI_INSPECTION_SCENES,
  filterScenes,
  parseUiInspectionArgs,
  parseWindowSize,
  resolveOutputDir,
  selectInspectionScenes,
  assertInspectionWindowEvidence,
  inspectInspectionScreenshot,
} = require('./uiInspection.cjs')

test('弹窗清理每个弹窗只关闭一次，保存失败保留现场且不自动重试', async (t) => {
  let clock = 0
  t.mock.method(Date, 'now', () => clock)
  for (const mode of ['closed', 'failed', 'already-failed', 'timeout']) {
    let clicks = 0; let visible = true; let disposed = false
    const element = { isVisible: async () => visible, dispose: async () => { disposed = true },
      textContent: async () => mode === 'already-failed' || (mode === 'failed' && clicks) ? '保存失败，重试关闭' : '图片编辑' }
    const button = { last() { return this }, count: async () => 1, isEnabled: async () => true,
      click: async () => { clicks += 1; if (mode === 'closed') visible = false } }
    const dialog = { last() { return this }, count: async () => Number(visible),
      elementHandle: async () => element, getByRole: () => button }
    const empty = { count: async () => 0 }
    const page = { keyboard: { press: async () => assert.fail('有弹窗时不得先Escape触发重复保存') },
      waitForTimeout: async (delay) => { clock += delay },
      locator: (selector) => selector.includes('data-dialog') ? dialog : empty }
    const context = {}; attachUiInspectionCommon(context)
    if (mode === 'closed') await context.closeTransientUi(page)
    else await assert.rejects(context.closeTransientUi(page), mode === 'timeout' ? /30 秒/ : /保存失败/)
    assert.equal(clicks, mode === 'already-failed' ? 0 : 1)
    assert.equal(disposed, true)
    assert.equal(visible, mode !== 'closed', '失败不强关或假报已清理')
  }
})

test('窗口证据拒绝场景放大和CSS缩放漂移，下一场景恢复尺寸后通过', () => {
  const requested = { width: 1440, height: 900 }
  const baseline = { outer: requested, content: requested, renderer: { ...requested, dpr: 2 }, zoomFactor: 1, nativeScaleFactor: 2 }
  assert.deepEqual(assertInspectionWindowEvidence(requested, baseline, structuredClone(baseline)), baseline)
  assert.throws(() => assertInspectionWindowEvidence(requested, baseline, { ...baseline,
    outer: { width: 1600, height: 1000 } }), /尺寸发生漂移/)
  assert.throws(() => assertInspectionWindowEvidence(requested, baseline, { ...baseline,
    renderer: { ...baseline.renderer, width: 1200 } }), /尺寸发生漂移/)
  assert.deepEqual(assertInspectionWindowEvidence(requested, baseline, structuredClone(baseline)), baseline)
})

test('截图按内容DIP辨别实际1x或显示器密度，拒绝带黑边的3200×2000', async () => {
  const sharp = require('sharp')
  const evidence = { content: { width: 1440, height: 900 }, renderer: { width: 1440, height: 900, dpr: 2 }, nativeScaleFactor: 2 }
  const png = (width, height) => sharp({ create: { width, height, channels: 4, background: '#000000' } }).png().toBuffer()
  assert.deepEqual(await inspectInspectionScreenshot(await png(2880, 1800), evidence),
    { width: 2880, height: 1800, captureScale: 2, captureMethod: 'electron-capture-page', monitorScale: 2 })
  assert.equal((await inspectInspectionScreenshot(await png(1440, 900), evidence)).captureScale, 1)
  await assert.rejects(inspectInspectionScreenshot(await png(3200, 2000), evidence), /截图像素尺寸不匹配/)
})

test('0.9页面缩放分别核对外框、CSS、effective DPR与native scale，不混同物理屏幕像素', async () => {
  const requested = { width: 1440, height: 900 }
  const evidence = { outer: requested, content: requested, zoomFactor: 0.9, nativeScaleFactor: 2,
    renderer: { width: 1600, height: 1000, dpr: 1.7999999523162842 } }
  assert.equal(assertInspectionWindowEvidence(requested, evidence, evidence), evidence)
  const sharp = require('sharp')
  const png = (width, height) => sharp({ create: { width, height, channels: 3, background: '#000000' } }).png().toBuffer()
  assert.equal((await inspectInspectionScreenshot(await png(2880, 1800), evidence)).captureScale, 2)
  await assert.rejects(inspectInspectionScreenshot(await png(3200, 2000), evidence), /截图像素尺寸不匹配/)
  assert.throws(() => assertInspectionWindowEvidence(requested, evidence, { ...evidence, nativeScaleFactor: 1.8 }), /尺寸发生漂移/)
  const badDpr = { ...evidence, renderer: { ...evidence.renderer, dpr: 2 } }
  assert.throws(() => assertInspectionWindowEvidence(requested, badDpr, badDpr), /尺寸发生漂移/)
  const badCss = { ...evidence, renderer: { ...evidence.renderer, width: 1440 } }
  assert.throws(() => assertInspectionWindowEvidence(requested, badCss, badCss), /尺寸发生漂移/)
})

test('默认覆盖两档项目窗口尺寸', () => {
  const options = parseUiInspectionArgs([], '.ui-tour')
  assert.deepEqual(options.sizes, DEFAULT_WINDOW_SIZES)
  assert.equal(options.outDir, '.ui-tour')
  assert.deepEqual(options.only, [])
  assert.equal(options.profile, 'temporary')
  assert.equal(options.allowWrites, false)
})

test('真实数据模式必须显式开启，写业务数据的场景默认被拦截', () => {
  const options = parseUiInspectionArgs(['--real-data'], '.ui-tour')
  assert.equal(options.profile, 'real')
  const selection = selectInspectionScenes([
    { id: 'read', name: '只读', setup() {} },
    { id: 'write', name: '写入', writesUserData: true, setup() {} },
  ], options)
  assert.deepEqual(selection.scenes.map((scene) => scene.id), ['read'])
  assert.deepEqual(selection.blocked.map((scene) => scene.id), ['write'])

  const allowed = selectInspectionScenes([...selection.scenes, ...selection.blocked], {
    ...options,
    allowWrites: true,
  })
  assert.deepEqual(allowed.scenes.map((scene) => scene.id).sort(), ['read', 'write'])
})

test('已有多图层文档只读场景仅在完整环境参数下注册且不声明写入', async () => {
  assert.equal(readExistingMultiLayerTarget({}), null)
  assert.throws(
    () => readExistingMultiLayerTarget({ HENJI_REAL_MULTI_LAYER_PROJECT_ID: 'project' }),
    /必须同时设置/,
  )
  assert.throws(
    () => readExistingMultiLayerTarget({
      HENJI_REAL_MULTI_LAYER_PROJECT_ID: 'project',
      HENJI_REAL_MULTI_LAYER_NODE_ID: 'node',
      HENJI_REAL_MULTI_LAYER_EXPECTED_LAYER_COUNT: '1',
    }),
    /大于等于 2 的整数/,
  )
  const calls = []
  const environment = {
    HENJI_REAL_MULTI_LAYER_PROJECT_ID: 'project-from-env',
    HENJI_REAL_MULTI_LAYER_NODE_ID: 'node-from-env',
    HENJI_REAL_MULTI_LAYER_EXPECTED_LAYER_COUNT: '10',
  }
  const gpuScene = createExistingMultiLayerReadOnlySceneDefinition(
    async (...args) => { calls.push(args) },
    environment,
  )
  const cpuScene = createExistingMultiLayerIsolatedCpuSceneDefinition(
    async (...args) => { calls.push(args) },
    {
      HENJI_REAL_MULTI_LAYER_DOCUMENT_PATH: '/fixture/document.json',
      HENJI_REAL_MULTI_LAYER_EXPECTED_LAYER_COUNT: '10',
    },
  )
  assert.ok(gpuScene)
  assert.ok(cpuScene)
  assert.equal(gpuScene.id, 'canvas-existing-multi-layer-readonly')
  assert.equal(cpuScene.id, 'canvas-existing-multi-layer-isolated-cpu-fallback')
  assert.notEqual(gpuScene.writesUserData, true)
  assert.equal(cpuScene.writesUserData, true)
  assert.equal(cpuScene.forceGpuInitializationFailure, true)
  await gpuScene.setup('page', 'app', 'inspection')
  await cpuScene.setup('page', 'app', 'inspection')
  const expectedCall = [
    'page',
    'app',
    'inspection',
    { projectId: 'project-from-env', nodeId: 'node-from-env', expectedLayerCount: 10 },
  ]
  assert.deepEqual(calls, [expectedCall, [
    'page',
    'app',
    'inspection',
    { documentPath: '/fixture/document.json', expectedLayerCount: 10 },
  ]])
  assert.equal(readExistingMultiLayerFixtureSource({}), null)
})

test('已有多图层隔离夹具按文件魔数识别正式导入媒体类型', () => {
  assert.equal(detectImageMediaType(Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ])), 'image/png')
  assert.equal(detectImageMediaType(Buffer.from([0xff, 0xd8, 0xff])), 'image/jpeg')
  assert.equal(detectImageMediaType(Buffer.from('RIFF0000WEBP')), 'image/webp')
  assert.throws(() => detectImageMediaType(Buffer.from('GIF89a')), /不支持的源资源格式/)
})

test('拒绝未知的数据模式', () => {
  assert.throws(() => parseUiInspectionArgs(['--profile', 'production'], '.ui-tour'), /temporary 或 real/)
})

test('支持重复尺寸、逗号筛选和自定义输出目录', () => {
  const options = parseUiInspectionArgs([
    '--size',
    '1440x900',
    '--size=1200x800',
    '--only',
    '生成,设置',
    '--out',
    'artifacts/ui',
  ], '.ui-tour')
  assert.deepEqual(options.sizes, [
    { width: 1440, height: 900 },
    { width: 1200, height: 800 },
  ])
  assert.deepEqual(options.only, ['生成', '设置'])
  assert.equal(options.outDir, 'artifacts/ui')
})

test('拒绝格式错误或低于项目下限的尺寸', () => {
  assert.throws(() => parseWindowSize('1440-900'), /无效窗口尺寸/)
  assert.throws(() => parseWindowSize('800x600'), /不能小于项目下限/)
})

test('only 同时匹配场景 id、界面与中文场景名', () => {
  const generationScenes = filterScenes(UI_INSPECTION_SCENES, ['生成'])
  const focusScenes = filterScenes(UI_INSPECTION_SCENES, ['focus'])
  assert.equal(generationScenes.length, 11)
  assert.deepEqual(focusScenes.map((scene) => scene.id).sort(), [
    'assets-search-focus',
    'assistant-focus',
    'generation-prompt-focus',
  ])
})

test('Midjourney 参数面板场景可在真实资料模式下只读运行', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'generation-midjourney-settings')
  assert.ok(scene)
  assert.notEqual(scene.writesUserData, true)
  const selection = selectInspectionScenes([scene], parseUiInspectionArgs([
    '--profile',
    'real',
    '--only',
    'Midjourney',
  ], '.ui-tour'))
  assert.deepEqual(selection.scenes.map((candidate) => candidate.id), ['generation-midjourney-settings'])
  assert.deepEqual(selection.blocked, [])
})

test('模型合并与参考图状态都有定向视觉场景', () => {
  const sceneIds = UI_INSPECTION_SCENES.map((scene) => scene.id)
  assert.equal(sceneIds.includes('generation-model-midjourney'), true)
  assert.equal(sceneIds.includes('generation-model-gemini-omni'), true)
  assert.equal(sceneIds.includes('generation-model-gpt-image-2'), true)
  assert.equal(sceneIds.includes('generation-midjourney-reference'), true)
  assert.equal(sceneIds.includes('generation-gpt-mask-control'), true)
  assert.equal(sceneIds.includes('generation-gpt-mask-editor'), true)
})

test('GPT Image 2 遮罩在生成页与画布都有定向视觉场景', () => {
  const generationScenes = UI_INSPECTION_SCENES.filter((scene) => scene.id.startsWith('generation-gpt-mask-'))
  const canvasScene = UI_INSPECTION_SCENES.find((scene) => scene.id === 'canvas-gpt-mask-editor')
  assert.equal(generationScenes.length, 2)
  assert.equal(generationScenes.every((scene) => scene.writesUserData !== true), true)
  assert.ok(canvasScene)
  assert.equal(canvasScene.writesUserData, true)
})

test('全景结果有节点内交互、五档比例、截图、上下文降级与单租约的真实 Electron 场景', () => {
  const toolbarScene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-panorama-toolbar')
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-panorama-viewer')
  assert.ok(toolbarScene)
  assert.equal(toolbarScene.writesUserData, true)
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
  const source = String(scene.setup)
  for (const marker of [
    'data-panorama-viewer-node-id',
    'data-panorama-inline-surface',
    'data-panorama-frozen-preview',
    'frozenFrameDiff.changedPct',
    'data-image-capability-more',
    'panoramaViewerNode',
    'exportImageNode',
    'snapshotNodeId',
    'webglcontextlost',
    'expectedRatioLabels',
    "viewportAspectRatio !== '4:3'",
    'activeInlineCanvases.count() > 1',
  ]) {
    assert.equal(source.includes(marker), true, `全景 Reality 场景缺少关键验收：${marker}`)
  }
})

test('图片能力工具条有响应式、键盘、禁用原因和相邻节点场景', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-image-capability-toolbar')
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
})

test('图片打光有独立的节点、编辑、保存重开场景', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-relight-editor')
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
})

test('多角度有独立的节点、草稿取消、相机编辑与保存重开场景', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-multi-angle-editor')
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
})

test('高清放大有独立的工具条、节点与保存重开场景', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-upscale-node')
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
})

test('多图层图片文档有完整编辑、实时保存与关闭重开的真实场景', () => {
  const scene = UI_INSPECTION_SCENES.find(
    (candidate) => candidate.id === 'canvas-multi-layer-document-editor'
  )
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
  const source = `${String(scene.setup)}\n${fs.readFileSync(
    path.join(__dirname, 'uiInspectionMultiLayerDragPerformance.cjs'),
    'utf8'
  )}`
  for (const marker of [
    'data-layer-stack-status="editable-v3"',
    "result.dblclick()",
    'firstOpenEvidence',
    'commandBars !== 1',
    "capture?.('editor')",
    'persistedRevision',
    '关闭编辑器',
    'materializedPreviewSource',
    'persistedProjection',
    '显示.*背景图层',
    'firstLegacyMigration',
    'secondLegacyMigration',
    'duplicateDocumentRef',
    'forkIsolation',
    'redoDocumentStillRecoverable',
    'packageRoundTrip',
  ]) {
    assert.equal(source.includes(marker), true, `多图层图片文档 Reality 场景缺少关键验收：${marker}`)
  }
})

test('九宫格生成与本地宫格切分共用一条真实 Electron 场景', () => {
  const scene = UI_INSPECTION_SCENES.find((candidate) => candidate.id === 'canvas-nine-grid')
  assert.ok(scene)
  assert.equal(scene.writesUserData, true)
})

test('画布 Midjourney 场景只操作可清理的专用工程，真实只读巡检会跳过', () => {
  const scenes = UI_INSPECTION_SCENES.filter((scene) => scene.id.startsWith('canvas-midjourney-'))
  assert.deepEqual(scenes.map((scene) => scene.id), [
    'canvas-midjourney-node',
    'canvas-midjourney-settings',
  ])
  assert.equal(scenes.every((scene) => scene.writesUserData === true), true)
})

test('输出目录相对项目根解析且绝对路径保持不变', () => {
  const root = path.resolve('workspace-root')
  const absolute = path.resolve('absolute-output')
  assert.equal(resolveOutputDir(root, '.ui-tour'), path.join(root, '.ui-tour'))
  assert.equal(resolveOutputDir(root, absolute), absolute)
})

test('场景覆盖应用界面和原生窗口且规则数固定为十一条', () => {
  assert.deepEqual([...new Set(UI_INSPECTION_SCENES.map((scene) => scene.surface))].sort(), [
    '助手',
    '工具箱',
    '生成',
    '画布',
    '窗口',
    '设置',
    '资产库',
  ])
  assert.equal(UI_AUDIT_RULES.length, 11)
  assert.equal(new Set(UI_AUDIT_RULES.map((rule) => rule.key)).size, 11)
  const sceneIds = new Set(UI_INSPECTION_SCENES.map((scene) => scene.id))
  assert.equal(sceneIds.has('generation-model-panel'), true)
  assert.equal(sceneIds.has('generation-midjourney-settings'), true)
  assert.equal(sceneIds.has('canvas-midjourney-node'), true)
  assert.equal(sceneIds.has('canvas-midjourney-settings'), true)
  assert.equal(sceneIds.has('settings-provider-center'), true)
  assert.equal(sceneIds.has('settings-provider-manager'), true)
  assert.equal(sceneIds.has('toolbox-image-edit'), true)
  assert.equal(sceneIds.has('image-editor-v3-release'), true)
  assert.equal(sceneIds.has('toolbox-camera-stage'), true)
  assert.equal(sceneIds.has('toolbox-camera-stage-lineart'), true)
  assert.equal(sceneIds.has('toolbox-camera-stage-playback-clock'), true)
  assert.equal(sceneIds.has('canvas-camera-stage-background-render-lifecycle'), true)
  assert.equal(sceneIds.has('assistant-memory'), true)
})
