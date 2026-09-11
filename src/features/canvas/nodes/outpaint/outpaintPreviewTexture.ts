import { createLogger } from '@/core/logging'
import { sampleImageBlock } from '../../ui/specialInterfaces/multiAngle/imageBlockTextures'

const logger = createLogger('features.canvas.outpaint')
const cache = new Map<string, string>()
const MAX_ENTRIES = 24
const SIZE = 256

/** Continuous outside-only warp; the source and its boundary remain anchored. */
export function outpaintSamplePosition(u: number, v: number): [number, number] {
  const distance = Math.hypot(Math.max(0, Math.abs(u - 0.5) - 0.5), Math.max(0, Math.abs(v - 0.5) - 0.5))
  const strength = 1 - Math.exp(-distance * distance * 8)
  const angle = 0.32 * strength * Math.sin(1.4 + u * 0.6 + v * 0.8)
  const cos = Math.cos(angle); const sin = Math.sin(angle)
  return [Math.max(0, Math.min(1, 0.5 + (u - 0.5) * cos - (v - 0.5) * sin)),
    Math.max(0, Math.min(1, 0.5 + (u - 0.5) * sin + (v - 0.5) * cos))]
}

/** One continuous low-resolution field, never independently stretched tiles. */
export function bakeOutpaintPreview(pixels: Uint8ClampedArray, width: number, height: number, maximum: number): string {
  const padding = 48
  const padded = document.createElement('canvas')
  const output = document.createElement('canvas')
  padded.width = padded.height = SIZE + padding * 2
  output.width = output.height = SIZE
  try {
    const staging = padded.getContext('2d')
    const target = output.getContext('2d')
    if (!staging || !target) throw new Error('无法创建扩图预览贴图')
    const sampleSize = Math.sqrt(pixels.length / 4)
    const data = staging.createImageData(padded.width, padded.height)
    for (let y = 0; y < padded.height; y++) for (let x = 0; x < padded.width; x++) {
      const u = ((x - padding + 0.5) / SIZE * (width + 2 * maximum) - maximum) / width
      const v = ((y - padding + 0.5) / SIZE * (height + 2 * maximum) - maximum) / height
      const [su, sv] = outpaintSamplePosition(u, v)
      const from = (Math.round(sv * (sampleSize - 1)) * sampleSize + Math.round(su * (sampleSize - 1))) * 4
      const to = (y * padded.width + x) * 4
      for (let channel = 0; channel < 4; channel++) data.data[to + channel] = pixels[from + channel]
    }
    staging.putImageData(data, 0, 0)
    target.filter = 'blur(12px)'
    target.drawImage(padded, -padding, -padding)
    return output.toDataURL('image/png')
  } finally {
    for (const canvas of [padded, output]) canvas.width = canvas.height = 0
  }
}

/** Reuse decoded input and a tiny fingerprint. Neither geometry nor node size participates in the key. */
export async function getOutpaintPreview(image: HTMLImageElement, maximum: number): Promise<string> {
  const pixels = sampleImageBlock(image)
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(pixels))
  const key = `${image.naturalWidth}/${image.naturalHeight}/${maximum}/` + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    cache.set(key, cached)
    return cached
  }
  const started = performance.now()
  logger.debug('生成扩图边缘预览', { event: 'outpaint.preview.start' })
  const texture = bakeOutpaintPreview(pixels, image.naturalWidth, image.naturalHeight, maximum)
  cache.set(key, texture)
  if (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
  logger.debug('扩图边缘预览已生成', { event: 'outpaint.preview.completed', durationMs: performance.now() - started })
  return texture
}
