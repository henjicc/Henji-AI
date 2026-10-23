import { isVideoEditContentCurrent } from './videoEditDocumentAlgorithm'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { videoEditClipMedia, videoEditComposition, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { videoEditGainValues, videoEditRecordingGainDb, type VideoEditGainMode, type VideoEditLoudnessMeasurement } from '@/core/videoEdit/loudness'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { editVideoProject, requireVideoEditInstance, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.loudness')
export interface VideoEditGainTarget { projectId: string; sequenceId: string; clipIds: string[] }
export function videoEditClipHasSound(composition: VideoEditComposition, clip: VideoEditClip): boolean {
  return (clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent !== 'video') && videoEditClipMedia(composition, clip)?.hasAudio !== false && Boolean(videoEditClipMedia(composition, clip))
}
/** Shared preview/export mixer; only the PCM spool/FFmpeg DSP is additional. At most one second per IPC. */
export async function spoolVideoEditAudio(composition: VideoEditComposition, range: { startFrame: number; endFrame: number }, signal?: AbortSignal, supplied?: VideoEditRenderSession, onProgress?: (fraction: number) => void): Promise<string> {
  const api = getPlatform().audioEdit.loudness
  const id = crypto.randomUUID()
  let renderer: VideoEditRenderSession | undefined = supplied
  const cancel = (): void => { void api.close(id).catch(() => undefined) }
  signal?.throwIfAborted(); signal?.addEventListener('abort', cancel, { once: true })
  try {
    await api.start(composition.sampleRate, composition.channels, id); signal?.throwIfAborted()
    renderer ??= new VideoEditRenderSession(composition, 1)
    for (let frame = range.startFrame; frame < range.endFrame;) {
      signal?.throwIfAborted()
      const end = Math.min(range.endFrame, frame + Math.max(1, Math.round(composition.fps)))
      const buffer = await renderer.mixAudio(frame / composition.fps, (end - frame) / composition.fps)
      signal?.throwIfAborted()
      await api.append(id, Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))); frame = end
      onProgress?.((frame - range.startFrame) / (range.endFrame - range.startFrame))
    }
    return id
  } catch (error) { await api.close(id); throw error }
  finally { signal?.removeEventListener('abort', cancel); if (!supplied) await renderer?.dispose() }
}
function snapshot(target: VideoEditGainTarget): { owner: VideoEditInstance; composition: VideoEditComposition; clips: VideoEditClip[] } {
  const owner = requireVideoEditInstance(target.projectId)
  const composition = structuredClone(videoEditComposition(owner.document, target.sequenceId))
  const ids = new Set(target.clipIds)
  const clips = composition.clips.filter(clip => ids.has(clip.id))
  if (!clips.length || clips.length !== ids.size || clips.some(clip => !videoEditClipHasSound(composition, clip))) throw new Error('请选择完整的声音片段或带声音的视频片段。')
  return { owner, composition, clips }
}
function unchanged(owner: VideoEditInstance, contentVersion: number): void {
  if (!isVideoEditContentCurrent(owner, contentVersion)) throw new Error('测量期间剪辑已有修改或已关闭，请重新测量。')
}
async function measureClip(composition: VideoEditComposition, clip: VideoEditClip, signal?: AbortSignal): Promise<VideoEditLoudnessMeasurement> {
  // Solo the explicit clip, preserve its mapping, speed, effects and fades; exclude neighbours' transitions.
  const media = videoEditClipMedia(composition, clip)!
  const isolated = { ...composition, clips: [clip], transitions: [], sequences: [], media: [media], items: composition.items.filter(item => item.id === clip.itemId), tracks: composition.tracks.map(track => ({ ...track, enabled: true, muted: false, solo: false })) }
  const api = getPlatform().audioEdit.loudness
  const id = await spoolVideoEditAudio(isolated, { startFrame: clip.start, endFrame: clip.start + clip.duration }, signal)
  const abort = (): void => { void api.close(id).catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try { signal?.throwIfAborted(); const result = await api.measure(id); signal?.throwIfAborted(); return result }
  finally { signal?.removeEventListener('abort', abort); await api.close(id) }
}
export async function measureVideoEditClips(target: VideoEditGainTarget, signal?: AbortSignal): Promise<VideoEditLoudnessMeasurement[]> {
  const { owner, composition, clips } = snapshot(target); const contentVersion = owner.contentVersion
  logger.info('开始测量片段响度', { event: 'video_edit.loudness.measure.start', context: { projectId: target.projectId, clips: clips.length } })
  try {
    const results = []
    for (const clip of clips) { results.push(await measureClip(composition, clip, signal)); unchanged(owner, contentVersion) }
    logger.info('片段响度测量完成', { event: 'video_edit.loudness.measure.completed', context: { projectId: target.projectId, clips: results.length } }); return results
  } catch (error) { logger.error('片段响度测量失败', error, { event: 'video_edit.loudness.measure.failed' }); throw error }
}

/** 在录制导入草稿上测量；调用方随导入一次提交并检查文档版本，不另写文件或历史。 */
export async function prepareVideoEditRecordingGain(composition: VideoEditComposition, clipIds: readonly string[], signal?: AbortSignal): Promise<Map<string, number>> {
  const ids = new Set(clipIds), gains = new Map<string, number>()
  const clips = composition.clips.filter(clip => ids.has(clip.id) && clip.duration / composition.fps >= .4 && videoEditClipHasSound(composition, clip))
  logger.info('开始匹配录制麦克风音量', { event: 'video_edit.recording_gain.start', context: { clips: clips.length } })
  try {
    for (const clip of clips) {
      signal?.throwIfAborted()
      const measured = await measureClip(composition, sourceLevelClip(clip), signal)
      gains.set(clip.id, videoEditRecordingGainDb(clip.gainDb ?? 0, measured))
    }
    signal?.throwIfAborted()
    logger.info('录制麦克风音量匹配完成', { event: 'video_edit.recording_gain.completed', context: { clips: gains.size } })
    return gains
  } catch (error) { logger.warn('录制麦克风音量匹配失败，未提交导入草稿', { event: 'video_edit.recording_gain.failed', error }); throw error }
}
/** All selected clips commit ONCE after all analyses/checks. No partial writes, no silent clamping. */
export async function applyVideoEditAudioGain(target: VideoEditGainTarget, mode: VideoEditGainMode, value: number, signal?: AbortSignal): Promise<{ clipId: string; gainDb: number; measurement?: VideoEditLoudnessMeasurement }[]> {
  const { owner, composition, clips } = snapshot(target); const contentVersion = owner.contentVersion
  assertVideoEditClipsEditable(composition, clips.map(clip => clip.id))
  signal?.throwIfAborted()
  logger.info('开始调整片段增益', { event: 'video_edit.loudness.gain.start', context: { projectId: target.projectId, mode, clips: clips.length } })
  try {
    const results = await prepareVideoEditAudioGain(composition, clips, mode, value, signal, () => unchanged(owner, contentVersion))
    signal?.throwIfAborted(); unchanged(owner, contentVersion)
    editVideoProject(target.projectId, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id !== target.sequenceId ? sequence : { ...sequence, clips: sequence.clips.map(clip => { const result = results.find(result => result.clipId === clip.id); return result ? { ...clip, gainDb: result.gainDb } : clip }) }) }))
    logger.info('片段增益调整完成', { event: 'video_edit.loudness.gain.completed', context: { projectId: target.projectId, mode, clips: results.length } }); return results
  } catch (error) { logger.error('片段增益调整失败', error, { event: 'video_edit.loudness.gain.failed' }); throw error }
}

/** 标准化只测片段所用的源声音，音量关键帧、淡化和效果不参与目标计算。 */
function sourceLevelClip(clip: VideoEditClip, gainDb = 0): VideoEditClip {
  return { ...clip, gainDb, volume: 1, curves: undefined, fadeInFrames: 0, fadeOutFrames: 0, effects: [], effectsEnabled: false }
}

/** 在不可变草稿上准备增益；调用方负责一次提交与过期结果保护。 */
export async function prepareVideoEditAudioGain(composition: VideoEditComposition, clips: VideoEditClip[], mode: VideoEditGainMode, value: number, signal?: AbortSignal, assertCurrent: () => void = () => {}, retainSilence = false): Promise<{ clipId: string; gainDb: number; measurement?: VideoEditLoudnessMeasurement }[]> {
  const measurements: VideoEditLoudnessMeasurement[] = []
  if (mode !== 'set' && mode !== 'adjust') for (const clip of clips) {
    measurements.push(await measureClip(composition, sourceLevelClip(clip), signal)); assertCurrent()
  }
  const bases = clips.map(clip => clip.gainDb ?? 0)
  const gains = retainSilence && mode === 'loudness'
    ? bases.map((base, index) => measurements[index].integratedLufs === null ? base : videoEditGainValues(mode, value, [base], [measurements[index]])[0])
    : videoEditGainValues(mode, value, bases, measurements)
  const results = clips.map((clip, index) => ({ clipId: clip.id, gainDb: gains[index], measurement: measurements[index] }))
  // 回读增益后的源声音；最终混音仍叠加用户已有音量与效果。
  if (measurements.length) for (let index = 0; index < clips.length; index++) {
    if (retainSilence && mode === 'loudness' && measurements[index].integratedLufs === null) continue
    const expected = mode === 'peak_max' ? measurements[index].samplePeakDbfs! + gains[index] : value
    // LUFS 的绝对门限会随放大纳入更多低电平片段；按回读结果有限校正，不放宽验收误差。
    for (let attempt = 0; attempt < (mode === 'loudness' ? 3 : 1); attempt++) {
      const measured = await measureClip(composition, sourceLevelClip(clips[index], results[index].gainDb), signal)
      assertCurrent(); results[index].measurement = measured
      const level = mode === 'loudness' ? measured.integratedLufs : measured.samplePeakDbfs
      if (level !== null && Math.abs(level - expected) <= (mode === 'loudness' ? .5 : .1)) break
      logger.warn('片段源增益复测未达到目标', { event: 'video_edit.loudness.gain.recheck', context: { clipId: clips[index].id, mode, attempt, expected, level, gainDb: results[index].gainDb, source: measurements[index] } })
      if (mode !== 'loudness' || level === null || attempt === 2) throw new Error('增益后的源声音未达到标准化目标，请重新测量。')
      results[index].gainDb = videoEditGainValues('adjust', expected - level, [results[index].gainDb])[0]
    }
  }
  signal?.throwIfAborted(); assertCurrent()
  return results
}
