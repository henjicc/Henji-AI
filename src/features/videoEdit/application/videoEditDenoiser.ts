import { ensureLocalModel } from '@/commands/localModels'
import { createLogger } from '@/core/logging'
import { toFetchableMediaUrl } from '@/services/imageSource'

const logger = createLogger('features.videoEdit.space')
let weights: Promise<string | undefined> | undefined

/**
 * 路径追踪降噪（OIDN）的权重地址：第一次用到时下载（约 2 MB）并校验，之后复用。
 * 下载失败时路径追踪照常出画、只是不降噪，下次再要时重新尝试。
 */
export function videoEditDenoiserWeights(): Promise<string | undefined> {
  weights ??= ensureLocalModel('path_trace_denoise_oidn').then(result => {
    const file = result.files.find(value => value.role === 'model')
    return file ? toFetchableMediaUrl(file.path) : undefined
  }, (error: unknown) => {
    logger.warn('渲染降噪模型没有准备好，路径追踪画面暂不降噪', { event: 'video_edit.space.denoise.unavailable', error })
    weights = undefined
    return undefined
  })
  return weights
}
