import { AdtsOutputFormat, AudioBufferSource, CanvasSource, Mp4OutputFormat, WavOutputFormat, Output, StreamTarget } from 'mediabunny'
import { BLACK_HEX } from '@/core/theme/colorTokens'
import { videoEditExportEncoding, videoEditExportGeometry, videoEditExportSettingsSchema, type VideoEditExportSettings } from '@/core/videoEdit/exportPresets'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { videoEditLoudnessSettingsSchema, type VideoEditLoudnessSettings, type VideoEditLoudnessMeasurement } from '@/core/videoEdit/loudness'
import { spoolVideoEditAudio } from './videoEditLoudness'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { getActiveVideoEditSequence, listVideoEditInstances, videoEditExportRange, publishVideoEdit, requireVideoEditInstance, saveVideoEdit, type VideoEditInstance } from './videoEditService'
import { publishVideoEditOutput, type VideoEditOutputReceipt } from './videoEditOutputs'
import { videoEditSmartRegionSegments, waitVideoEditSmartRegions } from './videoEditSmartRegions'
import { videoEditTrackResults, waitVideoEditTracking } from './videoEditTracking'

const logger = createLogger('features.videoEdit.export')
/**
 * A frame whose pictures or sound cannot be produced exactly stops the export (task 2.4: never a substitute frame);
 * the user sees where in the sequence and why.
 */
function videoEditExportFrameError(frame: number, fps: number, error: unknown): Error {
  return new Error(`导出在 ${videoEditFrameTimecode(frame, fps)} 处停止。${error instanceof Error ? error.message : String(error)}`, { cause: error })
}
export interface VideoEditExportTask { id: string; projectId: string; sequenceId: string; revision: number; startFrame: number; endFrame: number; progress: number; state: 'running' | 'completed' | 'cancelled' | 'failed'; error?: string; controller: AbortController; output?: VideoEditOutputReceipt; loudness?: VideoEditLoudnessSettings; loudnessMeasurement?: VideoEditLoudnessMeasurement }
const tasks = new WeakMap<VideoEditInstance, VideoEditExportTask>()
export function videoEditExportTask(projectId: string): VideoEditExportTask | undefined { return tasks.get(requireVideoEditInstance(projectId)) }
export function cancelVideoEditExport(projectId: string): void { videoEditExportTask(projectId)?.controller.abort() }
export interface VideoEditExportOptions {
  snapshot: VideoEditComposition
  range: { startFrame: number; endFrame: number }
  settings: VideoEditExportSettings
  signal?: AbortSignal
  onTask?: (task: VideoEditExportTask) => void
}
export async function exportVideoEdit(projectId: string, requestedPath?: string, background = false, submissionSignal?: AbortSignal, loudnessSettings?: VideoEditLoudnessSettings, options?: VideoEditExportOptions): Promise<string | null> {
  submissionSignal?.throwIfAborted()
  const loudness = loudnessSettings === undefined ? undefined : videoEditLoudnessSettingsSchema.parse(loudnessSettings)
  const instance = requireVideoEditInstance(projectId)
  const snapshot = structuredClone(options?.snapshot ?? getActiveVideoEditSequence(instance))
  const range = options?.range ?? videoEditExportRange(instance)
  const settings = options ? videoEditExportSettingsSchema.parse(options.settings) : undefined
  const format = settings?.format ?? 'mp4'
  if (instance.busy) throw new Error('该剪辑已有导出任务。')
  const platform = getPlatform()
  const path = requestedPath ?? await platform.system.dialog.save({ defaultPath: `${instance.document.name}.${format}`, filters: [{ name: format.toUpperCase(), extensions: [format] }] })
  submissionSignal?.throwIfAborted()
  if (!path) return null
  if (!listVideoEditInstances().includes(instance)) throw new Error('原剪辑已关闭，请重新选择导出剪辑。')
  if (await platform.system.fs.exists(path)) throw new Error('请选择新的文件名导出，避免覆盖已有文件。')
  submissionSignal?.throwIfAborted()
  if (!listVideoEditInstances().includes(instance)) throw new Error('原剪辑已关闭，请重新选择导出剪辑。')
  await saveVideoEdit(projectId)
  submissionSignal?.throwIfAborted()
  if (!listVideoEditInstances().includes(instance)) throw new Error('原剪辑已关闭，导出不会写入重新打开的剪辑。')
  if (instance.busy) throw new Error('该剪辑已有导出任务。')
  const document = snapshot
  const task: VideoEditExportTask = { id: crypto.randomUUID(), projectId, sequenceId: document.id, revision: document.revision, ...range, state: 'running', progress: 0, controller: new AbortController() }
  task.loudness = loudness
  tasks.set(instance, task); instance.busy = true; publishVideoEdit()
  const abort = (): void => task.controller.abort()
  options?.signal?.addEventListener('abort', abort, { once: true })
  if (options?.signal?.aborted) abort()
  options?.onTask?.(task)
  const render = async (): Promise<string | null> => {
  let renderer: VideoEditRenderSession | undefined
  let soundSession: string | undefined
  const loudnessApi = platform.audioEdit.loudness
  const cancelSound = (): void => { if (soundSession) void loudnessApi.close(soundSession).catch(() => undefined) }
  let output: Output | undefined
  let created = false
  let published = false
  // Layers a single-frame read decided (the sequential reader's picture was not exact), and where a frame failed.
  let singleFrameReads = 0
  let failedFrame: number | undefined
  const started = performance.now()
  logger.info('开始导出剪辑', { event: 'video_edit.export.start', context: { projectId, taskId: task.id, ...range } })
  try {
    // 智能区域（4.7d）：导出用到的区域先全部分析完成，导出画面与预览同一份蒙版。
    await waitVideoEditSmartRegions(document, document, task.controller.signal)
    await waitVideoEditTracking(document, document, task.controller.signal)
    renderer = new VideoEditRenderSession(document)
    renderer.setSmartRegions(videoEditSmartRegionSegments())
    renderer.setTracks(videoEditTrackResults(document))
    if (loudness) {
      soundSession = await spoolVideoEditAudio(document, range, task.controller.signal, renderer)
      task.controller.signal.addEventListener('abort', cancelSound, { once: true })
      task.controller.signal.throwIfAborted()
      task.loudnessMeasurement = await loudnessApi.normalize(soundSession, loudness)
      task.controller.signal.throwIfAborted()
    }
    output = new Output({ format: format === 'wav' ? new WavOutputFormat() : format === 'aac' ? new AdtsOutputFormat() : new Mp4OutputFormat(), target: new StreamTarget(new WritableStream({ write: async chunk => { task.controller.signal.throwIfAborted(); await platform.system.fs.writeFile(path, chunk.data, { position: chunk.position }) } }), { chunked: true, chunkSize: 1024 * 1024 }) })
    await platform.system.fs.writeFile(path, new Uint8Array(), { exclusive: true }); created = true
    const encoding = settings ? videoEditExportEncoding(settings, document.fps) : { fps: document.fps, videoBitrate: 8_000_000, audioBitrate: 192_000, audioCodec: 'aac' as const }
    const adapted = settings && format === 'mp4' ? new OffscreenCanvas(settings.width, settings.height) : undefined
    const geometry = settings ? videoEditExportGeometry(document.width, document.height, settings) : undefined
    const video = format === 'mp4' ? new CanvasSource(adapted ?? renderer.canvas, { codec: 'avc', bitrate: encoding.videoBitrate }) : undefined
    const audio = new AudioBufferSource({ codec: encoding.audioCodec, ...(format === 'wav' ? {} : { bitrate: encoding.audioBitrate }) })
    if (video) output.addVideoTrack(video, { frameRate: encoding.fps })
    output.addAudioTrack(audio)
    await output.start()
    const { startFrame, endFrame } = range; const frames = endFrame - startFrame
    const videoFrames = Math.ceil(frames / document.fps * encoding.fps - 1e-7)
    /** This frame's pictures or sound, exact, or the export stops here with the position in the message. */
    const exact = async <T>(frame: number, work: Promise<T>): Promise<T> => {
      try { return await work } catch (error) { failedFrame = frame; throw task.controller.signal.aborted ? error : videoEditExportFrameError(frame, document.fps, error) }
    }
    // Audio advances by sequence time independently from output FPS. This prevents
    // duplicated or missing sound when converting fractional/high frame rates.
    let audioFrame = startFrame
    const addSoundUntil = async (limit: number): Promise<void> => {
      while (audioFrame < limit) {
      const frame = audioFrame
      task.controller.signal.throwIfAborted()
        const end = Math.min(endFrame, frame + Math.max(1, Math.round(document.fps)))
        const mix = async (): Promise<AudioBuffer> => {
          if (!soundSession) return renderer!.mixAudio(frame / document.fps, (end - frame) / document.fps)
          const first = Math.ceil(frame / document.fps * document.sampleRate - 1e-7)
          const last = Math.ceil(end / document.fps * document.sampleRate - 1e-7)
          const origin = Math.ceil(startFrame / document.fps * document.sampleRate - 1e-7)
          const channels = await loudnessApi.read(soundSession, first - origin, last - first)
          const buffer = new AudioBuffer({ numberOfChannels: document.channels, sampleRate: document.sampleRate, length: last - first })
          channels.forEach((channel, index) => buffer.getChannelData(index).set(channel)); return buffer
        }
        await audio.add(await exact(frame, mix())); audioFrame = end
      }
    }
    const steps = video ? videoFrames : Math.ceil(frames / Math.max(1, Math.round(document.fps)))
    for (let index = 0; index < steps; index++) {
      const frame = video ? Math.min(endFrame - 1, startFrame + Math.floor(index * document.fps / encoding.fps + 1e-7)) : audioFrame
      task.controller.signal.throwIfAborted()
      await addSoundUntil(Math.min(endFrame, frame + 1))
      if (video) {
        singleFrameReads += (await exact(frame, renderer.render(frame, true))).singleFrameReads
        if (adapted && geometry) {
          const ctx = adapted.getContext('2d')!
          ctx.fillStyle = BLACK_HEX; ctx.fillRect(0, 0, adapted.width, adapted.height)
          const s = geometry.source; const d = geometry.destination
          ctx.drawImage(renderer.canvas, s.x, s.y, s.width, s.height, d.x, d.y, d.width, d.height)
        }
        await video.add(index / encoding.fps, Math.min(1 / encoding.fps, frames / document.fps - index / encoding.fps))
      }
      task.progress = (index + 1) / steps
      if (index % 5 === 0) { publishVideoEdit(); await new Promise(resolve => setTimeout(resolve, 0)) }
    }
    await addSoundUntil(endFrame)
    task.controller.signal.throwIfAborted()
    await output.finalize(); published = true; task.state = 'completed'
    task.output = await publishVideoEditOutput({ owner: instance, sequenceId: document.id, revision: document.revision, path, name: `${snapshot.name} · ${format === 'mp4' ? '成片' : '声音'}`, kind: format === 'mp4' ? 'video' : 'audio' })
    logger.info('剪辑导出完成', { event: 'video_edit.export.completed', context: { projectId, taskId: task.id, frames, singleFrameReads, elapsedMs: Math.round(performance.now() - started) } })
    return path
  } catch (error) {
    if (published) {
      task.error = '成片已保存，但输出来源核验未完成，请从已导出的文件引用素材。'
      logger.warn('成片已发布，来源核验未完成，保留输出文件', { event: 'video_edit.export.receipt_failed', error, context: { projectId, taskId: task.id } })
      throw new Error(task.error)
    }
    await output?.cancel().catch(() => undefined)
    if (created) await platform.system.fs.remove(path).catch(cleanupError => logger.warn('清理未完成导出失败', { event: 'video_edit.export.cleanup_failed', error: cleanupError }))
    task.state = task.controller.signal.aborted ? 'cancelled' : 'failed'; task.error = error instanceof Error ? error.message : '导出失败'
    if (task.controller.signal.aborted) logger.info('剪辑导出已取消', { event: 'video_edit.export.cancelled', context: { projectId, taskId: task.id } })
    else logger.error('剪辑导出失败', error, { event: 'video_edit.export.failed', context: { projectId, taskId: task.id, ...(failedFrame !== undefined ? { frame: failedFrame } : {}), singleFrameReads, elapsedMs: Math.round(performance.now() - started) } })
    if (!task.controller.signal.aborted) throw error
    return null
  } finally {
    task.controller.signal.removeEventListener('abort', cancelSound)
    options?.signal?.removeEventListener('abort', abort)
    try { if (soundSession) await loudnessApi.close(soundSession) } finally { try { await renderer?.dispose() } finally { instance.busy = false; publishVideoEdit() } }
  }
  }
  if (background) { void render().catch(() => undefined); return null }
  return render()
}
