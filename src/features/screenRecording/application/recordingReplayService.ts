import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { replayRecordingSteps, recordingScriptSchema, type RecordingOperation, type RecordingScript } from '@/core/screenRecording/script'
import { replaceRecordingSteps } from '@/core/screenRecording/replacement'
import { videoEditDocumentSchema } from '@/core/videoEdit/document'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { openApplicationSurface } from '@/features/navigation'
import { openVideoEditDocument, closeVideoEditProject, videoEditDocumentContent, activeVideoEditInstance, switchVideoEditSequence, setVideoEditView, importVideoEditSources, saveVideoEdit, verifyVideoEditSaved, holdVideoEditActivity, requireVideoEditInstance } from '@/features/videoEdit'
import { assertRecordingEditable, readRecordingUnderstanding } from './recordingUnderstandingService'
import { recordingView, startRecording, controlRecording, readRecordingDocument } from './recordingService'
import { UNDERSTANDING_ENTITY, UNDERSTANDING_PROPERTY } from './recordingUnderstandingFields'
import { recordedScriptSource, assertRecordedScriptEdits } from './recordingScriptSource'

const logger = createLogger('features.screenRecording.replay')
let running = false
export function recordingReplayBusy(): boolean { return running }
export async function generateSessionScript(id: string, context: CapabilityExecutionContext): Promise<Record<string, unknown>> {
  if (!context.commitProperties) throw new Error('录制脚本事务尚未就绪。')
  if (context.callerGrant && !context.callerGrant.permissions.includes('screen_recording:read')) throw new Error('PERMISSION_DENIED:生成脚本需要 screen_recording:read 权限。')
  const read = await readRecordingUnderstanding(id)
  assertRecordingEditable(read.content)
  if (!read.content.understanding.steps.length) throw new Error('请先理解录制，生成步骤后再生成操作脚本。')
  if (context.expectedRevisions?.screen_recording !== undefined && context.expectedRevisions.screen_recording !== read.meta.revision) throw new Error('CONFLICT:会话已修改，请重新读取。')
  const operationScript = await recordedScriptSource(id, read.content, context.signal)
  context.signal.throwIfAborted()
  const understanding = { ...read.content.understanding, operationScript }
  const ref = { kind: UNDERSTANDING_ENTITY, id }
  const committed = await context.commitProperties(ref, { [UNDERSTANDING_PROPERTY]: understanding }, { screen_recording: read.meta.revision }, '生成录制操作脚本')
  return { resultRef: ref, steps: operationScript.steps.length, blocked: operationScript.steps.filter(v => v.blockedReason).length, ...(committed.undoRef ? { undoRef: committed.undoRef } : {}), verified: JSON.stringify((await readRecordingUnderstanding(id)).content.understanding.operationScript) === JSON.stringify(operationScript) }
}
function wait(ms: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('重放已取消')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
  })
}
export interface ReplayOptions { stepId?: string; destinationId?: string; sourceId?: string }
/** Replay only in owned temporary documents; all writes still use the public transaction executor. */
export async function replaySession(id: string, options: ReplayOptions, context: CapabilityExecutionContext): Promise<{ completedSteps: string[]; replaced: number; verified: boolean }> {
  if (running || recordingView().snapshot || recordingView().busy) throw new Error('请先结束当前录制或重放。')
  if (!context.invokeCapability) throw new Error('正式能力执行入口尚未就绪。')
  const signal = context.signal, api = getPlatform().documents
  const read = await readRecordingUnderstanding(id), recording = read.content
  assertRecordingEditable(recording)
  const script = recordingScriptSchema.parse(recording.understanding.operationScript)
  assertRecordedScriptEdits(script, await recordedScriptSource(id, recording, signal))
  const through = options.stepId ? script.steps.findIndex(v => v.id === options.stepId) : script.steps.length - 1
  if (through < 0) throw new Error('请先生成脚本并选择存在的步骤。')
  const planned = script.steps.slice(0, through + 1)
  for (const step of planned) if (step.blockedReason || !step.operations.length) throw new Error(`步骤“${step.title}”不能重放：${step.blockedReason ?? '缺少操作'}`)
  const selected = options.stepId ? planned.filter(v => v.id === options.stepId) : planned
  if (selected.some(step => recording.understanding.privacy.candidates.some(v => v.status === 'accepted' && v.startUs < step.endUs && v.endUs > step.startUs))) throw new Error('目标步骤已有隐私打码，请先复核重录后的隐私位置；当前不自动替换这些步骤。')
  const docIds = [...new Set(planned.flatMap(step => step.operations.map(operation => operation.target.id.split(':')[0])))]
  const baselines = docIds.map(documentId => {
    const baseline = recording.scriptCapture.baselines.find(v => v.documentId === documentId)
    if (!baseline) throw new Error('操作缺少开始前的快照，请重新录制。')
    return baseline
  })
  if (options.destinationId && options.sourceId !== await getPlatform().screenRecording.capture({ operation: 'application-source', sessionId: id })) throw new Error('重录仅支持当前痕迹AI窗口，请重新选择来源。')
  if (running || recordingView().snapshot || recordingView().busy) throw new Error('录制状态已改变，请等待当前操作完成。')
  running = true
  const mapping = new Map<string, string>(), opened: string[] = [], captured: Array<{ step: RecordingScript['steps'][number]; sessionId: string }> = []
  const previous = activeVideoEditInstance()?.document.id
  let result: { completedSteps: string[]; replaced: number; verified: boolean } | undefined
  let cleanupFailure: Error | undefined
  let projectId: string | undefined, activeCapture: string | undefined, release: (() => void) | undefined
  logger.info('开始隔离重放', { event: 'recording.replay.start', context: { sessionId: id, steps: planned.length, recording: Boolean(options.destinationId) } })
  try {
    signal.throwIfAborted()
    const owner = options.destinationId ? await openVideoEditDocument({ id: options.destinationId }, { focus: false }) : undefined
    const version = owner?.contentVersion
    if (owner) release = holdVideoEditActivity(owner.document.id, '重录替换')
    const current = async (): Promise<void> => {
      signal.throwIfAborted()
      if (owner && (owner.session.isEnded || requireVideoEditInstance(owner.document.id) !== owner || owner.contentVersion !== version)) throw new Error('重录期间目标剪辑已改变，未替换任何片段。')
      if ((await readRecordingUnderstanding(id)).meta.revision !== read.meta.revision) throw new Error('重录期间脚本已改变，请重新读取。')
    }
    await current()
    projectId = (await api.createProject({ name: `重放临时-${crypto.randomUUID().slice(0, 8)}`, draft: false })).id
    for (const baseline of baselines) {
      const content = videoEditDocumentContent(structuredClone(baseline.content))
      // A replay snapshot has no live generation/recording jobs or explanation ownership.
      delete content.inPlaceGenerations; delete content.creativeIntents; delete content.exportHistory
      const created = await api.createDocument({ kind: 'video_edit', name: `重放-${mapping.size + 1}`, container: { kind: 'project', projectId }, content, draft: false })
      mapping.set(baseline.documentId, created.meta.id)
      await openVideoEditDocument({ id: created.meta.id }); opened.push(created.meta.id)
    }
    openApplicationSurface('workspace.video_edit')
    const focus = async (operation: RecordingOperation): Promise<void> => {
      const [oldId, localId] = operation.target.id.split(':'), target = mapping.get(oldId)
      if (!target || !localId) throw new Error('步骤目标不属于隔离快照。')
      const instance = await openVideoEditDocument({ id: target })
      const sequence = instance.document.sequences.find(v => operation.target.kind === 'video_edit.sequence' ? v.id === localId : v.clips.some(clip => clip.id === localId))
      if (!sequence) throw new Error('步骤的序列或片段已不存在。')
      switchVideoEditSequence(target, sequence.id)
      const clip = sequence.clips.find(v => v.id === localId)
      setVideoEditView(target, { frame: clip?.start ?? 0, playing: false })
    }
    const execute = async (operations: RecordingOperation[]): Promise<void> => {
      await current()
      const changes = operations.map(operation => {
        const [oldId, ...rest] = operation.target.id.split(':'), newId = mapping.get(oldId)
        if (!newId || !rest.length) throw new Error('步骤目标不属于隔离快照。')
        return { kind: 'set_properties', entityType: operation.target.kind, target: { kind: operation.target.kind, id: `${newId}:${rest.join(':')}` }, properties: operation.properties }
      })
      // No user identity or fee approval can be supplied by the script.
      for (const [index, change] of changes.entries()) {
        await focus(operations[index])
        await context.invokeCapability!('change_application_entities', { summary: '在临时副本重放录制操作', changes: [change] }, signal)
      }
    }
    const completedSteps = await replayRecordingSteps(script, options.stepId, { execute, wait,
      beforeStep: async step => {
        await focus(step.operations[0])
        await wait(300, signal)
        if (!options.destinationId || !selected.some(v => v.id === step.id)) return
        if (!options.sourceId || !recording.source) throw new Error('重录需要选择当前应用窗口。')
        const { backend, width, height, fps, bitrate } = recording.source.options
        activeCapture = await startRecording({ backend, width, height, fps, bitrate, sourceId: options.sourceId }, { name: `重录-${step.title.slice(0, 70)}-${crypto.randomUUID().slice(0, 8)}`, tracks: { systemAudio: false } }, null, signal)
        while (recordingView().snapshot?.phase !== 'recording') {
          if (!recordingView().snapshot || ['failed', 'stopped'].includes(recordingView().snapshot!.phase)) throw new Error('重录没有开始，请检查采集权限。')
          await wait(100, signal)
        }
        await wait(300, signal)
      },
      afterStep: async step => {
        if (!activeCapture) return
        const sessionId = activeCapture
        await controlRecording(sessionId, 'stop'); activeCapture = undefined
        captured.push({ step, sessionId })
      },
    }, signal)
    await current()
    let replaced = 0
    if (owner) {
      const replacements = await Promise.all(captured.map(async capture => {
        const saved = await readRecordingDocument(capture.sessionId)
        const media = saved.media.filter(v => v.kind === 'screen' && v.durationUs > 0)
        if (saved.status !== 'stopped' || media.length !== 1) throw new Error('重录未形成完整单段画面，原时间线保持不变。')
        return { step: capture.step, source: media[0] }
      }))
      await importVideoEditSources(owner.document.id, replacements.map(v => ({ path: v.source.path })), undefined, signal, async draft => {
        await current()
        replaced = replaceRecordingSteps(draft, recording, replacements.map(v => {
          const media = draft.media.find(m => m.path.replaceAll('\\', '/') === v.source.path.replaceAll('\\', '/'))
          if (!media) throw new Error('重录素材未完整导入。')
          return { step: v.step, media }
        }))
        return videoEditDocumentSchema.parse(draft)
      })
      context.execution?.report({ targetMutation: 'applied' })
      const expected = owner.document
      try { await saveVideoEdit(owner.document.id) } catch (error) { throw new ApplicationPersistenceFailure('画面已替换但未保存，请重试保存剪辑，不要再次重录。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: { kind: 'video_edit.document', id: owner.document.id }, replayMutation: false } }, error) }
      if (!await verifyVideoEditSaved(owner.document.id, expected, { contentOnly: true })) throw new Error('替换已提交，保存结果尚未确认；请读取剪辑，不要再次重录。')
    }
    result = { completedSteps, replaced, verified: true }
  } catch (error) { logger.error('隔离重放未完成', error, { event: signal.aborted ? 'recording.replay.cancelled' : 'recording.replay.failed', context: { sessionId: id } }); throw error }
  finally {
    try {
      const errors: unknown[] = []
      const cleanup = async (work: () => Promise<unknown>): Promise<void> => { try { await work() } catch (error) { errors.push(error) } }
      if (activeCapture) await cleanup(() => controlRecording(activeCapture!, 'cancel'))
      for (const temporaryId of opened) await cleanup(() => closeVideoEditProject(temporaryId))
      if (projectId) await cleanup(() => api.trashProject(projectId!))
      if (previous) await cleanup(() => openVideoEditDocument({ id: previous }))
      if (errors.length) {
        const error = new AggregateError(errors, '临时重放清理未完成，请检查临时工程；不要重复提交替换。')
        logger.error('临时重放清理失败', error, { event: 'recording.replay.cleanup.failed', context: { sessionId: id } })
        cleanupFailure = error
      }
    } finally { release?.(); running = false }
  }
  if (cleanupFailure) throw cleanupFailure
  if (!result) throw new Error('重放没有产生完成结果。')
  logger.info('隔离重放完成', { event: 'recording.replay.completed', context: { sessionId: id, replaced: result.replaced } })
  return result
}
