const sharp = require('sharp')

function cssClipToDip(clip, zoomFactor, content) {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0
    || ![content.width, content.height].every((value) => Number.isFinite(value) && value > 0)
    || ![clip.x, clip.y, clip.width, clip.height].every(Number.isFinite)
    || clip.width <= 0 || clip.height <= 0) throw new Error('截图坐标无效')
  const left = Math.max(0, Math.floor(clip.x * zoomFactor))
  const top = Math.max(0, Math.floor(clip.y * zoomFactor))
  const right = Math.min(content.width, Math.ceil((clip.x + clip.width) * zoomFactor))
  const bottom = Math.min(content.height, Math.ceil((clip.y + clip.height) * zoomFactor))
  if (right <= left || bottom <= top) throw new Error('截图区域不在可见内容区')
  return { x: left, y: top, width: right - left, height: bottom - top }
}

async function inspectInspectionScreenshot(bytes, evidence) {
  const { width, height } = await sharp(bytes).metadata()
  const allowedScales = [...new Set([1, evidence.nativeScaleFactor])]
  const captureScale = allowedScales.find((scale) => Number.isFinite(scale) && scale > 0
    && Math.abs(width - Math.round(evidence.content.width * scale)) <= 1
    && Math.abs(height - Math.round(evidence.content.height * scale)) <= 1)
  if (!Number.isFinite(width) || !Number.isFinite(height)
    || !captureScale) {
    throw new Error(`截图像素尺寸不匹配 Electron 内容DIP：${JSON.stringify({ width, height, content: evidence.content, allowedScales })}`)
  }
  return { width, height, captureScale, captureMethod: 'electron-capture-page', monitorScale: evidence.nativeScaleFactor }
}

/** 复用正式 runner 的窗口，不走 CDP screenshot（缩放时 CSS clip 与合成表面坐标不一致）。 */
async function captureInspectionPage(app, page, { clip, onEvidence } = {}) {
  if (!app) throw new Error('截图需要正式 runner 的 Electron 实例')
  const window = await app.browserWindow(page)
  try {
    const state = await window.evaluate((handle) => ({ content: handle.getContentSize(),
      zoomFactor: handle.webContents.getZoomFactor(), bounds: handle.getBounds() }))
    const nativeScaleFactor = await app.evaluate(({ screen }, bounds) => screen.getDisplayMatching(bounds).scaleFactor, state.bounds)
    if (!Number.isFinite(nativeScaleFactor) || nativeScaleFactor <= 0) throw new Error('截图显示器比例无效')
    const content = { width: state.content[0], height: state.content[1] }
    const rect = clip ? cssClipToDip(clip, state.zoomFactor, content) : null
    // 表示标签不是实际像素密度。只选择已有表示，密度由原始PNG尺寸测量，绝不请求插值。
    const captured = await window.evaluate(async (handle, options) => {
      const image = await handle.capturePage(options.rect ?? undefined)
      if (image.isEmpty()) throw new Error('Electron 捕获页面为空')
      const scales = image.getScaleFactors()
      if (!scales.length || scales.some((scale) => !Number.isFinite(scale) || scale <= 0)) throw new Error('Electron截图比例表示无效')
      const representationScale = scales.includes(1) ? 1 : Math.max(...scales)
      return { png: image.toPNG({ scaleFactor: representationScale }).toString('base64'), scales,
        representationScale, size: image.getSize() }
    }, { rect })
    const bytes = Buffer.from(captured.png, 'base64')
    try {
      const actual = await inspectInspectionScreenshot(bytes, { content: rect ?? content, nativeScaleFactor })
      onEvidence?.({ ...actual, representationScale: captured.representationScale,
        representationScales: captured.scales, nativeImageSize: captured.size, contentDip: rect ?? content })
    }
    catch (error) { throw new Error(`${error.message}；原生表示=${JSON.stringify({ scales: captured.scales, size: captured.size, rect })}`) }
    return bytes
  } finally { await window.dispose() }
}

module.exports = { captureInspectionPage, cssClipToDip, inspectInspectionScreenshot }
