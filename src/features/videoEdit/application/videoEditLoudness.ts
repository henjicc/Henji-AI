import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { videoEditClipMedia, videoEditComposition, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { videoEditGainVolumes, type VideoEditGainMode, type VideoEditLoudnessMeasurement } from '@/core/videoEdit/loudness'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { editVideoProject, listVideoEditInstances, requireVideoEditInstance, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.loudness')
export interface VideoEditGainTarget { projectId: string; sequenceId: string; clipIds: string[] }
export function videoEditClipHasSound(composition: VideoEditComposition, clip: VideoEditClip): boolean {
  return (clip.kind === 'audio' || clip.kind === 'video' && clip.sourceComponent !== 'video') && videoEditClipMedia(composition, clip)?.hasAudio !== false && Boolean(videoEditClipMedia(composition, clip))
}
/** Shared preview/export mixer; only the PCM spool/FFmpeg DSP is additional. At most one second per IPC. */
export async function spoolVideoEditAudio(composition: VideoEditComposition, range: { startFrame: number; endFrame: number }, signal?: AbortSignal, supplied?: VideoEditRenderSession): Promise<string> {
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
function unchanged(owner: VideoEditInstance, baseline: VideoEditInstance['document']): void {
  if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) throw new Error('测量期间剪辑已有修改或已关闭，请重新测量。')
}
async function measureClip(composition: VideoEditComposition, clip: VideoEditClip, signal?: AbortSignal): Promise<VideoEditLoudnessMeasurement> {
  // Solo the explicit clip, preserve its mapping, speed, effects and fades; exclude neighbours' transitions.
  const media = videoEditClipMedia(composition, clip)!
  const isolated = { ...composition, clips: [clip], transitions: [], media: [media], items: composition.items.filter(item => item.id === clip.itemId), tracks: composition.tracks.map(track => ({ ...track, enabled: true, muted: false, solo: false })) }
  const api = getPlatform().audioEdit.loudness
  const id = await spoolVideoEditAudio(isolated, { startFrame: clip.start, endFrame: clip.start + clip.duration }, signal)
  const abort = (): void => { void api.close(id).catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  try { signal?.throwIfAborted(); const result = await api.measure(id); signal?.throwIfAborted(); return result }
  finally { signal?.removeEventListener('abort', abort); await api.close(id) }
}
export async function measureVideoEditClips(target: VideoEditGainTarget, signal?: AbortSignal): Promise<VideoEditLoudnessMeasurement[]> {
  const { owner, composition, clips } = snapshot(target); const baseline = owner.document
  logger.info('开始测量片段响度', { event: 'video_edit.loudness.measure.start', context: { projectId: target.projectId, clips: clips.length } })
  try {
    const results = []
    for (const clip of clips) { results.push(await measureClip(composition, clip, signal)); unchanged(owner, baseline) }
    logger.info('片段响度测量完成', { event: 'video_edit.loudness.measure.completed', context: { projectId: target.projectId, clips: results.length } }); return results
  } catch (error) { logger.error('片段响度测量失败', error, { event: 'video_edit.loudness.measure.failed' }); throw error }
}
/** All selected clips commit ONCE after all analyses/checks. No partial writes, no silent clamping. */
export async function applyVideoEditAudioGain(target: VideoEditGainTarget, mode: VideoEditGainMode, value: number, signal?: AbortSignal): Promise<{ clipId: string; volume: number; measurement?: VideoEditLoudnessMeasurement }[]> {
  const { owner, composition, clips } = snapshot(target); const baseline = owner.document
  assertVideoEditClipsEditable(composition, clips.map(clip => clip.id))
  signal?.throwIfAborted()
  logger.info('开始调整片段增益', { event: 'video_edit.loudness.gain.start', context: { projectId: target.projectId, mode, clips: clips.length } })
  try {
    // A muted clip is measured at unity so normalization can explicitly make it audible again.
    const bases = clips.map(clip => clip.volume || 1)
    const measurements: VideoEditLoudnessMeasurement[] = []
    if (mode !== 'set' && mode !== 'adjust') for (let index = 0; index < clips.length; index++) {
      measurements.push(await measureClip(composition, { ...clips[index], volume: bases[index] }, signal)); unchanged(owner, baseline)
    }
    const volumes = videoEditGainVolumes(mode, value, mode === 'set' || mode === 'adjust' ? clips.map(clip => clip.volume) : bases, measurements)
    const results = clips.map((clip, index) => ({ clipId: clip.id, volume: volumes[index], measurement: measurements[index] }))
    if (mode === 'loudness' || mode === 'peak_all') for (let index = 0; index < clips.length; index++) {
      // Volume precedes nonlinear effects. Re-render instead of assuming that LUFS changes linearly.
      let verified = false
      for (let attempt = 0; attempt < 4; attempt++) {
        const measured = await measureClip(composition, { ...clips[index], volume: results[index].volume }, signal)
        unchanged(owner, baseline); results[index].measurement = measured
        const level = mode === 'loudness' ? measured.integratedLufs : measured.samplePeakDbfs
        if (level === null) throw new Error('声音低于测量门限，无法标准化。')
        if (Math.abs(level - value) <= (mode === 'loudness' ? .5 : .1)) { verified = true; break }
        results[index].volume = videoEditGainVolumes(mode, value, [results[index].volume], [measured])[0]
      }
      if (!verified) throw new Error('片段效果限制了音量，无法达到目标响度。请调整效果或使用导出响度标准化。')
    }
    if (mode === 'peak_max') {
      let verified = false
      for (let attempt = 0; attempt < 4; attempt++) {
        const measured = []
        for (let index = 0; index < clips.length; index++) { measured.push(await measureClip(composition, { ...clips[index], volume: results[index].volume }, signal)); unchanged(owner, baseline); results[index].measurement = measured[index] }
        const levels = measured.map(result => result.samplePeakDbfs)
        if (levels.some(level => level === null)) throw new Error('声音为静音，无法标准化峰值。')
        if (Math.abs(Math.max(...levels as number[]) - value) <= .1) { verified = true; break }
        const adjusted = videoEditGainVolumes(mode, value, results.map(result => result.volume), measured)
        results.forEach((result, index) => { result.volume = adjusted[index] })
      }
      if (!verified) throw new Error('片段效果限制了峰值，请调整效果后重试。')
    }
    signal?.throwIfAborted(); unchanged(owner, baseline)
    editVideoProject(target.projectId, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id !== target.sequenceId ? sequence : { ...sequence, clips: sequence.clips.map(clip => { const result = results.find(result => result.clipId === clip.id); return result ? { ...clip, volume: result.volume } : clip }) }) }))
    logger.info('片段增益调整完成', { event: 'video_edit.loudness.gain.completed', context: { projectId: target.projectId, mode, clips: results.length } }); return results
  } catch (error) { logger.error('片段增益调整失败', error, { event: 'video_edit.loudness.gain.failed' }); throw error }
}
