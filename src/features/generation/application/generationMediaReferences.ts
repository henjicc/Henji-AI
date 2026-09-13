import { inspectAsset } from '@/commands/assetLibrary'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { databaseService } from '@/services/database'
import { convertPathString, getDataRoot } from '@/utils/dataPath'
import { resolveReadableGenerationImage } from './generationResultSource'

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
      if (typeof ref?.id !== 'string' || !ref.id.trim() || !['asset', 'generation.result'].includes(String(ref.kind))) throw new Error(`INVALID_INPUT:${field.uploaded} 接受素材库 {kind:"asset",id:"…"} 或生成历史结果 {kind:"generation.result",id:"…"}，无需先加入素材库。`)
      if (ref.kind === 'generation.result') {
        await databaseService.init()
        const record = await databaseService.getHistoryById(ref.id)
        if (!record || !['success', 'completed'].includes(record.status)) throw new Error('NOT_FOUND:生成结果不存在或尚未成功，请读取生成历史取得有效 resultRef。')
        if (record.type !== field.type) throw new Error(`INVALID_INPUT:${field.uploaded} 中的生成结果类型应为 ${field.type}，实际为 ${record.type}。`)
        if (field.type === 'image') return (await resolveReadableGenerationImage(record)).source
        const stored = record.filePath || record.params.__resultUrl
        if (typeof stored !== 'string' || !stored.trim()) throw new Error('NOT_FOUND:生成记录没有可引用的媒体。')
        const source = stored.split('|||').map(value => value.trim()).filter(Boolean).at(-1)
        if (!source) throw new Error('NOT_FOUND:生成记录没有可引用的媒体。')
        const path = await convertPathString(source, await getDataRoot(), false)
        if (!path) throw new Error('NOT_FOUND:生成记录没有可引用的媒体。')
        return path
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
