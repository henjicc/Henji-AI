import crypto from 'node:crypto'
import { timestampedAsrService, prepareTimestampedAsrWithReceipt, executeTimestampedAsrWithReceipt, type TimestampedAsrReceipt } from './timestamped-asr'
import { readTranscriptionFacts, TranscriptionFailure, type TranscriptionFacts, type TranscriptionPreflight, type TranscriptionPreparation } from '../../../../src/core/audioEdit/transcriptionFailure'
import { audioEditTranscriptBlocks } from '../../../../src/core/audioEdit/timestampedTranscript'

import type {
  AudioEditTranscriptionRequest,
  AudioEditTranscriptionResult,
} from '../../../../src/core/audioEdit/types'
import { analyzeAudioEditTranscript } from '../../../../src/core/audioEdit/analysis'
import { createAudioEditBaseline } from '../../../../src/core/audioEdit/baseline'
import { createMainLogger } from '../logging'
import { requireAudioEditProject } from './project-store'
import { assertAudioEditProjectIdle, createAudioEditTask, findAudioEditTranscription, isAudioEditTaskActive, updateAudioEditTask, registerAudioEditTaskController } from './task-store'
import { prepareAudioEditAudio, verifyAudioEditSource } from './media'

const logger = createMainLogger('main.audio_edit.asr')
const controllers = new Map<string, AbortController>()

const client = timestampedAsrService.client

interface TranscriptionReceipt extends TimestampedAsrReceipt {
  output?: AudioEditTranscriptionResult
}

export const listAudioEditAsrModels = timestampedAsrService.listModels

export async function preflightAudioEditTranscription(input: TranscriptionPreflight): Promise<TranscriptionPreparation> {
  if (input.audioDocumentId) {
    const project = await requireAudioEditProject(input.audioDocumentId)
    if (project.source.sourcePath !== input.sourcePath) throw new Error('恢复的口播文档与当前声音素材不一致。')
    await verifyAudioEditSource(project)
    if (project.transcript.length) return { requiresConfirmation: false }
    const task = findAudioEditTranscription(project.id)
    if (task) {
      if (isAudioEditTaskActive(task.request_id)) throw new Error('原口播识别仍在执行，请查询原任务。')
      const prior = task.result_json ? JSON.parse(task.result_json) as TranscriptionReceipt : undefined
      if (prior?.sourceDigest !== (project.source.identity?.digest ?? project.source.sourcePath)) throw new Error('素材已变化，不能复用旧识别任务。')
      if (prior.output || prior.rawOutput) return { modelId: prior.modelId, requiresConfirmation: false }
      if (task.provider_task_id) {
        const plan = timestampedAsrService.prepare({ audioPath: input.sourcePath, durationMs: input.durationMs, modelId: prior.modelId })
        if (!client.get(plan.modelId)?.descriptor.features?.includes('resume-task')) throw new Error('原模型不能恢复查询，禁止重复提交识别。')
        return { modelId: plan.modelId, requiresConfirmation: false }
      }
      if (task.state !== 'failed' || !(prior.billing === 'not_charged' || task.error_message?.startsWith('[native_upload_unsupported]'))) throw new Error('原口播提交结果尚未确认，请核对原任务；不会再次请求付费确认。')
    }
  }
  return { ...await timestampedAsrService.preflight(input), requiresConfirmation: true }
}


export async function transcribeAudioEditProject(
  request: AudioEditTranscriptionRequest,
): Promise<AudioEditTranscriptionResult> {
  const requestId = request.requestId ?? crypto.randomUUID()
  const controller = new AbortController()
  const release = registerAudioEditTaskController(requestId, request.projectId, controller, true)
  try { return await transcribeRegisteredProject({ ...request, requestId }, controller) }
  finally { release() }
}

async function transcribeRegisteredProject(request: AudioEditTranscriptionRequest, controller: AbortController): Promise<AudioEditTranscriptionResult> {
  let billing: TranscriptionFacts['billing'] = 'not_charged'
  try {
  const project = await requireAudioEditProject(request.projectId)
  if (project.transcript.length) throw new Error('口播已有转写，请保留当前编辑；需要重新识别时另建口播。')
  await verifyAudioEditSource(project, true, controller.signal)
  const previous = findAudioEditTranscription(project.id)
  if (previous) billing = 'unknown'
  if (previous && previous.request_id !== request.requestId && isAudioEditTaskActive(previous.request_id)) throw new Error('该口播正在转写，请等待或取消。')
  const priorInput = previous?.result_json ? JSON.parse(previous.result_json) as TranscriptionReceipt : undefined
  if (priorInput?.rawOutput || priorInput?.output || priorInput?.billing === 'completed') billing = 'completed'
  const sourceDigest = project.source.identity?.digest ?? project.source.sourcePath
  if (previous && priorInput?.sourceDigest !== sourceDigest) throw new Error('素材已变化，旧转写任务不能覆盖当前口播。')
  const neverSubmitted = previous?.state === 'failed' && !previous.provider_task_id && (priorInput?.billing === 'not_charged' || previous.error_message?.startsWith('[native_upload_unsupported]'))
  if (neverSubmitted) billing = 'not_charged'
  if (priorInput?.output && priorInput.sourceDigest === (project.source.identity?.digest ?? project.source.sourcePath)) {
    const cached = priorInput.output
    return { ...cached, project: { ...project, transcript: cached.project.transcript, suggestions: cached.project.suggestions,
      selectedAsrModelId: cached.modelId, editBaseline: cached.project.editBaseline } }
  }
  const rawOutput = priorInput?.rawOutput
  if (previous && !neverSubmitted && !rawOutput && (!previous.provider_task_id || !priorInput?.modelId)) throw new Error('上次转写的提交结果无法确认，已阻止重复付费。请核对原口播任务。')
  const durationMs = project.source.durationFrames * 1_000 / project.source.sampleRate
  const plan = prepareTimestampedAsrWithReceipt(timestampedAsrService, {
    modelId: priorInput?.modelId ?? request.modelId, audioPath: project.source.sourcePath,
    durationMs,
    language: priorInput?.language ?? request.language,
  }, priorInput, sourceDigest)
  const modelId = plan.modelId
  if (previous && !neverSubmitted && !rawOutput && !client.get(modelId)?.descriptor.features?.includes('resume-task')) throw new Error('此模型不支持恢复查询，已阻止自动重复提交。')
  const language = priorInput?.language ?? request.language ?? 'zh'
  const inputDigest = crypto.createHash('sha256').update(JSON.stringify({ projectId: project.id, sourceDigest, modelId, language })).digest('hex')
  const requestId = previous?.request_id ?? request.requestId ?? crypto.randomUUID()
  const receipt: TranscriptionReceipt = { modelId, sourceDigest, language, billing, rawOutput }
  if (!previous || neverSubmitted) await timestampedAsrService.preflight({ sourcePath: plan.audioPath, durationMs: plan.durationMs, modelId })
  controller.signal.throwIfAborted()
  assertAudioEditProjectIdle(project.id)
  const release = registerAudioEditTaskController(requestId, project.id, controller)
  controllers.set(requestId, controller)
  try {
    if (!previous) createAudioEditTask({ requestId, projectId: project.id, kind: 'transcription', inputDigest })
    updateAudioEditTask(requestId, { state: 'running', result: { modelId, sourceDigest, language, cost: plan.cost, billing, ...(rawOutput ? { rawOutput } : {}) } })
  } catch (error) { release(); controllers.delete(requestId); throw error }
  logger.info('口播转写开始', {
    event: 'audio_edit.transcription.start', requestId, modelId,
    context: { projectId: project.id },
  })
  try {
    const audioPath = previous && !neverSubmitted ? project.source.audioPath : await prepareAudioEditAudio(project, controller.signal)
    controller.signal.throwIfAborted()
    const output = await executeTimestampedAsrWithReceipt(timestampedAsrService, Object.freeze({ ...plan, audioPath }), {
      requestId,
      signal: controller.signal,
      resumeTaskId: previous?.provider_task_id ?? undefined,
      onEvent: (event) => {
        // started.sessionId 是 SDK 会话标识，只有 processing.taskId 能恢复供应商任务。
        if (event.type === 'processing') {
          billing = 'submitted'
          updateAudioEditTask(requestId, { state: 'running', providerTaskId: event.taskId })
        }
      },
    }, receipt, saved => {
      billing = saved.billing ?? 'unknown'
      updateAudioEditTask(requestId, { state: 'running', result: saved })
    })
    billing = 'completed'
    const transcript = audioEditTranscriptBlocks(output, project.source.sampleRate)
    if (!transcript.length) throw new Error('识别结果没有可用时间戳，请选择支持时间戳的模型重试。')
    const granularity = transcript.some((block) => block.granularity === 'word')
      ? 'word'
      : transcript.length > 0
        ? 'segment'
        : 'none'
    // 结果交给渲染层实例接收并经文档会话保存（主进程不写口播内容）；第一次识别同时确立原文基线。
    const recognized = {
      ...project,
      transcript,
      suggestions: analyzeAudioEditTranscript(transcript, { sampleRate: project.source.sampleRate }),
      selectedAsrModelId: modelId,
    }
    const next = { ...recognized, editBaseline: createAudioEditBaseline(recognized, 'original') }
    logger.info('口播转写完成', {
      event: 'audio_edit.transcription.completed', requestId, modelId,
      context: { projectId: project.id, blockCount: transcript.length, granularity },
    })
    const result: AudioEditTranscriptionResult = { project: next, modelId, granularity }
    receipt.output = result
    // Keep the paid result in the existing task receipt before IPC delivery; reload can retrieve it.
    updateAudioEditTask(requestId, { state: 'completed', result: receipt })
    controller.signal.throwIfAborted()
    await verifyAudioEditSource(project, true, controller.signal)
    return result
  } catch (error) {
    billing = receipt.billing ?? billing
    updateAudioEditTask(requestId, {
      state: controller.signal.aborted ? 'cancelled' : 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      result: receipt,
    })
    logger.error('口播转写失败', {
      event: 'audio_edit.transcription.failed', requestId, modelId,
      context: { projectId: project.id }, error,
    })
    throw error
  } finally {
    controllers.delete(requestId)
    release()
  }
  } catch (error) {
    throw new TranscriptionFailure(error, { ...readTranscriptionFacts(error), billing, targetMutation: 'none', audioDocumentId: request.projectId })
  }
}

export function cancelAudioEditTranscription(requestId: string): void {
  controllers.get(requestId)?.abort()
}
