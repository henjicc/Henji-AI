import { VIDEO_EDIT_EXPORT_CAPABILITIES, videoEditExportInputSchema, videoEditExportQuerySchema, videoEditExportTaskInputSchema } from '@/core/application-control/domains/videoEdit/videoEditExportCapabilities'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { cancelVideoEditExport, videoEditExportTask } from './videoEditExport'
import { adoptRestoredVideoEditExports, cancelWaitingVideoEditExport, enqueueVideoEditExports, listWaitingVideoEditExports, retryVideoEditExportJob, videoEditProjectOutputDirectory, videoEditExportJobProgress, videoEditExportQueue, waitForVideoEditExportRestore, type VideoEditExportJob } from './videoEditExportQueue'
import { videoEditExportPresetLibrary } from './videoEditExportPresets'
import { exportVideoEditSubtitles } from './videoEditTimedContent'
import { requireVideoEditInstance } from './videoEditService'
import { resolveConfiguredDestination } from '@/features/canvas/application/canvasDownloadService'
import type { CanvasDownloadDestination } from '@/core/application-control/domains/canvas/canvasExportApplicationCapabilities'
import { patchVideoEditExportSettings, resolveVideoEditExportSettings, videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import { videoEditComposition } from '@/core/videoEdit/document'
import { adaptVideoEditExportPreset } from '../engine/videoEditExportEncoder'
import { ApplicationWriteExecution } from '@/core/application-control/execution/writeExecution'

const RESTORED_NOTICE = '按界面重新加载前提交时的内容导出。'
export function videoEditExportJobSummary(job: VideoEditExportJob): Record<string, unknown> {
  return { id: job.id, documentRef: { kind: 'video_edit.document', id: job.owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${job.owner.document.id}:${job.snapshot.id}` }, name: job.name, presetName: job.presetName, state: job.state, progress: videoEditExportJobProgress(job), range: job.range, settings: job.settings,
    rangeSource: job.rangeSource, outputReady: Boolean(job.task?.output), ...(job.task?.notice ? { notice: job.task.notice } : job.restored ? { notice: RESTORED_NOTICE } : {}), ...(job.task?.assetRef ? { assetRef: job.task.assetRef } : {}), ...(job.task ? { taskId: job.task.id } : {}), ...(job.error ? { error: job.error } : {}), ...(job.task?.loudnessMeasurement ? { loudnessMeasurement: job.task.loudnessMeasurement } : {}) }
}

/** 能力调用没有人点保存对话框：默认放进剪辑所在项目的“导出”文件夹，也可指定已配置的快速下载/预设目录。 */
async function videoEditCapabilityOutputDirectory(projectId: string, destination: CanvasDownloadDestination | undefined): Promise<string> {
  return destination ? resolveConfiguredDestination(destination) : videoEditProjectOutputDirectory(projectId)
}
export async function handleVideoEditExportCapability(id: string, raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown> | undefined> {
  const definition = VIDEO_EDIT_EXPORT_CAPABILITIES.find(value => value.id === id)
  if (!definition) return undefined
  const execution = new ApplicationWriteExecution()
  try {
  await waitForVideoEditExportRestore()
  const parsed = id === 'export_video_edit' ? videoEditExportInputSchema.parse(raw) : id === 'query_video_edit_export' ? videoEditExportQuerySchema.parse(raw) : videoEditExportTaskInputSchema.parse(raw)
  const documentRef = parsed.documentRef
  const owner = requireVideoEditInstance(documentRef.id)
  adoptRestoredVideoEditExports()
  let message = '已读取导出列表，提交不等于完成。'
  let verified = true
  let condition = '已从原剪辑回读导出列表。'
  let submitted: readonly VideoEditExportJob[] | undefined
  if (id === 'export_video_edit') {
    const input = videoEditExportInputSchema.parse(raw)
    if (input.format === 'srt' || input.format === 'vtt') {
      if (input.loudness) throw new Error('响度标准化只适用于视频成片，字幕导出不包含声音。')
      const directory = await videoEditCapabilityOutputDirectory(documentRef.id, input.destination)
      const format = input.format
      const result = await execution.run(() => exportVideoEditSubtitles(documentRef.id, format, owner.activeSequenceId, context.signal, input.subtitleClock, directory))
      return { resultRef: documentRef, queue: [], verification: { verified: result.verified, target: documentRef, condition: result.verified ? '已回读字幕文件核对。' : '用户取消文件选择。' }, message: result.saved ? '字幕已导出并核实。' : '已取消字幕导出。' }
    }
    if (input.retryTaskId) {
      const job = videoEditExportQueue.require(input.retryTaskId)
      if (job.owner !== owner) throw new Error('导出项必须属于明确的原剪辑。')
      if (context.callerGrant && job.settings.addToLibrary && !context.callerGrant.permissions.includes('assets:write')) throw new Error('此导出设置要求加入资产库，需要 assets:write 授权；请调整连接授权后重试。')
      context.signal?.throwIfAborted(); await execution.run(() => retryVideoEditExportJob(job.id)); message = '已按原快照重新加入队列。'
      submitted = [job]
    } else {
      const requests = input.exports ? await Promise.all(input.exports.map(async value => {
        const projectId = value.documentRef?.id ?? documentRef.id
        const sequenceId = value.sequenceRef?.id
        if (sequenceId && !sequenceId.startsWith(`${projectId}:`)) throw new Error('sequenceRef 必须属于该项 documentRef，请使用完整序列引用。')
        const target = requireVideoEditInstance(projectId)
        const preset = value.presetRef ? videoEditExportPresetLibrary.list().find(preset => preset.id === value.presetRef!.id) : undefined
        if (value.presetRef && !preset) throw new Error('预设不存在，请列出 video_edit.export_preset 重新选择。')
        const composition = videoEditComposition(target.document, sequenceId?.slice(projectId.length + 1) ?? target.activeSequenceId)
        const base = value.settings ?? (preset && preset.id !== 'builtin:sequence' ? preset.settings : videoEditSequenceExportSettings(composition))
        const settings = value.settings ? base : await adaptVideoEditExportPreset(resolveVideoEditExportSettings(base, composition))
        return { projectId, loudnessRequested: Boolean(value.settings?.loudness || value.presetRef && value.presetRef.id !== 'builtin:sequence' && preset?.settings.loudness), sequenceId: sequenceId?.slice(projectId.length + 1), presetId: preset?.id, range: value.range, settings: value.fit ? { ...settings, fit: value.fit } : settings, outputDirectory: () => videoEditCapabilityOutputDirectory(projectId, input.destination) }
      })) : [{ projectId: documentRef.id, loudnessRequested: Boolean(input.loudness || input.settings?.loudness), range: input.range, settings: input.settings ?? await adaptVideoEditExportPreset(patchVideoEditExportSettings(videoEditSequenceExportSettings(videoEditComposition(owner.document, owner.activeSequenceId)), { ...(input.loudness ? { loudness: input.loudness } : {}), ...(input.format ? { format: input.format as 'mp4' | 'aac' | 'wav' } : {}) })), outputDirectory: () => videoEditCapabilityOutputDirectory(documentRef.id, input.destination) }]
      if (context.callerGrant && requests.some(value => value.settings.addToLibrary) && !context.callerGrant.permissions.includes('assets:write')) throw new Error('加入资产库需要 assets:write 授权；请在导出 settings 中设 addToLibrary=false，或调整连接授权后重试。')
      const jobs = await execution.run(() => enqueueVideoEditExports(requests, context.signal))
      submitted = jobs
      verified = jobs.length > 0; message = verified ? `已加入 ${jobs.length} 项导出，请查询队列确认完成。` : '已取消文件选择，未加入任何导出。'
      condition = verified ? '全部输出路径已确认，原序列快照已一次提交到正式队列。' : '用户取消文件选择，未提交任务。'
    }
  } else if (id === 'cancel_video_edit_export') {
    const taskId = 'taskId' in parsed ? parsed.taskId : undefined
    if (taskId && listWaitingVideoEditExports(documentRef.id).some(record => record.id === taskId)) {
      await execution.run(() => cancelWaitingVideoEditExport(taskId))
    } else if (taskId) {
      // 队列项与渲染任务各有编号，查询结果两者都给，调用方传哪个都应认
      const job = videoEditExportQueue.list().find(item => item.id === taskId || item.task?.id === taskId) ?? videoEditExportQueue.require(taskId)
      if (job.owner !== owner) throw new Error('导出项必须属于明确的原剪辑。')
      await execution.run(() => videoEditExportQueue.cancel(job.id))
    } else {
      await execution.run(() => {
        for (const job of videoEditExportQueue.list().filter(job => job.owner === owner)) videoEditExportQueue.cancel(job.id)
        for (const record of listWaitingVideoEditExports(documentRef.id)) cancelWaitingVideoEditExport(record.id)
        cancelVideoEditExport(documentRef.id)
      })
    }
    message = '已请求取消未完成导出；已保存文件保留。'
  }
  if (requireVideoEditInstance(documentRef.id) !== owner) throw new Error('原剪辑已关闭，请重新查询。')
  const query = id === 'query_video_edit_export' ? videoEditExportQuerySchema.parse(raw) : undefined
  const filterId = query?.taskId
  const jobs = submitted ?? videoEditExportQueue.list().filter(job => job.owner === owner && (!filterId || job.id === filterId || job.task?.id === filterId))
  const liveIds = new Set(jobs.flatMap(job => [job.id, job.task?.id]))
  const archived = (query && !query.activeOnly ? owner.document.exportHistory ?? [] : []).filter(entry => !liveIds.has(entry.id) && !liveIds.has(entry.taskId) && (!filterId || entry.id === filterId || entry.taskId === filterId))
    .map(({ sequenceId, ...entry }) => ({ ...entry, documentRef, sequenceRef: { kind: 'video_edit.sequence', id: `${documentRef.id}:${sequenceId}` }, state: 'completed', progress: 1, archived: true, outputReady: true }))
  const latestTask = videoEditExportTask(documentRef.id)
  const task = latestTask && (!filterId || latestTask.id === filterId || jobs.some(job => job.task === latestTask)) ? latestTask : undefined
  if (filterId && !jobs.length && !archived.length && !task && !listWaitingVideoEditExports(documentRef.id).some(record => record.id === filterId)) throw new Error('EXPORT_TASK_NOT_FOUND:此剪辑没有匹配的导出任务或归档记录；请省略 taskId 查询可用导出。')
  const queue = jobs.map(job => {
    const entry = owner.document.exportHistory?.find(entry => entry.id === job.id || entry.taskId === job.task?.id)
    return { ...videoEditExportJobSummary(job), ...(entry ? { outputReady: true, path: entry.path, completedAt: entry.completedAt, ...(entry.assetRef ? { assetRef: entry.assetRef } : {}) } : {}) }
  })
  if (query) {
    // 还没接回队列的恢复项（原剪辑刚打开、登记尚在取回）同样可见，状态按排队报告。
    const waiting = listWaitingVideoEditExports(documentRef.id).filter(record => !filterId || record.id === filterId)
      .map(record => ({ id: record.id, documentRef, state: record.state, progress: record.progress, outputReady: false, notice: record.state === 'queued' ? '等原剪辑打开后按界面重新加载前提交的内容继续导出。' : RESTORED_NOTICE, ...(record.error ? { error: record.error } : {}) }))
    const all: Record<string, unknown>[] = [...queue, ...archived, ...waiting]
    if (task && !all.some(item => item.id === task.id || item.taskId === task.id)) all.push({
      id: task.id, taskId: task.id, documentRef, state: task.state, progress: task.progress, outputReady: Boolean(task.output),
      ...(task.notice ? { notice: task.notice } : {}), ...(task.assetRef ? { assetRef: task.assetRef } : {}),
    })
    const filtered = all.filter(item => !query.activeOnly || item.state === 'queued' || item.state === 'running')
      .sort((a, b) => String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0)
    let after: string | undefined
    if (query.cursor) {
      try {
        const cursor: unknown = JSON.parse(decodeURIComponent(query.cursor))
        const value = cursor as { documentId?: unknown; taskId?: unknown; activeOnly?: unknown; after?: unknown }
        if (!value || value.documentId !== documentRef.id || value.taskId !== (query.taskId ?? null) || value.activeOnly !== query.activeOnly || typeof value.after !== 'string') throw new Error()
        after = value.after
      } catch { throw new Error('INVALID_INPUT:cursor 不属于当前查询，请保持原筛选条件或从首页开始。') }
    }
    const remaining = after === undefined ? filtered : filtered.filter(item => String(item.id) > after!)
    const page = remaining.slice(0, query.limit)
    const projected = page.map(item => {
      const { id, state, progress, outputReady, taskId, error, notice, assetRef, completedAt, archived } = item
      const summary = { id, documentRef, state, progress, outputReady,
        resultRef: { documentRef, taskId: String(id) },
        ...(taskId ? { taskId } : {}), ...(error ? { error } : {}), ...(notice ? { notice } : {}),
        ...(assetRef ? { assetRef } : {}), ...(completedAt ? { completedAt } : {}), ...(archived ? { archived } : {}),
      }
      return query.detail === 'full' ? { ...item, ...summary } : summary
    })
    const nextCursor = remaining.length > page.length ? encodeURIComponent(JSON.stringify({ documentId: documentRef.id, taskId: query.taskId ?? null, activeOnly: query.activeOnly, after: String(page[page.length - 1].id) })) : null
    return { resultRef: documentRef, queue: projected, total: filtered.length, nextCursor, message, verification: { verified, target: documentRef, condition } }
  }
  return { resultRef: documentRef, queue: [...queue, ...archived], message, verification: { verified, target: documentRef, condition }, ...(task ? { task: { id: task.id, state: task.state, progress: task.progress, revision: task.revision, startFrame: task.startFrame, endFrame: task.endFrame, ...(task.notice ? { notice: task.notice } : {}), ...(task.loudness ? { loudness: task.loudness } : {}), ...(task.loudnessMeasurement ? { loudnessMeasurement: task.loudnessMeasurement } : {}) } } : {}) }
  } catch (error) { throw definition.readOnly ? error : execution.failure(error) }
}
