import { AudioBufferSource, CanvasSource, Mp4OutputFormat, Output, StreamTarget } from 'mediabunny'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { getActiveVideoEditSequence, listVideoEditInstances, videoEditExportRange, publishVideoEdit, requireVideoEditInstance, saveVideoEdit, type VideoEditInstance } from './videoEditService'
import { publishVideoEditOutput, type VideoEditOutputReceipt } from './videoEditOutputs'

const logger = createLogger('features.videoEdit.export')
/**
 * A frame whose pictures or sound cannot be produced exactly stops the export (task 2.4: never a substitute frame);
 * the user sees where in the sequence and why.
 */
function videoEditExportFrameError(frame: number, fps: number, error: unknown): Error {
  return new Error(`导出在 ${videoEditFrameTimecode(frame, fps)} 处停止。${error instanceof Error ? error.message : String(error)}`, { cause: error })
}
export interface VideoEditExportTask { id: string; projectId: string; sequenceId: string; revision: number; startFrame: number; endFrame: number; progress: number; state: 'running' | 'completed' | 'cancelled' | 'failed'; error?: string; controller: AbortController; output?: VideoEditOutputReceipt }
const tasks = new WeakMap<VideoEditInstance, VideoEditExportTask>()
export function videoEditExportTask(projectId: string): VideoEditExportTask | undefined { return tasks.get(requireVideoEditInstance(projectId)) }
export function cancelVideoEditExport(projectId: string): void { videoEditExportTask(projectId)?.controller.abort() }
export async function exportVideoEdit(projectId: string, requestedPath?: string, background = false, submissionSignal?: AbortSignal): Promise<string | null> {
  submissionSignal?.throwIfAborted()
  const instance = requireVideoEditInstance(projectId)
  const snapshot = structuredClone(getActiveVideoEditSequence(instance))
  const range = videoEditExportRange(instance)
  if (instance.busy) throw new Error('该工程已有导出任务。')
  const platform = getPlatform()
  const path = requestedPath ?? await platform.system.dialog.save({ defaultPath: `${instance.document.name}.mp4`, filters: [{ name: 'MP4 视频', extensions: ['mp4'] }] })
  submissionSignal?.throwIfAborted()
  if (!path) return null
  if (!listVideoEditInstances().includes(instance)) throw new Error('原工程已关闭，请重新选择导出工程。')
  if (await platform.system.fs.exists(path)) throw new Error('请选择新的文件名导出，避免覆盖已有文件。')
  submissionSignal?.throwIfAborted()
  if (!listVideoEditInstances().includes(instance)) throw new Error('原工程已关闭，请重新选择导出工程。')
  await saveVideoEdit(projectId)
  submissionSignal?.throwIfAborted()
  if (!listVideoEditInstances().includes(instance)) throw new Error('原工程已关闭，导出不会写入重新打开的工程。')
  if (instance.busy) throw new Error('该工程已有导出任务。')
  const document = snapshot
  const task: VideoEditExportTask = { id: crypto.randomUUID(), projectId, sequenceId: document.id, revision: document.revision, ...range, state: 'running', progress: 0, controller: new AbortController() }
  tasks.set(instance, task); instance.busy = true; publishVideoEdit()
  const render = async (): Promise<string | null> => {
  let renderer: VideoEditRenderSession | undefined
  let output: Output | undefined
  let created = false
  let published = false
  // Layers a single-frame read decided (the sequential reader's picture was not exact), and where a frame failed.
  let singleFrameReads = 0
  let failedFrame: number | undefined
  const started = performance.now()
  logger.info('开始导出剪辑', { event: 'video_edit.export.start', context: { projectId, taskId: task.id, ...range } })
  try {
    renderer = new VideoEditRenderSession(document)
    output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(new WritableStream({ write: async chunk => { task.controller.signal.throwIfAborted(); await platform.system.fs.writeFile(path, chunk.data, { position: chunk.position }) } }), { chunked: true, chunkSize: 1024 * 1024 }) })
    await platform.system.fs.writeFile(path, new Uint8Array(), { exclusive: true }); created = true
    const video = new CanvasSource(renderer.canvas, { codec: 'avc', bitrate: 8_000_000 })
    const audio = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 })
    output.addVideoTrack(video, { frameRate: document.fps }); output.addAudioTrack(audio)
    await output.start()
    const { startFrame, endFrame } = range; const frames = endFrame - startFrame
    let nextAudioFrame = startFrame
    /** This frame's pictures or sound, exact, or the export stops here with the position in the message. */
    const exact = async <T>(frame: number, work: Promise<T>): Promise<T> => {
      try { return await work } catch (error) { failedFrame = frame; throw task.controller.signal.aborted ? error : videoEditExportFrameError(frame, document.fps, error) }
    }
    for (let frame = startFrame; frame < endFrame; frame++) {
      task.controller.signal.throwIfAborted()
      if (frame === nextAudioFrame) {
        const end = Math.min(endFrame, frame + Math.max(1, Math.round(document.fps)))
        await audio.add(await exact(frame, renderer.mixAudio(frame / document.fps, (end - frame) / document.fps))); nextAudioFrame = end
      }
      singleFrameReads += (await exact(frame, renderer.render(frame, true))).singleFrameReads
      await video.add((frame - startFrame) / document.fps, 1 / document.fps)
      task.progress = (frame - startFrame + 1) / frames
      if (frame % 5 === 0) { publishVideoEdit(); await new Promise(resolve => setTimeout(resolve, 0)) }
    }
    task.controller.signal.throwIfAborted()
    await output.finalize(); published = true; task.state = 'completed'
    task.output = await publishVideoEditOutput({ owner: instance, sequenceId: document.id, revision: document.revision, path, name: `${snapshot.name} · 成片`, kind: 'video' })
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
  } finally { try { await renderer?.dispose() } finally { instance.busy = false; publishVideoEdit() } }
  }
  if (background) { void render().catch(() => undefined); return null }
  return render()
}
