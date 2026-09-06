const assert = require('node:assert/strict')
const test = require('node:test')
const { readDragPersistenceEvidence, isDragPersistenceConfirmed } = require('./uiInspectionMultiLayerDragPerformance.cjs')
const { createDragPoints, sendNativeDrag, releaseNativeDrag, verifyDragTrace,
  assertVisibleFixtureColors, assertGpuFrameOrder, isGpuSurfaceReady, waitForVisibleFixtureColors } = require('./uiInspectionGpuDragEvidence.cjs')

test('可见GPU与提交计数允许没有CPU代理栈；只有DOM或不可见GPU不能假装就绪', () => {
  const ready = { composition: 'gpu', presentation: 'webgpu-surface', visible: true, coverage: 1,
    frameCount: 1, surfaceFrameCount: 1, imageBitmapFrameCount: 0 }
  assert.equal(isGpuSurfaceReady(ready), true)
  for (const wrong of [{ composition: 'cpu' }, { presentation: 'canvas2d' }, { visible: false },
    { coverage: 0 }, { frameCount: 0 }, { surfaceFrameCount: 0 }, { imageBitmapFrameCount: 1 }]) {
    assert.equal(isGpuSurfaceReady({ ...ready, ...wrong, rasterStackAttached: 1 }), false)
  }
})

test('GPU确认后旧像素不能当五层就绪，等实际颜色出现；永久缺色与截图失败仍报错', async (t) => {
  let clock = 0; let captures = 0
  t.mock.method(Date, 'now', () => clock)
  const sharp = require('sharp')
  const old = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const current = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#000000' } }).png().toBuffer()
  const page = { waitForTimeout: async () => { clock += 10000 } }
  await waitForVisibleFixtureColors(page, async () => ++captures === 1 ? old : current, [[0, 0, 0]])
  assert.equal(captures, 2)
  await assert.rejects(waitForVisibleFixtureColors(page, async () => old, [[0, 0, 0]]), /实际像素仍未就绪/)
  await assert.rejects(waitForVisibleFixtureColors(page, async () => { throw new Error('capture failed') }, [[0, 0, 0]]), /capture failed/)
})

test('拖动保存证据只统计正式文档写入，节点投影等关闭；读取日志不能挤掉保存事件', async () => {
  const payload = { afterTimestamp: '2026-09-06T01:00:00.000Z', documentId: 'owned',
    documentRef: 'image-edit:owned', revision: 1, initialRevision: 0, projectId: 'project', nodeId: 'node' }
  let hasMore = false
  const events = ['owned', 'other'].map((documentId) => ({
    event: 'image_editor_v3.document.save.completed', context: { documentId, revision: 1 },
  }))
  const native = { logging: { queryLogEvents: async (query) => {
    assert.equal(query.domainPrefix, 'main.image_editor_v3.documents')
    assert.equal(query.keyword, 'image_editor_v3.document.save.completed')
    assert.equal(query.limit, 20)
    return { events, hasMore }
  } }, imageEditorV3: { loadDocument: async () => ({ revision: 1,
    document: { id: 'owned', layers: [{ id: 'ui-foreground-layer', transform: [1, 0, 0, 1, 5, 6] }] } }) },
  db: { select: async () => [{ nodes_json: JSON.stringify([{ id: 'node', data: {
    imageEditSession: { documentRef: payload.documentRef, revision: 0 },
  } }]) }] } }
  const previous = globalThis.window
  globalThis.window = { henjiNative: native }
  try {
    const page = { evaluate: (callback, data) => callback(data) }
    const evidence = await readDragPersistenceEvidence(page, payload)
    assert.equal(isDragPersistenceConfirmed(evidence, payload), true)
    for (const change of [{ repositorySaveCount: 0 }, { repositorySaveCount: 2 },
      { persistedDocumentId: 'other' }, { persistedRevision: 0 }, { nodeRevision: 1 }, { nodeDocumentRef: 'other' }]) {
      assert.equal(isDragPersistenceConfirmed({ ...evidence, ...change }, payload), false)
    }
    hasMore = true
    await assert.rejects(readDragPersistenceEvidence(page, payload), /截断/)
  } finally { globalThis.window = previous }
})

function fixture() {
  const before = { revision: 1, renderGeneration: 1, overrideCount: 0, renderPlanCompileCount: 1,
    cpuTaskStartCount: 0, uploadCount: 5, readbackCount: 0, frameCount: 2, surfaceFrameCount: 2,
    imageBitmapFrameCount: 0, directSurfaceFailureCount: 0, uniformUpdateCount: 0,
    interactionSequence: 0, cameraSequence: 1, gpuSceneGeneration: 1 }
  const frames = Array.from({ length: 10 }, (_, index) => ({ ...before, frameCount: 3 + index,
    surfaceFrameCount: 3 + index, uniformUpdateCount: 1 + index, interactionSequence: (index + 1) * 10,
    eventToSubmissionAckMs: 4 }))
  return { before, frames, after: frames.at(-1),
    inputs: Array.from({ length: 100 }, () => ({ x: 20, y: 10, trusted: true })), finalPoint: { x: 20, y: 10 } }
}

test('真实原生驱动持续投递100次并反向结束，不逐事件等待帧', async () => {
  const events = []
  let focused = false
  const handle = { focus: () => { focused = true }, webContents: { getZoomFactor: () => 1,
    sendInputEvent: (event) => { assert.equal(focused, true); events.push(event) } } }
  const window = { evaluate: (callback, payload) => callback(handle, payload) }
  const gesture = createDragPoints({ x: 0, y: 0, width: 300, height: 200 })
  const result = await sendNativeDrag(window, { ...gesture, intervalMs: 0 })
  assert.equal(result.offeredEvents, 100)
  assert.equal(events.filter((event) => event.type === 'mouseMove').length, 101)
  assert.equal(events.filter((event) => event.type === 'mouseDown').length, 1)
  assert.equal(events.filter((event) => event.type === 'mouseUp').length, 0)
  assert.ok(gesture.points[59].x > gesture.points.at(-1).x)
  assert.deepEqual(events.at(-1).modifiers, ['control', 'leftbuttondown'])
  await releaseNativeDrag(window, gesture.points.at(-1))
  assert.equal(events.at(-1).type, 'mouseUp')
  assert.equal(events.at(-1).x, gesture.points.at(-1).x)
})

test('100个输入允许10次合帧，仅报告提交ACK、不伪称屏幕present和CPU倍数', () => {
  const metrics = verifyDragTrace(fixture())
  assert.equal(metrics.receivedPointerMoves, 100)
  assert.equal(metrics.acknowledgedFrameCount, 10)
  assert.equal(metrics.eventToSubmissionAckP95Ms, 4)
  assert.equal(metrics.comparison, 'no-comparable-CPU-baseline')
  assert.match(metrics.latencyMeaning, /not GPU completion or physical screen presentation/)
})

test('拒绝缺失计数、旧帧、丢末次输入、假事件以及所有热路径副作用', () => {
  for (const field of ['revision', 'renderGeneration', 'overrideCount', 'renderPlanCompileCount',
    'cpuTaskStartCount', 'uploadCount', 'readbackCount', 'imageBitmapFrameCount', 'directSurfaceFailureCount']) {
    const trace = fixture(); trace.frames[1][field] += 1
    assert.throws(() => verifyDragTrace(trace), /副作用/)
  }
  const missing = fixture(); missing.before.cpuTaskStartCount = null
  assert.throws(() => verifyDragTrace(missing), /缺少真实/)
  const stale = fixture(); stale.frames[3].interactionSequence = 1
  assert.throws(() => verifyDragTrace(stale), /旧帧/)
  const late = fixture(); late.finalPoint.x += 5
  assert.throws(() => verifyDragTrace(late), /未送达/)
  const fake = fixture(); fake.inputs[0].trusted = false
  assert.throws(() => verifyDragTrace(fake), /原生输入/)
  const excess = fixture(); excess.after.uniformUpdateCount = 50
  assert.throws(() => verifyDragTrace(excess), /提交确认/)
})

test('像素检查必须看到每个独立资源的颜色，裁掉元素会失败', async () => {
  const sharp = require('sharp')
  const png = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 28, g: 92, b: 218 } } }).png().toBuffer()
  await assertVisibleFixtureColors(png, [[28, 92, 218]])
  await assert.rejects(assertVisibleFixtureColors(png, [[28, 92, 218], [165, 65, 220]]), /不可见元素/)
})

test('松手新场景允许手势重置，但拒绝旧场景或旧相机迟到覆盖', () => {
  const old = { gpuSceneGeneration: 1, cameraSequence: 2, interactionSequence: 100 }
  const current = { gpuSceneGeneration: 2, cameraSequence: 2, interactionSequence: 0 }
  assertGpuFrameOrder([old, current])
  assert.throws(() => assertGpuFrameOrder([old, current, old]), /旧GPU帧/)
  assert.throws(() => assertGpuFrameOrder([current, { ...current, cameraSequence: 1 }]), /旧GPU帧/)
})
