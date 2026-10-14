import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import { createVideoEditDocument, videoEditComposition } from '@/core/videoEdit/document'
import { recordingMovieRecipeSchema } from '@/core/screenRecording/movie'
import { recordingProductSteps, recordingStepsHtml, recordingStepsMarkdown, type RecordingProductKind } from '@/core/screenRecording/products'
import { inspectVideoEditMedia, VideoEditRenderSession, waitVideoEditSmartRegions, waitVideoEditTracking, videoEditTrackResults } from '@/features/videoEdit'
import { readRecordingUnderstanding, assertRecordingEditable } from './recordingUnderstandingService'
import { recordingMovieCursorSources } from './recordingMovieSources'
import { buildRecordingMoviePlan } from './recordingMoviePlan'
import { applyRecordingMovieAttention } from './recordingMovieAttention'
import { createRecordingStepImageDocument } from './recordingProductImages'
import { recordingProductLogs } from './recordingProductLogs'

const logger = createLogger('features.screenRecording.products')
export interface RecordingProductExport {
  id: string; sessionId: string; product: RecordingProductKind; state: 'running' | 'completed' | 'cancelled' | 'failed';
  completedSteps: number; steps: Array<{ id: string; title: string; startUs: number; endUs: number }>;
  files: string[]; documentRefs: Array<{ kind: 'documents.document'; id: string }>; warnings: string[]; error?: string; verified: boolean;
}
interface Job { result: RecordingProductExport; directory: string; controller: AbortController; done: Promise<void> }
const jobs = new Map<string, Job>()
const preparing = new Set<string>()
export function recordingProductExports(): RecordingProductExport[] { return [...jobs.values()].map(job => structuredClone(job.result)) }
export function recordingProductExport(id: string): RecordingProductExport { const job = jobs.get(id); if (!job) throw new Error('导出记录不存在，请列出 screen_recording.export。'); return structuredClone(job.result) }
export function recordingProductBusy(id: string): boolean { return preparing.has(id) || [...jobs.values()].some(job => job.result.sessionId === id && job.result.state === 'running') }
export async function cancelRecordingProductExport(id: string): Promise<void> { const job = jobs.get(id); if (!job) throw new Error('导出记录不存在，请重新列出。'); job.controller.abort(); await job.done }
registerApplicationCloseGuard(async () => { for (const job of jobs.values()) if (job.result.state === 'running') { job.controller.abort(); await job.done } })

export async function exportRecordingProduct(sessionId: string, options: { product: RecordingProductKind; stepIds?: string[]; directory?: string }, signal: AbortSignal, progress?: (completed: number, total: number) => void): Promise<RecordingProductExport> {
  if (recordingProductBusy(sessionId)) throw new Error('此会话正在导出，请等待或取消。')
  preparing.add(sessionId)
  try {
    const read = await readRecordingUnderstanding(sessionId), recording = read.content
    assertRecordingEditable(recording)
    const steps = recordingProductSteps(recording, recording.understanding, options.stepIds)
    const platform = getPlatform(), id = crypto.randomUUID(), controller = new AbortController()
    const directory = await platform.system.paths.join(options.directory ?? (await platform.system.paths.appDirectories()).folders.exports, `录制-${options.product}-${id}`)
    const result: RecordingProductExport = { id, sessionId, product: options.product, state: 'running', completedSteps: 0, steps: steps.map(({ id, title, startUs, endUs }) => ({ id, title, startUs, endUs })), files: [], documentRefs: [], warnings: [], verified: false }
    let resolveDone!: () => void
    const job: Job = { result, directory, controller, done: new Promise<void>(resolve => { resolveDone = resolve }) }
    jobs.set(id, job)
    const abort = (): void => controller.abort(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
    const current = async (): Promise<void> => { controller.signal.throwIfAborted(); if ((await readRecordingUnderstanding(sessionId)).meta.revision !== read.meta.revision) throw new Error('导出期间会话已改变，已完成的文件保留，请读取后重新导出。') }
    let renderer: VideoEditRenderSession | undefined
    let frameExport: string | undefined
    logger.info('开始导出录制产物', { event: 'recording.product.start', context: { sessionId, exportId: id, product: options.product, steps: steps.length } })
    try {
      await current(); await platform.system.fs.mkdir(directory)
      const selectedClicks = new Set<string>()
      const draft = createVideoEditDocument(read.meta.name), cursors = await recordingMovieCursorSources(recording, controller.signal, event => {
        if (event.kind !== 'click' || event.phase !== 'down') return
        for (const step of steps) {
          const at = event.monoUs + 120000
          if (!selectedClicks.has(step.id) && at >= step.startUs && at < step.endUs && recording.media.some(media => media.kind === 'screen' && at >= media.monoUs && at < media.monoUs + media.durationUs)) { step.representativeUs = at; selectedClicks.add(step.id) }
        }
      })
      if (!cursors.size) result.warnings.push('没有操作日志，已保留原画面，未添加光标或推近。')
      if (recording.understanding.privacy.candidates.some(candidate => candidate.status === 'pending')) result.warnings.push('存在未确认的隐私候选，导出画面仅对已确认项打码。')
      const selectedMedia = recording.media.filter(media => media.kind === 'screen' && media.durationUs > 0 && steps.some(step => media.monoUs < step.endUs && media.monoUs + media.durationUs > step.startUs))
      for (const source of selectedMedia) {
        await current()
        const media = await inspectVideoEditMedia(source.path, controller.signal)
        const cursor = cursors.get(source.id); if (cursor) media.recordingCursor = cursor
        draft.media.push(media); draft.items.push({ id: crypto.randomUUID(), name: media.name, kind: media.kind, mediaId: media.id })
      }
      // Keep real source time and gaps for documentation; use the shared movie compiler for every visual effect.
      const recipe = recordingMovieRecipeSchema.parse({ trimPauses: false, trimFillers: false, waitSpeed: 1, camera: 'off', normalizeAudio: false, captions: false, steps: false, frame: false })
      // Documentation keeps even accepted mistake ranges: reports must still be able to show the error.
      const plan = buildRecordingMoviePlan(draft, { ...recording, media: selectedMedia }, { ...recording.understanding, candidates: [] }, recipe, read.meta.name)
      if (cursors.size) await applyRecordingMovieAttention(draft, plan.screenSequenceIds, recipe.attention, controller.signal, () => controller.signal.throwIfAborted())
      const composition = videoEditComposition(draft, plan.sequenceIds[0])
      const regions = await waitVideoEditSmartRegions(composition, composition, controller.signal)
      await waitVideoEditTracking(composition, composition, controller.signal)
      renderer = new VideoEditRenderSession(composition); renderer.setSmartRegions(regions); renderer.setTracks(videoEditTrackResults(composition))
      const originUs = Math.min(...selectedMedia.map(media => media.monoUs))
      const frameAt = (us: number): number => Math.max(0, Math.floor((us - originUs) * composition.fps / 1e6))
      const write = async (name: string, bytes: Uint8Array): Promise<string> => {
        await current()
        const path = await platform.system.paths.join(directory, name)
        await platform.system.fs.writeFile(path, bytes, { exclusive: true })
        result.files.push(name)
        const readBytes = await platform.system.fs.readFile(path, { maxBytes: 16 * 1024 * 1024 })
        if (readBytes.length !== bytes.length || readBytes.some((byte, index) => byte !== bytes[index])) throw new Error('导出文件回读不一致，已保留文件，请核对后重试。')
        return path
      }
      for (const [index, step] of steps.entries()) {
        await current()
        if (options.product === 'gif') {
          // Only a contiguous real screen range; pause gaps must not become blank tutorial frames.
          const source = recording.media.find(media => media.kind === 'screen' && step.startUs >= media.monoUs && step.startUs < media.monoUs + media.durationUs)
          if (!source) throw new Error(`步骤“${step.title}”起点没有屏幕原片，请调整步骤边界。`)
          const stop = Math.min(step.endUs, source.monoUs + source.durationUs, step.startUs + 15e6)
          if (stop < step.endUs) result.warnings.push(`“${step.title}”动图只包含起点后首段连续画面（最多 15 秒）。`)
          const fps = 10, frames = Math.max(1, Math.ceil((stop - step.startUs) / 1e6 * fps)), width = 640, height = Math.round(width * composition.height / composition.width)
          const output = new OffscreenCanvas(width, height), ctx = output.getContext('2d', { willReadFrequently: true })!
          const started = await platform.video.startFrameExport({ frameCount: frames, fps, width, height, fileNameStem: 'recording-step', format: 'gif', orientation: 'top-down' }); frameExport = started.sessionId
          for (let frame = 0; frame < frames; frame++) {
            controller.signal.throwIfAborted()
            await renderer.render(frameAt(Math.min(stop - 1, step.startUs + frame / fps * 1e6)), true)
            ctx.drawImage(renderer.canvas, 0, 0, width, height)
            await platform.video.appendFrameExport({ sessionId: frameExport, frameIndex: frame, bytes: new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer) })
          }
          await current()
          const name = step.image.replace(/\.png$/, '.gif'), path = await platform.system.paths.join(directory, name)
          const receipt = await platform.video.finishFrameExport({ sessionId: frameExport, targetPath: path }); frameExport = undefined
          result.files.push(name)
          const info = await platform.video.readVideoInfo(receipt.savedPath)
          if (info.width !== width || info.height !== height || Math.abs(info.durationSeconds - frames / fps) > 1 / fps) throw new Error('动图解码回读的尺寸或时长不一致。')
        } else {
          const at = options.product === 'bug_report' ? Math.max(...recording.media.filter(media => media.kind === 'screen' && media.monoUs < step.endUs && media.monoUs + media.durationUs > step.startUs).map(media => Math.min(step.endUs, media.monoUs + media.durationUs) - 1)) : step.representativeUs
          await renderer.render(frameAt(at), true)
          const path = await write(step.image, new Uint8Array(await (await renderer.canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()))
          if (options.product === 'image_document') {
            await current()
            const documentId = await createRecordingStepImageDocument(step, path, controller.signal)
            result.documentRefs.push({ kind: 'documents.document', id: documentId })
          }
        }
        result.completedSteps = index + 1; progress?.(index + 1, steps.length)
      }
      if (options.product === 'steps' || options.product === 'bug_report') {
        let text = recordingStepsMarkdown(read.meta.name, steps, result.warnings)
        if (options.product === 'bug_report') {
          const logs = await recordingProductLogs(sessionId, read.meta.createdAt, steps, controller.signal)
          result.warnings.push(...logs.warnings)
          text = recordingStepsMarkdown(`${read.meta.name} · 缺陷报告`, steps, result.warnings) + '\n应用日志片段（同一录制时段）\n\n' + logs.text.split('\n').map(line => `    ${line}`).join('\n') + '\n'
        }
        await write(options.product === 'steps' ? 'steps.md' : 'report.md', new TextEncoder().encode(text))
        if (options.product === 'steps') await write('steps.html', new TextEncoder().encode(recordingStepsHtml(read.meta.name, steps, result.warnings)))
      }
      await current(); result.verified = true; result.state = 'completed'
      logger.info('录制产物已导出并回读', { event: 'recording.product.completed', context: { sessionId, exportId: id, files: result.files.length, documents: result.documentRefs.length } })
      return structuredClone(result)
    } catch (error) {
      result.state = controller.signal.aborted ? 'cancelled' : 'failed'
      result.error = typeof error === 'object' && error !== null && 'code' in error ? '保存失败，请检查所选目录可写并确认磁盘空间。' : error instanceof Error ? error.message.replace(/[A-Za-z]:[\\/][^\n"']+/g, '所选文件') : '导出未完成，请检查日志后重试。'
      if (controller.signal.aborted) logger.info('录制产物导出已取消，已发布产物保留', { event: 'recording.product.cancelled', context: { sessionId, exportId: id, completedSteps: result.completedSteps } })
      else logger.error('录制产物导出未完成，已发布产物保留', error, { event: 'recording.product.failed', context: { sessionId, exportId: id, completedSteps: result.completedSteps } })
      if (controller.signal.aborted) return structuredClone(result)
      throw new Error(result.error, { cause: error })
    } finally {
      try { if (frameExport) await platform.video.cancelFrameExport(frameExport) } finally { try { await renderer?.dispose() } finally { signal.removeEventListener('abort', abort); resolveDone() } }
    }
  } finally { preparing.delete(sessionId) }
}
