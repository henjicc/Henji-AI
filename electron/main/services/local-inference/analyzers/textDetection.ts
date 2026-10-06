import type { SmartRegionBox } from '../../../../../src/core/videoEdit/smartRegions'
import { boxIoU } from './yunet'

/*
 * 文字区域检测：PP-OCRv4 移动端检测模型（RapidOCR 转换的 ONNX）。只用检测部分，不识别文字内容。
 * 预处理与 PaddleOCR DetResizeForTest + NormalizeImage 一致：BGR，(x/255 − 0.5) / 0.5，宽高取 32 的倍数；
 * 后处理按 DBNet 的做法：概率图阈值 0.3 二值化 → 连通域 → 框内平均概率 ≥ 0.6 → 按“面积 × 1.6 / 周长”向外扩（unclip）。
 * 剪辑里只需要区域，所以输出轴对齐框；旋转文字的框会稍大，不影响打码。
 */

export const PPOCR_LONG_SIDE = 736

export function ppocrInputSize(sourceWidth: number, sourceHeight: number): { width: number; height: number } {
  const scale = PPOCR_LONG_SIDE / Math.max(1, sourceWidth, sourceHeight)
  const align = (value: number): number => Math.max(32, Math.round(value * scale / 32) * 32)
  return { width: align(sourceWidth), height: align(sourceHeight) }
}

export function ppocrInput(rgb: Uint8Array, width: number, height: number, target = new Float32Array(3 * width * height)): Float32Array {
  const plane = width * height
  for (let index = 0; index < plane; index++) {
    target[index] = rgb[index * 3 + 2] / 127.5 - 1; target[plane + index] = rgb[index * 3 + 1] / 127.5 - 1; target[2 * plane + index] = rgb[index * 3] / 127.5 - 1
  }
  return target
}

export interface TextDetectionOptions { threshold?: number; boxThreshold?: number; unclipRatio?: number; minSize?: number }

/** 概率图（宽 × 高）→ 归一化文字框（置信度为框内平均概率，编号 0）。 */
export function textBoxesFromMap(map: Float32Array, width: number, height: number, options: TextDetectionOptions = {}): SmartRegionBox[] {
  const { threshold = 0.3, boxThreshold = 0.6, unclipRatio = 1.6, minSize = 3 } = options
  const labels = new Int32Array(width * height).fill(-1)
  const stack = new Int32Array(width * height)
  const boxes: SmartRegionBox[] = []
  for (let start = 0; start < map.length; start++) {
    if (labels[start] !== -1 || map[start] < threshold) continue
    let top = 0; stack[top++] = start; labels[start] = 1
    let x0 = width; let y0 = height; let x1 = -1; let y1 = -1; let sum = 0; let count = 0
    while (top > 0) {
      const index = stack[--top]
      const x = index % width; const y = (index - x) / width
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y
      sum += map[index]; count++
      const visit = (next: number): void => { if (labels[next] === -1 && map[next] >= threshold) { labels[next] = 1; stack[top++] = next } }
      if (x > 0) visit(index - 1); if (x < width - 1) visit(index + 1)
      if (y > 0) visit(index - width); if (y < height - 1) visit(index + width)
    }
    const w = x1 - x0 + 1; const h = y1 - y0 + 1
    if (Math.min(w, h) < minSize || sum / count < boxThreshold) continue
    const distance = w * h * unclipRatio / (2 * (w + h))
    const ux0 = Math.max(0, x0 - distance); const uy0 = Math.max(0, y0 - distance)
    const ux1 = Math.min(width, x1 + 1 + distance); const uy1 = Math.min(height, y1 + 1 + distance)
    const round = (value: number): number => Math.round(value * 10000) / 10000
    boxes.push([round(ux0 / width), round(uy0 / height), round((ux1 - ux0) / width), round((uy1 - uy0) / height), Math.round(sum / count * 100) / 100, 0])
  }
  return boxes
}

/**
 * 文字框去闪烁：每帧取前后 `radius` 帧内全部框的并集（重叠的框合并为外接框）。
 * 字幕检测在个别帧会漏掉一两个字块，打码时就会闪；分析帧率不高时这样能稳定住。
 */
export function stabilizeTextFrames(frames: readonly SmartRegionBox[][], radius = 1): SmartRegionBox[][] {
  return frames.map((_, index) => {
    const merged: Array<[number, number, number, number, number]> = []
    for (let other = Math.max(0, index - radius); other <= Math.min(frames.length - 1, index + radius); other++) {
      for (const box of frames[other]) {
        const current = { x: box[0], y: box[1], width: box[2], height: box[3] }
        const overlap = merged.find(entry => boxIoU({ x: entry[0], y: entry[1], width: entry[2], height: entry[3] }, current) > 0.3)
        if (!overlap) { merged.push([box[0], box[1], box[2], box[3], box[4]]); continue }
        const x0 = Math.min(overlap[0], box[0]); const y0 = Math.min(overlap[1], box[1])
        const x1 = Math.max(overlap[0] + overlap[2], box[0] + box[2]); const y1 = Math.max(overlap[1] + overlap[3], box[1] + box[3])
        overlap[0] = x0; overlap[1] = y0; overlap[2] = x1 - x0; overlap[3] = y1 - y0; overlap[4] = Math.max(overlap[4], box[4])
      }
    }
    return merged.map(entry => [entry[0], entry[1], entry[2], entry[3], entry[4], 0] as SmartRegionBox)
  })
}
