import { createLogger } from '@/core/logging'
import { registry } from '@/core/ModelRegistry'
import type { ParamDef } from '@/core/types'
import { transferModelParamOverrides } from '@/core/params/modelParamTransfer'
import { resolveInputLimits } from '@/core/inputs/inputLimits'
import { isGenerationTerminalStatus, normalizeGenerationTaskStatus } from '@/core/application-control/domains/generation/taskStatus'
import { landVideoEditInPlaceResult, planVideoEditInPlaceGeneration, switchVideoEditClipTake, type VideoEditInPlaceIntent, type VideoEditInPlacePlan, type VideoEditInPlaceReference, type VideoEditReferenceRole } from '@/core/videoEdit/inPlaceGeneration'
import { generationApplicationService } from '@/features/generation/application/generationApplicationService'
import { subscribeVisibleGenerationTaskChanges } from '@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { observeVideoEditFrame } from './videoEditFrameObservation'
import { prepareVideoEditCreativeResult } from './videoEditCreativeSources'
import { placeVideoEditFileInProject } from './videoEditResultTarget'
import { importVideoEditSources } from './videoEditMedia'
import { editVideoProject, requireVideoEditInstance, saveVideoEdit } from './videoEditService'

/*
 * 原地生成（4.12）的执行：规划 → 放占位 → 取参考帧 → 走正式生成链路提交 → 等待 → 结果复制进项目并收录 → 一步编辑落进时间线。
 * - 生成走 generationApplicationService（与生成页、助手同一条可见任务链路），记录同时出现在生成历史里。
 * - 参考帧走 observeVideoEditFrame（正式渲染器离屏取源帧并收录为图片），上传由主进程按当前供应商的官方上传完成。
 * - 占位只在这里（运行时状态），不写进剪辑文件：取消、失败不留任何剪辑修改；完成时才做唯一的一步编辑（一次撤销）。
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
  references: VideoEditInPlaceReference[]
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
  jobs.set(id, next); publish()
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
/** 仅供测试：清空任务表。 */
export function resetVideoEditInPlaceJobsForTest(): void { for (const controller of controllers.values()) controller.abort(); controllers.clear(); jobs.clear(); publish() }

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
function selectedReferences(plan: VideoEditInPlacePlan, request: VideoEditInPlaceRequest, modelId: string, params: Record<string, unknown>): VideoEditInPlaceReference[] {
  const wanted = plan.references.filter(reference => !request.referenceRoles || request.referenceRoles.includes(reference.role))
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
  const references = selectedReferences(plan, request, modelId, params)
  const images = references.map((_, index) => placeholder(index))
  const preparation = generationApplicationService.prepare({ modelId, prompt: request.prompt, mediaType, options: { ...params, ...(images.length ? { images, uploadedFilePaths: images } : {}) } })
  return { plan, modelId, providerId: model.meta.provider, mediaType, references, params, preparation }
}

// ---- 执行 ----
function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }
function aborted(signal: AbortSignal): boolean { return signal.aborted }

/** 等生成任务到终态；进度由界面直接订阅生成进度。 */
async function waitTask(taskId: string, signal: AbortSignal): Promise<{ ok: true } | { ok: false; error: string }> {
  return await new Promise((resolve, reject) => {
    const check = (): boolean => {
      let task: ReturnType<typeof generationApplicationService.getTask>
      try { task = generationApplicationService.getTask(taskId) } catch { return false }
      if (!isGenerationTerminalStatus(task.status)) return false
      cleanup()
      const status = normalizeGenerationTaskStatus(task.status)
      resolve(status === 'success' && task.resultAvailable ? { ok: true } : { ok: false, error: task.errorMessage || (status === 'cancelled' ? '生成已取消。' : '生成没有完成。') })
      return true
    }
    const onAbort = (): void => { cleanup(); reject(signal.reason ?? new DOMException('已取消。', 'AbortError')) }
    const unsubscribe = subscribeVisibleGenerationTaskChanges(() => { check() })
    // 状态事件之外再兜底轮询（结果写回与事件可能错开）。
    const timer = setInterval(check, 2000)
    function cleanup(): void { unsubscribe(); clearInterval(timer); signal.removeEventListener('abort', onAbort) }
    signal.addEventListener('abort', onAbort, { once: true })
    check()
  })
}

async function referenceFiles(job: VideoEditInPlaceJob, references: VideoEditInPlaceReference[], signal: AbortSignal): Promise<string[]> {
  const paths: string[] = []
  for (const reference of references) {
    const observed = await observeVideoEditFrame(job.projectId, { kind: 'source', itemId: reference.itemId, timeUs: reference.sourceTimeUs }, 1920, signal)
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
    return landed.document
  })
  await saveVideoEdit(job.projectId)
  return { clipId: landed!.clipId, ...(landed!.fallback ? { fallback: landed!.fallback } : {}) }
}

async function run(job: VideoEditInPlaceJob, preparation: VideoEditInPlacePreparation, taskId: string, controller: AbortController, submitted: (taskId: string) => void, failed: (error: unknown) => void): Promise<void> {
  const signal = controller.signal
  const context = { projectId: job.projectId, jobId: job.id, action: job.plan.action, modelId: job.modelId }
  try {
    const paths = await referenceFiles(job, preparation.references, signal)
    signal.throwIfAborted()
    const options = { ...preparation.params, ...(paths.length ? { images: paths.map(toFetchableMediaUrl), uploadedFilePaths: paths } : {}) }
    const submittedTask = await generationApplicationService.submit({ modelId: job.modelId, prompt: job.request.prompt, mediaType: preparation.mediaType, options }, taskId)
    update(job.id, { status: 'generating', taskId: submittedTask.taskId })
    logger.info('原地生成已提交', { event: 'video_edit.in_place.submitted', requestId: submittedTask.taskId, taskId: submittedTask.taskId, modelId: job.modelId, context })
    submitted(submittedTask.taskId)
    const outcome = await waitTask(submittedTask.taskId, signal)
    if (!outcome.ok) throw new Error(outcome.error)
    update(job.id, { status: 'placing' })
    const landed = await land(job, submittedTask.taskId, signal)
    update(job.id, { status: 'placed', clipId: landed.clipId, ...(landed.fallback ? { fallback: landed.fallback } : {}) })
    prune()
    logger.info('原地生成已落进时间线', { event: 'video_edit.in_place.completed', requestId: submittedTask.taskId, taskId: submittedTask.taskId, modelId: job.modelId, context: { ...context, clipId: landed.clipId, fallback: landed.fallback ?? null } })
  } catch (error) {
    if (aborted(signal) || jobs.get(job.id)?.status === 'cancelled') { failed(error); return }
    const current = jobs.get(job.id)
    // 还没提交就失败（取帧、校验、供应商未配置）：撤回占位，错误交给发起方（面板里就地显示，可直接改了再试）。
    if (!current?.taskId) { jobs.delete(job.id); publish() } else update(job.id, { status: 'failed', error: message(error) })
    logger.warn('原地生成未完成', { event: 'video_edit.in_place.failed', error, ...(current?.taskId ? { requestId: current.taskId, taskId: current.taskId } : {}), modelId: job.modelId, context })
    failed(error)
  } finally { controllers.delete(job.id) }
}

export interface VideoEditInPlaceStart { job: VideoEditInPlaceJob; taskId: string }
/**
 * 开始一次原地生成：时间线上立刻出现占位，返回时任务已提交到生成链路（或在提交前失败）。
 * `taskId` 由助手按操作身份传入以保证幂等；界面省略时新建。`replacesJobId` 是被重试或换模型的失败任务。
 */
export async function startVideoEditInPlaceGeneration(request: VideoEditInPlaceRequest, options: { taskId?: string; replacesJobId?: string } = {}): Promise<VideoEditInPlaceStart> {
  const preparation = await prepareVideoEditInPlace(request)
  const job: VideoEditInPlaceJob = { id: crypto.randomUUID(), projectId: request.projectId, plan: preparation.plan, request: structuredClone(request), modelId: preparation.modelId, status: 'preparing' }
  jobs.set(job.id, job); publish()
  const controller = new AbortController(); controllers.set(job.id, controller)
  const taskId = options.taskId ?? `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  logger.info('原地生成开始', { event: 'video_edit.in_place.start', requestId: taskId, modelId: job.modelId, context: { projectId: job.projectId, jobId: job.id, action: job.plan.action, frame: job.plan.frame, duration: job.plan.duration, references: preparation.references.map(value => value.role) } })
  // 提交前（取参考帧、提交）失败时调用方拿到错误；提交后的失败只反映在占位上。
  return await new Promise<VideoEditInPlaceStart>((resolve, reject) => {
    let settled = false
    // 重试或换模型：新任务提交成功后才移除原来失败的占位，新提交失败时原占位（和它的错误）还在
    void run(job, preparation, taskId, controller, submittedId => { settled = true; if (options.replacesJobId) dismissVideoEditInPlaceJob(options.replacesJobId); resolve({ job: jobs.get(job.id)!, taskId: submittedId }) }, error => { if (!settled) { settled = true; reject(error) } })
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
  jobs.delete(id); publish()
}
/** 用同样的设置重试失败的那一次。 */
export async function retryVideoEditInPlaceJob(id: string): Promise<VideoEditInPlaceStart> {
  const job = jobs.get(id)
  if (!job || job.status !== 'failed') throw new Error('只有失败的原地生成可以重试。')
  return await startVideoEditInPlaceGeneration({ ...job.request, modelId: job.modelId }, { replacesJobId: id })
}

/** 切回替换前的镜头版本（一步编辑，可撤销）。 */
export function switchVideoEditClipTakeInProject(projectId: string, sequenceId: string, clipId: string, index: number): void {
  editVideoProject(projectId, document => switchVideoEditClipTake(document, sequenceId, clipId, index))
}
