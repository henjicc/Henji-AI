import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS } from '@/core/videoEdit/time'
import { createLogger } from '@/core/logging'
import { completeInPlaceGeneration } from '@/core/services/inPlaceGeneration'
import { registry } from '@/core/ModelRegistry'
import type { ParamDef } from '@/core/types'
import { transferModelParamOverrides } from '@/core/params/modelParamTransfer'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { isGenerationTerminalStatus, normalizeGenerationTaskStatus } from '@/core/application-control/domains/generation/taskStatus'
import { landVideoEditInPlaceResult, planVideoEditInPlaceGeneration, switchVideoEditClipTake, videoEditReferenceLabel, type VideoEditInPlaceIntent, type VideoEditInPlacePlan, type VideoEditInPlaceReference, type VideoEditReferenceRole } from '@/core/videoEdit/inPlaceGeneration'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { generationApplicationService } from '@/features/generation/application/generationApplicationService'
import { databaseService } from '@/services/database'
import { videoEditInPlaceRecordSchema } from '@/core/videoEdit/inPlacePersistence'
import { VideoEditOperationFailure } from '@/core/videoEdit/operationFailure'
import { waitForGenerationCompletion as waitVideoEditGenerationTask } from '@/features/generation'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { prepareVideoEditCreativeResult } from './videoEditCreativeSources'
import { placeVideoEditFileInProject } from './videoEditResultTarget'
import { importVideoEditSources } from './videoEditMedia'
import { editVideoProject, requireVideoEditInstance, saveVideoEdit, subscribeVideoEdit, updateVideoEditInPlaceMetadata } from './videoEditService'

/*
 * 原地生成（4.12）的执行：规划 → 放占位 → 取参考帧 → 走正式生成链路提交 → 等待 → 结果复制进项目并收录 → 一步编辑落进时间线。
 * - 生成走 generationApplicationService（与生成页、助手同一条可见任务链路），记录同时出现在生成历史里。
 * - 参考帧走 observeVideoEditFrame（正式渲染器离屏取源帧并收录为图片），上传由主进程按当前供应商的官方上传完成。
 * - 占位持久化为不进撤销的文档元数据；完成时才做唯一的一步剪辑编辑（一次撤销）。
 * - 落点在完成时按当时的剪辑重新求（core/videoEdit/inPlaceGeneration.ts），生成期间不阻塞编辑。
 */

const logger = createLogger('features.videoEdit.inPlaceGeneration')

export interface VideoEditInPlaceRequest {
  projectId: string
  sequenceId: string
  intent: VideoEditInPlaceIntent
  prompt: string
  /** 省略时用默认模型中已配置、且能接受这次输入的那个。 */
  modelId?: string
  /** 模型参数；省略的按模型默认值，时长与画面比例按落点和序列自动换算。 */
  params?: Record<string, unknown>
  /** 要带入的参考帧；省略时带入规划给出的全部参考（受模型能接受的图片数量限制）。 */
  referenceRoles?: VideoEditReferenceRole[]
  /** 指定目标序列的节目帧；省略时不带入，和自动参考来源独立选择。 */
  referenceFrame?: number
}
export type VideoEditInPlaceStatus = 'preparing' | 'generating' | 'placing' | 'failed' | 'placed' | 'cancelled'
export interface VideoEditInPlaceJob {
  id: string
  projectId: string
  plan: VideoEditInPlacePlan
  request: VideoEditInPlaceRequest
  modelId: string
  status: VideoEditInPlaceStatus
  taskId?: string
  clipId?: string
  error?: string
  /** 落位时原落点被占用或原片段已删除，改放到了新轨道上。 */
  fallback?: 'clip_missing' | 'slot_taken'
}
export interface VideoEditInPlacePreparation {
  plan: VideoEditInPlacePlan
  modelId: string
  providerId: string
  mediaType: 'image' | 'video' | 'audio'
  /** 实际带入的参考帧（按模型可接受的图片数量截取）。 */
  references: VideoEditInPlaceSelectedReference[]
  params: Record<string, unknown>
  preparation: Record<string, unknown>
}

const ACTION_LABELS = { generate_shot: '生成镜头', replace_shot: '替换镜头', extend_shot: '延长镜头', generate_audio: '配音 / 配乐' } as const
export function videoEditInPlaceActionLabel(action: VideoEditInPlaceIntent['action']): string { return ACTION_LABELS[action] }

// ---- 任务表（运行时状态，界面用 useSyncExternalStore 订阅） ----
const jobs = new Map<string, VideoEditInPlaceJob>()
const controllers = new Map<string, AbortController>()
const listeners = new Set<() => void>()
let version = 0
let snapshot: readonly VideoEditInPlaceJob[] = []
const FINISHED_KEEP = 50
function publish(): void { version++; snapshot = [...jobs.values()]; for (const listener of listeners) listener() }
function update(id: string, patch: Partial<VideoEditInPlaceJob>): VideoEditInPlaceJob | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  const next = { ...job, ...patch }
  jobs.set(id, next); persist(next); publish()
  return next
}
function prune(): void {
  const finished = [...jobs.values()].filter(job => job.status === 'placed' || job.status === 'cancelled')
  for (const job of finished.slice(0, Math.max(0, finished.length - FINISHED_KEEP))) jobs.delete(job.id)
}
export function subscribeVideoEditInPlaceJobs(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditInPlaceJobsVersion(): number { return version }
export function listVideoEditInPlaceJobs(): readonly VideoEditInPlaceJob[] { return snapshot }
export function readVideoEditInPlaceJob(id: string): VideoEditInPlaceJob | undefined { return jobs.get(id) }
export function findVideoEditInPlaceJobByTask(taskId: string): VideoEditInPlaceJob | undefined { return [...jobs.values()].find(job => job.taskId === taskId) }
/** 完成占位已清除时，从文档片段及镜头版本的持久来源读回，绝不重新落位。 */
export function findVideoEditPlacedGeneration(projectId: string, taskId: string): { clipId: string; takeIndex?: number } | undefined {
  const owner = requireVideoEditInstance(projectId)
  for (const sequence of owner.document.sequences) for (const clip of sequence.clips) {
    if (clip.creativeSource?.type === 'generation' && clip.creativeSource.recordId === taskId) return { clipId: clip.id }
    const takeIndex = clip.takes?.findIndex(take => take.creativeSource?.type === 'generation' && take.creativeSource.recordId === taskId) ?? -1
    if (takeIndex >= 0) return { clipId: clip.id, takeIndex }
  }
  return undefined
}

export function requireVideoEditFailedGeneration(projectId: string, taskId: string): VideoEditInPlaceJob {
  requireVideoEditInstance(projectId)
  const job = findVideoEditInPlaceJobByTask(taskId)
  if (!job || job.projectId !== projectId || job.status !== 'failed') throw new VideoEditOperationFailure('请引用这个剪辑保留的失败原地生成任务。', { reason: 'failed_task_missing', availableTaskRefs: listVideoEditInPlaceJobs().filter(value => value.projectId === projectId && value.status === 'failed' && value.taskId).map(value => ({ kind: 'generation.task', id: value.taskId })) })
  return job
}

/** 新的付费提交只能替换确认生成失败的占位；成功或未知结果一律走原任务恢复。 */
export async function assertVideoEditInPlaceRegeneration(job: VideoEditInPlaceJob): Promise<void> {
  if (!job.taskId) throw new Error('原任务身份缺失，不能重新提交。')
  let status: string | undefined
  try { status = generationApplicationService.getTask(job.taskId).status } catch { status = undefined }
  const history = await databaseService.getHistoryById(job.taskId)
  const successful = Boolean(job.clipId) || normalizeGenerationTaskStatus(status ?? '') === 'success' || normalizeGenerationTaskStatus(history?.status ?? '') === 'success'
  if (successful || ![history?.status, status].some(value => isGenerationTerminalStatus(value ?? ''))) throw new VideoEditOperationFailure('原任务已成功或结果尚未确认，请恢复原任务落位/保存，不要重新付费生成。', { reason: 'recover_original', taskRef: { kind: 'generation.task', id: job.taskId }, capabilityId: 'recover_video_edit_in_place_generation', replayGeneration: false })
}
/** 仅供测试：清空任务表。 */
export function resetVideoEditInPlaceJobsForTest(): void { for (const controller of controllers.values()) controller.abort(); controllers.clear(); jobs.clear(); publish() }

function persist(job: VideoEditInPlaceJob): void {
  let owner: ReturnType<typeof requireVideoEditInstance>
  try { owner = requireVideoEditInstance(job.projectId) } catch { return }
  const records = (owner.document.inPlaceGenerations ?? []).filter(value => value.id !== job.id)
  if (job.taskId && job.status !== 'placed' && job.status !== 'cancelled') {
    const { projectId: _projectId, ...request } = job.request
    records.push(videoEditInPlaceRecordSchema.parse({ id: job.id, taskId: job.taskId, modelId: job.modelId, plan: job.plan, request,
      status: job.status, ...(job.error ? { error: job.error.slice(0, 10_000) } : {}), ...(job.clipId ? { clipId: job.clipId } : {}),
    }))
  }
  updateVideoEditInPlaceMetadata(job.projectId, records)
}

function recordFailure(id: string, error: unknown): void {
  const job = jobs.get(id)
  if (!job) return
  const next: VideoEditInPlaceJob = { ...job, status: 'failed', error: message(error) }
  jobs.set(id, next)
  // 退出写屏障或保存异常不能再从失败处理抛出未捕获错误；保留原任务号供重开续查。
  try { persist(next) } catch (metadataError) {
    logger.warn('原地生成恢复信息未能更新，请保存剪辑后核对原任务', { event: 'video_edit.in_place.metadata.failed', error: metadataError, requestId: job.taskId, taskId: job.taskId, context: { projectId: job.projectId } })
  }
  publish()
}

/** 只暂停剪辑的等待/落位，生成任务继续；关闭屏障已经保存其续接元数据。 */
function watchOwner(job: VideoEditInPlaceJob, controller: AbortController): () => void {
  const owner = requireVideoEditInstance(job.projectId)
  return subscribeVideoEdit(() => {
    let current: typeof owner | undefined
    try { current = requireVideoEditInstance(job.projectId) } catch { current = undefined }
    if (current === owner) return
    controller.abort(new DOMException('剪辑已关闭，重新打开后继续落位。', 'AbortError'))
    if (controllers.get(job.id) === controller) { controllers.delete(job.id); jobs.delete(job.id); publish() }
  })
}

/** 文档打开即恢复，同一会话多次请求不会启动第二个落位器。失败占位保留原设置。 */
export function restoreVideoEditInPlaceJobs(projectId: string): void {
  const owner = requireVideoEditInstance(projectId)
  const records = owner.document.inPlaceGenerations ?? []
  // 文件重新载入时以新的元数据为准，移除旧文件的落位器。
  for (const job of jobs.values()) if (job.projectId === projectId && job.status !== 'placed' && job.status !== 'cancelled' && !records.some(record => record.id === job.id)) {
    controllers.get(job.id)?.abort(new DOMException('占位已从剪辑文件移除。', 'AbortError'))
    controllers.delete(job.id); jobs.delete(job.id)
  }
  for (const record of records) {
    if (controllers.has(record.id)) continue
    const job: VideoEditInPlaceJob = { ...record, status: record.status === 'preparing' ? 'generating' : record.status, projectId, request: { ...record.request, projectId } }
    jobs.set(job.id, job)
    if (job.status !== 'failed') {
      const controller = new AbortController(); controllers.set(job.id, controller)
      void resume(job, controller)
    }
  }
  publish()
}

async function resume(job: VideoEditInPlaceJob, controller: AbortController): Promise<void> {
  const unwatch = watchOwner(job, controller)
  logger.info('恢复剪辑原地生成', { event: 'video_edit.in_place.restore.start', requestId: job.taskId, taskId: job.taskId, context: { projectId: job.projectId } })
  try {
    await complete(job, job.taskId!, controller.signal, true)
    logger.info('剪辑原地生成已恢复落位', { event: 'video_edit.in_place.restore.completed', requestId: job.taskId, taskId: job.taskId, context: { projectId: job.projectId } })
  } catch (error) {
    if (!controller.signal.aborted) {
      recordFailure(job.id, error)
      logger.warn('剪辑原地生成恢复未完成', { event: 'video_edit.in_place.restore.failed', error, requestId: job.taskId, taskId: job.taskId })
    }
  } finally { unwatch(); if (controllers.get(job.id) === controller) controllers.delete(job.id) }
}

// ---- 规划与参数 ----
export function planVideoEditInPlace(projectId: string, sequenceId: string, intent: VideoEditInPlaceIntent): VideoEditInPlacePlan {
  const owner = requireVideoEditInstance(projectId)
  const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  const view = owner.activeSequenceId === sequenceId ? owner : owner.sequenceViews.get(sequenceId)
  const targets = (view?.targetTrackIds ?? []).flatMap(id => { const track = sequence?.tracks.find(value => value.id === id); return track ? [track.index] : [] })
  return planVideoEditInPlaceGeneration(owner.document, sequenceId, intent, targets)
}

function ratioText(width: number, height: number): string {
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a
  const divisor = gcd(width, height) || 1
  return `${width / divisor}:${height / divisor}`
}
/**
 * 落点的意图（时长、画面比例）换算到模型参数：借用模型切换时的同一套语义换算（时长、比例按最接近的可选值），
 * 只看参数的语义，不认具体模型。
 */
export function videoEditInPlaceDefaultParams(modelId: string, plan: VideoEditInPlacePlan): Record<string, unknown> {
  const intentSchema = [
    { id: 'duration', type: 'number', order: 0, name: { zh: '时长', en: 'Duration' }, default: 0 },
    { id: 'aspect_ratio', type: 'dropdown', order: 1, name: { zh: '画面比例', en: 'Aspect ratio' }, default: '', options: [{ value: ratioText(plan.width, plan.height), label: ratioText(plan.width, plan.height) }] },
  ] as ParamDef[]
  const overrides = transferModelParamOverrides({
    sourceSchema: intentSchema,
    targetSchema: registry.getSchema(modelId),
    sourceValues: { duration: Math.max(1, Math.round(plan.duration / plan.fps)), ...(plan.mediaType === 'video' ? { aspect_ratio: ratioText(plan.width, plan.height) } : {}) },
    sourceDefaults: { duration: 0, aspect_ratio: '' },
  })
  return { ...registry.getDefaultValues(modelId), ...overrides }
}

/** 这个模型最多能带几张参考帧（按当前参数）。 */
export function videoEditInPlaceReferenceLimit(modelId: string, params: Record<string, unknown>, wanted: number): number {
  try { return Math.max(0, Math.min(wanted, resolveInputLimits(modelId, params as DynamicValueMap, { imagesCount: wanted }).images.max)) } catch { return 0 }
}

function modelMatches(plan: VideoEditInPlacePlan, type: string): boolean {
  return plan.mediaType === 'audio' ? type === 'audio' : type === 'video' || type === 'image'
}
export function videoEditInPlaceModelMismatch(plan: VideoEditInPlacePlan, modelId: string): string | null {
  const model = registry.getModel(modelId)
  if (!model) return '所选模型不存在，请换一个模型。'
  return modelMatches(plan, model.meta.type) ? null : plan.mediaType === 'audio' ? '配音 / 配乐需要声音模型（语音合成或音乐生成）。' : '镜头需要视频模型（也可以用图片模型生成静帧）。'
}

const placeholder = (index: number): string => `video-edit-reference-${index + 1}.png`
export type VideoEditInPlaceSelectedReference = VideoEditInPlaceReference | { role: 'specified_time'; sequenceId: string; frame: number }
export function videoEditInPlaceReferenceLabel(reference: VideoEditInPlaceSelectedReference, fps: number): string {
  return reference.role === 'specified_time' ? `指定时间 ${videoEditFrameTimecode(reference.frame, fps)} 的节目画面` : videoEditReferenceLabel(reference)
}
/** 界面、准备和提交的唯一参考选择入口；不取帧，不改变播放头。 */
export function selectVideoEditInPlaceReferences(plan: VideoEditInPlacePlan, selection: Pick<VideoEditInPlaceRequest, 'referenceRoles' | 'referenceFrame'>): VideoEditInPlaceSelectedReference[] {
  const available = plan.references.map(reference => reference.role)
  const invalid = selection.referenceRoles?.filter(role => !available.includes(role)) ?? []
  if (invalid.length) throw new Error(`本次落点没有参考来源 ${invalid.join('、')}；可用来源：${available.join('、') || '无'}，可用 referenceRoles=[] 取消自动参考。`)
  const wanted: VideoEditInPlaceSelectedReference[] = plan.references.filter(reference => selection.referenceRoles === undefined || selection.referenceRoles.includes(reference.role))
  if (selection.referenceFrame !== undefined) {
    if (plan.mediaType === 'audio') throw new Error('声音生成不接受参考画面，请取消指定时间帧。')
    const limit = Math.floor(plan.fps * VIDEO_EDIT_MAX_SEQUENCE_SECONDS)
    if (!Number.isSafeInteger(selection.referenceFrame) || selection.referenceFrame < 0 || selection.referenceFrame >= limit) throw new Error(`参考帧须为目标序列 0 到 ${limit - 1} 范围内的整数帧。`)
    wanted.push({ role: 'specified_time', sequenceId: plan.sequenceId, frame: selection.referenceFrame })
  }
  return wanted
}
export function selectedVideoEditInPlaceReferences(plan: VideoEditInPlacePlan, request: VideoEditInPlaceRequest, modelId: string, params: Record<string, unknown>): VideoEditInPlaceSelectedReference[] {
  const wanted = selectVideoEditInPlaceReferences(plan, request)
  return wanted.slice(0, videoEditInPlaceReferenceLimit(modelId, params, wanted.length))
}

/** 提交前的完整检查（不取帧、不付费）：落点、模型、参数、参考帧数量与预估费用。界面、助手与提交共用。 */
export async function prepareVideoEditInPlace(request: VideoEditInPlaceRequest): Promise<VideoEditInPlacePreparation> {
  const plan = planVideoEditInPlace(request.projectId, request.sequenceId, request.intent)
  const modelId = request.modelId ?? (await generationApplicationService.resolveModel({ mediaType: plan.mediaType, prompt: request.prompt.trim() || '镜头', options: {} })).modelId
  const mismatch = videoEditInPlaceModelMismatch(plan, modelId)
  if (mismatch) throw new Error(mismatch)
  const model = registry.getModel(modelId)!
  const mediaType = model.meta.type as VideoEditInPlacePreparation['mediaType']
  const params = { ...videoEditInPlaceDefaultParams(modelId, plan), ...(request.params ?? {}) }
  const references = selectedVideoEditInPlaceReferences(plan, request, modelId, params)
  const images = references.map((_, index) => placeholder(index))
  const preparation = generationApplicationService.prepare({ modelId, prompt: request.prompt, mediaType, options: { ...params, ...(images.length ? { images, uploadedFilePaths: images } : {}) } })
  return { plan, modelId, providerId: model.meta.provider, mediaType, references, params, preparation }
}

// ---- 执行 ----
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function aborted(signal: AbortSignal): boolean { return signal.aborted }

export { waitForGenerationCompletion as waitVideoEditGenerationTask } from '@/features/generation'

async function referenceFiles(job: VideoEditInPlaceJob, references: VideoEditInPlaceSelectedReference[], signal: AbortSignal): Promise<string[]> {
  const paths: string[] = []
  for (const reference of references) {
    const target = reference.role === 'specified_time' ? { kind: 'program' as const, sequenceId: reference.sequenceId, frame: reference.frame } : { kind: 'source' as const, itemId: reference.itemId, timeUs: reference.sourceTimeUs }
    const observed = await observeVideoEditFrame(job.projectId, target, 1920, signal)
    paths.push(observed.asset.filePath)
  }
  return paths
}

async function land(job: VideoEditInPlaceJob, taskId: string, signal: AbortSignal): Promise<{ clipId: string; fallback?: VideoEditInPlaceJob['fallback'] }> {
  const assertTarget = (): void => { signal.throwIfAborted(); requireVideoEditInstance(job.projectId) }
  const prepared = await prepareVideoEditCreativeResult({ type: 'generation', recordId: taskId, outputIndex: 0 }, { signal, assertTarget, place: path => placeVideoEditFileInProject(requireVideoEditInstance(job.projectId), path) })
  assertTarget()
  let landed: ReturnType<typeof landVideoEditInPlaceResult> | undefined
  await importVideoEditSources(job.projectId, [{ assetId: prepared.asset.id }], undefined, signal, (document, itemIds) => {
    const item = document.items.find(value => itemIds.includes(value.id) && document.media.some(media => media.id === value.mediaId && media.assetId === prepared.asset.id))
    if (!item) throw new Error('生成结果没有导入项目。')
    landed = landVideoEditInPlaceResult(document, job.plan, item.id, prepared.origin)
    // 落位与已应用标记是同一份内容；保存响应丢失/崩溃重开仅保存，不再次放置。
    return { ...landed.document, inPlaceGenerations: (document.inPlaceGenerations ?? []).map(value => value.id === job.id ? { ...value, status: 'placing' as const, clipId: landed!.clipId } : value) }
  })
  // 在等待保存前记住已发生的编辑：保存失败/取消竞态不能再次导入同一结果。
  update(job.id, { clipId: landed!.clipId })
  return { clipId: landed!.clipId, ...(landed!.fallback ? { fallback: landed!.fallback } : {}) }
}

async function complete(job: VideoEditInPlaceJob, taskId: string, signal: AbortSignal, recovering = false): Promise<void> {
  const landed = await completeInPlaceGeneration({ signal,
    readApplied: () => { const current = jobs.get(job.id) ?? job; return current.clipId ? { clipId: current.clipId, fallback: current.fallback } : undefined },
    wait: () => waitVideoEditGenerationTask(taskId, signal, recovering),
    place: async () => { update(job.id, { status: 'placing', error: undefined }); return land(job, taskId, signal) },
    markApplied: result => update(job.id, result), save: () => saveVideoEdit(job.projectId) })
  update(job.id, { status: 'placed', error: undefined, clipId: landed.clipId, ...(landed.fallback ? { fallback: landed.fallback } : {}) })
  await saveVideoEdit(job.projectId)
  prune()
}

async function run(job: VideoEditInPlaceJob, preparation: VideoEditInPlacePreparation, taskId: string, controller: AbortController, submitted: (taskId: string) => Promise<void> | void, failed: (error: unknown) => void): Promise<void> {
  const signal = controller.signal
  const unwatch = watchOwner(job, controller)
  let submittedId: string | undefined
  const context = { projectId: job.projectId, jobId: job.id, action: job.plan.action, modelId: job.modelId }
  try {
    // 先持久登记续接点；即使提交响应丢失，也只查同一个任务号而不重放付费生成。
    persist(job)
    await saveVideoEdit(job.projectId)
    const paths = await referenceFiles(job, preparation.references, signal)
    signal.throwIfAborted()
    const options = { ...preparation.params, ...(paths.length ? { images: paths.map(toFetchableMediaUrl), uploadedFilePaths: paths } : {}) }
    const submittedTask = await generationApplicationService.submit({ modelId: job.modelId, prompt: job.request.prompt, mediaType: preparation.mediaType, options }, taskId)
    submittedId = submittedTask.taskId
    signal.throwIfAborted()
    update(job.id, { status: 'generating', taskId: submittedTask.taskId })
    logger.info('原地生成已提交', { event: 'video_edit.in_place.submitted', requestId: submittedTask.taskId, taskId: submittedTask.taskId, modelId: job.modelId, context })
    await submitted(submittedTask.taskId)
    await complete(job, submittedTask.taskId, signal)
    logger.info('原地生成已落进时间线', { event: 'video_edit.in_place.completed', requestId: submittedTask.taskId, taskId: submittedTask.taskId, modelId: job.modelId, context: { ...context, clipId: jobs.get(job.id)?.clipId } })
  } catch (error) {
    if (aborted(signal) || jobs.get(job.id)?.status === 'cancelled') { failed(error); return }
    const current = jobs.get(job.id)
    // 还没提交就失败（取帧、校验、供应商未配置）：撤回占位，错误交给发起方（面板里就地显示，可直接改了再试）。
    if (!submittedId) {
      try { persist({ ...job, status: 'cancelled' }) } catch (metadataError) {
        logger.warn('原地生成提交失败后占位尚未保存', { event: 'video_edit.in_place.metadata.failed', error: metadataError, requestId: taskId, taskId, context: { projectId: job.projectId } })
      }
      jobs.delete(job.id); publish()
    } else recordFailure(job.id, error)
    logger.warn('原地生成未完成', { event: 'video_edit.in_place.failed', error, ...(current?.taskId ? { requestId: current.taskId, taskId: current.taskId } : {}), modelId: job.modelId, context })
    failed(error)
  } finally { unwatch(); if (controllers.get(job.id) === controller) controllers.delete(job.id) }
}

export interface VideoEditInPlaceStart { job: VideoEditInPlaceJob; taskId: string }
/**
 * 开始一次原地生成：时间线上立刻出现占位，返回时任务已提交到生成链路（或在提交前失败）。
 * `taskId` 由助手按操作身份传入以保证幂等；界面省略时新建。`replacesJobId` 是被重试或换模型的失败任务。
 */
export async function startVideoEditInPlaceGeneration(request: VideoEditInPlaceRequest, options: { taskId?: string; replacesJobId?: string } = {}): Promise<VideoEditInPlaceStart> {
  if (options.replacesJobId) {
    const original = readVideoEditInPlaceJob(options.replacesJobId)
    if (!original || original.projectId !== request.projectId || original.status !== 'failed') throw new Error('原失败占位不存在或不属于目标剪辑。')
    await assertVideoEditInPlaceRegeneration(original)
  }
  const preparation = await prepareVideoEditInPlace(request)
  const taskId = options.taskId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const job: VideoEditInPlaceJob = { id: crypto.randomUUID(), projectId: request.projectId, plan: preparation.plan, request: structuredClone(request), modelId: preparation.modelId, status: 'preparing', taskId }
  jobs.set(job.id, job); publish()
  const controller = new AbortController(); controllers.set(job.id, controller)
  logger.info('原地生成开始', { event: 'video_edit.in_place.start', requestId: taskId, modelId: job.modelId, context: { projectId: job.projectId, jobId: job.id, action: job.plan.action, frame: job.plan.frame, duration: job.plan.duration, references: preparation.references.map(value => value.role) } })
  // 提交前（取参考帧、提交）失败时调用方拿到错误；提交后的失败只反映在占位上。
  return await new Promise<VideoEditInPlaceStart>((resolve, reject) => {
    let settled = false
    // 重试或换模型：新任务提交成功后才移除原来失败的占位，新提交失败时原占位（和它的错误）还在
    void run(job, preparation, taskId, controller, async submittedId => {
      if (options.replacesJobId) {
        dismissVideoEditInPlaceJob(options.replacesJobId)
        try { await saveVideoEdit(request.projectId) } catch (error) {
          const failure = new VideoEditOperationFailure('新的生成已经提交，但占位保存未确认。请恢复这个新任务，不要重复付费提交。', { reason: 'submitted_save_failed', taskRef: { kind: 'generation.task', id: submittedId }, capabilityId: 'recover_video_edit_in_place_generation', replayGeneration: false })
          failure.cause = error
          throw failure
        }
      }
      settled = true; resolve({ job: jobs.get(job.id)!, taskId: submittedId })
    }, error => { if (!settled) { settled = true; reject(error) } })
  })
}

/** 取消：撤回占位，正在生成的任务一并取消；已经完成的生成结果留在生成记录里。不改剪辑。 */
export async function cancelVideoEditInPlaceJob(id: string): Promise<void> {
  const job = jobs.get(id)
  if (!job || job.status === 'placed' || job.status === 'cancelled') return
  update(id, { status: 'cancelled' })
  controllers.get(id)?.abort(new DOMException('已取消原地生成。', 'AbortError'))
  logger.info('原地生成已取消', { event: 'video_edit.in_place.cancelled', ...(job.taskId ? { requestId: job.taskId, taskId: job.taskId } : {}), context: { projectId: job.projectId, jobId: id } })
  if (job.taskId) {
    try { if (generationApplicationService.getTask(job.taskId).cancellable) await generationApplicationService.cancelTask(job.taskId, '已在剪辑时间线取消原地生成') } catch (error) { logger.warn('原地生成的生成任务取消未确认', { event: 'video_edit.in_place.cancel_task_failed', error, requestId: job.taskId, taskId: job.taskId }) }
  }
  prune()
}
/** 移除失败的占位（不重试）。 */
export function dismissVideoEditInPlaceJob(id: string): void {
  const job = jobs.get(id)
  if (!job || job.status !== 'failed') return
  persist({ ...job, status: 'cancelled' }); jobs.delete(id); publish()
}
/** 用同样的设置重试失败的那一次。 */
export async function retryVideoEditInPlaceJob(id: string, options: { recoveryOnly?: boolean; taskId?: string } = {}): Promise<VideoEditInPlaceStart> {
  const job = jobs.get(id)
  if (!job || job.status !== 'failed') throw new Error('只有失败的原地生成可以重试。')
  // 生成已成功但落位/保存失败：复用原结果，不发起新的付费请求。
  let successful = Boolean(job.clipId)
  let terminal = false
  if (!successful && job.taskId) {
    try { const status = generationApplicationService.getTask(job.taskId).status; successful = normalizeGenerationTaskStatus(status) === 'success'; terminal = isGenerationTerminalStatus(status) } catch { successful = false }
    if (!successful) { const status = (await databaseService.getHistoryById(job.taskId))?.status ?? ''; successful = normalizeGenerationTaskStatus(status) === 'success'; terminal ||= isGenerationTerminalStatus(status) }
  }
  if ((successful || options.recoveryOnly && !terminal) && job.taskId) {
    update(id, { status: 'placing', error: undefined })
    const controller = new AbortController(); controllers.set(id, controller)
    void resume(jobs.get(id)!, controller)
    return { job: jobs.get(id)!, taskId: job.taskId }
  }
  if (options.recoveryOnly) throw new VideoEditOperationFailure('原生成任务没有已完成的结果。若确认生成失败，可携带 replacesTaskRef 检查并提交新的付费生成；移除失败占位无需生成。', { reason: 'generation_failed', taskRef: { kind: 'generation.task', id: job.taskId }, capabilityId: 'generate_video_edit_in_place', retryField: 'replacesTaskRef' })
  return await startVideoEditInPlaceGeneration({ ...job.request, modelId: job.modelId }, { replacesJobId: id, taskId: options.taskId })
}

/** 切回替换前的镜头版本（一步编辑，可撤销）。 */
export function switchVideoEditClipTakeInProject(projectId: string, sequenceId: string, clipId: string, index: number): void {
  editVideoProject(projectId, document => switchVideoEditClipTake(document, sequenceId, clipId, index))
}
