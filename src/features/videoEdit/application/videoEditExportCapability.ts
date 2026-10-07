import { VIDEO_EDIT_EXPORT_CAPABILITIES, videoEditExportInputSchema, videoEditExportQuerySchema } from '@/core/application-control/domains/videoEdit/videoEditExportCapabilities'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { cancelVideoEditExport, videoEditExportTask } from './videoEditExport'
import { enqueueVideoEditExports, retryVideoEditExportJob, videoEditExportQueue, type VideoEditExportJob } from './videoEditExportQueue'
import { videoEditExportPresetLibrary } from './videoEditExportPresets'
import { exportVideoEditSubtitles } from './videoEditTimedContent'
import { requireVideoEditInstance } from './videoEditService'
import { patchVideoEditExportSettings, videoEditSequenceExportSettings } from '@/core/videoEdit/exportPresets'
import { videoEditComposition } from '@/core/videoEdit/document'

export function videoEditExportJobSummary(job: VideoEditExportJob): Record<string, unknown> {
  return { id: job.id, documentRef: { kind: 'video_edit.document', id: job.owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${job.owner.document.id}:${job.snapshot.id}` }, name: job.name, presetName: job.presetName, state: job.state, progress: job.state === 'completed' ? 1 : job.task?.progress ?? 0, range: job.range, settings: job.settings,
    outputReady: Boolean(job.task?.output), ...(job.task?.assetRef ? { assetRef: job.task.assetRef } : {}), ...(job.task ? { taskId: job.task.id } : {}), ...(job.error ? { error: job.error } : {}), ...(job.task?.loudnessMeasurement ? { loudnessMeasurement: job.task.loudnessMeasurement } : {}) }
}
export async function handleVideoEditExportCapability(id: string, raw: unknown, context: CapabilityExecutionContext): Promise<Record<string, unknown> | undefined> {
  const definition = VIDEO_EDIT_EXPORT_CAPABILITIES.find(value => value.id === id)
  if (!definition) return undefined
  const parsed = id === 'export_video_edit' ? videoEditExportInputSchema.parse(raw) : videoEditExportQuerySchema.parse(raw)
  const documentRef = parsed.documentRef
  const owner = requireVideoEditInstance(documentRef.id)
  let message = '已读取导出列表，提交不等于完成。'
  let verified = true
  let condition = '已从原剪辑回读导出列表。'
  let submitted: readonly VideoEditExportJob[] | undefined
  if (id === 'export_video_edit') {
    const input = videoEditExportInputSchema.parse(raw)
    if (input.format === 'srt' || input.format === 'vtt') {
      if (input.loudness) throw new Error('响度标准化只适用于视频成片，字幕导出不包含声音。')
      const result = await exportVideoEditSubtitles(documentRef.id, input.format, owner.activeSequenceId, context.signal, input.subtitleClock)
      return { resultRef: documentRef, queue: [], verification: { verified: result.verified, target: documentRef, condition: result.verified ? '已回读字幕文件核对。' : '用户取消文件选择。' }, message: result.saved ? '字幕已导出并核实。' : '已取消字幕导出。' }
    }
    if (input.retryTaskId) {
      const job = videoEditExportQueue.require(input.retryTaskId)
      if (job.owner !== owner) throw new Error('导出项必须属于明确的原剪辑。')
      if (context.callerGrant && job.settings.addToLibrary && !context.callerGrant.permissions.includes('assets:write')) throw new Error('此导出设置要求加入资产库，需要 assets:write 授权；请调整连接授权后重试。')
      context.signal?.throwIfAborted(); retryVideoEditExportJob(job.id); message = '失败项已重新加入队列。'
      submitted = [job]
    } else {
      const requests = input.exports ? input.exports.map(value => {
        const projectId = value.documentRef?.id ?? documentRef.id
        const sequenceId = value.sequenceRef?.id
        if (sequenceId && !sequenceId.startsWith(`${projectId}:`)) throw new Error('sequenceRef 必须属于该项 documentRef，请使用完整序列引用。')
        const target = requireVideoEditInstance(projectId)
        const preset = value.presetRef ? videoEditExportPresetLibrary.list().find(preset => preset.id === value.presetRef!.id) : undefined
        if (value.presetRef && !preset) throw new Error('预设不存在，请列出 video_edit.export_preset 重新选择。')
        const settings = value.settings ?? preset?.settings ?? videoEditSequenceExportSettings(videoEditComposition(target.document, sequenceId?.slice(projectId.length + 1) ?? target.activeSequenceId))
        return { projectId, sequenceId: sequenceId?.slice(projectId.length + 1), presetId: preset?.id, range: value.range, settings: value.fit ? { ...settings, fit: value.fit } : settings }
      }) : [{ projectId: documentRef.id, range: input.range, settings: input.settings ?? patchVideoEditExportSettings(videoEditSequenceExportSettings(videoEditComposition(owner.document, owner.activeSequenceId)), { ...(input.loudness ? { loudness: input.loudness } : {}), ...(input.format ? { format: input.format as 'mp4' | 'aac' | 'wav' } : {}) }) }]
      if (context.callerGrant && requests.some(value => value.settings.addToLibrary) && !context.callerGrant.permissions.includes('assets:write')) throw new Error('加入资产库需要 assets:write 授权；请在导出 settings 中设 addToLibrary=false，或调整连接授权后重试。')
      const jobs = await enqueueVideoEditExports(requests, context.signal)
      submitted = jobs
      verified = jobs.length > 0; message = verified ? `已加入 ${jobs.length} 项导出，请查询队列确认完成。` : '已取消文件选择，未加入任何导出。'
      condition = verified ? '全部输出路径已确认，原序列快照已一次提交到正式队列。' : '用户取消文件选择，未提交任务。'
    }
  } else if (id === 'cancel_video_edit_export') {
    const taskId = 'taskId' in parsed ? parsed.taskId : undefined
    if (taskId) {
      const job = videoEditExportQueue.require(taskId)
      if (job.owner !== owner) throw new Error('导出项必须属于明确的原剪辑。')
      videoEditExportQueue.cancel(job.id)
    } else {
      for (const job of videoEditExportQueue.list().filter(job => job.owner === owner)) videoEditExportQueue.cancel(job.id)
      cancelVideoEditExport(documentRef.id)
    }
    message = '已请求取消未完成导出；已保存文件保留。'
  }
  if (requireVideoEditInstance(documentRef.id) !== owner) throw new Error('原剪辑已关闭，请重新查询。')
  const filterId = id === 'query_video_edit_export' && 'taskId' in parsed ? parsed.taskId : undefined
  const jobs = submitted ?? videoEditExportQueue.list().filter(job => job.owner === owner && (!filterId || job.id === filterId))
  const task = videoEditExportTask(documentRef.id)
  return { resultRef: documentRef, queue: jobs.map(videoEditExportJobSummary), message, verification: { verified, target: documentRef, condition }, ...(task ? { task: { id: task.id, state: task.state, progress: task.progress, revision: task.revision, startFrame: task.startFrame, endFrame: task.endFrame, ...(task.loudness ? { loudness: task.loudness } : {}), ...(task.loudnessMeasurement ? { loudnessMeasurement: task.loudnessMeasurement } : {}) } } : {}) }
}
