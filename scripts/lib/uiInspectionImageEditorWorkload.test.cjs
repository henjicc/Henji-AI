const assert = require('node:assert/strict')
const test = require('node:test')
const { COUNTERS, WORKLOAD_FOREGROUND, assertGpuSnapshot, summarizeWorkloadPhase, collectWorkerLogs, createImageEditorWorkloadScenes } = require('./uiInspectionImageEditorWorkload.cjs')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')

function sample(patch = {}) {
  return { ...Object.fromEntries(Object.keys(COUNTERS).map((key) => [key, 0])),
    composition: 'gpu', presentation: 'webgpu-surface', visible: true,
    generation: 1, gpuGeneration: 1, gpuFrames: 1, ...patch }
}

test('独立工作量场景登记为画布写夹具，不依赖其他场景先运行', () => {
  const [scene] = createImageEditorWorkloadScenes({})
  assert.equal(scene.id, 'canvas-gpu-session-workload')
  assert.equal(scene.surface, '画布')
  assert.equal(scene.writesUserData, true)
})

test('两层夹具真实调用两次ingest再一次save，默认单层不变，前景数据不得仅附在未消费参数上', async () => {
  const previousWindow = global.window, previousDocument = global.document
  const ingests = [], saves = [], canvases = []
  global.document = { createElement: (tag) => {
    assert.equal(tag, 'canvas')
    const canvas = { width: 0, height: 0 }
    const draw = { createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {} }
    Object.assign(canvas, { getContext: () => draw,
      toBlob: (done) => done(new Blob(['background-binary'])),
      toDataURL: () => `data:image/png;base64,${Buffer.from(JSON.stringify({ width: canvas.width, height: canvas.height, color: draw.fillStyle })).toString('base64')}` })
    canvases.push(canvas)
    return canvas
  } }
  global.window = { henjiNative: {
    image: { persistImageBinary: async (bytes, extension) => {
      assert.equal(Buffer.from(bytes).toString(), 'background-binary'); assert.equal(extension, 'png')
      return '/temporary-fixture/background.png'
    } },
    imageEditorV3: {
      ingestSource: async (input) => {
        ingests.push(input)
        return { resource: { resourceRef: `sha256:${String(ingests.length).repeat(64)}` },
          mediaUrl: 'henji-media://fixture', metadata: { width: 1600, height: 1000 } }
      },
      saveDocument: async (input) => {
        saves.push(input)
        return { documentRef: `image-edit-v3:${input.document.id}`, revision: input.document.revision, previewRef: null }
      },
    },
    db: { select: async () => [{ nodes_json: '[]', edges_json: '[]' }], execute: async () => undefined },
  } }
  const locator = { click: async () => {}, dblclick: async () => {}, waitFor: async () => {}, locator: () => locator }
  const page = { getByRole: () => locator, locator: () => locator, evaluate: (run, input) => run(input) }
  const context = { seedAndOpenCanvasPanoramaProject: async () => ({ projectId: 'temporary-project' }), settlePage: async () => {} }
  try {
    const result = await openCanvasImageEditorV3Fixture({ page, context, width: 1600, height: 1000, label: '两层', foreground: WORKLOAD_FOREGROUND })
    assert.equal(ingests.length, 2); assert.equal(saves.length, 1); assert.equal(canvases.length, 2)
    assert.equal(ingests[0].source.kind, 'local-path')
    assert.equal(ingests[1].source.kind, 'data-url')
    assert.deepEqual(JSON.parse(Buffer.from(ingests[1].source.dataUrl.split(',')[1], 'base64').toString()), {
      width: WORKLOAD_FOREGROUND.width, height: WORKLOAD_FOREGROUND.height, color: WORKLOAD_FOREGROUND.color,
    })
    assert.equal(saves[0].document.layers.length, 2)
    assert.equal(saves[0].document.layers[0].visible, true)
    assert.equal(saves[0].document.layers[1].id, 'reality-gpu-foreground-layer')
    assert.deepEqual(saves[0].document.layers[1].transform, WORKLOAD_FOREGROUND.transform)
    assert.deepEqual(saves[0].resourceRefs, [result.fixture.sourceResourceRef, result.fixture.foregroundResourceRef])
    assert.equal(new Set(saves[0].document.layers.map((layer) => layer.source.resourceId)).size, 2)
    await openCanvasImageEditorV3Fixture({ page, context, width: 64, height: 64, label: '默认' })
    assert.equal(ingests.length, 3); assert.equal(saves[1].document.layers.length, 1)
    assert.equal(saves[1].resourceRefs.length, 1)
  } finally {
    if (previousWindow === undefined) delete global.window; else global.window = previousWindow
    if (previousDocument === undefined) delete global.document; else global.document = previousDocument
  }
})

test('计数缺失/旧GPU帧/降级不能伪装正常GPU基线', () => {
  assertGpuSnapshot(sample())
  for (const patch of [{ cpuTasks: null }, { cpuPlan: NaN }, { gpuGeneration: 0 },
    { composition: 'cpu' }, { visible: false }, { gpuFrames: 0 }]) {
    assert.throws(() => assertGpuSnapshot(sample(patch)))
  }
})

test('权威编辑要求逐次一次revision，相机要求跨RAF且不能改变文档；不强迫优化前CPU计数为零', () => {
  const before = sample(), after = sample({ revision: 1, generation: 2, gpuGeneration: 2, cpuPlan: 2, cpuTasks: 3, gpuFrames: 2 })
  assert.equal(summarizeWorkloadPhase('authoritative-edits', [before, after], 1, []).delta.cpuTasks, 3)
  assert.throws(() => summarizeWorkloadPhase('authoritative-edits', [before, { ...after, revision: 2 }], 1, []), /精确提交/)
  assert.throws(() => summarizeWorkloadPhase('camera-updates', [before, before], 1, []), /跨RAF/)
  assert.throws(() => summarizeWorkloadPhase('camera-updates', [before, { ...before, camera: 1, revision: 1 }], 1, []), /意外修改/)
  assert.equal(summarizeWorkloadPhase('camera-updates', [before, { ...before, camera: 1 }], 1, []).delta.revision, 0)
  assert.throws(() => summarizeWorkloadPhase('camera-updates', [before, { ...before, camera: 1, gpuReadbacks: 1 }], 1, []), /回读/)
})

test('正式Worker事件按request/event去重，不把启动次数当完成次数或CPU耗时', () => {
  const start = { requestId: 'one', event: 'image_editor_v3.viewport_composite.start', context: { phase: 'target' } }
  const completed = { ...start, event: 'image_editor_v3.viewport_composite.completed', context: { phase: 'target', workerMs: 12, tileCount: 4 } }
  const result = summarizeWorkloadPhase('camera-updates', [sample(), sample({ camera: 1 })], 1,
    [start, start, completed, completed, { ...start, requestId: 'unfinished' }])
  assert.equal(result.cpuWorkerEvidence.startedRequests, 2)
  assert.equal(result.cpuWorkerEvidence.completedRequests, 1)
  assert.equal(result.cpuWorkerEvidence.completedWorkerWallMs, 12)
  assert.equal(result.cpuWorkerEvidence.completedTiles, 4)
  assert.match(result.cpuWorkerEvidence.meaning, /不等于CPU线程耗时/)
})

test('日志按领域、文档和采样时间窗查询，等待正式缓冲刷出，截断必须拒绝', async () => {
  const previous = global.window
  const queries = []
  let reads = 0
  global.window = { henjiNative: { logging: { queryLogEvents: async (query) => {
    queries.push(query)
    return { events: ++reads === 1 ? [] : [{ event: 'image_editor_v3.viewport_composite.start', requestId: 'one' }], hasMore: false }
  } } } }
  const page = { evaluate: (read, input) => input ? read(input) : Promise.resolve() }
  try {
    const events = await collectWorkerLogs(page, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:01.000Z', 'specific-document', 1)
    assert.equal(events.length, 1)
    assert.equal(reads, 2)
    assert.deepEqual(queries[0], { date: '2026-09-06', afterTimestamp: '2026-09-06T00:00:00.000Z',
      beforeTimestamp: '2026-09-06T00:00:01.000Z', domainPrefix: 'image_editor_v3.viewport_composite', keyword: 'specific-document', limit: 1000 })
    global.window.henjiNative.logging.queryLogEvents = async () => ({ events: [], hasMore: true })
    await assert.rejects(collectWorkerLogs(page, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:01.000Z', 'specific-document', 0), /有界采集上限/)
  } finally { if (previous === undefined) delete global.window; else global.window = previous }
})
