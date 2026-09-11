import { createLogger } from '@/core/logging'
import { sampleImageBlock } from '../../ui/specialInterfaces/multiAngle/imageBlockTextures'

const logger = createLogger('features.canvas.outpaint')
const cache = new Map<string, string>()
const MAX_ENTRIES = 24
export const OUTPAINT_PREVIEW_SLICE = 64

/** Nine-slice atlas: clamp source edges before baking blur, including all four corners. */
export function bakeOutpaintPreview(pixels: Uint8ClampedArray): string {
  const size = OUTPAINT_PREVIEW_SLICE
  const padding = 32
  const sample = document.createElement('canvas')
  const padded = document.createElement('canvas')
  const output = document.createElement('canvas')
  sample.width = sample.height = size
  padded.width = padded.height = size * 3 + padding * 2
  output.width = output.height = size * 3
  try {
    const read = sample.getContext('2d')
    const staging = padded.getContext('2d')
    const target = output.getContext('2d')
    if (!read || !staging || !target) throw new Error('无法创建扩图预览贴图')
    const data = read.createImageData(size, size)
    data.data.set(pixels)
    read.putImageData(data, 0, 0)
    const sourceStarts = [0, 0, size - 1]
    const sourceSizes = [1, size, 1]
    const targetStarts = [0, size + padding, size * 2 + padding]
    const targetSizes = [size + padding, size, size + padding]
    for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
      staging.drawImage(sample, sourceStarts[x], sourceStarts[y], sourceSizes[x], sourceSizes[y],
        targetStarts[x], targetStarts[y], targetSizes[x], targetSizes[y])
    }
    target.filter = 'blur(7px)'
    target.drawImage(padded, -padding, -padding)
    return output.toDataURL('image/png')
  } finally {
    for (const canvas of [sample, padded, output]) canvas.width = canvas.height = 0
  }
}

/** Reuse decoded input and a tiny fingerprint. Neither geometry nor node size participates in the key. */
export async function getOutpaintPreview(image: HTMLImageElement): Promise<string> {
  const pixels = sampleImageBlock(image)
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(pixels))
  const key = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  const started = performance.now()
  logger.debug('生成扩图边缘预览', { event: 'outpaint.preview.start' })
  const texture = bakeOutpaintPreview(pixels)
  cache.set(key, texture)
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  logger.debug('扩图边缘预览已生成', { event: 'outpaint.preview.completed', durationMs: performance.now() - started })
  return texture
}
