const assert = require('node:assert/strict')
const test = require('node:test')
const { BRUSH_GEOMETRY_CASES, assertBrushGeometryState, changedPixels,
  assertRestoredPixels, assertClosedDocumentProjection, createCanvasBrushGeometryScenes,
  readPreviewResourcePixels, waitForScreenPixels } = require('./uiInspectionCanvasBrushGeometry.cjs')

test('提交ACK后首张仍旧帧时等待真实像素；持续不更新或重开不一致必须超时失败', async (t) => {
  let clock = 0; let captures = 0
  t.mock.method(Date, 'now', () => clock)
  const page = { waitForTimeout: async (delay) => { clock += delay } }
  const old = Array(64).fill(255)
  const edited = Array.from({ length: 64 }, (_, index) => index % 4 === 3 ? 255 : 0)
  const actual = await waitForScreenPixels(page, async () => ++captures === 1 ? old : edited,
    old, { mode: 'changed', label: '下笔' })
  assert.equal(captures, 2)
  assert.deepEqual(actual, edited)
  captures = 0
  await waitForScreenPixels(page, async () => ++captures === 1 ? old : edited,
    edited, { mode: 'restored', changed: 16, label: '重开' })
  assert.equal(captures, 2)
  await assert.rejects(waitForScreenPixels(page, async () => old, old, { mode: 'changed', label: '下笔' }), /期限内未满足/)
  await assert.rejects(waitForScreenPixels(page, async () => old, edited,
    { mode: 'restored', changed: 16, label: '重开' }), /期限内未满足/)
})

function fixture(scenario, painted = true) {
  return { revision: 2, sourceGeometry: { width: scenario.sourceSize, height: scenario.sourceSize },
    document: { geometry: { width: 64, height: 64 }, layers: [{ id: 'reality-gpu-source-layer', type: 'raster',
      source: { resourceId: 'source' }, transform: [scenario.scale, 0, 0, scenario.scale, 0, 0],
      tiles: painted ? { '0/0/0': 'brush1', ...(scenario.id === 'large-source' ? { '0/1/0': 'brush2' } : {}) } : {} }] } }
}

test('初始ACK不代表白图显示；棋盘首帧不能作为像素基准，白源未出现必须失败', async (t) => {
  let clock = 0; let captures = 0
  t.mock.method(Date, 'now', () => clock)
  const page = { waitForTimeout: async (delay) => { clock += delay } }
  const checker = new Uint8Array(256 * 256 * 4).fill(60)
  const white = new Uint8Array(checker)
  white.fill(255, (32 * 256 + 32) * 4, (32 * 256 + 32) * 4 + 4)
  const actual = await waitForScreenPixels(page, async () => ++captures === 1 ? checker : white, null,
    { mode: 'initial-white', label: '初始白图' })
  assert.equal(captures, 2)
  assert.equal(actual, white)
  await assert.rejects(waitForScreenPixels(page, async () => checker, null,
    { mode: 'initial-white', label: '初始白图' }), /期限内未满足/)
})

test('两种画笔闭环注册为真实画布临时数据场景，坐标确在源外与缩放后的大图右侧', () => {
  const scenes = createCanvasBrushGeometryScenes({})
  assert.equal(scenes.length, 2)
  assert.ok(scenes.every((scene) => scene.surface === '画布' && scene.writesUserData))
  const [small, large] = BRUSH_GEOMETRY_CASES
  assert.ok(small.from > small.sourceSize)
  assert.equal(large.from / large.scale, 500)
  assert.ok(large.to / large.scale > 512)
})

test('保留真实源几何且要求实际笔画资源；大源必须保存跨512的两个瓦片', () => {
  for (const scenario of BRUSH_GEOMETRY_CASES) {
    assertBrushGeometryState(fixture(scenario), { sourceResourceRef: 'source' }, scenario, true)
    assertBrushGeometryState(fixture(scenario, false), { sourceResourceRef: 'source' }, scenario, false)
    const stretched = fixture(scenario); stretched.sourceGeometry.width = 64
    assert.throws(() => assertBrushGeometryState(stretched, { sourceResourceRef: 'source' }, scenario, true), /金字塔/)
    assert.throws(() => assertBrushGeometryState(fixture(scenario, false), { sourceResourceRef: 'source' }, scenario, true), /真实笔画资源/)
  }
  const scenario = BRUSH_GEOMETRY_CASES[1]
  const clipped = fixture(scenario); delete clipped.document.layers[0].tiles['0/1/0']
  assert.throws(() => assertBrushGeometryState(clipped, { sourceResourceRef: 'source' }, scenario, true), /512边界/)
})

test('像素断言按RGB像素而非通道计数，未撤销或重开白屏必须失败', () => {
  const white = Array(16 * 4).fill(255)
  const black = Array.from({ length: 16 * 4 }, (_, index) => index % 4 === 3 ? 255 : 0)
  assert.equal(changedPixels(white, black), 16)
  assert.equal(assertRestoredPixels(white, [...white], 16), 0)
  assert.throws(() => assertRestoredPixels(white, black, 16), /没有恢复像素/)
  assert.throws(() => changedPixels([], []), /为空/)
})

test('自动保存允许previewRef为空；关闭使用物化后的权威引用，不拿关闭前空引用对比', () => {
  const initial = { documentRef: 'doc', document: { id: 'one', layers: [] }, revision: 0, previewRef: null }
  const edited = { ...initial, document: { id: 'one', layers: [{ id: 'brush' }] }, revision: 6 }
  const closed = { ...edited, previewRef: 'new-preview' }
  const node = { documentRef: 'doc', revision: 6, previewRef: 'new-preview' }
  assertClosedDocumentProjection(initial, edited, closed, node, 'doc')
  assert.throws(() => assertClosedDocumentProjection(initial, edited, edited, node, 'doc'), /最新物化预览/)
  assert.throws(() => assertClosedDocumentProjection(initial, edited, closed, { ...node, previewRef: null }, 'doc'), /最新物化预览/)
  assert.throws(() => assertClosedDocumentProjection(initial, edited, { ...closed, revision: 7 }, node, 'doc'), /同一文档/)
  assert.throws(() => assertClosedDocumentProjection(initial, edited,
    { ...closed, document: { ...closed.document, id: 'other' } }, node, 'doc'), /同一文档/)
})

test('节点像素核对读取正式预览资源，不依赖被自定义协议污染的DOM Canvas', async () => {
  const png = await require('sharp')({ create: { width: 16, height: 16, channels: 3, background: '#ffffff' } }).png().toBuffer()
  const previous = global.window
  let request
  global.window = { henjiNative: { imageEditorV3: { readFastProxy: async (input) => {
    request = input; return { bytes: new Uint8Array(png).buffer }
  } } } }
  try {
    const pixels = await readPreviewResourcePixels({ evaluate: (read, ref) => read(ref) }, 'sha256:preview')
    assert.equal(request.resourceRef, 'sha256:preview')
    assert.equal(request.maxDimension, 256)
    assert.equal(pixels.length, 256 * 256 * 4)
    assert.ok(pixels.every((value) => value === 255))
  } finally { if (previous === undefined) delete global.window; else global.window = previous }
})
