import { inspectAsset } from '@/commands/assetLibrary'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { readGenerationResultMedia } from './generationResultSource'
import { APPLICATION_MEDIA_REFERENCE_KINDS } from '@/core/application-control/mediaReferenceKinds'
import { materializeImageEditPreview } from '@/features/imageEdit/application/imageEditApplicationService'

/** 稳定素材引用只在应用边界解析；供应商上传仍由正式生成链路负责。 */
export async function resolveGenerationMediaReferences(options: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resolved = { ...options }
  const fields = [
    { uploaded: 'uploadedImages', visible: 'images', paths: 'uploadedFilePaths', type: 'image' },
    { uploaded: 'uploadedVideos', visible: 'videos', paths: 'uploadedVideoFilePaths', type: 'video' },
    { uploaded: 'uploadedAudios', visible: 'audios', paths: 'uploadedAudioFilePaths', type: 'audio' },
  ] as const
  for (const field of fields) {
    const input = options[field.uploaded] ?? options[field.visible]
    if (!Array.isArray(input)) continue
    const paths = await Promise.all(input.map(async (value: unknown): Promise<string> => {
      if (typeof value === 'string') return value
      const ref = value as { kind?: unknown; id?: unknown } | null
      if (typeof ref?.id !== 'string' || !ref.id.trim() || !APPLICATION_MEDIA_REFERENCE_KINDS.some(kind => kind === ref.kind)) throw new Error(`INVALID_INPUT:${field.uploaded} 接受 {kind,id}，kind 可为 ${APPLICATION_MEDIA_REFERENCE_KINDS.join('、')}；无需加入素材库。`)
      if (ref.kind === 'image_edit.preview') {
        if (field.type !== 'image') throw new Error(`INVALID_INPUT:${field.uploaded} 需要 ${field.type}，编辑预览实际为 image。`)
        return materializeImageEditPreview(ref.id)
      }
      if (ref.kind === 'generation.result') {
        const result = await readGenerationResultMedia(ref.id, field.type)
        if (!result) throw new Error('NOT_FOUND:生成结果不存在，请读取生成历史取得有效 resultRef。')
        return result.source
      }
      const asset = await inspectAsset(ref.id)
      if (asset.mediaType !== field.type) throw new Error(`INVALID_INPUT:${field.uploaded} 中的素材类型应为 ${field.type}，实际为 ${asset.mediaType}。`)
      return asset.filePath
    }))
    resolved[field.visible] = paths.map(toFetchableMediaUrl)
    // 显式本地路径优先；引用解析时填入原始路径，不能将显示协议传给 fs。
    resolved[field.paths] = options[field.paths] ?? paths
    delete resolved[field.uploaded]
  }
  return resolved
}
