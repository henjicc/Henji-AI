import type { LocalMediaImportResult, LocalMediaKind } from '@/core/media/localMediaImportContracts'
import type { ClipboardFileEntry, ClipboardImage } from '@/platform/contracts/clipboard'
import { readClipboardFiles, readClipboardImage } from '@/commands/clipboard'
import { createLogger } from '@/core/logging'
import { getPathForFile } from '@/platform/desktopApi'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { resolveLargeUploadAction } from '@/services/largeUploadPolicy'

const logger = createLogger('services.localMediaImport')

export type LocalMediaImportInput = File | ClipboardFileEntry
export type ClipboardImageSource = ClipboardFileEntry | ClipboardImage

/** 文件图片优先只取路径；没有图片文件时仍读取截图位图。 */
export async function readClipboardImageSources(): Promise<ClipboardImageSource[]> {
  if (isDesktopRuntime()) {
    const files = await readClipboardFiles()
    const images = files.filter(file => inferLocalMediaKind({ name: file.path, type: file.mimeType }) === 'image')
    if (images.length) return images
  }
  const image = await readClipboardImage()
  return image ? [image] : []
}

/** 编辑器单图入口与生成页多图入口共用来源选择。 */
export async function readClipboardImageSource(): Promise<ClipboardImageSource | null> {
  return (await readClipboardImageSources())[0] ?? null
}

const EXTENSION_KINDS: Record<string, LocalMediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', avif: 'image', svg: 'image',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', avi: 'video', mkv: 'video', mxf: 'video', mpg: 'video', mpeg: 'video', m2ts: 'video', mts: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', opus: 'audio', pcm: 'audio',
}

/** 助手路径导入还支持由原生解析器识别的专业容器，不改变界面上传端口的格式选择。 */
export function inferLocalMediaImportKind(path: string): LocalMediaKind | null {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  if (['wmv', 'flv', '3gp', 'ts'].includes(extension)) return 'video'
  if (['aiff', 'aif', 'wma'].includes(extension)) return 'audio'
  if (['tif', 'tiff', 'heic', 'heif'].includes(extension)) return 'image'
  return inferLocalMediaKind({ name: path, type: '' })
}

export function inferLocalMediaKind(file: Pick<File, 'name' | 'type'>): LocalMediaKind | null {
  const mimeKind = file.type.split('/')[0]
  if (mimeKind === 'image' || mimeKind === 'video' || mimeKind === 'audio') return mimeKind
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_KINDS[extension] ?? null
}

function createImportId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `media-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function importLocalMedia(
  input: LocalMediaImportInput,
  expectedKind?: LocalMediaKind,
): Promise<LocalMediaImportResult> {
  const pathEntry = 'path' in input ? input : null
  // 现有大文件策略只读取 File 的 name/size；空 File 承载元数据，不分配或读取原文件字节。
  let file: File
  if ('path' in input) {
    if (!input.path.trim() || !Number.isSafeInteger(input.size) || input.size < 0) {
      throw new Error('Invalid media path or size')
    }
    file = new File([], input.path.split(/[\\/]/).pop() || 'media', { type: input.mimeType })
    Object.defineProperty(file, 'size', { value: input.size })
  } else file = input
  const kind = inferLocalMediaKind(file)
  if (!kind || (expectedKind && kind !== expectedKind)) {
    throw new Error('Unsupported or mismatched media file')
  }

  const importId = createImportId()
  const startedAt = performance.now()
  const directPath = pathEntry ? pathEntry.path.trim() : getPathForFile(file).trim()
  logger.info('媒体导入已提交', {
    event: 'media_import.renderer.start',
    requestId: importId,
    context: { kind, sizeBytes: file.size, source: directPath ? 'path' : 'bytes' },
  })
  try {
    let result: LocalMediaImportResult
    if (directPath) {
      const action = await resolveLargeUploadAction(file, directPath)
      result = await getPlatform().media.importFromPath({
        importId,
        sourcePath: directPath,
        expectedKind: kind,
        ownership: action === 'reference' ? 'referenced' : 'managed',
        mimeType: file.type || undefined,
      })
    } else {
      const bytes = new Uint8Array(await file.arrayBuffer())
      result = await getPlatform().media.importFromBytes({
        importId,
        bytes,
        fileName: file.name,
        expectedKind: kind,
        mimeType: file.type || undefined,
      })
    }
    logger.info('媒体导入结果已返回渲染层', {
      event: 'media_import.renderer.completed',
      requestId: importId,
      context: {
        kind: result.kind,
        ownership: result.ownership,
        sizeBytes: result.sizeBytes,
        cacheHit: result.cacheHit,
        totalMs: Math.round(performance.now() - startedAt),
      },
    })
    return result
  } catch (error) {
    logger.error('媒体导入结果返回失败', {
      event: 'media_import.renderer.failed',
      requestId: importId,
      context: { kind, sizeBytes: file.size, totalMs: Math.round(performance.now() - startedAt) },
      error,
    })
    throw error
  }
}
