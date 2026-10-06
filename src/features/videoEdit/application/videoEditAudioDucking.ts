import { createLogger } from '@/core/logging'
import { audibleVideoEditClips, videoEditComposition } from '@/core/videoEdit/document'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { mergeVideoEditAudioActivity, replaceVideoEditDuckingKeyframes, videoEditAudioRoleSchema, videoEditDuckingSettingsSchema, type VideoEditAudioActivity, type VideoEditAudioRole, type VideoEditDuckingSettings } from '@/core/videoEdit/audioDucking'
import { getPlatform } from '@/platform/runtime'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { spoolVideoEditAudio, videoEditClipHasSound, type VideoEditGainTarget } from './videoEditLoudness'
import { editVideoSequence, listVideoEditInstances, requireVideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.audioDucking')
export function setVideoEditAudioRoles(target: VideoEditGainTarget, role: VideoEditAudioRole): void {
  const parsed = videoEditAudioRoleSchema.parse(role)
  const owner = requireVideoEditInstance(target.projectId); const composition = videoEditComposition(owner.document, target.sequenceId)
  const ids = new Set(target.clipIds); const clips = composition.clips.filter(clip => ids.has(clip.id))
  if (!ids.size || clips.length !== ids.size || clips.some(clip => !videoEditClipHasSound(composition, clip))) throw new Error('请选择带声音的片段再设置声音类型。')
  assertVideoEditClipsEditable(composition, target.clipIds)
  editVideoSequence(target.projectId, target.sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => ids.has(clip.id) ? { ...clip, audioRole: parsed } : clip) }))
}
/** UI and public capability share this analysis + one atomic document edit. */
export async function generateVideoEditAudioDucking(target: VideoEditGainTarget, rawSettings: VideoEditDuckingSettings, signal?: AbortSignal): Promise<string[]> {
  const settings = videoEditDuckingSettingsSchema.parse(rawSettings)
  const owner = requireVideoEditInstance(target.projectId); const baseline = owner.document
  const composition = structuredClone(videoEditComposition(baseline, target.sequenceId))
  const ids = new Set(target.clipIds); const music = composition.clips.filter(clip => ids.has(clip.id))
  if (!ids.size || music.length !== ids.size || music.some(clip => clip.audioRole !== 'music' || !videoEditClipHasSound(composition, clip))) throw new Error('请先把要压低的声音片段标为音乐，再生成回避。')
  assertVideoEditClipsEditable(composition, target.clipIds)
  const start = Math.min(...music.map(clip => clip.start)); const end = Math.max(...music.map(clip => clip.start + clip.duration))
  // Use the mixer eligibility contract: disabled, muted and non-solo sound tracks cannot trigger ducking.
  const triggers = audibleVideoEditClips(composition).filter(clip => clip.audioRole === settings.targetRole && videoEditClipHasSound(composition, clip) && clip.start < end && clip.start + clip.duration > start)
  const assertCurrent = (): void => {
    signal?.throwIfAborted()
    if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) throw new Error('分析期间剪辑已有修改或已关闭，请重新生成回避。')
  }
  assertCurrent()
  logger.info('开始生成音频回避', { event: 'video_edit.ducking.start', context: { projectId: target.projectId, music: music.length, triggers: triggers.length } })
  try {
    let activity: VideoEditAudioActivity[] = []
    // Analyze each trigger separately: concurrent voices cannot cancel each other by phase.
    for (const clip of triggers) {
      assertCurrent()
      const isolated = { ...composition, clips: [clip], transitions: [] }
      const from = Math.max(start, clip.start); const to = Math.min(end, clip.start + clip.duration)
      const api = getPlatform().audioEdit.loudness
      const renderer = new VideoEditRenderSession(isolated, 1)
      let session: string | undefined
      const abort = (): void => { if (session) void api.close(session).catch(() => undefined) }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        session = await spoolVideoEditAudio(isolated, { startFrame: from, endFrame: to }, signal, renderer)
        assertCurrent()
        const ranges = await api.detectActivity(session, settings.sensitivity)
        assertCurrent()
        // Compact after every clip instead of retaining all overlapping voices' intervals.
        activity = mergeVideoEditAudioActivity([...activity, ...ranges.map(range => ({ startSeconds: range.startSeconds + from / composition.fps, endSeconds: range.endSeconds + from / composition.fps }))], 0.15)
      } finally { signal?.removeEventListener('abort', abort); try { if (session) await api.close(session) } finally { await renderer.dispose() } }
    }
    const merged = mergeVideoEditAudioActivity(activity, 0.15)
    const points = new Map(music.map(clip => [clip.id, replaceVideoEditDuckingKeyframes(clip, merged, composition.fps, settings)]))
    assertCurrent()
    editVideoSequence(target.projectId, target.sequenceId, sequence => ({ ...sequence, clips: sequence.clips.map(clip => points.has(clip.id) ? { ...clip, curves: { ...clip.curves, volume: points.get(clip.id)! } } : clip) }))
    logger.info('音频回避生成完成', { event: 'video_edit.ducking.completed', context: { projectId: target.projectId, clips: music.length, intervals: merged.length } })
    return music.map(clip => clip.id)
  } catch (error) { logger.error('音频回避生成失败', error, { event: 'video_edit.ducking.failed', context: { projectId: target.projectId } }); throw error }
}
