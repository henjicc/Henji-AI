import { videoEditComposition } from '@/core/videoEdit/document'
import { videoEditClipStabilizationSchema, type VideoEditClipStabilization } from '@/core/videoEdit/stabilization'
import { createLogger } from '@/core/logging'
import { editVideoSequence, requireVideoEditInstance } from './videoEditService'
import { setVideoEditTrackResults, videoEditClipStabilizationSolution } from '../engine/videoEditTrackResults'
import { videoEditStabilizationRequest, videoEditTrackingCovers, videoEditTrackingFailureText, videoEditTrackingStatus, videoEditTrackResults, waitVideoEditTrackingDefinitions } from './videoEditTracking'

/*
 * 防抖（应用层）：片段上只存意图参数；相机运动在后台跟踪进程里按素材内容分析并缓存（写入参数即自动开始），
 * 平滑路径在渲染时按参数求解。界面、通用属性 video_edit.clip.stabilization 与助手的 stabilize_video_edit_clip 走同一入口。
 */

const logger = createLogger('features.videoEdit.stabilization')

/** 设置或关闭（null）片段防抖，一步撤销；只用于视频与嵌套序列片段。 */
export function setVideoEditClipStabilization(projectId: string, sequenceId: string, clipId: string, value: VideoEditClipStabilization | null): void {
  const parsed = value === null ? null : videoEditClipStabilizationSchema.parse(value)
  editVideoSequence(projectId, sequenceId, sequence => {
    const clip = sequence.clips.find(entry => entry.id === clipId)
    if (!clip) throw new Error('片段已移除。')
    if (parsed && clip.kind !== 'video' && clip.kind !== 'sequence') throw new Error('防抖只用于视频或嵌套序列片段。')
    const next = { ...clip }
    if (parsed) next.stabilization = parsed; else delete next.stabilization
    return { ...sequence, clips: sequence.clips.map(value => value === clip ? next : value) }
  })
}

/** 防抖读回：off 未开启；analyzing 正在分析相机运动；ready 已求出平滑路径（实际裁切比例等）；failed 附用户可处理的原因。 */
export type VideoEditStabilizationReadout =
  | { state: 'off' }
  | { state: 'analyzing'; progress: number }
  | { state: 'ready'; crop: number; zoom: number; frames: number; solveMs: number }
  | { state: 'failed'; message: string }

export async function readVideoEditStabilization(projectId: string, sequenceId: string, clipId: string): Promise<VideoEditStabilizationReadout> {
  const instance = requireVideoEditInstance(projectId)
  const composition = videoEditComposition(instance.document, sequenceId)
  const clip = composition.clips.find(entry => entry.id === clipId)
  if (!clip?.stabilization) return { state: 'off' }
  const request = videoEditStabilizationRequest(instance.document, composition.frameRate, clip)
  if (!request) return { state: 'failed', message: '这个片段没有可分析的画面。' }
  const status = videoEditTrackingStatus(request.definition)
  if (status?.state === 'failed') return { state: 'failed', message: videoEditTrackingFailureText(status.reason) }
  if (status?.state !== 'ready' || !videoEditTrackingCovers(status, request.range)) return { state: 'analyzing', progress: status?.state === 'tracking' ? status.progress : 0 }
  setVideoEditTrackResults(videoEditTrackResults())
  try {
    const solution = await videoEditClipStabilizationSolution(composition, clip)
    if (!solution) return { state: 'analyzing', progress: 1 }
    return { state: 'ready', crop: Math.round(solution.crop * 1000) / 1000, zoom: Math.round(solution.zoom * 1000) / 1000, frames: solution.corrections.length, solveMs: solution.solveMs }
  } catch (error) {
    logger.warn('防抖路径求解失败', { event: 'video_edit.stabilization.read_failed', error, context: { clipId } })
    return { state: 'failed', message: error instanceof Error ? error.message : '防抖路径求解失败。' }
  }
}

/** 等相机运动分析覆盖片段并求出平滑路径（助手与导出前使用）。 */
export async function waitVideoEditStabilization(projectId: string, sequenceId: string, clipId: string, signal?: AbortSignal): Promise<VideoEditStabilizationReadout> {
  const instance = requireVideoEditInstance(projectId)
  const composition = videoEditComposition(instance.document, sequenceId)
  const clip = composition.clips.find(entry => entry.id === clipId)
  const request = clip && videoEditStabilizationRequest(instance.document, composition.frameRate, clip)
  if (request) await waitVideoEditTrackingDefinitions([request], signal)
  return readVideoEditStabilization(projectId, sequenceId, clipId)
}
