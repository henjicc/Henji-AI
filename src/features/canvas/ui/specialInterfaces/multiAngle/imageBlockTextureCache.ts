import { createLogger } from '@/core/logging'
import { exists, isDesktopShell, join, mkdir, readTextFile, writeTextFile } from '@/platform/desktopApi'
import { bakeImageBlockTextures, sampleImageBlock, type ImageBlockTextures } from './imageBlockTextures'

export interface ImageBlockAppearance { aspect: number; textures: ImageBlockTextures }
const logger = createLogger('features.canvas.multiAngle')
const memory = new Map<string, ImageBlockAppearance>()
const sources = new Map<string, string>()
const pending = new Map<string, Promise<ImageBlockAppearance>>()
const MAX_BYTES = 160 * 1024
const MEMORY_ENTRIES = 48
let writes = Promise.resolve()

function remember<K, V>(map: Map<K, V>, key: K, value: V): void {
  map.delete(key); map.set(key, value)
  if (map.size > MEMORY_ENTRIES) map.delete(map.keys().next().value!)
}

/** Immediate reuse on canvas remount; image load verifies the tiny pixel fingerprint again. */
export function peekImageBlockAppearance(source: string): ImageBlockAppearance | undefined {
  const key = sources.get(source)
  return key ? memory.get(key) : undefined
}

function valid(value: unknown): value is ImageBlockAppearance & { key: string } {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<ImageBlockAppearance> & { key?: unknown }
  return typeof entry.key === 'string' && typeof entry.aspect === 'number' && Number.isFinite(entry.aspect) && entry.aspect > 0
    && !!entry.textures && ['left', 'right', 'top', 'bottom', 'back'].every(face => {
      const data = entry.textures?.[face as keyof ImageBlockTextures]
      return typeof data === 'string' && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)
    })
}

async function diskPath(key: string): Promise<{ directory: string; file: string } | null> {
  if (!isDesktopShell()) return null
  const { getThumbnailsPath } = await import('@/utils/dataPath')
  const directory = await join(await getThumbnailsPath(), 'image-block')
  // Fixed 256 slots bound disk usage to 40 MiB; full keys reject collisions and old algorithms.
  return { directory, file: await join(directory, `${key.slice(0, 2)}.json`) }
}

async function obtain(key: string, image: HTMLImageElement, pixels: Uint8ClampedArray, aspect: number): Promise<ImageBlockAppearance> {
  let path: Awaited<ReturnType<typeof diskPath>> = null
  try {
    path = await diskPath(key)
    if (path && await exists(path.file)) {
      const text = await readTextFile(path.file)
      if (text.length <= MAX_BYTES) {
        const stored: unknown = JSON.parse(text)
        if (valid(stored) && stored.key === key) {
          logger.debug('复用图片块本地贴图', { event: 'multi_angle.texture_cache.hit' })
          return { aspect: stored.aspect, textures: stored.textures }
        }
      }
    }
  } catch (error) {
    logger.warn('图片块缓存读取失败，将重新生成', { event: 'multi_angle.texture_cache.read_failed', error })
  }
  logger.debug('生成图片块贴图', { event: 'multi_angle.texture_bake.start' })
  const result = { aspect, textures: bakeImageBlockTextures(image, pixels) }
  logger.debug('图片块贴图已生成', { event: 'multi_angle.texture_bake.completed' })
  const payload = JSON.stringify({ key, ...result })
  if (path && payload.length <= MAX_BYTES) {
    const destination = path
    writes = writes.then(async () => {
      await mkdir(destination.directory, { recursive: true })
      await writeTextFile(destination.file, payload)
    }).catch(error => logger.warn('图片块缓存写入失败，保留内存贴图', { event: 'multi_angle.texture_cache.write_failed', error }))
    await writes
  }
  return result
}

/** Content identity avoids stale textures when an image is replaced at the same URL. */
export async function getImageBlockAppearance(source: string, image: HTMLImageElement): Promise<ImageBlockAppearance> {
  const aspect = image.naturalWidth / image.naturalHeight
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('图片尺寸无效')
  const pixels = sampleImageBlock(image)
  const header = new TextEncoder().encode(`image-block-mirrored-back-v2/${aspect}/`)
  const bytes = new Uint8Array(header.length + pixels.length)
  bytes.set(header); bytes.set(pixels, header.length)
  const key = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('')
  const cached = memory.get(key)
  let result = cached
  if (!result) {
    let job = pending.get(key)
    if (!job) {
      job = obtain(key, image, pixels, aspect)
      pending.set(key, job)
    }
    try { result = await job } finally { if (pending.get(key) === job) pending.delete(key) }
  }
  remember(memory, key, result)
  // Do not retain large inline originals just to support the synchronous preview lookup.
  if (source.length <= 4096) remember(sources, source, key)
  return result
}
