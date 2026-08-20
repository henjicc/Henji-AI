import type { LocalMediaImportResult, LocalMediaKind } from '@/core/media/localMediaImportContracts'
import { createLogger } from '@/core/logging'
import { getPathForFile } from '@/platform/desktopApi'
import { getPlatform } from '@/platform/runtime'
import { resolveLargeUploadAction } from '@/services/largeUploadPolicy'

const logger = createLogger('services.localMediaImport')

const EXTENSION_KINDS: Record<string, LocalMediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', avif: 'image', svg: 'image',
  mp4: 'video', m4v: 'video', mov: 'video', webm: 'video', avi: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', opus: 'audio', pcm: 'audio',
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
  file: File,
  expectedKind?: LocalMediaKind,
): Promise<LocalMediaImportResult> {
  const kind = inferLocalMediaKind(file)
  if (!kind || (expectedKind && kind !== expectedKind)) {
    throw new Error('Unsupported or mismatched media file')
  }

  const importId = createImportId()
  const startedAt = performance.now()
  const directPath = getPathForFile(file).trim()
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
