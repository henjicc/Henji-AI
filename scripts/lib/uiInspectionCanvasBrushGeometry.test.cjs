const assert = require('node:assert/strict')
const test = require('node:test')
const { BRUSH_GEOMETRY_CASES, assertBrushGeometryState, changedPixels,
  assertRestoredPixels, assertClosedDocumentProjection, createCanvasBrushGeometryScenes,
  readPreviewResourcePixels, waitForScreenPixels, capturePixelResult, inspectPreviewPixelDifference,
  configureBrushFixture, assertVisiblePreviewChange } = require('./uiInspectionCanvasBrushGeometry.cjs')

test('节点代理诊断分开RGB、Alpha和可见黑色差异，不把透明黑当画笔或把Alpha变化当画笔通过', () => {
  const white = new Uint8Array(256 * 256 * 4).fill(255)
  const edited = new Uint8Array(white)
  edited[3] = 120
  edited.fill(0, 4, 8)
  const index = (200 * 256 + 208) * 4
  edited.fill(252, index, index + 3)
  const result = inspectPreviewPixelDifference(white, edited, BRUSH_GEOMETRY_CASES[1])
  assert.equal(result.alphaChangedOver8, 2)
  assert.equal(result.rgbChangedOver8, 1)
  assert.equal(result.visibleNonWhitePixels, 1)
  assert.equal(result.maxVisibleWhiteDeficit, 3)
  assert.deepEqual(result.brushCenterRgba, [252, 252, 252, 255])
  assert.deepEqual(result.reflectedCenterRgba, [255, 255, 255, 255])
  assert.match(result.representation, /lossless-source-tile/)
  assert.throws(() => inspectPreviewPixelDifference([], [], BRUSH_GEOMETRY_CASES[1]), /完整RGBA/)
})

test('像素等待每阶段只报告最终样本；失败保留截图且仍抛原像素错误', async (t) => {
  let clock = 0
  t.mock.method(Date, 'now', () => clock)
  const page = { waitForTimeout: async (delay) => { clock += delay } }
  const white = Array(64).fill(255)
  const results = []; const screenshots = []; const logs = []
  t.mock.method(console, 'log', (message) => logs.push(message))
  const editor = { evaluate: async () => ({ selectedTools: ['move'], brushOverlayTiles: 0, revision: '5' }) }
  const capture = { clipCss: { x: 10, y: 20, width: 64, height: 64 },
    capture: { contentDip: { x: 9, y: 18, width: 58, height: 58 } } }
  const onResult = async (result) => {
    results.push(result)
    await capturePixelResult(editor, { capture: async (suffix) => screenshots.push(suffix) }, 'redo-brush', capture, result)
  }
  await assert.rejects(waitForScreenPixels(page, async () => white, white,
    { mode: 'changed', label: '重做', onResult }), /重做：屏幕像素在期限内/)
  assert.equal(results.length, 1)
  assert.equal(results[0].accepted, false)
  assert.deepEqual(screenshots, ['redo-brush-failed'])
  assert.match(logs[0], /"clipCss"/)
  assert.match(logs[0], /"selectedTools":\["move"\]/)
  await waitForScreenPixels(page, async () => white, white,
    { mode: 'restored', label: '恢复', onResult })
  assert.equal(results.length, 2)
  assert.equal(results[1].accepted, true)
  assert.equal(screenshots.length, 1)
  assert.ok(logs.every((message) => !message.includes('rawPngBase64')))
})

test('提交ACK后首张仍旧帧时等待真实像素；持续不更新或重开不一致必须超时失败', async (t) => {
  let clock = 0; let captures = 0
  t.mock.method(Date, 'now', () => clock)
  const page = { waitForTimeout: async (delay) => { clock += delay } }
  const old = Array(64).fill(255)
  const edited = Array.from({ length: 64 }, (_, index) => index % 4 === 3 ? 255 : 0)
  const actual = await waitForScreenPixels(page, async () => ++captures === 1 ? old : edited,
    old, { mode: 'changed', label: '下笔' })
  assert.equal(captures, 3)
  assert.deepEqual(actual, edited)
  captures = 0
  await waitForScreenPixels(page, async () => ++captures === 1 ? old : edited,
    edited, { mode: 'restored', changed: 16, label: '重开' })
  assert.equal(captures, 3)
  await assert.rejects(waitForScreenPixels(page, async () => old, old, { mode: 'changed', label: '下笔' }), /期限内未满足/)
  await assert.rejects(waitForScreenPixels(page, async () => old, edited,
    { mode: 'restored', changed: 16, label: '重开' }), /期限内未满足/)
})

test('首次已变化但抗锯齿仍过渡不能作为基准；相邻完整RGBA一致后才接受', async (t) => {
  let clock = 0; let captures = 0
  t.mock.method(Date, 'now', () => clock)
  const page = { waitForTimeout: async (delay) => { clock += delay } }
  const initial = Array(64).fill(255)
  const transition = Array.from({ length: 64 }, (_, index) => index % 4 === 3 ? 255 : 63)
  const stable = Array.from({ length: 64 }, (_, index) => index % 4 === 3 ? 255 : 0)
  const results = []
  const result = await waitForScreenPixels(page, async () => ++captures === 1 ? transition : [...stable], initial,
    { mode: 'changed', label: '画笔', onResult: (value) => results.push(value) })
  assert.deepEqual(result, stable)
  assert.equal(captures, 3)
  assert.equal(results.length, 1)
  assert.equal(results[0].stableSamples, 2)

  captures = 0
  const alphaTransition = stable.map((value, index) => index % 4 === 3 ? 254 : value)
  await waitForScreenPixels(page, async () => ++captures === 1 ? alphaTransition : [...stable], stable,
    { mode: 'restored', changed: 16, label: '恢复' })
  assert.equal(captures, 3, 'RGB相同而Alpha还变化也不是稳定完整RGBA')
})

test('像素持续振荡即使每张都满足变化阈值也必须超时，不挑一张作为基准', async (t) => {
  let clock = 0; let captures = 0
  t.mock.method(Date, 'now', () => clock)
  const page = { waitForTimeout: async (delay) => { clock += delay } }
  const initial = Array(64).fill(255)
  const result = []
  await assert.rejects(waitForScreenPixels(page,
    async () => {
      const value = (captures++ % 2) * 63
      return Array.from({ length: 64 }, (_, index) => index % 4 === 3 ? 255 : value)
    }, initial,
    { mode: 'changed', label: '振荡', onResult: (value) => result.push(value) }), /期限内未满足/)
  assert.equal(result.length, 1)
  assert.equal(result[0].accepted, false)
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
  assert.equal(captures, 3)
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
  assert.equal(large.brushSize, 96)
  assert.equal(small.brushSize, 32)
  assert.ok(large.from / large.scale - large.brushSize / 2 < 512)
  assert.ok(large.to / large.scale + large.brushSize / 2 > 512)
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

test('节点预览读取正式mip0无损8bit直通RGBA，初始大源取完整粗mip且错误契约拒绝', async () => {
  const previous = global.window
  let request
  let invalid = {}; let sourceSize = 64
  global.window = { henjiNative: { imageEditorV3: { readSourceTile: async (input) => {
    request = input
    const size = Math.ceil(sourceSize / (2 ** input.mip))
    return { ...input, width: size, height: size, channels: 4, bitDepth: 8,
      sampleFormat: 'uint', numericRange: 'unorm8', colorSpace: 'srgb', transferFunction: 'srgb',
      alphaMode: 'straight', rowStride: size * 4, pixels: new Uint8Array(size * size * 4).fill(255).buffer, ...invalid }
  } } } }
  try {
    const page = { evaluate: (read, ref) => read(ref) }
    const pixels = await readPreviewResourcePixels(page, 'sha256:preview')
    assert.equal(request.resourceRef, 'sha256:preview')
    assert.equal(request.mip, 0)
    assert.equal(request.bitDepth, 8)
    assert.equal(request.tileX, 0); assert.equal(request.tileY, 0); assert.equal(request.halo, 0)
    assert.equal(pixels.length, 256 * 256 * 4)
    assert.ok(pixels.every((value) => value === 255))
    assert.throws(() => assertVisiblePreviewChange(pixels, [...pixels]), /仍是初始图片/)
    const edited = [...pixels]; edited.fill(224, (200 * 256 + 208) * 4, (200 * 256 + 224) * 4)
    assertVisiblePreviewChange(pixels, edited)
    sourceSize = 640
    await readPreviewResourcePixels(page, 'sha256:source', sourceSize)
    assert.equal(request.mip, 2, '640源mip2=160整图，不把mip0左上512瓦片充当整源')
    sourceSize = 64
    for (invalid of [{ width: 32 }, { pixels: new ArrayBuffer(4) }, { alphaMode: 'premultiplied' },
      { bitDepth: 16 }, { rowStride: 300 }, { transferFunction: 'linear' }, { resourceRef: 'wrong' }]) {
      await assert.rejects(readPreviewResourcePixels(page, 'sha256:preview'), /无损瓦片契约不匹配/)
    }
  } finally { if (previous === undefined) delete global.window; else global.window = previous }
})

test('大源画笔通过正式参数控件32→96且回读受控值；控件未更新或不透明度异常必须失败', async () => {
  let value = 32; let ignore = false; let opacity = '1'; const keys = []
  const settings = { getByRole: (role, { name }) => {
    assert.equal(role, 'slider')
    if (name.test('大小')) return { inputValue: async () => String(value), press: async (key) => {
      keys.push(key)
      if (!ignore) value += key === 'ArrowRight' ? 1 : -1
    } }
    return { inputValue: async () => name.test('不透明度') ? opacity : '0.8' }
  } }
  const editor = { locator: (selector) => { assert.equal(selector, '[data-tool-parameters]'); return settings } }
  assert.deepEqual(await configureBrushFixture(editor, BRUSH_GEOMETRY_CASES[1]), { size: 96, opacity: 1, hardness: 0.8 })
  assert.equal(keys.length, 64)
  assert.ok(keys.every((key) => key === 'ArrowRight'))
  value = 32; ignore = true
  await assert.rejects(configureBrushFixture(editor, BRUSH_GEOMETRY_CASES[1]), /正式画笔参数不符合/)
  value = 96; opacity = '0.5'
  await assert.rejects(configureBrushFixture(editor, BRUSH_GEOMETRY_CASES[1]), /正式画笔参数不符合/)
})
