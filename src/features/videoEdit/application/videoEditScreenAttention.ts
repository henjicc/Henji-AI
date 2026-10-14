import { createLogger } from '@/core/logging'
import { videoEditClipMedia, videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { copyVideoEditSequence } from '@/core/videoEdit/sequenceCopy'
import { screenAttentionSettingsSchema, type ScreenAttentionSettings, type ScreenAttentionRegion } from '@/core/videoEdit/screenAttention'
import { videoEditReframeSizeSchema } from '@/core/videoEdit/reframe'
import type { VideoEditSize } from '@/core/videoEdit/clipGeometry'
import { editVideoProject, holdVideoEditActivity, requireVideoEditInstance } from './videoEditService'
import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { analyzeVideoEditScreenAttentionOffThread } from './videoEditScreenAttentionWorkerClient'
import type { VideoEditReframeTarget } from './videoEditReframe'

const logger = createLogger('features.videoEdit.screenAttention')
export interface VideoEditScreenAttentionOptions { settings: ScreenAttentionSettings; size?: VideoEditSize; name?: string; regions?: ScreenAttentionRegion[] }
export interface VideoEditScreenAttentionResult { sequenceId: string; clipIds: string[]; created: boolean; quietFrames: number; impreciseCapabilities: number }
/** All target clips commit once; paragraph strength and multi-aspect copies share this exact service. */
export async function generateVideoEditScreenAttention(target: VideoEditReframeTarget, options: VideoEditScreenAttentionOptions, signal?: AbortSignal): Promise<VideoEditScreenAttentionResult> {
  const settings = screenAttentionSettingsSchema.parse(options.settings)
  const owner = requireVideoEditInstance(target.projectId); const baseline = owner.document; const version = owner.contentVersion
  const sequence = baseline.sequences.find(value => value.id === target.sequenceId)
  if (!sequence) throw new Error('目标序列不存在。')
  const size = videoEditReframeSizeSchema.parse(options.size ?? { width: sequence.width, height: sequence.height })
  if (target.clipId && (size.width !== sequence.width || size.height !== sequence.height)) throw new Error('单片段推近使用所属序列画幅；多画幅请指定 sequenceRef。')
  if (sequence.pixelAspectRatio.numerator !== sequence.pixelAspectRatio.denominator) throw new Error('注意力推近需要方形像素序列，请先调整像素长宽比。')
  const clips = sequence.clips.filter(clip => (!target.clipId || clip.id === target.clipId) && clip.kind === 'video' && clip.sourceComponent !== 'audio' && videoEditClipMedia(baseline, clip)?.recordingCursor)
  if (!clips.length) throw new Error('请选择带录制事件日志的屏幕原片片段；录制会话接线后即可生成。')
  const created = !target.clipId && Boolean(options.size)
  if (!created && clips.some(clip => sequence.tracks.find(track => track.index === clip.track)?.locked)) throw new Error('目标轨道已锁定，请先解锁。')
  if (clips.some(clip => clip.disabledIntrinsicSections?.includes('motion'))) throw new Error('请先启用目标片段的运动效果，再生成推近。')
  const operationSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(600000)]) : AbortSignal.timeout(600000)
  const current = (): void => { operationSignal.throwIfAborted(); if (!isVideoEditContentCurrent(owner, version)) throw new Error('分析期间原剪辑已改变，请重新生成。') }
  const release = holdVideoEditActivity(target.projectId, '注意力推近')
  const updated = new Map<string, VideoEditClip>(); let quietFrames = 0; let impreciseCapabilities = 0
  logger.info('开始注意力推近', { event: 'video_edit.screen_attention.start', context: { projectId: target.projectId, sequenceId: sequence.id, clips: clips.length } })
  try {
    for (const clip of clips) {
      current()
      const composition = videoEditComposition(baseline, sequence.id)
      composition.clips = [clip]
      const media = videoEditClipMedia(baseline, clip)!
      composition.media = composition.media.filter(value => value.id === media.id)
      const result = await analyzeVideoEditScreenAttentionOffThread({ composition, clipId: clip.id, target: size, settings, regions: options.regions }, operationSignal)
      updated.set(clip.id, result.clip); quietFrames += result.quietFrames; impreciseCapabilities += result.impreciseCapabilities
    }
    current()
    const changed = { ...sequence, ...size, clips: sequence.clips.map(clip => updated.get(clip.id) ?? clip) }
    const result = created ? copyVideoEditSequence(changed) : changed
    if (created) result.name = options.name?.trim() || `${sequence.name.slice(0, 160)} · ${size.width}×${size.height}`
    editVideoProject(target.projectId, document => ({ ...document, sequences: created ? [...document.sequences, result] : document.sequences.map(value => value.id === result.id ? result : value) }))
    const clipIds = result.clips.filter(clip => clip.kind === 'video' && clip.sourceComponent !== 'audio' && videoEditClipMedia(baseline, clip)?.recordingCursor && (!target.clipId || clip.id === target.clipId)).map(clip => clip.id)
    logger.info('注意力推近完成', { event: 'video_edit.screen_attention.completed', context: { projectId: target.projectId, clips: clipIds.length, quietFrames, impreciseCapabilities } })
    return { sequenceId: result.id, clipIds, created, quietFrames, impreciseCapabilities }
  } catch (error) { logger.error('注意力推近未完成', { event: operationSignal.aborted ? 'video_edit.screen_attention.cancelled' : 'video_edit.screen_attention.failed', error, context: { projectId: target.projectId } }); throw error }
  finally { release() }
}
