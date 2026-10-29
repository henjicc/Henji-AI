import type { OperationRecord } from './operationStore'
import type { GenerationHistoryStatusDto } from '../generation-history/store'
import type { AudioEditStoredTask } from '../audio-edit/task-store'
import { applicationGenerationTaskId, applicationInvocationId } from '../../../../src/core/application-control/operationIdentity'
import type { WebReplayJobSnapshot } from '../web-replay/renderJobs'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { capabilityVerificationEnvelope } from '../../../../src/core/application-control/capabilityVerification'
import { webReplayRenderOutput } from '../../../../src/core/webReplay/renderResult'
import { REJECTED_BEFORE_WRITE_ERROR_NAMES } from '../../../../src/core/application-control/execution/rejectionErrors'
import type { VideoEditExportJobRecord } from '../../../../src/platform/contracts/videoEditExport'

/** 宿主当前的修订号；恢复回执沿用它，避免对外发出缺字段的结果。 */
export interface HostRevisionSnapshot { revision: number; scopeRevisions: Record<string, number> }

/** 导出提交的回执与编码任务分开：查询时用主进程登记刷新队列，重载不重提导出。 */
export function recoverPersistedVideoEditExportOperation(
  listJobs: () => VideoEditExportJobRecord[], record: OperationRecord,
  currentRevisions?: () => HostRevisionSnapshot | undefined,
  rendererAwaiting?: (record: OperationRecord) => boolean,
): OperationRecord | undefined {
  if (record.capabilityId !== 'export_video_edit' || !['unknown', 'executing', 'completed'].includes(record.state)) return undefined
  if (record.state === 'executing' && rendererAwaiting?.(record)) return undefined
  const previous = object(record.result?.data)
  const rows = Array.isArray(previous.queue) ? previous.queue.map(object) : []
  const jobs = listJobs().filter(job => job.invocationIds?.includes(applicationInvocationId(record.callerId, record.operationId)) || rows.some(row => row.id === job.id))
  const revisions = resolveRevisions(record, currentRevisions)
  if (!jobs.length || !revisions) return undefined
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('export_video_edit')!
  const input = definition.inputSchema.safeParse(record.input)
  if (!input.success) return undefined
  const documentRef = record.input.documentRef
  const queue = jobs.map(job => {
    const payload = object(job.payload)
    const { error: _error, notice: _notice, ...previousRow } = rows.find(row => row.id === job.id) ?? {}
    let snapshot: Record<string, unknown> = {}
    try { snapshot = object(JSON.parse(job.snapshotJson ?? '{}')) } catch { /* 缺失快照时由正式输出契约拒绝恢复。 */ }
    return { ...previousRow, id: job.id, documentRef: { kind: 'video_edit.document', id: job.projectId }, sequenceRef: { kind: 'video_edit.sequence', id: `${job.projectId}:${snapshot.id}` },
      name: job.name, presetName: job.presetName, state: job.state, progress: job.progress, range: payload.range, settings: payload.settings, rangeSource: payload.rangeSource,
      outputReady: job.outputPublished, ...(job.outputPublished ? { path: payload.path } : {}), ...(job.error ? { error: job.error } : {}),
      ...(job.state === 'interrupted' ? { notice: `已中断，可用 retryTaskId=${job.id} 按原快照重试。` } : {}) }
  })
  const output = definition.outputSchema.safeParse({ resultRef: documentRef, queue, message: queue.some(job => job.state === 'interrupted') ? '导出已中断，可按原快照重试。' : queue.every(job => job.state === 'completed') ? '导出已完成。' : '已从主进程登记读取导出状态。',
    verification: { verified: true, target: documentRef, condition: '已从主进程导出登记核对原任务。' } })
  if (!output.success) return undefined
  const data = capabilityVerificationEnvelope(definition, input.data, { ...object(output.data), ...revisions })
  return { ...record, state: 'completed', verificationState: 'verified', confirmation: undefined,
    result: { ok: true, data, resultingRevision: revisions.revision, resultingScopeRevisions: revisions.scopeRevisions } }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** A lost renderer receipt cannot prove caption mutation, but the native ASR receipt proves submission/results. */
export function recoverPersistedTranscriptionOperation(
  findTask: (id: string) => (AudioEditStoredTask & { document_id: string }) | undefined,
  record: OperationRecord,
): OperationRecord | undefined {
  if (record.state !== 'unknown' || !record.requestId || !['generate_video_edit_subtitles', 'transcribe_audio_edit'].includes(record.capabilityId ?? '')) return undefined
  const task = findTask(record.requestId)
  if (!task) return undefined
  const result = task.result_json ? object(JSON.parse(task.result_json)) : {}
  const notExecuted = !task.provider_task_id && (result.billing === 'not_charged' || task.error_message?.startsWith('[native_upload_unsupported]'))
  const billing = notExecuted ? 'not_charged' : result.output ? 'completed' : task.provider_task_id ? 'submitted' : 'unknown'
  const audioDocumentRef = { kind: 'audio_edit.document', id: task.document_id }
  return { ...record, state: notExecuted ? 'not_executed' : 'unknown', verificationState: notExecuted ? 'verified' : 'unresolved',
    result: { ok: false, error: { code: 'CAPABILITY_REJECTED', recoverable: true,
      message: notExecuted ? '识别在提交前失败，未计费；修复原因后复用原口播继续。' : '宿主重载中断回执；已核对原识别任务，字幕是否写入仍需核对，禁止重复提交识别。',
      details: { execution: { notExecuted, billing, targetMutation: notExecuted ? 'none' : 'unknown', audioDocumentId: task.document_id },
        recovery: { audioDocumentRef, replayRecognition: false } } } } }
}

/**
 * 取本次回执该带的修订号：优先沿用原回执，其次用宿主当前快照。
 *
 * 能力的公开输出 schema 把 `revision` / `scopeRevisions` 列为必填（`capabilityOutputSchema`
 * 给每个能力都加了这两项）。这里重建回执时漏掉它们，按 schema 校验的标准 MCP 客户端
 * 会直接拒收整条结果——外部客户端因此完全用不了付费生成，而 Pi 不做 schema 校验，
 * 所以这条一直没被发现。两个来源都拿不到时宁可不重建，也不发一条违反自己契约的回执。
 */
function resolveRevisions(record: OperationRecord, current?: () => HostRevisionSnapshot | undefined): HostRevisionSnapshot | undefined {
  const previous = object(object(record.result).data)
  if (typeof previous.revision === 'number' && previous.scopeRevisions && typeof previous.scopeRevisions === 'object') {
    return { revision: previous.revision, scopeRevisions: previous.scopeRevisions as Record<string, number> }
  }
  const envelope = object(record.result)
  if (typeof envelope.resultingRevision === 'number' && envelope.resultingScopeRevisions && typeof envelope.resultingScopeRevisions === 'object') {
    return { revision: envelope.resultingRevision, scopeRevisions: envelope.resultingScopeRevisions as Record<string, number> }
  }
  return current?.()
}

/** 启动和查询仅核对本地正式行，不提交模型请求，也不重新执行创建。 */
export function recoverPersistedGenerationOperation(
  findHistory: (taskId: string) => GenerationHistoryStatusDto | null,
  record: OperationRecord,
  currentRevisions?: () => HostRevisionSnapshot | undefined,
): OperationRecord | undefined {
  if (record.capabilityId !== 'create_visible_generation_task' || !['unknown', 'completed'].includes(record.state)) return undefined
  const task = findHistory(applicationGenerationTaskId(applicationInvocationId(record.callerId, record.operationId)))
  if (!task) return undefined
  const revisions = resolveRevisions(record, currentRevisions)
  if (!revisions) return undefined
  const target = { kind: 'generation.task', id: task.id }
  return { ...record, state: 'completed', verificationState: 'verified', targetRefs: [target],
    result: { ok: true, resultingRevision: revisions.revision, resultingScopeRevisions: revisions.scopeRevisions,
      data: { taskId: task.id, status: 'submitted', taskRef: target,
        revision: revisions.revision, scopeRevisions: revisions.scopeRevisions,
        observedStatus: task.status, serverTaskId: task.taskId,
        ...(task.hasResult ? { resultRef: { kind: 'generation.result', id: task.id } } : {}),
        verification: { verified: true, condition: '原任务已由正式历史主键核对；尚未执行的排队任务不会自动提交', target } } } }
}

/** 应用操作在主进程登记网页重演时用的任务标识，与渲染层收到的操作标识相同。 */
export function webReplayJobIdOf(record: Pick<OperationRecord, 'callerId' | 'operationId'>): string {
  return applicationInvocationId(record.callerId, record.operationId)
}

/**
 * 网页重演由主进程执行，渲染层重载只丢了回执。按操作标识查主进程的重演登记：还在排队或跑就是执行中；
 * 跑完了用登记的结果按正常回执的同一形状重建；写盘前就结束（被拒、被取消）是未执行；其余失败仍待核对。
 * 不重新执行任何东西，登记里找不到（应用重启过）、发起它的页面仍在等回执、或暂时拿不到宿主修订号时不改动。
 */
export function recoverPersistedWebReplayOperation(
  findJob: (jobId: string) => WebReplayJobSnapshot | undefined,
  record: OperationRecord,
  currentRevisions?: () => HostRevisionSnapshot | undefined,
  rendererAwaiting?: (record: OperationRecord) => boolean,
): OperationRecord | undefined {
  if (record.capabilityId !== 'render_web_app_replay' || !['unknown', 'executing'].includes(record.state)) return undefined
  const job = findJob(webReplayJobIdOf(record))
  // 发起它的页面还在等时，它的回执马上就到，账本以它为准
  if (!job || (record.state === 'executing' && rendererAwaiting?.(record))) return undefined
  if (job.state === 'queued' || job.state === 'running') {
    return record.state === 'executing' ? undefined : { ...record, state: 'executing', verificationState: 'unresolved', confirmation: undefined }
  }
  if (job.state === 'completed' && job.result) {
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('render_web_app_replay')
    const input = definition?.inputSchema.safeParse(record.input)
    const revisions = resolveRevisions(record, currentRevisions)
    if (!definition || !input?.success || !revisions) return undefined
    const { recordingRef, pointer } = input.data as { recordingRef: { id: string }; pointer: boolean }
    const output = definition.outputSchema.safeParse({ ...webReplayRenderOutput(recordingRef.id, pointer, job.result), revision: revisions.revision, scopeRevisions: revisions.scopeRevisions })
    if (!output.success) return undefined
    const data = capabilityVerificationEnvelope(definition, input.data, output.data as Record<string, unknown>)
    const verified = (data.verification as { verified?: boolean } | undefined)?.verified === true
    return { ...record, state: 'completed', verificationState: verified ? 'verified' : 'unresolved', confirmation: undefined,
      result: { ok: true, data, resultingRevision: revisions.revision, resultingScopeRevisions: revisions.scopeRevisions } }
  }
  const notExecuted = job.state === 'cancelled' || REJECTED_BEFORE_WRITE_ERROR_NAMES.has(job.error?.name ?? '')
  // 渲染层还在时它已经按自己收到的错误记了账，不用登记里的覆盖
  if (!notExecuted && record.state === 'unknown' && record.result) return undefined
  return { ...record, state: notExecuted ? 'not_executed' : 'unknown', verificationState: notExecuted ? 'verified' : 'unresolved', confirmation: undefined,
    result: { ok: false, error: { code: 'CAPABILITY_REJECTED', recoverable: true, message: job.error?.message ?? '网页重演没有完成。',
      details: notExecuted ? { execution: { notExecuted: true } } : {} } } }
}
