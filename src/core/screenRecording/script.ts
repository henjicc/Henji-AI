import { z } from 'zod'
import { videoEditDocumentSchema } from '../videoEdit/document'
import type { CaptureEvent } from '../captureLog/events'
import type { RecordingUnderstanding } from './understanding'

// A deliberately finite vocabulary: no code, paths, arbitrary properties or paid operations.
export const recordingOperationSchema = z.object({
  target: z.object({ kind: z.enum(['video_edit.clip', 'video_edit.sequence']), id: z.string().min(1) }).strict(),
  properties: z.object({
    'video_edit.clip.x': z.number().finite().optional(), 'video_edit.clip.y': z.number().finite().optional(),
    'video_edit.clip.scale': z.number().positive().optional(), 'video_edit.clip.rotation': z.number().finite().optional(),
    'video_edit.clip.opacity': z.number().min(0).max(1).optional(),
    'video_edit.sequence.name': z.string().min(1).max(120).optional(),
    'video_edit.sequence.width': z.number().int().min(2).max(8192).optional(),
    'video_edit.sequence.height': z.number().int().min(2).max(8192).optional(),
  }).strict().refine(v => Object.keys(v).length > 0),
}).strict().refine(v => Object.keys(v.properties).every(key => key.startsWith(`${v.target.kind}.`)))
export type RecordingOperation = z.infer<typeof recordingOperationSchema>
export const recordingCallSchema = z.object({ callId: z.string().uuid(), operations: z.array(recordingOperationSchema).min(1).max(64) }).strict()
export const recordingBaselineSchema = z.object({ documentId: z.string().min(1), content: videoEditDocumentSchema }).strict().refine(v => v.documentId === v.content.id, '快照归属不符')
export const recordingScriptStepSchema = z.object({
  id: z.string().min(1), title: z.string().min(1).max(120), startUs: z.number().int().nonnegative(), endUs: z.number().int().positive(),
  operations: z.array(recordingOperationSchema).max(256), narrationIds: z.array(z.string()).max(1000),
  wait: z.object({ kind: z.literal('capability_completed'), settleMs: z.number().int().min(100).max(10000) }).strict(),
  blockedReason: z.string().max(1000).nullable(),
}).strict().refine(v => v.endUs > v.startUs)
export const recordingScriptSchema = z.object({ steps: z.array(recordingScriptStepSchema).max(20000) }).strict().superRefine((value, ctx) => {
  const ids = new Set<string>()
  value.steps.forEach((step, i) => {
    if (ids.has(step.id) || i > 0 && step.startUs < value.steps[i - 1].endUs) ctx.addIssue({ code: 'custom', path: ['steps', i], message: '步骤须按时间排序、不重叠且标识唯一' })
    ids.add(step.id)
  })
})
export type RecordingScript = z.infer<typeof recordingScriptSchema>
export const recordingScriptCaptureSchema = z.object({ baselines: z.array(recordingBaselineSchema).max(16), calls: z.array(recordingCallSchema).max(20000) }).strict()
export type RecordingScriptCapture = z.infer<typeof recordingScriptCaptureSchema>

export function captureRecordingOperations(capabilityId: string, input: unknown): RecordingOperation[] | null {
  if (capabilityId !== 'change_application_entities') return null
  const parsed = z.object({ changes: z.array(z.object({ kind: z.literal('set_properties'), target: recordingOperationSchema.shape.target.extend({ label: z.string().optional(), revision: z.number().int().nonnegative().optional() }), entityType: z.string().optional(), properties: recordingOperationSchema.shape.properties }).strict()).min(1).max(32), summary: z.string().optional(), expectedRevisions: z.record(z.string(), z.number().int().nonnegative()).optional() }).strict().safeParse(input)
  if (!parsed.success) return null
  const operations = z.array(recordingOperationSchema).safeParse(parsed.data.changes.map(({ target, properties }) => ({ target: { kind: target.kind, id: target.id }, properties })))
  return operations.success ? operations.data : null
}
export function generateRecordingScript(understanding: RecordingUnderstanding, events: CaptureEvent[], capture: RecordingScriptCapture, ignored: ReadonlySet<string> = new Set()): RecordingScript {
  const baselineIds = new Set(capture.baselines.map(v => v.documentId))
  const calls = new Map(capture.calls.map(call => [call.callId, call.operations]))
  const ends = new Map(events.filter(v => v.kind === 'capability' && v.phase !== 'started').map(v => [v.kind === 'capability' ? v.callId : '', v]))
  const orderedStarts = events.filter(v => v.kind === 'capability' && v.phase === 'started' && !ignored.has(v.capability)).sort((a, b) => a.monoUs - b.monoUs)
  let cursor = 0
  return recordingScriptSchema.parse({ steps: understanding.steps.map(step => {
    while (cursor < orderedStarts.length && orderedStarts[cursor].monoUs < step.startUs) cursor++
    const starts: CaptureEvent[] = []
    while (cursor < orderedStarts.length && orderedStarts[cursor].monoUs < step.endUs) starts.push(orderedStarts[cursor++])
    const operations: RecordingOperation[] = []
    let blockedReason: string | null = starts.length ? null : '此步骤没有可重放的应用操作，请重新录制受支持的剪辑操作。'
    for (const event of starts) {
      if (event.kind !== 'capability') continue
      const end = ends.get(event.callId), input = calls.get(event.callId)
      if (!input || end?.kind !== 'capability' || end.phase !== 'completed') blockedReason = '此步骤含未完成、付费或尚不支持隔离重放的操作；不会自动再次执行。'
      else {
        operations.push(...input)
        if (input.some(operation => !baselineIds.has(operation.target.id.split(':')[0]))) blockedReason = '此步骤缺少操作前快照，请重新录制。'
      }
    }
    return { id: step.id, title: step.title, startUs: step.startUs, endUs: step.endUs, operations, blockedReason,
      narrationIds: understanding.transcript.filter(v => v.startUs < step.endUs && v.endUs > step.startUs).map(v => v.id), wait: { kind: 'capability_completed', settleMs: 700 } }
  }) })
}

export interface RecordingReplayHost {
  execute(operations: RecordingOperation[], signal: AbortSignal): Promise<void>
  wait(ms: number, signal: AbortSignal): Promise<void>
  beforeStep?(step: RecordingScript['steps'][number]): Promise<void>
  afterStep?(step: RecordingScript['steps'][number]): Promise<void>
}
/** The caller owns isolation and cleanup. Never continue after a failed/unknown result. */
export async function replayRecordingSteps(script: RecordingScript, throughStepId: string | undefined, host: RecordingReplayHost, signal: AbortSignal): Promise<string[]> {
  const through = throughStepId ? script.steps.findIndex(v => v.id === throughStepId) : script.steps.length - 1
  if (through < 0) throw new Error('请选择存在的脚本步骤。')
  const steps = script.steps.slice(0, through + 1)
  for (const step of steps) if (step.blockedReason || !step.operations.length) throw new Error(`步骤“${step.title}”不能重放：${step.blockedReason ?? '缺少操作'}`)
  const completed: string[] = []
  for (const step of steps) {
    signal.throwIfAborted()
    try {
      await host.beforeStep?.(step)
      await host.execute(step.operations, signal)
      await host.wait(step.wait.settleMs, signal)
      await host.afterStep?.(step)
      completed.push(step.id)
    } catch (error) { throw new Error(`重放停在“${step.title}”，原工程未修改。${error instanceof Error ? error.message : String(error)}`, { cause: error }) }
  }
  return completed
}
