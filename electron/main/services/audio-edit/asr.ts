import crypto from 'node:crypto'
import { timestampedAsrService, prepareTimestampedAsrWithReceipt, executeTimestampedAsrWithReceipt, timestampedAsrNeverSubmitted, type TimestampedAsrReceipt } from './timestamped-asr'
import { asrUploadEncoding } from '../../../../src/core/audioEdit/asrCatalog'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
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
import { assertAudioEditProjectIdle, claimAudioEditTask, findAudioEditTranscription, isAudioEditTaskActive, isAudioEditTaskRunningHere, listAudioEditTasks, settleStaleAudioEditTask, updateOwnedAudioEditTask, registerAudioEditTaskController, type AudioEditStoredTask } from './task-store'
import type { AudioEditTaskStatus, AudioEditTranscriptionResubmission } from '../../../../src/core/application-control/domains/audioEdit/audioEditTaskStatus'
import { prepareAudioEditTranscriptionAudio, verifyAudioEditSource } from './media'
import { audioEditSourceReceiptDigest } from './source-identity'

const logger = createMainLogger('main.audio_edit.asr')
const UNCONFIRMED_SUBMISSION = '上次转写在交给识别服务时中断，无法确认是否已经计费，已阻止重复付费。需要重新识别时，请用同一素材新建口播。'
const controllers = new Map<string, AbortController>()

const client = timestampedAsrService.client

interface TranscriptionReceipt extends TimestampedAsrReceipt {
  output?: AudioEditTranscriptionResult
}

export const listAudioEditAsrModels = timestampedAsrService.listModels

/**
 * 这份口播最近一次转写的记录：还有进程在跑（本进程，或共用数据库的助手命令行、主应用）就拒绝，不能重提也不能改标；
 * 运行中却已没有进程在跑的，先记为中断，再交给回执判断能否重新提交。ownRequestId 是本次调用自己登记的任务。
 */
function latestSettledTranscription(projectId: string, ownRequestId?: string): AudioEditStoredTask | undefined {
  const task = findAudioEditTranscription(projectId)
  if (!task) return undefined
  if (task.request_id !== ownRequestId && isAudioEditTaskActive(task.request_id)) throw new Error('这份口播正在转写（可能在另一个窗口或助手命令行里），请等待或取消原任务。')
  settleStaleAudioEditTask(task.request_id)
  return findAudioEditTranscription(projectId)
}

/**
 * 最近一次转写再发起会怎样，与 preflight / transcribe 的拒绝条件同源：已拿到结果或能续查的供应商任务只续查、不重复计费；
 * 确认没有交给识别服务才可重新提交；交出去却无法确认、也续查不了的拒绝。本进程正在跑的不标。
 */
function transcriptionResubmission(task: AudioEditStoredTask, sourceDigest: string): AudioEditTranscriptionResubmission | undefined {
  if (task.state === 'completed') return undefined
  const unfinished = task.state === 'queued' || task.state === 'running'
  if (unfinished && isAudioEditTaskRunningHere(task.request_id)) return undefined
  if (unfinished && isAudioEditTaskActive(task.request_id)) return 'running_elsewhere'
  const prior = task.result_json ? JSON.parse(task.result_json) as TranscriptionReceipt : undefined
  // 素材变了，旧回执既不能续用也不能覆盖当前口播
  if (prior?.sourceDigest !== sourceDigest) return 'blocked'
  if (prior?.output || prior?.rawOutput) return 'resume'
  if (task.provider_task_id) return prior?.modelId && client.get(prior.modelId)?.descriptor.features?.includes('resume-task') ? 'resume' : 'blocked'
  // 心跳已停的运行中记录在下次发起时会先记为中断，这里按中断判断
  return timestampedAsrNeverSubmitted(unfinished ? { ...task, state: 'failed' } : task, prior) ? 'allowed' : 'blocked'
}

/** 口播的处理任务；最近一次转写附上能否再发起。口播读不出来时只列任务，不猜能否再发起。 */
export async function listAudioEditTaskStatuses(projectId: string): Promise<AudioEditTaskStatus[]> {
  const tasks = listAudioEditTasks(projectId)
  const latest = findAudioEditTranscription(projectId)
  const project = latest ? await requireAudioEditProject(projectId).catch(() => undefined) : undefined
  const resubmission = latest && project ? transcriptionResubmission(latest, audioEditSourceReceiptDigest(project.source)) : undefined
  return resubmission ? tasks.map(task => task.requestId === latest!.request_id ? { ...task, resubmission } : task) : tasks
}

export async function preflightAudioEditTranscription(input: TranscriptionPreflight): Promise<TranscriptionPreparation> {
  if (input.audioDocumentId) {
    const project = await requireAudioEditProject(input.audioDocumentId)
    if (project.source.sourcePath !== input.sourcePath) throw new Error('恢复的口播文档与当前声音素材不一致。')
    await verifyAudioEditSource(project)
    if (project.transcript.length) return { requiresConfirmation: false }
    const task = latestSettledTranscription(project.id)
    if (task) {
      const prior = task.result_json ? JSON.parse(task.result_json) as TranscriptionReceipt : undefined
      if (prior?.sourceDigest !== audioEditSourceReceiptDigest(project.source)) throw new Error('素材已变化，不能复用旧识别任务。')
      if (prior.output || prior.rawOutput) return { modelId: prior.modelId, requiresConfirmation: false }
      if (task.provider_task_id) {
        const plan = timestampedAsrService.prepare({ audioPath: input.sourcePath, durationMs: input.durationMs, modelId: prior.modelId })
        if (!client.get(plan.modelId)?.descriptor.features?.includes('resume-task')) throw new Error('原模型不能恢复查询，禁止重复提交识别。')
        return { modelId: plan.modelId, requiresConfirmation: false }
      }
      if (!timestampedAsrNeverSubmitted(task, prior)) throw new Error(UNCONFIRMED_SUBMISSION)
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
  await verifyAudioEditSource(project, controller.signal)
  const previous = latestSettledTranscription(project.id, request.requestId)
  if (previous) billing = 'unknown'
  const priorInput = previous?.result_json ? JSON.parse(previous.result_json) as TranscriptionReceipt : undefined
  if (priorInput?.rawOutput || priorInput?.output || priorInput?.billing === 'completed') billing = 'completed'
  const sourceDigest = audioEditSourceReceiptDigest(project.source)
  if (previous && priorInput?.sourceDigest !== sourceDigest) throw new Error('素材已变化，旧转写任务不能覆盖当前口播。')
  const neverSubmitted = previous ? timestampedAsrNeverSubmitted(previous, priorInput) : false
  if (neverSubmitted) billing = 'not_charged'
  if (priorInput?.output && priorInput.sourceDigest === audioEditSourceReceiptDigest(project.source)) {
    const cached = priorInput.output
    return { ...cached, project: { ...project, transcript: cached.project.transcript, suggestions: cached.project.suggestions,
      selectedAsrModelId: cached.modelId, editBaseline: cached.project.editBaseline } }
  }
  const rawOutput = priorInput?.rawOutput
  if (previous && !neverSubmitted && !rawOutput && (!previous.provider_task_id || !priorInput?.modelId)) throw new Error(UNCONFIRMED_SUBMISSION)
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
  // 这次尝试的执行者令牌。认领是一条条件写入：上面读到记录之后（preflight 期间）有人新建、接管或写过这一行，就放弃
  const owner = crypto.randomUUID()
  const claimed = claimAudioEditTask({ requestId, projectId: project.id, kind: 'transcription', inputDigest, owner,
    result: { modelId, sourceDigest, language, cost: plan.cost, billing, ...(rawOutput ? { rawOutput } : {}) },
    ...(previous ? { takeoverUpdatedAt: previous.updated_at } : {}) })
  if (!claimed) throw new Error('这份口播刚被另一个窗口或助手命令行开始转写，请稍后查询原任务；这次没有提交。')
  const release = registerAudioEditTaskController(requestId, project.id, controller, false, owner)
  controllers.set(requestId, controller)
  /** 带令牌写回执；令牌对不上（已被接管）时抛错，调用处据此不再往下做。 */
  const write = (update: Parameters<typeof updateOwnedAudioEditTask>[2]): void => {
    if (!updateOwnedAudioEditTask(requestId, owner, update)) throw new Error('这份口播的转写已由另一个窗口或助手命令行接手，这里停止。')
  }
  logger.info('口播转写开始', {
    event: 'audio_edit.transcription.start', requestId, modelId,
    context: { projectId: project.id },
  })
  let upload: { path: string; bytes: number } | undefined
  try {
    // 恢复供应商任务只按任务号查询，不读音频；新提交才准备转写副本。
    if (!previous || neverSubmitted) {
      const startedAt = performance.now()
      const encoding = asrUploadEncoding(modelId)
      upload = await prepareAudioEditTranscriptionAudio(project, encoding, controller.signal)
      logger.info('转写音频已准备', {
        event: 'audio_edit.transcription.audio_prepared', requestId, modelId,
        context: { projectId: project.id, encoding, bytes: upload.bytes, audioSeconds: durationMs / 1000, elapsedMs: Math.round(performance.now() - startedAt) },
      })
    }
    const audioPath = upload?.path ?? project.source.audioPath
    controller.signal.throwIfAborted()
    const output = await executeTimestampedAsrWithReceipt(timestampedAsrService, Object.freeze({ ...plan, audioPath }), {
      requestId,
      signal: controller.signal,
      resumeTaskId: previous?.provider_task_id ?? undefined,
      onEvent: (event) => {
        // started.sessionId 是 SDK 会话标识，只有 processing.taskId 能恢复供应商任务。
        if (event.type === 'processing') {
          billing = 'submitted'
          write({ state: 'running', providerTaskId: event.taskId })
        }
      },
    }, receipt, saved => {
      // 发出付费请求前的那次写入在这里：写不进去就抛错，请求不会发出
      write({ state: 'running', result: { ...saved } })
      billing = saved.billing ?? 'unknown'
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
    // 结果已经付费拿到：令牌被接管（本进程曾长时间卡住）时照样交给渲染层，只是回执归接管方
    if (!updateOwnedAudioEditTask(requestId, owner, { state: 'completed', result: { ...receipt } })) logger.warn('转写结果的回执已归另一处，本处结果照常交回', { event: 'audio_edit.transcription.receipt_taken_over', requestId, modelId })
    // 已付费结果在回执里，副本再无用处；删不掉（被占用）就留给口播离开作品时的缓存清理，不影响这次结果。
    if (upload) await removeUnmanagedCachePath(upload.path, { force: true }).catch(() => undefined)
    controller.signal.throwIfAborted()
    await verifyAudioEditSource(project, controller.signal)
    return result
  } catch (error) {
    billing = receipt.billing ?? billing
    // 带令牌写回：已被接管时不覆盖接管方写下的回执
    updateOwnedAudioEditTask(requestId, owner, {
      state: controller.signal.aborted ? 'cancelled' : 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      result: { ...receipt },
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

