const sharp = require('sharp')
const { openCanvasImageEditorV3Fixture } = require('./uiInspectionCanvasImageEditorV3.cjs')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

const BLUE = [30, 120, 210]
const ORANGE = [230, 100, 30]
const DIAGNOSTIC_WARN_EVENTS = ['image_editor_v3.gpu_scene.device_lost',
  'image_editor_v3.gpu_scene.fallback', 'image_editor_v3.gpu_scene.failed']

function inspectFallbackPixels(pixels) {
  if (pixels.length !== 128 * 96 * 4) throw new Error('回退截图像素尺寸无效')
  const result = { blue: 0, orange: 0, neutral: 0, total: 0, grayMin: 255, grayMax: 0 }
  for (let y = 4; y < 92; y += 1) for (let x = 4; x < 124; x += 1) {
    const offset = (y * 128 + x) * 4
    const rgb = [...pixels.slice(offset, offset + 3)]
    result.total += 1
    if (BLUE.every((value, channel) => Math.abs(value - rgb[channel]) <= 8)) result.blue += 1
    if (ORANGE.every((value, channel) => Math.abs(value - rgb[channel]) <= 8)) result.orange += 1
    if (Math.max(...rgb) - Math.min(...rgb) <= 3) {
      result.neutral += 1
      result.grayMin = Math.min(result.grayMin, ...rgb)
      result.grayMax = Math.max(result.grayMax, ...rgb)
    }
  }
  return result
}

function pixelsMatch(result, mode) {
  if (mode === 'both') return result.blue > 16 && result.orange > 16
  if (mode === 'blue') return result.blue >= result.total * 0.99 && result.orange === 0
  if (mode === 'transparent') return result.blue === 0 && result.orange === 0
    && result.neutral >= result.total * 0.99 && result.grayMax - result.grayMin >= 8
  throw new Error('未知回退像素判据')
}

function isCurrentCpuFrame(state, revision, afterGeneration = -1) {
  return state.revision === revision && state.composition === 'cpu' && state.presentation === 'canvas2d'
    && state.gpuVisibility === 'hidden' && state.frontVisibility === 'visible'
    && state.coverage >= 0.999999 && state.frameGeneration === state.requestGeneration
    && state.frameGeneration > afterGeneration && state.diagnostics.length === 0
}

async function waitForState(page, read, accept, label) {
  const deadline = Date.now() + 30000
  let state
  while (Date.now() < deadline) {
    state = await read()
    if (accept(state)) return state
    await page.waitForTimeout(80)
  }
  throw new Error(`${label}：${JSON.stringify(state)}`)
}

async function readFrame(editor, readAlpha = false) {
  return editor.evaluate((root, alpha) => {
    const preview = root.querySelector('[data-preview-surface]')
    const front = root.querySelector('[data-presentation-front-surface]')
    const gpu = root.querySelector('[data-presentation-gpu-surface]')
    const grid = root.querySelector('[data-document-transparency-grid]')
    const state = { revision: Number(root.querySelector('[data-command-bar]')?.getAttribute('data-document-revision')),
      composition: preview?.getAttribute('data-preview-composition-backend'),
      presentation: preview?.getAttribute('data-preview-presentation-backend'),
      coverage: Number(preview?.getAttribute('data-preview-coverage')),
      requestGeneration: Number(preview?.getAttribute('data-preview-render-generation')),
      frameGeneration: Number(front?.getAttribute('data-render-generation')),
      gpuVisibility: gpu ? getComputedStyle(gpu).visibility : null,
      frontVisibility: front ? getComputedStyle(front).visibility : null,
      diagnostics: [...(preview?.querySelectorAll('[role="status"]') ?? [])].map((element) => element.textContent),
      sampledPixels: 0, nontransparentPixels: null }
    if (alpha && state.composition === 'cpu' && front instanceof HTMLCanvasElement && grid) {
      const documentRect = grid.getBoundingClientRect(); const surfaceRect = front.getBoundingClientRect()
      const sx = front.width / surfaceRect.width; const sy = front.height / surfaceRect.height
      const x = Math.max(0, Math.floor((documentRect.left - surfaceRect.left) * sx))
      const y = Math.max(0, Math.floor((documentRect.top - surfaceRect.top) * sy))
      const right = Math.min(front.width, Math.ceil((documentRect.right - surfaceRect.left) * sx))
      const bottom = Math.min(front.height, Math.ceil((documentRect.bottom - surfaceRect.top) * sy))
      if (right <= x || bottom <= y) throw new Error('CPU文档区域没有有效像素')
      const context = front.getContext('2d')
      if (!context) throw new Error('CPU正式显示表面不可读取')
      const data = context.getImageData(x, y, right - x, bottom - y).data
      state.sampledPixels = data.length / 4; state.nontransparentPixels = 0
      for (let index = 3; index < data.length; index += 4) if (data[index] !== 0) state.nontransparentPixels += 1
    }
    return state
  }, readAlpha)
}

function createSourceFreeFallbackScene(context) {
  return { id: 'canvas-gpu-sourcefree-fallback', surface: '画布', name: '画布-GPU失败后全隐藏透明与恢复',
    writesUserData: true, setup: async (page, app, inspection = {}) => {
      const { dialog, editor, fixture } = await openCanvasImageEditorV3Fixture({ page, context,
        width: 320, height: 240, label: '透明回退蓝底', solidColor: `rgb(${BLUE.join(',')})`,
        foreground: { width: 80, height: 80, color: `rgb(${ORANGE.join(',')})`, transform: [1, 0, 0, 1, 120, 80] } })
      await editor.locator('[data-tool-id="hand"]').click()
      const readDocument = () => page.evaluate(async (documentRef) => window.henjiNative.imageEditorV3.loadDocument({
        requestId: `reality-sourcefree-${crypto.randomUUID()}`, documentRef,
      }), fixture.documentRef)
      const original = await readDocument()
      const waitPixels = (mode) => waitForState(page, async () => {
        const clip = await editor.locator('[data-document-transparency-grid]').boundingBox()
        if (!clip) throw new Error('回退场景没有文档截图区域')
        const bytes = await captureInspectionPage(app, page, { clip })
        const pixels = await sharp(bytes).resize(128, 96, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
        return inspectFallbackPixels(pixels)
      }, (result) => pixelsMatch(result, mode), `实际${mode}像素未显示`)
      const waitGpu = () => waitForState(page, () => readFrame(editor), (state) => state.composition === 'gpu'
        && state.presentation === 'webgpu-surface' && state.gpuVisibility === 'visible' && state.coverage === 1,
      'GPU正式显示未就绪')
      await waitGpu(); await waitPixels('both'); await inspection.capture?.('gpu-initial')
      const failureStartedAt = new Date().toISOString()
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('henji:image-editor-gpu-scene-diagnostic',
        { detail: { recovery: 'failure' } })))
      const initialCpu = await waitForState(page, () => readFrame(editor),
        (state) => isCurrentCpuFrame(state, original.revision), '设备失败没有交回当前CPU帧')
      await waitPixels('both')
      let revision = original.revision
      const toggle = async (layerId, show) => {
        await editor.locator(`[data-layer-id="${layerId}"]`).getByRole('button', { name: show ? /显示|Show/i : /隐藏|Hide/i }).click()
        revision += 1
        return waitForState(page, readDocument, (loaded) => loaded.revision === revision
          && loaded.document.layers.find((layer) => layer.id === layerId)?.visible === show, '显隐没有保存同一文档的新版本')
      }
      await toggle('reality-gpu-foreground-layer', false)
      const hidden = await toggle('reality-gpu-source-layer', false)
      if (hidden.document.layers.some((layer) => layer.visible)) throw new Error('尚有可见层，不能宣称无源')
      const emptyFrame = await waitForState(page, () => readFrame(editor, true), (state) => isCurrentCpuFrame(state, revision,
        initialCpu.frameGeneration) && state.sampledPixels > 0 && state.nontransparentPixels === 0,
      '全隐藏没有用当前透明CPU帧替换旧图')
      await waitPixels('transparent'); await inspection.capture?.('cpu-all-hidden')
      const shown = await toggle('reality-gpu-source-layer', true)
      await waitForState(page, () => readFrame(editor), (state) => isCurrentCpuFrame(state, revision, emptyFrame.frameGeneration),
        '重新显示没有渲染最新CPU文档')
      await waitPixels('blue'); await inspection.capture?.('cpu-blue-only')
      await dialog.getByRole('button', { name: /关闭编辑器|Close editor/i }).click()
      await dialog.waitFor({ state: 'hidden', timeout: 30000 })
      const closed = await readDocument()
      if (!closed.previewRef || closed.revision !== revision || JSON.stringify(closed.document) !== JSON.stringify(shown.document)) {
        throw new Error('GPU失效后的CPU关闭导出未保留最新文档')
      }
      await page.locator(`[data-layer-stack-node-id="${fixture.nodeId}"]`).dblclick()
      await dialog.waitFor({ state: 'visible', timeout: 15000 })
      await waitGpu(); await waitPixels('blue')
      const reopened = await readDocument()
      if (reopened.documentRef !== original.documentRef || reopened.revision !== revision
        || reopened.sourceFingerprint !== closed.sourceFingerprint || reopened.previewRef !== closed.previewRef
        || JSON.stringify(reopened.resourceRefs) !== JSON.stringify(closed.resourceRefs)
        || JSON.stringify(reopened.document) !== JSON.stringify(shown.document)) throw new Error('新GPU会话恢复了旧文档或改写保存指纹/资源')
      await inspection.capture?.('gpu-reopened-blue')
      const diagnostics = await page.evaluate(async ({ afterTimestamp, events }) => {
        const result = await window.henjiNative.logging.queryLogEvents({ date: afterTimestamp.slice(0, 10), afterTimestamp,
          domainPrefix: 'features.image_edit.v3.gpu_scene', limit: 100 })
        if (result.hasMore) throw new Error('故障诊断事件被截断')
        if (result.events.some((event) => event.level === 'error')) throw new Error('回退产生非预期GPU错误')
        return result.events.filter((event) => event.level === 'warn' && events.includes(event.event)).map((event) => event.event)
      }, { afterTimestamp: failureStartedAt, events: DIAGNOSTIC_WARN_EVENTS })
      if (!diagnostics.includes('image_editor_v3.gpu_scene.device_lost') || !diagnostics.includes('image_editor_v3.gpu_scene.failed')) {
        throw new Error('未实际触发设备丢失与恢复失败，不能宣称验证CPU回退')
      }
      console.log(`[canvas-sourcefree-fallback] ${JSON.stringify({ revision, emptyFrame, diagnostics,
        sameDocument: true, sameFingerprint: true, latestVisibilityRestored: true })}`)
    } }
}

module.exports = { createSourceFreeFallbackScene, inspectFallbackPixels, pixelsMatch, isCurrentCpuFrame, readFrame, DIAGNOSTIC_WARN_EVENTS }
