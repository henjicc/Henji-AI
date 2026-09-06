const sharp = require('sharp')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

const BRUSH_GEOMETRY_CASES = [
  { id: 'small-source', name: '小原图外首次画笔', sourceSize: 16, scale: 1, from: 48, to: 52, y: 48 },
  { id: 'large-source', name: '大原图缩放后跨瓦片画笔', sourceSize: 640, scale: 0.1, from: 50, to: 54, y: 50 },
]

function assertBrushGeometryState(state, fixture, scenario, painted) {
  const layer = state.document.layers.find((entry) => entry.id === 'reality-gpu-source-layer')
  if (!layer || layer.type !== 'raster' || layer.source?.resourceId !== fixture.sourceResourceRef
    || state.document.geometry.width !== 64 || state.document.geometry.height !== 64
    || state.sourceGeometry.width !== scenario.sourceSize || state.sourceGeometry.height !== scenario.sourceSize
    || layer.transform.join(',') !== [scenario.scale, 0, 0, scenario.scale, 0, 0].join(',')) {
    throw new Error('画笔改变了原图金字塔、画布尺寸或图层变换')
  }
  const tileKeys = Object.keys(layer.tiles)
  if (painted ? !tileKeys.length : tileKeys.length !== 0) throw new Error('真实笔画资源未保存或撤销未恢复')
  if (painted && scenario.id === 'large-source' && (!tileKeys.includes('0/0/0') || !tileKeys.includes('0/1/0'))) {
    throw new Error(`大原图局部500→540的真实笔画未跨越512边界：${tileKeys.join(',')}`)
  }
  return { tileKeys, sourceGeometry: state.sourceGeometry, revision: state.revision }
}

function changedPixels(left, right, threshold = 8) {
  if (left.length !== right.length || left.length === 0) throw new Error('像素证据尺寸不一致或为空')
  let count = 0
  for (let index = 0; index < left.length; index += 4) {
    if ([0, 1, 2].some((channel) => Math.abs(left[index + channel] - right[index + channel]) > threshold)) count += 1
  }
  return count
}

function assertRestoredPixels(actual, expected, changed) {
  const difference = changedPixels(actual, expected)
  // 真实截图允许小量分数缩放栅格差异，但至少95%的原始改变必须恢复。
  if (difference > Math.max(8, Math.ceil(changed * 0.05))) throw new Error(`撤销/重开没有恢复像素：${difference}`)
  return difference
}

async function waitForScreenPixels(page, readPixels, reference, { mode, changed = 0, label }) {
  const deadline = Date.now() + 30000
  let difference = null; let attempts = 0
  while (Date.now() < deadline) {
    const pixels = await readPixels()
    if (mode === 'initial-white') {
      if (pixels.length !== 256 * 256 * 4) throw new Error('初始白图截图必须为256² RGBA')
      // 文档(8,8)位于两种真实白源内部，避开透明背景、图像边缘与后续笔画。
      const offset = (32 * 256 + 32) * 4
      difference = Math.max(...[0, 1, 2, 3].map((channel) => Math.abs(pixels[offset + channel] - 255)))
    } else difference = changedPixels(pixels, reference)
    attempts += 1
    const accepted = mode === 'changed' ? difference >= 8
      : difference <= (mode === 'initial-white' ? 8 : Math.max(8, Math.ceil(changed * 0.05)))
    if (accepted) return pixels
    await page.waitForTimeout(80)
  }
  throw new Error(`${label}：屏幕像素在期限内未满足${mode}判据，差异=${difference}，采样=${attempts}`)
}

function assertClosedDocumentProjection(initial, edited, closed, nodeState, documentRef) {
  if (closed.documentRef !== documentRef || closed.document.id !== initial.document.id
    || closed.revision !== edited.revision || !closed.previewRef || closed.previewRef === initial.previewRef
    || JSON.stringify(closed.document.layers) !== JSON.stringify(edited.document.layers)
    || nodeState?.documentRef !== documentRef || nodeState?.revision !== closed.revision
    || nodeState?.previewRef !== closed.previewRef) throw new Error('关闭后节点未引用同一文档的最新物化预览')
}

async function waitForState(page, read, accept, label) {
  const deadline = Date.now() + 30000
  let value
  while (Date.now() < deadline) {
    value = await read()
    if (accept(value)) return value
    await page.waitForTimeout(80)
  }
  throw new Error(`${label}：${JSON.stringify(value)}`)
}

async function readDocumentState(page, fixture) {
  return page.evaluate(async ({ documentRef, sourceResourceRef }) => {
    const loaded = await window.henjiNative.imageEditorV3.loadDocument({
      requestId: `reality-brush-document-${crypto.randomUUID()}`, documentRef,
    })
    const pyramid = await window.henjiNative.imageEditorV3.describeSourcePyramid({
      requestId: `reality-brush-pyramid-${crypto.randomUUID()}`, resourceRef: sourceResourceRef,
    })
    const source = pyramid.levels.find((level) => level.mip === 0)
    return { documentRef: loaded.documentRef, document: loaded.document, revision: loaded.revision, previewRef: loaded.previewRef,
      sourceGeometry: { width: source?.width, height: source?.height } }
  }, fixture)
}

async function waitForGpu(page, editor, afterGeneration = -1) {
  return waitForState(page, () => editor.evaluate((root) => {
    const preview = root.querySelector('[data-preview-surface]')
    const front = root.querySelector('[data-presentation-front-surface]')
    const gpu = root.querySelector('[data-presentation-gpu-surface]')
    return { generation: Number(front?.getAttribute('data-render-generation') ?? '-1'),
      composition: preview?.getAttribute('data-preview-composition-backend'),
      presentation: preview?.getAttribute('data-preview-presentation-backend'),
      visible: gpu instanceof HTMLElement && getComputedStyle(gpu).visibility === 'visible',
      coverage: Number(preview?.getAttribute('data-preview-coverage') ?? '0') }
  }), (state) => state.generation > afterGeneration && state.composition === 'gpu'
    && state.presentation === 'webgpu-surface' && state.visible && state.coverage > 0,
  '画笔几何场景未就绪GPU画面')
}

async function readContentPixels(page, editor, app) {
  const clip = await editor.locator('[data-viewport-content]').boundingBox()
  if (!clip || clip.width < 1 || clip.height < 1) throw new Error('图片内容没有有效截图范围')
  // 与整窗证据共用 Electron DIP 捕获；256²只用于像素比较，不是物理屏幕分辨率。
  return [...await sharp(await captureInspectionPage(app, page, { clip }))
    .resize(256, 256, { fit: 'fill' }).ensureAlpha().raw().toBuffer()]
}

async function readPreviewResourcePixels(page, resourceRef) {
  // henji-media 图片合法地污染 DOM Canvas；经正式受管资源读取，不修改 CORS 或导入第二份资源。
  const encoded = await page.evaluate(async (ref) => {
    const proxy = await window.henjiNative.imageEditorV3.readFastProxy({
      requestId: `reality-preview-pixels-${crypto.randomUUID()}`, resourceRef: ref, maxDimension: 256,
    })
    return [...new Uint8Array(proxy.bytes)]
  }, resourceRef)
  return [...await sharp(Buffer.from(encoded)).resize(256, 256, { fit: 'fill' }).ensureAlpha().raw().toBuffer()]
}

function createCanvasBrushGeometryScenes(context) {
  return BRUSH_GEOMETRY_CASES.map((scenario) => ({
    id: `canvas-gpu-brush-${scenario.id}`, surface: '画布',
    name: `画布-GPU${scenario.name}闭环`, writesUserData: true,
    setup: async (page, app, helpers = {}) => {
      const { dialog, editor, fixture, projectId } = await openCanvasImageEditorV3Fixture({
        page, context, width: 64, height: 64, sourceWidth: scenario.sourceSize,
        sourceHeight: scenario.sourceSize, transform: [scenario.scale, 0, 0, scenario.scale, 0, 0],
        // 正式画笔目前固定黑色，用白色原图获得可核对的真实对比，不绕过工具注入颜色。
        solidColor: 'rgb(255,255,255)', label: scenario.name,
      })
      let gpu = await waitForGpu(page, editor)
      const readPixels = () => readContentPixels(page, editor, app ?? helpers.electronApp)
      const initial = await readDocumentState(page, fixture)
      assertBrushGeometryState(initial, fixture, scenario, false)
      const node = page.locator(`[data-layer-stack-node-id="${fixture.nodeId}"][data-layer-stack-status="editable-v3"]`)
      const nodePreview = node.locator('img[alt="多图层图片预览"]')
      const initialNodeSource = await nodePreview.getAttribute('src')
      const initialNodePixels = await readPreviewResourcePixels(page, fixture.sourceResourceRef)
      await helpers.capture?.('initial')
      const documentBox = await editor.locator('[data-document-transparency-grid]').boundingBox()
      const contentBox = await editor.locator('[data-viewport-content]').boundingBox()
      if (!documentBox || !contentBox || ['x', 'y', 'width', 'height'].some((key) => Math.abs(documentBox[key] - contentBox[key]) > 1)) {
        throw new Error(`截图内容区域与真实文档投影不一致：${JSON.stringify({ documentBox, contentBox })}`)
      }
      const initialPixels = await waitForScreenPixels(page, readPixels, null,
        { mode: 'initial-white', label: '初始白色原图尚未实际显示' }).catch(async (error) => {
        await helpers.capture?.('initial-failed')
        throw error
      })
      await editor.locator('[data-layer-id="reality-gpu-source-layer"] [data-layer-select]').click()
      await editor.locator('[data-tool-id="raster-brush"]').click()
      const overlay = editor.locator('[data-raster-brush-overlay]')
      await overlay.waitFor({ state: 'visible', timeout: 5000 })
      const box = await editor.locator('[data-viewport-content]').boundingBox()
      if (!box) throw new Error('真实画笔没有内容坐标')
      const point = (x) => ({ x: box.x + box.width * x / 64, y: box.y + box.height * scenario.y / 64 })
      const from = point(scenario.from); const to = point(scenario.to)
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(to.x, to.y, { steps: 12 })
      await page.mouse.up()
      let revision = initial.revision
      const settleMutation = async () => {
        revision += 1
        await waitForState(page, () => editor.locator('[data-command-bar]').getAttribute('data-document-revision'),
          (value) => Number(value) === revision, '画笔动作没有单次提交')
        gpu = await waitForGpu(page, editor, gpu.generation)
        return waitForState(page, () => readDocumentState(page, fixture),
          (value) => value.revision === revision, '画笔动作没有自动保存')
      }
      const painted = await settleMutation()
      const brushEvidence = assertBrushGeometryState(painted, fixture, scenario, true)
      await editor.locator('[data-tool-id="move"]').click()
      const paintedPixels = await waitForScreenPixels(page, readPixels, initialPixels,
        { mode: 'changed', label: '真实下笔没有改变原图外/大原图右侧可见像素' })
      const paintChanged = changedPixels(initialPixels, paintedPixels)
      if (paintChanged < 8) throw new Error('真实下笔没有改变原图外/大原图右侧可见像素')
      await helpers.capture?.('brush')

      await editor.getByRole('button', { name: /^(添加图层|Add layer)$/i }).click()
      await page.getByRole('menuitem', { name: /^(模糊|Blur)$/i }).click()
      const withEffect = await settleMutation()
      const effect = withEffect.document.layers.find((layer) => layer.type === 'effect')
      if (!effect || withEffect.document.layers.indexOf(effect) < 1) throw new Error('模糊没有位于真实画笔图层上方')
      const effectPixels = await waitForScreenPixels(page, readPixels, paintedPixels,
        { mode: 'changed', label: '模糊效果没有消费真实笔画像素' })
      const effectChanged = changedPixels(effectPixels, paintedPixels)
      if (effectChanged < 8) throw new Error('模糊效果没有消费真实笔画像素')
      await helpers.capture?.('effect')

      await editor.getByRole('button', { name: /^(撤销|Undo)$/i }).click()
      const undoEffect = await settleMutation()
      if (undoEffect.document.layers.some((layer) => layer.type === 'effect')) throw new Error('撤销未移除效果')
      await waitForScreenPixels(page, readPixels, paintedPixels,
        { mode: 'restored', changed: effectChanged, label: '撤销效果没有恢复像素' })
      await editor.getByRole('button', { name: /^(撤销|Undo)$/i }).click()
      assertBrushGeometryState(await settleMutation(), fixture, scenario, false)
      await waitForScreenPixels(page, readPixels, initialPixels,
        { mode: 'restored', changed: paintChanged, label: '撤销画笔没有恢复像素' })
      await editor.getByRole('button', { name: /^(重做|Redo)$/i }).click()
      assertBrushGeometryState(await settleMutation(), fixture, scenario, true)
      await waitForScreenPixels(page, readPixels, paintedPixels,
        { mode: 'restored', changed: paintChanged, label: '重做画笔没有恢复像素' })
      await editor.getByRole('button', { name: /^(重做|Redo)$/i }).click()
      const redone = await settleMutation()
      if (JSON.stringify(redone.document.layers) !== JSON.stringify(withEffect.document.layers)) throw new Error('重做未恢复同一笔画和效果资源')
      await waitForScreenPixels(page, readPixels, effectPixels,
        { mode: 'restored', changed: effectChanged, label: '重做效果没有恢复像素' })

      await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 30000 })
      await waitForState(page, () => nodePreview.evaluate((image) => ({ ready: image.complete && image.naturalWidth > 0, src: image.currentSrc })),
        (value) => value.ready && Boolean(value.src) && value.src !== initialNodeSource, '关闭后节点预览没有更新图片')
      // doc-only autosave 合法地保存 previewRef:null；关闭屏障才物化预览，必须重读此时的权威引用。
      const closed = await readDocumentState(page, fixture)
      const nodeState = await page.evaluate(async ({ id, nodeId }) => {
        const rows = await window.henjiNative.db.select('SELECT nodes_json FROM storyboard_projects WHERE id = ? LIMIT 1', [id])
        return JSON.parse(rows[0].nodes_json).find((entry) => entry.id === nodeId)?.data?.imageEditSession
      }, { id: projectId, nodeId: fixture.nodeId })
      assertClosedDocumentProjection(initial, redone, closed, nodeState, fixture.documentRef)
      const nodePixels = await readPreviewResourcePixels(page, closed.previewRef)
      if (changedPixels(nodePixels, initialNodePixels) < 8) throw new Error('关闭后节点预览像素仍是初始图片')
      await helpers.capture?.('node-preview')
      await node.dblclick()
      await dialog.waitFor({ state: 'visible', timeout: 15000 })
      await waitForGpu(page, editor)
      const reopened = await readDocumentState(page, fixture)
      assertBrushGeometryState(reopened, fixture, scenario, true)
      if (reopened.revision !== revision || JSON.stringify(reopened.document.layers) !== JSON.stringify(redone.document.layers)) {
        throw new Error('重新打开丢失笔画、效果或创建新版本')
      }
      await waitForScreenPixels(page, readPixels, effectPixels,
        { mode: 'restored', changed: effectChanged, label: '重开没有恢复像素' })
      await helpers.capture?.('reopened')
      console.log(`[canvas-gpu-brush-geometry] ${JSON.stringify({ case: scenario.id, brushEvidence,
        pixelCaptureScale: 'electron-capture-page-raw-png-normalized-256',
        paintChangedPixels: paintChanged, effectChangedPixels: effectChanged,
        revision, reopenedRevision: reopened.revision, sameDocument: true })}`)
    },
  }))
}

module.exports = { BRUSH_GEOMETRY_CASES, assertBrushGeometryState, changedPixels, readPreviewResourcePixels, waitForScreenPixels,
  assertRestoredPixels, assertClosedDocumentProjection, createCanvasBrushGeometryScenes }
