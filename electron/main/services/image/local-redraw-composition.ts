import type { RegistrationTransform } from './registration'
import { inverseTransformPoint, transformScales } from './registration/transform'

export interface TransformSafety {
  safe: boolean
  editableCoverage: number
  centerDisplacement: number
  reason?: string
}

function bilinearSample(
  pixels: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  channel: number,
): number | null {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return null
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(width - 1, x0 + 1)
  const y1 = Math.min(height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const top = pixels[(y0 * width + x0) * 4 + channel] * (1 - fx)
    + pixels[(y0 * width + x1) * 4 + channel] * fx
  const bottom = pixels[(y1 * width + x0) * 4 + channel] * (1 - fx)
    + pixels[(y1 * width + x1) * 4 + channel] * fx
  return top * (1 - fy) + bottom * fy
}

export function evaluateTransformSafety(
  transform: RegistrationTransform,
  width: number,
  height: number,
  editMatte: Uint8Array,
): TransformSafety {
  const { scaleX, scaleY } = transformScales(transform)
  const anisotropy = Math.abs(scaleX / Math.max(1e-8, scaleY) - 1)
  const center = inverseTransformPoint(transform, (width - 1) / 2, (height - 1) / 2)
  const centerDisplacement = center
    ? Math.hypot(center.x - (width - 1) / 2, center.y - (height - 1) / 2)
    : Infinity
  let editablePixels = 0
  let coveredPixels = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (editMatte[y * width + x] < 8) continue
      editablePixels += 1
      const point = inverseTransformPoint(transform, x, y)
      if (point && point.x >= 0 && point.y >= 0 && point.x <= width - 1 && point.y <= height - 1) {
        coveredPixels += 1
      }
    }
  }
  const editableCoverage = coveredPixels / Math.max(1, editablePixels)
  let reason: string | undefined
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX < 0.6 || scaleX > 1.4 || scaleY < 0.6 || scaleY > 1.4) {
    reason = '缩放超出安全范围'
  } else if (anisotropy > 0.1) {
    reason = '横纵缩放差异超出安全范围'
  } else if (centerDisplacement > Math.hypot(width, height) * 0.2) {
    reason = '位移超出安全范围'
  } else if (editableCoverage < 0.95) {
    reason = '重绘选区覆盖不足'
  }
  return { safe: !reason, editableCoverage, centerDisplacement, reason }
}

export function warpPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  transform: RegistrationTransform,
): Uint8Array {
  const output = new Uint8Array(pixels.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = inverseTransformPoint(transform, x, y)
      const offset = (y * width + x) * 4
      if (!point) continue
      for (let channel = 0; channel < 4; channel += 1) {
        const sample = bilinearSample(pixels, width, height, point.x, point.y, channel)
        output[offset + channel] = sample === null ? 0 : Math.round(sample)
      }
    }
  }
  return output
}

export function measureSelectionChange(
  reference: Uint8Array,
  generated: Uint8Array,
  editMatte: Uint8Array,
): { selectedPixels: number; changedFraction: number; meanAbsoluteDelta: number; opaqueCoverage: number } {
  let selectedPixels = 0
  let changedPixels = 0
  let absoluteDelta = 0
  let opaquePixels = 0
  for (let pixel = 0; pixel < editMatte.length; pixel += 1) {
    if (editMatte[pixel] < 128) continue
    selectedPixels += 1
    const offset = pixel * 4
    let pixelDelta = 0
    for (let channel = 0; channel < 3; channel += 1) {
      pixelDelta += Math.abs(reference[offset + channel] - generated[offset + channel])
    }
    absoluteDelta += pixelDelta / 3
    if (pixelDelta / 3 >= 3) changedPixels += 1
    if (generated[offset + 3] >= 250) opaquePixels += 1
  }
  return {
    selectedPixels,
    changedFraction: changedPixels / Math.max(1, selectedPixels),
    meanAbsoluteDelta: absoluteDelta / Math.max(1, selectedPixels),
    opaqueCoverage: opaquePixels / Math.max(1, selectedPixels),
  }
}

export function blendMaskedPixel(
  destination: Uint8Array,
  destinationOffset: number,
  generated: Uint8Array,
  generatedOffset: number,
  matte: number,
): void {
  const weight = matte / 255
  const sourceAlpha = destination[destinationOffset + 3] / 255
  const generatedAlpha = generated[generatedOffset + 3] / 255
  const outputAlpha = sourceAlpha * (1 - weight) + generatedAlpha * weight
  for (let channel = 0; channel < 3; channel += 1) {
    const premultiplied = destination[destinationOffset + channel] * sourceAlpha * (1 - weight)
      + generated[generatedOffset + channel] * generatedAlpha * weight
    destination[destinationOffset + channel] = outputAlpha > 0
      ? Math.round(premultiplied / outputAlpha)
      : 0
  }
  destination[destinationOffset + 3] = Math.round(outputAlpha * 255)
}
