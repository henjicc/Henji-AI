import crypto from 'node:crypto'
import { timestampedAsrService, prepareTimestampedAsrWithReceipt, executeTimestampedAsrWithReceipt, timestampedAsrNeverSubmitted, type TimestampedAsrReceipt } from './timestamped-asr'
import { asrUploadEncoding, estimateAsrCost, type AsrCostEstimate, type AsrUploadEncoding } from '../../../../src/core/audioEdit/asrCatalog'
import { removeUnmanagedCachePath } from '../media-recycle/cache-deletion'
import { readTranscriptionFacts, TranscriptionFailure, type TranscriptionFacts, type TranscriptionPreflight, type TranscriptionPreparation } from '../../../../src/core/audioEdit/transcriptionFailure'
import { audioEditTranscriptBlocks, type TimestampedTranscript } from '../../../../src/core/audioEdit/timestampedTranscript'
import { audioEditUntranscribedBlocks } from '../../../../src/core/audioEdit/splice'

import type {
  AudioEditProjectDocument,
  AudioEditTranscriptBlock,
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

interface TranscriptionReceipt<T = AudioEditTranscriptionResult> extends TimestampedAsrReceipt {
  output?: T
}

/** 补转写一段插入的声音所得：词块已换算到口播原素材的采样帧。 */
interface FillOutput { modelId: string; transcript: AudioEditTranscriptBlock[] }

const FULL_KIND = 'transcription'
interface FillSegment { block: AudioEditTranscriptBlock; kind: string; durationMs: number }

/**
 * 插入段还没有转写：每段单独截一份转写副本、单独登记一条任务。kind 由素材摘要与区间决定，
 * 同一段重试时认领、执行者令牌、续查与防重复计费都与整份转写同一套；素材或区间变了就是另一段。
 */
function fillSegments(project: AudioEditProjectDocument): FillSegment[] {
  const sourceDigest = audioEditSourceReceiptDigest(project.source)
  return audioEditUntranscribedBlocks(project).map(block => ({ block,
    kind: `transcription_fill:${crypto.createHash('sha256').update(`${sourceDigest}:${block.startFrame}:${block.endFrame}`).digest('hex').slice(0, 32)}`,
    durationMs: (block.endFrame - block.startFrame) * 1_000 / project.source.sampleRate }))
}

export const listAudioEditAsrModels = timestampedAsrService.listModels

/**
 * 这份口播最近一次转写（kind 指整份转写或某一段补转写）的记录：还有进程在跑（本进程，或共用数据库的助手命令行、主应用）就拒绝，
 * 不能重提也不能改标；运行中却已没有进程在跑的，先记为中断，再交给回执判断能否重新提交。ownRequestId 是本次调用自己登记的任务。
 */
function latestSettledTranscription(projectId: string, ownRequestId?: string, kind = FULL_KIND): AudioEditStoredTask | undefined {
  const task = findAudioEditTranscription(projectId, kind)
  if (!task) return undefined
  if (task.request_id !== ownRequestId && isAudioEditTaskActive(task.request_id)) throw new Error('这份口播正在转写（可能在另一个窗口或助手命令行里），请等待或取消原任务。')
  settleStaleAudioEditTask(task.request_id)
  return findAudioEditTranscription(projectId, kind)
}

/**
 * 同一 kind 的上一次记录能否不再付费：已拿到结果或能续查供应商任务的，返回要沿用的模型；
 * 确认没交给识别服务的返回 undefined（要重新付费）；交出去却无法确认、也续查不了的拒绝。
 */
function reusablePriorTranscription(task: AudioEditStoredTask | undefined, sourceDigest: string, audioPath: string, durationMs: number): { modelId?: string } | undefined {
  if (!task) return undefined
  const prior = task.result_json ? JSON.parse(task.result_json) as TranscriptionReceipt<unknown> : undefined
  if (prior?.sourceDigest !== sourceDigest) throw new Error('素材已变化，不能复用旧识别任务。')
  if (prior.output || prior.rawOutput) return { modelId: prior.modelId }
  if (task.provider_task_id) {
    const plan = timestampedAsrService.prepare({ audioPath, durationMs, modelId: prior.modelId })
    if (!client.get(plan.modelId)?.descriptor.features?.includes('resume-task')) throw new Error('原模型不能恢复查询，禁止重复提交识别。')
    return { modelId: plan.modelId }
  }
  if (!timestampedAsrNeverSubmitted(task, prior)) throw new Error(UNCONFIRMED_SUBMISSION)
  return undefined
}

/** 几段各自估价再相加（与各段各自计费一致）；有一段没有单价就整体未知。 */
function sumAsrCost(modelId: string, durations: readonly number[]): AsrCostEstimate {
  const parts = durations.map(durationMs => estimateAsrCost(modelId, durationMs))
  const first = parts[0]
  if (first?.status !== 'estimated') return { status: 'unknown', amount: null, currency: null }
  let amount = 0
  for (const part of parts) {
    if (part.status !== 'estimated' || part.currency !== first.currency) return { status: 'unknown', amount: null, currency: null }
    amount += part.amount
  }
  return { status: 'estimated', amount, currency: first.currency }
}

/** 补转写默认沿用口播第一次识别的模型（同一种时间粒度）；它的凭据已经不在时交给自动选择。 */
function fillModelId(project: AudioEditProjectDocument, requested: string | undefined): string | undefined {
  if (requested) return requested
  return timestampedAsrService.listModels().find(model => model.id === project.selectedAsrModelId && model.configured)?.id
}

/**
 * 最近一次转写再发起会怎样，与 preflight / transcribe 的拒绝条件同源：已拿到结果或能续查的供应商任务只续查、不重复计费；
 * 确认没有交给识别服务才可重新提交；交出去却无法确认、也续查不了的拒绝。
 */
function transcriptionResubmission(task: AudioEditStoredTask, sourceDigest: string): AudioEditTranscriptionResubmission {
  if (task.state === 'completed') return 'completed'
  const unfinished = task.state === 'queued' || task.state === 'running'
  if (unfinished && isAudioEditTaskRunningHere(task.request_id)) return 'running'
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
    const sourceDigest = audioEditSourceReceiptDigest(project.source)
    if (project.transcript.length) {
      // 已有转写：只看还没转写的插入段，已付过费（拿到结果或能续查）的不再计费，只按其余各段的时长估价
      const unpaid = fillSegments(project).filter(segment => !reusablePriorTranscription(latestSettledTranscription(project.id, undefined, segment.kind), sourceDigest, project.source.sourcePath, segment.durationMs))
      const modelId = fillModelId(project, input.modelId)
      if (!unpaid.length) return { ...(modelId ? { modelId } : {}), requiresConfirmation: false }
      // 上传上限按最长的一段检查：每段是单独一次识别
      const checked = await timestampedAsrService.preflight({ ...input, modelId, durationMs: Math.max(...unpaid.map(segment => segment.durationMs)) })
      return { modelId: checked.modelId, cost: sumAsrCost(checked.modelId, unpaid.map(segment => segment.durationMs)), requiresConfirmation: true }
    }
    const reused = reusablePriorTranscription(latestSettledTranscription(project.id), sourceDigest, input.sourcePath, input.durationMs)
    if (reused) return { ...reused, requiresConfirmation: false }
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

/** 没有转写的口播整份识别；已有转写的只补还没转写的插入段，没有插入段就拒绝（不覆盖已有编辑）。 */
async function transcribeRegisteredProject(request: AudioEditTranscriptionRequest & { requestId: string }, controller: AbortController): Promise<AudioEditTranscriptionResult> {
  const facts: { billing: TranscriptionFacts['billing'] } = { billing: 'not_charged' }
  try {
    const project = await requireAudioEditProject(request.projectId)
    if (project.transcript.length) {
      const segments = fillSegments(project)
      if (!segments.length) throw new Error('口播已有转写，请保留当前编辑；需要重新识别时另建口播。')
      await verifyAudioEditSource(project, controller.signal)
      return await fillUntranscribedSegments(project, segments, request, controller, facts)
    }
    await verifyAudioEditSource(project, controller.signal)
    return await runPaidTranscription<AudioEditTranscriptionResult>({
      project, kind: FULL_KIND, requestId: request.requestId, controller, facts, modelId: request.modelId, language: request.language,
      durationMs: project.source.durationFrames * 1_000 / project.source.sampleRate,
      prepareAudio: (encoding, signal) => prepareAudioEditTranscriptionAudio(project, encoding, signal),
      reuse: cached => ({ ...cached, project: { ...project, transcript: cached.project.transcript, suggestions: cached.project.suggestions,
        selectedAsrModelId: cached.modelId, editBaseline: cached.project.editBaseline } }),
      finish: (output, modelId) => {
        const transcript = audioEditTranscriptBlocks(output, project.source.sampleRate)
        if (!transcript.length) throw new Error('识别结果没有可用时间戳，请选择支持时间戳的模型重试。')
        const granularity = transcript.some((block) => block.granularity === 'word') ? 'word' : 'segment'
        // 结果交给渲染层实例接收并经文档会话保存（主进程不写口播内容）；第一次识别同时确立原文基线。
        const recognized = {
          ...project,
          transcript,
          suggestions: analyzeAudioEditTranscript(transcript, { sampleRate: project.source.sampleRate }),
          // 词块与线索都换了一批（词块 ID 按位置编，会与旧的撞号），旧线索的判断材料不能留给新线索
          suggestionHandoff: undefined,
          selectedAsrModelId: modelId,
        }
        logger.info('口播转写完成', {
          event: 'audio_edit.transcription.completed', requestId: request.requestId, modelId,
          context: { projectId: project.id, blockCount: transcript.length, granularity },
        })
        return { project: { ...recognized, editBaseline: createAudioEditBaseline(recognized, 'original') }, modelId, granularity }
      },
    })
  } catch (error) {
    throw new TranscriptionFailure(error, { ...readTranscriptionFacts(error), billing: facts.billing, targetMutation: 'none', audioDocumentId: request.projectId })
  }
}

/**
 * 逐段补转写插入段，全部拿到后一次换掉占位词块（渲染层接收后形成一步撤销）。
 * 中途失败时已付费的段留在各自回执里，再调用直接取回，不重复计费。
 */
async function fillUntranscribedSegments(project: AudioEditProjectDocument, segments: readonly FillSegment[], request: AudioEditTranscriptionRequest & { requestId: string }, controller: AbortController, facts: { billing: TranscriptionFacts['billing'] }): Promise<AudioEditTranscriptionResult> {
  const rate = project.source.sampleRate
  const preferred = fillModelId(project, request.modelId)
  const filled: AudioEditTranscriptBlock[] = []
  let modelId = preferred ?? project.selectedAsrModelId ?? ''
  let charged = false
  for (const [index, { block, kind, durationMs }] of segments.entries()) {
    const segmentFacts: { billing: TranscriptionFacts['billing'] } = { billing: 'not_charged' }
    try {
      const output = await runPaidTranscription<FillOutput>({
        project, kind, requestId: `${request.requestId}:fill-${index}`, controller, facts: segmentFacts, modelId: preferred, language: request.language, durationMs,
        prepareAudio: (encoding, signal) => prepareAudioEditTranscriptionAudio(project, encoding, signal, block),
        finish: (recognized, usedModel) => {
          const local = audioEditTranscriptBlocks(recognized, rate)
          // 插入的是一段没说话的声音时识别不出字：占位去掉即可；有字却没有时间戳才是失败
          if (!local.length && recognized.text.trim()) throw new Error('识别结果没有可用时间戳，请选择支持时间戳的模型重试。')
          const shift = (frame: number): number => Math.max(block.startFrame, Math.min(block.endFrame, block.startFrame + frame))
          const transcript = local.map((item, ordinal) => ({ ...item, id: `${block.id}:${ordinal}`, startFrame: shift(item.startFrame), endFrame: shift(item.endFrame), included: block.included, locked: block.locked }))
          return { modelId: usedModel, transcript: transcript.filter(item => item.endFrame > item.startFrame) }
        },
      })
      if (segmentFacts.billing === 'completed') charged = true
      modelId = output.modelId
      filled.push(...output.transcript)
    } catch (error) {
      // 这次调用里前面的段已经付费拿到结果：失败时如实说明有计费
      facts.billing = segmentFacts.billing === 'not_charged' && charged ? 'completed' : segmentFacts.billing
      throw error
    }
  }
  facts.billing = 'completed'
  const replaced = new Set(segments.map(segment => segment.block.id))
  const transcript = [...project.transcript.filter(item => !replaced.has(item.id)), ...filled].sort((a, b) => a.startFrame - b.startFrame)
  const suggestions = [...project.suggestions.filter(item => !item.blockIds.some(id => replaced.has(id))), ...analyzeAudioEditTranscript(filled, { sampleRate: rate })]
  const granularity = filled.some(item => item.granularity === 'word') ? 'word' : filled.length ? 'segment' : 'none'
  logger.info('插入段补转写完成', {
    event: 'audio_edit.transcription.fill_completed', requestId: request.requestId, modelId,
    context: { projectId: project.id, segments: segments.length, blockCount: filled.length, granularity },
  })
  return { project: { ...project, transcript, suggestions }, modelId, granularity }
}

/**
 * 一次付费识别（整份转写或一段插入段）：取回或续查上一次同 kind 的回执，否则认领、准备副本、提交。
 * facts.billing 随进展更新，调用方失败时据此说明是否计费。
 */
async function runPaidTranscription<T>(task: {
  project: AudioEditProjectDocument; kind: string; requestId: string; controller: AbortController; facts: { billing: TranscriptionFacts['billing'] }
  modelId?: string; language?: string; durationMs: number
  prepareAudio: (encoding: AsrUploadEncoding, signal: AbortSignal) => Promise<{ path: string; bytes: number }>
  /** 回执里已有的结果怎么交回（默认原样） */
  reuse?: (cached: T) => T
  finish: (output: TimestampedTranscript, modelId: string) => T
}): Promise<T> {
  const { project, kind, controller, facts, durationMs } = task
  const previous = latestSettledTranscription(project.id, task.requestId, kind)
  if (previous) facts.billing = 'unknown'
  const priorInput = previous?.result_json ? JSON.parse(previous.result_json) as TranscriptionReceipt<T> : undefined
  if (priorInput?.rawOutput || priorInput?.output || priorInput?.billing === 'completed') facts.billing = 'completed'
  const sourceDigest = audioEditSourceReceiptDigest(project.source)
  if (previous && priorInput?.sourceDigest !== sourceDigest) throw new Error('素材已变化，旧转写任务不能覆盖当前口播。')
  const neverSubmitted = previous ? timestampedAsrNeverSubmitted(previous, priorInput) : false
  if (neverSubmitted) facts.billing = 'not_charged'
  if (priorInput?.output) return task.reuse ? task.reuse(priorInput.output) : priorInput.output
  const rawOutput = priorInput?.rawOutput
  if (previous && !neverSubmitted && !rawOutput && (!previous.provider_task_id || !priorInput?.modelId)) throw new Error(UNCONFIRMED_SUBMISSION)
  const plan = prepareTimestampedAsrWithReceipt(timestampedAsrService, {
    modelId: priorInput?.modelId ?? task.modelId, audioPath: project.source.sourcePath,
    durationMs,
    language: priorInput?.language ?? task.language,
  }, priorInput, sourceDigest)
  const modelId = plan.modelId
  if (previous && !neverSubmitted && !rawOutput && !client.get(modelId)?.descriptor.features?.includes('resume-task')) throw new Error('此模型不支持恢复查询，已阻止自动重复提交。')
  const language = priorInput?.language ?? task.language ?? 'zh'
  const inputDigest = crypto.createHash('sha256').update(JSON.stringify({ projectId: project.id, sourceDigest, modelId, language, ...(kind === FULL_KIND ? {} : { kind }) })).digest('hex')
  const requestId = previous?.request_id ?? task.requestId
  const receipt: TranscriptionReceipt<T> = { modelId, sourceDigest, language, billing: facts.billing, rawOutput }
  if (!previous || neverSubmitted) await timestampedAsrService.preflight({ sourcePath: plan.audioPath, durationMs: plan.durationMs, modelId })
  controller.signal.throwIfAborted()
  assertAudioEditProjectIdle(project.id)
  // 这次尝试的执行者令牌。认领是一条条件写入：上面读到记录之后（preflight 期间）有人新建、接管或写过这一行，就放弃
  const owner = crypto.randomUUID()
  const claimed = claimAudioEditTask({ requestId, projectId: project.id, kind, inputDigest, owner,
    result: { modelId, sourceDigest, language, cost: plan.cost, billing: facts.billing, ...(rawOutput ? { rawOutput } : {}) },
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
    context: { projectId: project.id, kind },
  })
  let upload: { path: string; bytes: number } | undefined
  try {
    // 恢复供应商任务只按任务号查询，不读音频；新提交才准备转写副本。
    if (!previous || neverSubmitted) {
      const startedAt = performance.now()
      const encoding = asrUploadEncoding(modelId)
      upload = await task.prepareAudio(encoding, controller.signal)
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
          facts.billing = 'submitted'
          write({ state: 'running', providerTaskId: event.taskId })
        }
      },
    }, receipt, saved => {
      // 发出付费请求前的那次写入在这里：写不进去就抛错，请求不会发出
      write({ state: 'running', result: { ...saved } })
      facts.billing = saved.billing ?? 'unknown'
    })
    facts.billing = 'completed'
    const result = task.finish(output, modelId)
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
    facts.billing = receipt.billing ?? facts.billing
    // 带令牌写回：已被接管时不覆盖接管方写下的回执
    updateOwnedAudioEditTask(requestId, owner, {
      state: controller.signal.aborted ? 'cancelled' : 'failed',
      errorMessage: error instanceof Error ? error.message : String(error),
      result: { ...receipt },
    })
    logger.error('口播转写失败', {
      event: 'audio_edit.transcription.failed', requestId, modelId,
      context: { projectId: project.id, kind }, error,
    })
    throw error
  } finally {
    controllers.delete(requestId)
    release()
  }
}

