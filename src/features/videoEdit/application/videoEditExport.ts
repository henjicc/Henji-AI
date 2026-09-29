import { AudioBufferSource, CanvasSource, Mp4OutputFormat, Output, StreamTarget } from 'mediabunny'
import { getPlatform } from '@/platform/runtime'
import { createLogger } from '@/core/logging'
import { videoEditDuration } from '@/core/videoEdit/document'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { publishVideoEdit, requireVideoEditInstance, saveVideoEdit } from './videoEditService'

const logger = createLogger('features.videoEdit.export')
export interface VideoEditExportTask { id: string; projectId: string; revision: number; progress: number; state: 'running' | 'completed' | 'cancelled' | 'failed'; error?: string; controller: AbortController }
const tasks = new Map<string, VideoEditExportTask>()
export function videoEditExportTask(projectId: string): VideoEditExportTask | undefined { return tasks.get(projectId) }
export function cancelVideoEditExport(projectId: string): void { tasks.get(projectId)?.controller.abort() }
export async function exportVideoEdit(projectId: string, requestedPath?: string, background = false): Promise<string | null> {
  const instance = requireVideoEditInstance(projectId)
  if (instance.busy) throw new Error('该工程已有导出任务。')
  const platform = getPlatform()
  const path = requestedPath ?? await platform.system.dialog.save({ defaultPath: `${instance.document.name}.mp4`, filters: [{ name: 'MP4 视频', extensions: ['mp4'] }] })
  if (!path) return null
  if (await platform.system.fs.exists(path)) throw new Error('请选择新的文件名导出，避免覆盖已有文件。')
  await saveVideoEdit(projectId)
  if (instance.busy) throw new Error('该工程已有导出任务。')
  const document = structuredClone(instance.document)
  const task: VideoEditExportTask = { id: crypto.randomUUID(), projectId, revision: document.revision, state: 'running', progress: 0, controller: new AbortController() }
  tasks.set(projectId, task); instance.busy = true; publishVideoEdit()
  const render = async (): Promise<string | null> => {
  const renderer = new VideoEditRenderSession(document)
  let created = false
  const output = new Output({ format: new Mp4OutputFormat(), target: new StreamTarget(new WritableStream({ write: async chunk => { task.controller.signal.throwIfAborted(); await platform.system.fs.writeFile(path, chunk.data, { position: chunk.position }) } }), { chunked: true, chunkSize: 1024 * 1024 }) })
  logger.info('开始导出剪辑', { event: 'video_edit.export.start', context: { projectId, taskId: task.id } })
  try {
    await platform.system.fs.writeFile(path, new Uint8Array(), { exclusive: true }); created = true
    const video = new CanvasSource(renderer.canvas, { codec: 'avc', bitrate: 8_000_000 })
    const audio = new AudioBufferSource({ codec: 'aac', bitrate: 192_000 })
    output.addVideoTrack(video, { frameRate: document.fps }); output.addAudioTrack(audio)
    await output.start()
    const frames = videoEditDuration(document)
    for (let frame = 0; frame < frames; frame++) {
      task.controller.signal.throwIfAborted()
      if (frame % document.fps === 0) await audio.add(await renderer.mixAudio(frame / document.fps, Math.min(1, (frames - frame) / document.fps)))
      await renderer.render(frame, true); await video.add(frame / document.fps, 1 / document.fps)
      task.progress = (frame + 1) / frames
      if (frame % 5 === 0) { publishVideoEdit(); await new Promise(resolve => setTimeout(resolve, 0)) }
    }
    await output.finalize(); task.state = 'completed'
    logger.info('剪辑导出完成', { event: 'video_edit.export.completed', context: { projectId, taskId: task.id, frames } })
    return path
  } catch (error) {
    await output.cancel().catch(() => undefined)
    if (created) await platform.system.fs.remove(path).catch(cleanupError => logger.warn('清理未完成导出失败', { event: 'video_edit.export.cleanup_failed', error: cleanupError }))
    task.state = task.controller.signal.aborted ? 'cancelled' : 'failed'; task.error = error instanceof Error ? error.message : '导出失败'
    if (task.controller.signal.aborted) logger.info('剪辑导出已取消', { event: 'video_edit.export.cancelled', context: { projectId, taskId: task.id } })
    else logger.error('剪辑导出失败', error, { event: 'video_edit.export.failed', context: { projectId, taskId: task.id } })
    if (!task.controller.signal.aborted) throw error
    return null
  } finally { await renderer.dispose(); instance.busy = false; publishVideoEdit() }
  }
  if (background) { void render().catch(() => undefined); return null }
  return render()
}
