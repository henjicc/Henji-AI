'use strict'

const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')

const PIXEL_DIFF_THRESHOLD = 2
const RASTER_CONTROL_RATIO_LIMIT = 0.75

async function readGray(buffer) {
  const { data, info } = await sharp(buffer)
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}

function normalizeRect(rect, width, height) {
  if (!rect) return { left: 0, top: 0, width, height }
  const left = Math.max(0, Math.min(width, Math.floor(rect.left ?? rect.x ?? 0)))
  const top = Math.max(0, Math.min(height, Math.floor(rect.top ?? rect.y ?? 0)))
  const right = Math.max(left, Math.min(width, Math.ceil(left + rect.width)))
  const bottom = Math.max(top, Math.min(height, Math.ceil(top + rect.height)))
  return { left, top, width: right - left, height: bottom - top }
}

async function loadPair(bufferA, bufferB) {
  const [first, second] = await Promise.all([readGray(bufferA), readGray(bufferB)])
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error(
      `截图尺寸不一致：${first.width}x${first.height} vs ${second.width}x${second.height}`
    )
  }
  return { first, second }
}

/** 灰度逐像素比较；差值大于 2 才计为变化，规避截图舍入噪声。 */
async function diffBuffers(bufferA, bufferB, rect) {
  const { first, second } = await loadPair(bufferA, bufferB)
  const area = normalizeRect(rect, first.width, first.height)
  let changed = 0
  let maxDelta = 0

  for (let y = area.top; y < area.top + area.height; y += 1) {
    const rowStart = y * first.width
    for (let x = area.left; x < area.left + area.width; x += 1) {
      const index = rowStart + x
      const delta = Math.abs(first.data[index] - second.data[index])
      if (delta > maxDelta) maxDelta = delta
      if (delta > PIXEL_DIFF_THRESHOLD) changed += 1
    }
  }

  const pixelCount = area.width * area.height
  return {
    changedPixels: changed,
    pixelCount,
    changedPct: pixelCount ? Number(((changed / pixelCount) * 100).toFixed(6)) : 0,
    maxDelta,
    rect: area,
  }
}

/** 找到绝对灰度差总和最大的方块，便于输出局部对照图。 */
async function worstBlock(bufferA, bufferB, blockSize = 160) {
  const { first, second } = await loadPair(bufferA, bufferB)
  const size = Math.max(1, Math.floor(blockSize))
  let worst = { left: 0, top: 0, width: Math.min(size, first.width), height: Math.min(size, first.height), score: -1 }

  for (let top = 0; top < first.height; top += size) {
    for (let left = 0; left < first.width; left += size) {
      const width = Math.min(size, first.width - left)
      const height = Math.min(size, first.height - top)
      let score = 0
      for (let y = top; y < top + height; y += 1) {
        const rowStart = y * first.width
        for (let x = left; x < left + width; x += 1) {
          score += Math.abs(first.data[rowStart + x] - second.data[rowStart + x])
        }
      }
      if (score > worst.score) worst = { left, top, width, height, score }
    }
  }
  return worst
}

/** 裁剪指定区域并放大 3 倍，输出两张可直接人工查看的 PNG。 */
async function cropCompare(bufferA, bufferB, rect, outPathA, outPathB) {
  const metadata = await sharp(bufferA).metadata()
  const area = normalizeRect(rect, metadata.width, metadata.height)
  for (const outputPath of [outPathA, outPathB]) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  }
  await Promise.all([
    sharp(bufferA).extract(area).resize({ width: area.width * 3, kernel: sharp.kernel.nearest }).png().toFile(outPathA),
    sharp(bufferB).extract(area).resize({ width: area.width * 3, kernel: sharp.kernel.nearest }).png().toFile(outPathB),
  ])
  return { rect: area, files: [outPathA, outPathB] }
}

/**
 * Chromium 在分数缩放下切换 paint containment 会重新栅格化文字，无法要求逐像素为零。
 * 使用同轮次的 will-change 已知负例作机器内控制：候选必须几何完全一致，且变化像素占比
 * 显著低于负例。若负例未产生差异，则不能用它放宽候选判定，仍保持失败。
 */
function passesRasterControl(candidate, negativeControl, ratioLimit = RASTER_CONTROL_RATIO_LIMIT) {
  if (candidate?.passed) return true
  if (!candidate?.geometry || !Object.values(candidate.geometry).every(Boolean)) return false
  const candidatePct = Number(candidate?.pixels?.changedPct)
  const controlPct = Number(negativeControl?.pixels?.changedPct)
  if (!Number.isFinite(candidatePct) || !Number.isFinite(controlPct) || controlPct <= 0) return false
  return candidatePct / controlPct <= ratioLimit
}

module.exports = {
  PIXEL_DIFF_THRESHOLD,
  RASTER_CONTROL_RATIO_LIMIT,
  cropCompare,
  diffBuffers,
  passesRasterControl,
  worstBlock,
}
