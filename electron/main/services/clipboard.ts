import { clipboard, ClipboardItem, nativeImage } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveSourceBytes } from './image/source'
import { loadSharp } from './image/sharp-loader'
import { createMainLogger } from './logging/main-logger'
import { readFileBytes } from './system'

const logger = createMainLogger('main.clipboard')
const MAX_CLIPBOARD_FILE_BYTES = 16 * 1024 * 1024

export interface ClipboardFileEntryDto {
  path: string
  size: number
  mimeType: string
}

export interface ClipboardImageDto {
  /** 统一为 data URL，调用方不需要关心剪贴板里原本是位图还是文件 */
  dataUrl: string
  /** 建议文件名，来自文件路径；位图截图则生成时间戳名 */
  name: string
  /** bitmap = 截图等原始位图；file = 从资源管理器复制的图片文件 */
  origin: 'bitmap' | 'file'
}

function inferMimeFromPath(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  return 'application/octet-stream'
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>()
  return paths.filter((filePath) => {
    const normalized = path.normalize(filePath)
    if (seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

/** Electron 44 起剪贴板为异步 W3C 接口：文件列表统一读 text/uri-list（Windows CF_HDROP、macOS 文件引用都映射到它）。 */
async function readClipboardFilePaths(): Promise<string[]> {
  const item = (await clipboard.read()).find(entry => [...entry.types].includes('text/uri-list'))
  if (!item) return []
  const list = await (await item.getType('text/uri-list')).text()
  const paths = list.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith('file:'))
    .flatMap(uri => { try { return [fileURLToPath(uri)] } catch { return [] } })
  return uniquePaths(paths.filter((filePath) => path.isAbsolute(filePath)))
}

export async function readClipboardFiles(): Promise<ClipboardFileEntryDto[]> {
  const entries: ClipboardFileEntryDto[] = []
  const filePaths = await readClipboardFilePaths()
  for (const filePath of filePaths) {
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) continue
      entries.push({
        path: filePath,
        size: stat.size,
        mimeType: inferMimeFromPath(filePath),
      })
    } catch (error) {
      logger.warn('剪贴板文件读取失败', { event: 'clipboard.files_read.failed', error, context: { pathCount: filePaths.length } })
    }
  }
  return entries
}

export function readClipboardText(): Promise<string> {
  return clipboard.readText()
}

/**
 * 主动从剪贴板取一张图片。
 *
 * 两种来源都要覆盖：截图之类的原始位图读 image/png，从资源管理器复制的图片文件
 * 走已有的文件列表读取。判断顺序放在这里而不是各调用方，避免每个界面各写一遍。
 * 剪贴板里没有图片时返回 null，由调用方决定怎么提示。
 */
async function readClipboardPng(): Promise<Buffer | null> {
  const item = (await clipboard.read()).find(entry => [...entry.types].includes('image/png'))
  return item ? Buffer.from(await (await item.getType('image/png')).arrayBuffer()) : null
}

async function readNativeClipboardImage(expectWrittenImage = false): Promise<Buffer | null> {
  let image = await readClipboardPng()
  // Windows 暂时无法打开剪贴板时读取可能为空；短暂让出主线程后有界重读。
  const startedAt = performance.now()
  let deferredReads = 0
  while (!image?.length && performance.now() - startedAt < 250) {
    await new Promise<void>(resolve => setTimeout(resolve, 16))
    image = await readClipboardPng()
    deferredReads++
  }
  if (deferredReads) logger.info('剪贴板图片延后读回', {
    event: 'clipboard.image_read.deferred', context: { expectWrittenImage, deferredReads, durationMs: Math.round(performance.now() - startedAt), found: Boolean(image?.length) },
  })
  return image?.length ? image : null
}

export async function readClipboardImage(): Promise<ClipboardImageDto | null> {
  const image = await readNativeClipboardImage()
  if (image) {
    return {
      dataUrl: `data:image/png;base64,${image.toString('base64')}`,
      name: `clipboard-${Date.now()}.png`,
      origin: 'bitmap',
    }
  }

  const filePaths = await readClipboardFilePaths()
  for (const filePath of filePaths) {
    const mimeType = inferMimeFromPath(filePath)
    if (!mimeType.startsWith('image/')) continue
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) continue
      if (stat.size > MAX_CLIPBOARD_FILE_BYTES) {
        logger.warn('剪贴板图片超过读取预算，请通过文件导入入口添加', { event: 'clipboard.image_read.limit', context: { sizeBytes: stat.size } })
        continue
      }
      const bytes = Buffer.from(await readFileBytes(filePath, { maxBytes: MAX_CLIPBOARD_FILE_BYTES }))
      return { dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`, name: path.basename(filePath), origin: 'file' }
    } catch (error) {
      logger.warn('剪贴板图片读取失败', { event: 'clipboard.image_read.failed', error, context: { pathCount: filePaths.length } })
    }
  }

  return null
}

export async function writeImageFromPath(filePath: string): Promise<void> {
  await writeClipboardImage(() => fs.readFile(filePath), 'path')
}

export function writeClipboardText(text: string): Promise<void> { return clipboard.writeText(text) }

export async function writeImageFromSource(source: string): Promise<void> {
  await writeClipboardImage(async () => (await resolveSourceBytes(source)).bytes, 'source')
}

async function writeClipboardImage(readBytes: () => Promise<Buffer>, inputKind: string): Promise<void> {
  const startedAt = performance.now()
  let stage = 'read'
  const context: Record<string, string | number> = { inputKind }
  logger.info('开始复制图片', { event: 'clipboard.image_write.start', context: { ...context } })
  try {
    const bytes = await readBytes()
    context.sourceBytes = bytes.length
    stage = 'decode'
    const sharp = await loadSharp()
    const pngBytes = await sharp(bytes).png().toBuffer()
    context.pngBytes = pngBytes.length
    stage = 'native_image'
    logger.info('图片转换完成，开始创建剪贴板位图', {
      event: 'clipboard.image_write.prepared', context: { ...context },
    })
    const image = nativeImage.createFromBuffer(pngBytes)
    if (image.isEmpty()) throw new Error('Failed to decode image for clipboard')
    const size = image.getSize()
    context.width = size.width
    context.height = size.height
    stage = 'write'
    logger.info('图片已解码，开始写入系统剪贴板', {
      event: 'clipboard.image_write.decoded', context: { ...context, rssBytes: process.memoryUsage().rss },
    })
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([pngBytes], { type: 'image/png' }) })])
    stage = 'confirm'
    if (!(await readNativeClipboardImage(true))) throw new Error('系统暂时无法读回复制的图片，请重试')
    logger.info('图片复制完成', {
      event: 'clipboard.image_write.completed', context: { ...context, durationMs: Math.round(performance.now() - startedAt) },
    })
  } catch (error) {
    logger.error('图片复制失败', {
      event: 'clipboard.image_write.failed', error,
      context: { ...context, stage, durationMs: Math.round(performance.now() - startedAt) },
    })
    throw error
  }
}
