import { inspectAsset } from '@/commands/assetLibrary'
import { toFetchableMediaUrl } from '@/services/imageSource'

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
      if (ref?.kind !== 'asset' || typeof ref.id !== 'string') throw new Error(`INVALID_INPUT:${field.uploaded} 必须包含素材引用 {kind:"asset",id:"…"}。`)
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
