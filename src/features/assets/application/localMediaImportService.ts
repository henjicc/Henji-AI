import { mediaErrorDetails, redactMediaError, normalizeMediaImportPath } from '@/core/media/localMediaImportSafety'
import type { z } from 'zod'
import { importLocalMediaCapability } from '@/core/application-control/domains/asset/localMediaImportCapability'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'
import { inferLocalMediaImportKind } from '@/services/localMediaImport'
import { addMediaReferenceToLibrary } from '../services/assetCollectionService'
import { inspectAsset } from '@/commands/assetLibrary'

const logger = createLogger('features.assets.localMediaImport')

export async function importLocalMediaPath(raw: unknown, signal?: AbortSignal): Promise<z.infer<typeof importLocalMediaCapability.outputSchema>> {
  const input = importLocalMediaCapability.inputSchema.parse(raw)
  const name = input.path.split(/[\\/]/).at(-1) || '素材'
  const summary = { inputIndex: 0, fileName: name, pathLength: input.path.length }
  logger.info('按路径导入素材开始', { event: 'asset.local_import.start', context: summary })
  let writing = false
  try {
    signal?.throwIfAborted()
    const sourcePath = normalizeMediaImportPath(input.path, typeof navigator === 'undefined' || !/Macintosh|Mac OS X|Linux/.test(navigator.userAgent))
    if (/\.pcm$/i.test(sourcePath)) throw new Error('MEDIA_FORMAT_UNSUPPORTED: 裸 PCM 没有可验证的文件头，请先转成 WAV 后重试 import_local_media。')
    const kind = inferLocalMediaImportKind(sourcePath)
    if (!kind) throw new Error('MEDIA_FORMAT_UNSUPPORTED: 格式不支持，请使用具有正确扩展名的图片、视频或音频文件。')
    const media = await getPlatform().media.importFromPath({ importId: crypto.randomUUID(), sourcePath, expectedKind: kind, ownership: 'referenced', verifyContent: true })
    signal?.throwIfAborted()
    writing = true
    const asset = await addMediaReferenceToLibrary({ filePath: media.fullPath, mediaType: media.kind, source: 'imported' })
    const saved = await inspectAsset(asset.id)
    if (saved.inspectionStatus !== 'ready' || saved.filePath !== asset.filePath || saved.mediaType !== media.kind) throw new Error('素材登记后回读不一致，请先查询素材库，不要重复导入。')
    const assetRef = { kind: 'asset' as const, id: saved.id }
    logger.info('按路径导入素材完成', { event: 'asset.local_import.completed', context: { ...summary, assetRef } })
    return { assetRef, name: saved.displayName, mediaType: media.kind, sizeBytes: media.sizeBytes, reused: asset.wasExisting === true,
      verification: { verified: true, target: assetRef, condition: '主进程已核验实际媒体格式，并从素材库回读确认原文件引用。' } }
  } catch (error) {
    // 保留错误类别与取消身份，输入路径只以摘要进入日志。
    logger.warn('按路径导入素材失败', { event: 'asset.local_import.failed', context: summary, error: mediaErrorDetails(error, [input.path]) })
    if (error instanceof Error && error.name === 'AbortError') throw redactMediaError(error, [input.path])
    const safe = redactMediaError(error, [input.path])
    if (writing) safe.message += ' 素材登记未确认，请先查询素材库核对结果，不要直接重复导入。'
    throw writing ? safe : notExecutedFailure(safe)
  }
}
