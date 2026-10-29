import { loadRecordingSetup, recordingOutput } from '@/services/recordingSetupModel'
import { z } from 'zod'
import { getPlatform } from '@/platform'
import { createLogger } from '@/core/logging'
import { createRecordingDocument } from '@/core/screenRecording/document'
import { recordingDirectorPlanSchema, directorPlanIdentity, assertDirectorTargets } from '@/core/screenRecording/director'
import { planDirectorInputSchema } from '@/core/application-control/domains/screenRecording/directorCapability'
import { videoEditDocumentSchema } from '@/core/videoEdit/document'
import { openVideoEditDocument, videoEditDocumentContent, holdVideoEditActivity, requireVideoEditInstance } from '@/features/videoEdit'
import type { CapabilityExecutionContext } from '@/features/application-control'
import { defaultDocumentOperationChanges } from '@/features/documents'
import { readRecordingUnderstanding } from './recordingUnderstandingService'
import { replaySession } from './recordingReplayService'
import { waitRecordingStep } from './recordingWait'
import { startRecording, controlRecording, recordingView, readRecordingDocument } from './recordingService'
import { pointDirectorCursor, clearDirectorCursor } from './recordingDirectorCursor'
import { generateRecordingNarration, narrationIdentity, recordingNarrationCost, recordingNarrationTaskId } from './recordingNarration'
import { withPaidOperation } from '@/services/paidApproval'
import { inheritApplicationConfirmation } from '@/core/application-control/userConfirmation'
import { generateRecordingMovie } from './recordingMovieService'
import { RECORDING_MOVIE_RECIPES } from '@/core/screenRecording/movie'

const logger = createLogger('features.screenRecording.director')
const runs = new Map<string, AbortController>()
export function recordingDirectorBusy(id: string): boolean { return runs.has(id) }
export function cancelRecordingDirector(id: string): void { runs.get(id)?.abort(new DOMException('导演录制已取消', 'AbortError')) }
export async function planRecordingDirector(input: z.infer<typeof planDirectorInputSchema>, context: CapabilityExecutionContext): Promise<string> {
  const parsed = planDirectorInputSchema.parse(input), content = createRecordingDocument()
  content.status = 'stopped'
  let at = 0
  const steps = parsed.steps.map(step => {
    const id = crypto.randomUUID(), startUs = at
    at += Math.max(2, step.narration.length / 4) * 1e6
    return { id, title: step.title, startUs: Math.round(startUs), endUs: Math.round(at), operations: step.operations, narrationIds: [id], wait: { kind: 'capability_completed' as const, settleMs: step.settleMs }, blockedReason: null }
  })
  const plan = recordingDirectorPlanSchema.parse({ operationScript: { steps }, director: { goal: parsed.goal, voice: parsed.voice, confirmed: true, narration: parsed.steps.map((v, i) => ({ stepId: steps[i].id, text: v.narration, picture: v.picture })) } })
  Object.assign(content.understanding, plan)
  content.directorRun = { takes: [] }
  const ids = [...new Set(steps.flatMap(v => v.operations.filter(o => o.target.kind !== 'settings.registry').map(o => o.target.id.split(':')[0])))]
  for (const documentId of ids) {
    context.signal.throwIfAborted()
    const owner = await openVideoEditDocument({ id: documentId }, { focus: false })
    content.scriptCapture.baselines.push({ documentId, content: videoEditDocumentSchema.parse(videoEditDocumentContent(structuredClone(owner.document))) })
  }
  assertDirectorTargets(plan, content.scriptCapture)
  const created = await getPlatform().documents.createDocument({ id: crypto.randomUUID(), kind: 'screen_recording', container: { kind: 'user' }, name: `${parsed.goal.slice(0, 60).replace(/[\\/:*?"<>|]/g, ' ')}-${crypto.randomUUID().slice(0, 8)}`, content, draft: false })
  defaultDocumentOperationChanges.changed()
  return created.meta.id
}

/** Plan and saved takes live in the session; all pixel capture/replay/movie edits use existing services. */
export async function startRecordingDirector(id: string, documentId: string, context: CapabilityExecutionContext): Promise<{ sessionId: string; sequenceIds: string[]; verified: boolean }> {
  if (runs.size || recordingView().snapshot) throw new Error('请先结束当前导演录制或屏幕录制。')
  const read = await readRecordingUnderstanding(id)
  const plan = recordingDirectorPlanSchema.parse({ director: read.content.understanding.director, operationScript: read.content.understanding.operationScript })
  assertDirectorTargets(plan, read.content.scriptCapture)
  if (read.content.directorRun?.movie) throw new Error('这份脚本已有成片提交记录，请打开目标剪辑核对或恢复保存，不要再次录制。')
  const controller = new AbortController(), signal = controller.signal
  const releaseConfirmation = inheritApplicationConfirmation(context.signal, signal)
  const abort = () => controller.abort(context.signal.reason)
  context.signal.addEventListener('abort', abort, { once: true }); if (context.signal.aborted) abort()
  runs.set(id, controller)
  let active: string | undefined
  let releaseOwner: (() => void) | undefined
  let revision = read.meta.revision
  const content = read.content
  const originalIdentity = directorPlanIdentity(plan)
  const save = async (): Promise<void> => {
    const latest = await readRecordingUnderstanding(id)
    if (latest.meta.revision !== revision) throw new Error('导演脚本在执行期间已修改，已停止；现有配音仍保留在生成历史。')
    const saved = await getPlatform().documents.saveDocument({ target: { id }, expectedRevision: revision, content })
    revision = saved.meta.revision; defaultDocumentOperationChanges.changed(); context.execution?.report({ targetMutation: 'applied' })
  }
  const current = async (): Promise<void> => {
    signal.throwIfAborted()
    const latest = await readRecordingUnderstanding(id)
    if (latest.meta.revision !== revision || directorPlanIdentity({ director: latest.content.understanding.director!, operationScript: latest.content.understanding.operationScript }) !== originalIdentity) throw new Error('导演脚本已变化，请重新开始录制。')
  }
  logger.info('开始导演录制', { event: 'recording.director.start', context: { documentId: id, destinationId: documentId, steps: plan.operationScript.steps.length } })
  try {
    await current()
    const owner = await openVideoEditDocument({ id: documentId }, { focus: false }), version = owner.contentVersion
    releaseOwner = holdVideoEditActivity(documentId, '导演录制')
    const destinationCurrent = () => { if (owner.session.isEnded || requireVideoEditInstance(documentId) !== owner || owner.contentVersion !== version) throw new Error('目标剪辑已变化，已保留配音与原片，未自动覆盖。') }
    const director = content.understanding.director!
    const run = content.directorRun ??= { takes: [] }
    const pending = director.narration.filter(narration => !run.takes.some(take => take.stepId === narration.stepId && take.identity === narrationIdentity(narration.text, director.voice) && (take.taskId || take.path && take.durationUs)))
    const generationTasks = new Map(pending.map(narration => [narration.stepId, recordingNarrationTaskId([id, narration.stepId], narration.text, director.voice)]))
    const costs = pending.map(narration => recordingNarrationCost(narration.text, director.voice))
    const estimatedCny = costs.some(v => v === null) ? null : costs.reduce<number>((total, cost) => total + (cost ?? 0), 0)
    const synthesize = async (paidSignal: AbortSignal) => {
      for (const narration of director.narration) {
        await current()
        const identity = narrationIdentity(narration.text, director.voice)
        let take = run.takes.find(v => v.stepId === narration.stepId && v.identity === identity)
        if (take?.path && take.durationUs) continue
        if (!take) { take = { stepId: narration.stepId, identity }; run.takes = [...run.takes.filter(v => v.stepId !== narration.stepId), take] }
        const entry = take
        const result = await generateRecordingNarration(narration.text, director.voice, id, { ...context, signal: paidSignal }, { taskId: entry.taskId, operationId: generationTasks.get(narration.stepId), dispatched: async taskId => { entry.taskId = taskId; await save() } })
        Object.assign(entry, result); await save()
      }
    }
    if (pending.length) await withPaidOperation({ category: 'generation', documentId: id, estimatedCny, generationTaskIds: [...generationTasks.values()], generationTaskEstimates: pending.map((narration, index) => ({ taskId: generationTasks.get(narration.stepId)!, estimatedCny: costs[index] })) }, synthesize, signal)
    else await synthesize(signal)
    await current()
    let recordingId = run.recordingId
    if (!recordingId) {
      const sourceId = z.string().parse(await getPlatform().screenRecording.capture({ operation: 'application-source', sessionId: id }))
      const actualSteps: typeof plan.operationScript.steps = []
      let stepStart = 0, currentStep = plan.operationScript.steps[0]
      await replaySession(id, { director: {
        point: operation => pointDirectorCursor(operation, signal),
        beforeStep: async step => {
          currentStep = step
          if (!active) {
            active = await startRecording({ ...recordingOutput(loadRecordingSetup().setup), sourceId, backend: 'auto' }, { name: `导演-${crypto.randomUUID().slice(0, 8)}`, tracks: { systemAudio: false } }, null, signal)
            const deadline = performance.now() + 30000
            while (recordingView().snapshot?.phase !== 'recording') {
              if (performance.now() > deadline || !recordingView().snapshot || recordingView().snapshot?.phase === 'failed') throw new Error('导演录制未能开始。')
              await waitRecordingStep(100, signal)
            }
          }
          stepStart = z.number().int().nonnegative().parse(await getPlatform().screenRecording.capture({ operation: 'clock', sessionId: active! }))
        },
        wait: async (settleMs, waitSignal) => {
          const take = run.takes.find(v => v.stepId === currentStep.id)!
          await waitRecordingStep(Math.max(settleMs, take.durationUs! / 1000 + 300), waitSignal)
        },
        afterStep: async step => {
          if (!active || recordingView().snapshot?.phase !== 'recording') throw new Error('用户已停止或暂停采集，导演执行已结束。')
          const endUs = z.number().int().nonnegative().parse(await getPlatform().screenRecording.capture({ operation: 'clock', sessionId: active }))
          actualSteps.push({ ...step, startUs: Math.round(stepStart), endUs })
          if (step.id === plan.operationScript.steps.at(-1)!.id) {
            clearDirectorCursor()
            recordingId = active!
            await controlRecording(active!, 'stop'); active = undefined
          }
        },
      } }, { ...context, signal })
      const captured = await readRecordingUnderstanding(recordingId!)
      const captureContent = captured.content
      const screenEnd = Math.max(...captureContent.media.filter(v => v.kind === 'screen').map(v => v.monoUs + v.durationUs))
      for (const step of actualSteps) step.endUs = Math.min(step.endUs, screenEnd)
      captureContent.understanding.operationScript = { steps: actualSteps }
      captureContent.understanding.director = structuredClone(director)
      captureContent.directorRun = structuredClone(run)
      captureContent.scriptCapture = structuredClone(content.scriptCapture)
      captureContent.understanding.steps = actualSteps.map(step => ({ id: step.id, title: step.title, description: director.narration.find(v => v.stepId === step.id)!.picture, startUs: step.startUs, endUs: step.endUs, signal: 'capability', eventIds: [] }))
      captureContent.understanding.transcript = actualSteps.map(step => {
        const narration = director.narration.find(v => v.stepId === step.id)!, take = run.takes.find(v => v.stepId === step.id)!
        const startUs = step.startUs, endUs = Math.min(step.endUs, startUs + take.durationUs!)
        captureContent.media.push({ id: step.id, kind: 'microphone', path: take.path!, monoUs: startUs, durationUs: take.durationUs! })
        return { id: step.id, startUs, endUs, text: narration.text, granularity: 'segment', mediaId: step.id }
      })
      await getPlatform().documents.saveDocument({ target: { id: recordingId! }, expectedRevision: captured.meta.revision, content: captureContent })
      run.recordingId = recordingId; await save()
    }
    await current()
    destinationCurrent()
    run.movie = { documentId, state: 'preparing', sequenceIds: [] }; await save()
    const movie = await generateRecordingMovie(recordingId!, { documentId, recipe: { ...RECORDING_MOVIE_RECIPES.tutorial, formats: ['landscape'], trimPauses: false, trimFillers: false, waitSpeed: 1, cursor: false, attention: 'off', camera: 'off', steps: false } }, signal)
    context.execution?.report({ targetMutation: 'applied' })
    run.movie = { documentId, state: 'completed', sequenceIds: movie.sequenceIds }; await save()
    logger.info('导演成片已生成', { event: 'recording.director.completed', context: { documentId: id, recordingId, destinationId: documentId } })
    return { sessionId: recordingId!, sequenceIds: movie.sequenceIds, verified: movie.verified && (await readRecordingDocument(recordingId!)).media.length > 0 }
  } catch (error) { logger.error('导演录制未完成', error, { event: signal.aborted ? 'recording.director.cancelled' : 'recording.director.failed', context: { documentId: id } }); throw error }
  finally {
    try { if (active && recordingView().snapshot?.sessionId === active) await controlRecording(active, 'cancel') }
    finally { releaseOwner?.(); clearDirectorCursor(); releaseConfirmation(); context.signal.removeEventListener('abort', abort); runs.delete(id) }
  }
}
