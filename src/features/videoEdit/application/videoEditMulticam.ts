import { createLogger } from '@/core/logging'
import { activeVideoEditClips, clipSourceSeconds, videoEditComposition, type VideoEditComposition } from '@/core/videoEdit/document'
import { applyVideoEditMulticamCuts, changeVideoEditMulticamCamera, createVideoEditMulticam, suggestVideoEditMulticamCuts, videoEditMulticamSource, type VideoEditMulticamActivity, type VideoEditMulticamCreate } from '@/core/videoEdit/multicam'
import { videoEditMulticamDownsample, VIDEO_EDIT_MULTICAM_SYNC_RATE } from '@/core/videoEdit/multicamSync'
import { assertVideoEditClipsEditable } from '@/core/videoEdit/lockedTracks'
import { getPlatform } from '@/platform/runtime'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { synchronizeVideoEditMulticam } from './videoEditMulticamWorkerClient'
import { editVideoProject, editVideoSequence, getActiveVideoEditSequence, holdVideoEditActivity, listVideoEditInstances, requireVideoEditInstance, type VideoEditInstance } from './videoEditService'

export function videoEditProgramMulticam(instance: VideoEditInstance): { clip: VideoEditInstance['document']['sequences'][number]['clips'][number]; source: VideoEditInstance['document']['sequences'][number] } | undefined {
  const parent = getActiveVideoEditSequence(instance)
  const candidates = activeVideoEditClips(parent, instance.frame).filter(clip => videoEditMulticamSource(instance.document, clip))
  const clip = candidates.find(clip => clip.id === instance.selection) ?? candidates.at(-1)
  const source = clip && videoEditMulticamSource(instance.document, clip)
  return clip && source ? { clip, source } : undefined
}

const logger = createLogger('features.videoEdit.multicam')
export interface VideoEditMulticamTarget { projectId: string; sequenceId: string; clipId: string }
export interface VideoEditMulticamAutoOptions { minimumSeconds?: number; sensitivity?: number; speech?: { startSeconds: number; endSeconds: number; speaker: string }[] }

async function readSyncSound(composition: VideoEditComposition, start: number, duration: number, signal?: AbortSignal): Promise<Float32Array> {
  const renderer = new VideoEditRenderSession(composition, 1)
  const abort = (): void => { void renderer.dispose().catch(() => undefined) }
  signal?.addEventListener('abort', abort, { once: true })
  const output = new Float32Array(Math.floor(duration * VIDEO_EDIT_MULTICAM_SYNC_RATE))
  try {
    for (let second = 0; second < duration; second++) {
      signal?.throwIfAborted()
      const buffer = await renderer.mixAudio(start + second, Math.min(1, duration - second))
      signal?.throwIfAborted()
      output.set(videoEditMulticamDownsample([buffer.getChannelData(0)], buffer.sampleRate).subarray(0, output.length - second * VIDEO_EDIT_MULTICAM_SYNC_RATE), second * VIDEO_EDIT_MULTICAM_SYNC_RATE)
    }
    return output
  } finally { signal?.removeEventListener('abort', abort); await renderer.dispose() }
}

/** Entire asynchronous preparation is isolated; baseline rechecked immediately before the one undoable commit. */
export async function createVideoEditMulticamSource(projectId: string, sequenceId: string, options: VideoEditMulticamCreate, signal?: AbortSignal): Promise<ReturnType<typeof createVideoEditMulticam>> {
  const owner = requireVideoEditInstance(projectId); const baseline = owner.document
  const release = holdVideoEditActivity(projectId, '正在同步多机位')
  const current = (): void => { signal?.throwIfAborted(); if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) throw new Error('同步期间剪辑已有修改或已关闭，请重新创建多机位。') }
  logger.info('开始同步多机位', { event: 'video_edit.multicam.create.start', context: { projectId, cameras: options.cameras.length, sync: options.sync } })
  try {
    current(); let offsets: number[] | undefined
    if (options.sync === 'audio') {
      const prepared = createVideoEditMulticam(baseline, sequenceId, { ...options, sync: 'in_points', cameras: options.cameras.map(camera => ({ ...camera, inPointSeconds: undefined })) })
      const source = videoEditComposition(prepared.document, prepared.sequence.id)
      offsets = [0]; let reference: Float32Array | undefined
      for (const [index, clip] of source.clips.entries()) {
        current()
        const media = source.media.find(media => media.id === source.items.find(item => item.id === clip.itemId)?.mediaId)
        if (media?.hasAudio === false) throw new Error('按声音同步需要每个机位都有声音，请改用入点或时间码。')
        const isolated = { ...source, multicam: undefined, clips: [{ ...clip, start: 0, volume: 1 }], tracks: source.tracks.map(track => ({ ...track, enabled: true, muted: false, solo: false })) }
        const sound = await readSyncSound(isolated, 0, clip.duration / source.fps, signal)
        current()
        if (index === 0) reference = sound
        else offsets.push((await synchronizeVideoEditMulticam(reference!, sound, signal)).seconds)
      }
    }
    current()
    const result = createVideoEditMulticam(baseline, sequenceId, options, offsets)
    editVideoProject(projectId, () => result.document)
    logger.info('多机位源序列已创建', { event: 'video_edit.multicam.create.completed', context: { projectId, sequenceId: result.sequence.id } })
    return result
  } catch (error) { logger.error('多机位同步失败', error, { event: 'video_edit.multicam.create.failed', context: { projectId } }); throw error }
  finally { release() }
}

export function switchVideoEditMulticam(target: VideoEditMulticamTarget, cameraId: string, cutFrame?: number): void {
  editVideoSequence(target.projectId, target.sequenceId, () => changeVideoEditMulticamCamera(requireVideoEditInstance(target.projectId).document, target.sequenceId, target.clipId, cameraId, cutFrame))
}

export async function autoSwitchVideoEditMulticam(target: VideoEditMulticamTarget, options: VideoEditMulticamAutoOptions = {}, signal?: AbortSignal): Promise<string[]> {
  const owner = requireVideoEditInstance(target.projectId); const baseline = owner.document
  const parent = videoEditComposition(baseline, target.sequenceId); const clip = parent.clips.find(clip => clip.id === target.clipId)
  const source = clip && videoEditMulticamSource(baseline, clip)
  if (!clip || !source?.multicam) throw new Error('请选择时间线中的多机位片段。')
  assertVideoEditClipsEditable(parent, [clip.id])
  const current = (): void => { signal?.throwIfAborted(); if (!listVideoEditInstances().includes(owner) || owner.document !== baseline) throw new Error('分析期间剪辑已有修改或已关闭，请重新建议切换。') }
  const release = holdVideoEditActivity(target.projectId, '正在建议多机位切换')
  logger.info('开始建议多机位切换', { event: 'video_edit.multicam.auto.start', context: { projectId: target.projectId, clipId: clip.id } })
  try {
    current()
    const analyses: VideoEditMulticamActivity[] = []
    for (const camera of source.multicam.cameras) {
      current()
      const isolated = { ...parent, clips: [{ ...clip, volume: 1, multicamCameraId: camera.id }], transitions: [], tracks: parent.tracks.map(track => ({ ...track, enabled: true, muted: false, solo: false })), sequences: parent.sequences?.map(sequence => sequence.id === source.id ? { ...sequence, tracks: sequence.tracks.map(track => ({ ...track, enabled: true, muted: false, solo: false })), multicam: { ...source.multicam!, audioCameraId: camera.id } } : sequence) }
      const api = getPlatform().audioEdit.loudness; const id = crypto.randomUUID(); const renderer = new VideoEditRenderSession(isolated, 1)
      const levels: VideoEditMulticamActivity['levels'] = []
      const abort = (): void => { void api.close(id).catch(() => undefined); void renderer.dispose().catch(() => undefined) }
      signal?.addEventListener('abort', abort, { once: true })
      try {
        await api.start(parent.sampleRate, parent.channels, id)
        for (let from = 0; from < clip.duration; from += Math.max(1, Math.round(parent.fps / 2))) {
          current()
          const to = Math.min(clip.duration, from + Math.max(1, Math.round(parent.fps / 2)))
          const buffer = await renderer.mixAudio((clip.start + from) / parent.fps, (to - from) / parent.fps)
          current(); const planes = Array.from({ length: buffer.numberOfChannels }, (_, channel) => buffer.getChannelData(channel))
          await api.append(id, planes)
          let energy = 0
          for (const plane of planes) for (const sample of plane) energy += sample * sample
          levels.push({ startSeconds: from / parent.fps, endSeconds: to / parent.fps, rms: Math.sqrt(energy / (planes.length * buffer.length)) })
        }
        const activity = await api.detectActivity(id, options.sensitivity ?? 50)
        current(); analyses.push({ cameraId: camera.id, activity, levels, speaker: camera.speaker })
      } finally { signal?.removeEventListener('abort', abort); try { await api.close(id) } finally { await renderer.dispose() } }
    }
    const available = (cameraId: string, frame: number): boolean => {
      const camera = source.multicam!.cameras.find(camera => camera.id === cameraId)!; const angle = source.clips.find(value => value.id === camera.clipId)!
      const seconds = clipSourceSeconds(clip, clip.start + frame, parent.fps)
      const fps = source.frameRate.numerator / source.frameRate.denominator
      return seconds >= angle.start / fps && seconds < (angle.start + angle.duration) / fps
    }
    const cuts = suggestVideoEditMulticamCuts(clip.duration, parent.fps, clip.multicamCameraId ?? source.multicam.cameras[0].id, analyses, options.minimumSeconds ?? 2, options.speech).filter(cut => cut.frame === 0 || available(cut.cameraId, cut.frame))
    current(); const next = applyVideoEditMulticamCuts(baseline, target.sequenceId, clip.id, cuts)
    editVideoSequence(target.projectId, target.sequenceId, () => next)
    const ids = next.clips.filter(value => value.itemId === clip.itemId && value.track === clip.track && value.start >= clip.start && value.start < clip.start + clip.duration).map(value => value.id)
    logger.info('多机位切换建议已应用', { event: 'video_edit.multicam.auto.completed', context: { projectId: target.projectId, segments: ids.length } })
    return ids
  } catch (error) { logger.error('多机位切换建议失败', error, { event: 'video_edit.multicam.auto.failed', context: { projectId: target.projectId } }); throw error }
  finally { release() }
}
