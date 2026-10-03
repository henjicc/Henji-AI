/**
 * 按“实际合成画面”判定图层拖动是否跟手（图片编辑器 V3 发布候选场景用）。
 *
 * 09-04（9d719232）起，GPU 呈现可用时拖动走 GPU 实时合成：图层位移只写进 GPU 场景的临时变换，
 * DOM 反馈层（data-move-feedback-frame）不再移动。所以“画面是否跟随指针”只能看合成结果：
 * 用 Electron 正式截屏（capturePage，取的是合成后的窗口画面）截预览区，在按下前的画面里取一块
 * 有二维纹理的特征区域，在当前画面里搜索它的位移，要求与指针位移一致。
 *
 * 纯函数（位移估计、特征块选择）有精确测试；截屏只在真实 Electron 里调用。
 */
const sharp = require('sharp')
const { captureInspectionPage } = require('./uiInspectionCapture.cjs')

/**
 * 在 after 里以 expected 为中心、±radius 像素范围内搜索 patch 的位移，返回最佳位移与误差。
 * 误差是逐像素 RGB 绝对差的均值（0–255）。zeroError 是“完全没动”时的误差，用于证明画面确实移动了。
 * @param {{data: Buffer, width: number, height: number, channels: number}} before
 * @param {{data: Buffer, width: number, height: number, channels: number}} after
 * @param {{x: number, y: number, width: number, height: number}} patch 设备像素
 * @param {{x: number, y: number}} expected 设备像素
 */
function estimatePatchDisplacement(before, after, patch, expected, radius = 4) {
  const errorAt = (dx, dy) => {
    let total = 0
    let samples = 0
    for (let row = 0; row < patch.height; row += 1) {
      const sourceY = patch.y + row
      const targetY = sourceY + dy
      if (sourceY < 0 || sourceY >= before.height || targetY < 0 || targetY >= after.height) return Infinity
      for (let column = 0; column < patch.width; column += 1) {
        const sourceX = patch.x + column
        const targetX = sourceX + dx
        if (sourceX < 0 || sourceX >= before.width || targetX < 0 || targetX >= after.width) return Infinity
        const sourceOffset = (sourceY * before.width + sourceX) * before.channels
        const targetOffset = (targetY * after.width + targetX) * after.channels
        for (let channel = 0; channel < 3; channel += 1) {
          total += Math.abs(before.data[sourceOffset + channel] - after.data[targetOffset + channel])
        }
        samples += 3
      }
    }
    return samples ? total / samples : Infinity
  }
  let best = { dx: expected.x, dy: expected.y, error: Infinity }
  for (let dy = Math.round(expected.y) - radius; dy <= Math.round(expected.y) + radius; dy += 1) {
    for (let dx = Math.round(expected.x) - radius; dx <= Math.round(expected.x) + radius; dx += 1) {
      const error = errorAt(dx, dy)
      if (error < best.error) best = { dx, dy, error }
    }
  }
  return { ...best, zeroError: errorAt(0, 0) }
}

/** 特征块的纹理强度（亮度标准差）：平坦区域无法判定位移，必须拒绝。 */
function patchTextureStdDev(image, patch) {
  let sum = 0
  let sumSquares = 0
  let count = 0
  for (let row = 0; row < patch.height; row += 1) {
    for (let column = 0; column < patch.width; column += 1) {
      const offset = ((patch.y + row) * image.width + patch.x + column) * image.channels
      const luma = 0.2126 * image.data[offset] + 0.7152 * image.data[offset + 1] + 0.0722 * image.data[offset + 2]
      sum += luma
      sumSquares += luma * luma
      count += 1
    }
  }
  const mean = sum / count
  return Math.sqrt(Math.max(0, sumSquares / count - mean * mean))
}

/**
 * 在若干候选特征点（图层图片内的比例坐标）里选第一个：移动前后整块都落在可见区域（文档裁切）内。
 * 坐标都是页面 CSS 像素。只要终点位移可行，中间各步（起点与终点之间的线性插值）也都可行。
 * @param {{ anchorBox: Box, visibleBox: Box, anchors: {x: number, y: number}[], delta: {x: number, y: number},
 *   size?: number, margin?: number }} options
 */
function selectFeaturePatch({ anchorBox, visibleBox, anchors, delta, size = 32, margin = 4 }) {
  for (const anchor of anchors) {
    const center = { x: anchorBox.x + anchorBox.width * anchor.x, y: anchorBox.y + anchorBox.height * anchor.y }
    const patch = { x: Math.round(center.x - size / 2), y: Math.round(center.y - size / 2), width: size, height: size }
    const inside = (dx, dy) => patch.x + dx >= visibleBox.x + margin && patch.y + dy >= visibleBox.y + margin
      && patch.x + dx + size <= visibleBox.x + visibleBox.width - margin
      && patch.y + dy + size <= visibleBox.y + visibleBox.height - margin
    if (inside(0, 0) && inside(delta.x, delta.y)) return { anchor, patch }
  }
  return null
}

async function captureRegionPixels(app, page, clip) {
  const bytes = await captureInspectionPage(app, page, { clip })
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels, scale: info.width / clip.width, bytes }
}

/**
 * 断言合成画面里的图层相对 baseline 平移了 expectedCss（CSS 像素），容差 tolerancePx（CSS 像素）。
 * GPU 帧是异步提交的：在 timeoutMs 内反复截屏，直到命中或超时（超时报出最后一次的估计）。
 */
async function assertCompositedDisplacement({ app, page, clip, baseline, patchCss, expectedCss, tolerancePx = 1.5,
  minMotionGain = 8, timeoutMs = 1500, label }) {
  const toDevice = (value) => Math.round(value * baseline.scale)
  const patch = { x: toDevice(patchCss.x - clip.x), y: toDevice(patchCss.y - clip.y),
    width: toDevice(patchCss.width), height: toDevice(patchCss.height) }
  const expected = { x: expectedCss.x * baseline.scale, y: expectedCss.y * baseline.scale }
  const radius = Math.max(3, Math.ceil(tolerancePx * baseline.scale) + 2)
  const deadline = Date.now() + timeoutMs
  let last = null
  do {
    const current = await captureRegionPixels(app, page, clip)
    const estimate = estimatePatchDisplacement(baseline, current, patch, expected, radius)
    const actualCss = { x: estimate.dx / baseline.scale, y: estimate.dy / baseline.scale }
    const moved = expectedCss.x === 0 && expectedCss.y === 0
      ? true
      : estimate.zeroError - estimate.error >= minMotionGain
    last = { actualCss, expectedCss, error: Number(estimate.error.toFixed(2)), zeroError: Number(estimate.zeroError.toFixed(2)), moved }
    if (moved && Math.abs(actualCss.x - expectedCss.x) <= tolerancePx && Math.abs(actualCss.y - expectedCss.y) <= tolerancePx
      && estimate.error <= 24) {
      return last
    }
    await page.waitForTimeout(50)
  } while (Date.now() < deadline)
  throw new Error(`${label}：合成画面位移与指针不一致：${JSON.stringify(last)}`)
}

module.exports = {
  assertCompositedDisplacement,
  captureRegionPixels,
  estimatePatchDisplacement,
  patchTextureStdDev,
  selectFeaturePatch,
}
