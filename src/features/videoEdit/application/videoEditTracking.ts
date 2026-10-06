import { createLogger } from '@/core/logging'
import { videoEditClipMedia, type VideoEditClip, type VideoEditDocument } from '@/core/videoEdit/document'
import { videoEditTrackerKey, type VideoEditTracker } from '@/core/videoEdit/tracking'
import { videoEditFps } from '@/core/videoEdit/time'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { getPlatform } from '@/platform/runtime'
import { trackingDefinitionKey, type TrackingDefinition, type TrackingFailureReason, type TrackingRange, type TrackingRunOptions, type TrackingStatus } from '@/platform/contracts/tracking'
import { toFetchableMediaUrl } from '@/services/imageSource'
import { listVideoEditInstances, subscribeVideoEditDomain } from './videoEditService'

/*
 * 跟踪器协调（任务 4.10，渲染层）：打开着的剪辑里每个跟踪器，按片段用到的素材范围在后台跟踪（主进程缓存、去重）；
 * 新建或修改提示（纠错）后自动从提示帧往两边跟满片段；停止、单步、续跟由跟踪面板发起。
 * 状态供跟踪面板、效果控件、节目监视器与助手读取；结果发给渲染 Worker（效果作用区域、遮罩跟随、片段跟随）。
 * 不依赖页面是否打开：助手在后台新建跟踪也会立刻开始。
 */

const logger = createLogger('features.videoEdit.tracking')

interface Entry { definition: TrackingDefinition; status: TrackingStatus; version: number; operation?: object }
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
const exportRequests = new Map<object, Map<string, Request>>()
let revision = 0

function publish(): void { revision++; for (const listener of listeners) listener() }
export function subscribeVideoEditTracking(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditTrackingRevision(): number { return revision }

/** 片段上的一个跟踪器对应的跟踪定义与范围；片段不是视频或图片时为 undefined。 */
export function videoEditTrackingRequest(document: Pick<VideoEditDocument, 'media' | 'items'>, frameRate: { numerator: number; denominator: number }, clip: VideoEditClip, tracker: Pick<VideoEditTracker, 'method' | 'prompts'>): { definition: TrackingDefinition; range: TrackingRange } | undefined {
  const media = videoEditClipMedia(document, clip)
  if (!media || (media.kind !== 'video' && media.kind !== 'image')) return undefined
  const sourceRange = videoEditClipSourceRange(clip, videoEditFps(frameRate))
  const startUs = Math.max(0, Math.floor(sourceRange.from * 1e6)); const endUs = Math.max(startUs + 1, Math.ceil(sourceRange.to * 1e6))
  return { definition: { source: media.path, method: tracker.method, prompts: [...tracker.prompts].sort((a, b) => a.timeUs - b.timeUs) }, range: { startUs, endUs } }
}

function record(definition: TrackingDefinition, status: TrackingStatus): void {
  const key = trackingDefinitionKey(definition)
  const previous = entries.get(key)
  if (previous && JSON.stringify(previous.status) === JSON.stringify(status)) return
  // Progress alone does not rewrite the result file. Only invalidate Worker reads when a result changes or a run completes.
  const changed = Boolean(status.result && (JSON.stringify(previous?.status.result) !== JSON.stringify(status.result) || status.state === 'ready' && previous?.status.state === 'tracking'))
  entries.set(key, { definition, status, version: (previous?.version ?? 0) + (changed ? 1 : 0), operation: previous?.operation })
  publish()
}

function failed(definition: TrackingDefinition, error: unknown, event: string): void {
  logger.warn('跟踪请求失败', { event, error, context: { method: definition.method } })
  record(definition, { state: 'failed', reason: 'inference', message: error instanceof Error ? error.message.slice(0, 200) : undefined })
}

/** 开始（或继续）跟踪；跟踪面板的按钮、导出与新建后自动跟踪共用。 */
export function runVideoEditTracking(definition: TrackingDefinition, range: TrackingRange, options: TrackingRunOptions): void {
  const key = trackingDefinitionKey(definition)
  const current = entries.get(key)?.status
  record(definition, { state: 'tracking', progress: 0, direction: options.direction, ...(current?.result ? { result: current.result } : {}) })
  const operation = {}; entries.get(key)!.operation = operation
  void Promise.resolve().then(() => getPlatform().tracking.run(definition, range, options)).then(status => {
    // A progress event can finish before IPC returns its initial tracking state.
    const entry = entries.get(key)
    if (entry?.operation !== operation || entry.status.state !== 'tracking') return
    if (status.state === 'idle') failed(definition, new Error('跟踪没有开始。'), 'video_edit.tracking.run_failed')
    else record(definition, status)
  }, (error: unknown) => { if (entries.get(key)?.operation === operation) failed(definition, error, 'video_edit.tracking.run_failed') })
}

export function stopVideoEditTracking(definition: TrackingDefinition): void {
  void Promise.resolve().then(() => getPlatform().tracking.stop(definition)).catch((error: unknown) => logger.warn('停止跟踪失败', { event: 'video_edit.tracking.stop_failed', error }))
}

/** 打开着的全部剪辑里的跟踪器（定义 + 片段范围）。 */
function neededTrackers(): Map<string, { definition: TrackingDefinition; range: TrackingRange }> {
  const needed = new Map<string, { definition: TrackingDefinition; range: TrackingRange }>()
  for (const instance of listVideoEditInstances()) for (const sequence of instance.document.sequences) for (const clip of sequence.clips) for (const tracker of clip.trackers ?? []) {
    const request = videoEditTrackingRequest(instance.document, sequence.frameRate, clip, tracker)
    if (request) mergeRequest(needed, request)
  }
  for (const requests of exportRequests.values()) for (const request of requests.values()) mergeRequest(needed, request)
  return needed
}

type Request = { definition: TrackingDefinition; range: TrackingRange }
function mergeRequest(requests: Map<string, Request>, request: Request): void {
  const key = trackingDefinitionKey(request.definition); const previous = requests.get(key)
  requests.set(key, previous ? { definition: request.definition, range: { startUs: Math.min(previous.range.startUs, request.range.startUs), endUs: Math.max(previous.range.endUs, request.range.endUs) } } : request)
}
function reconcile(): void {
  const needed = neededTrackers()
  for (const [key, request] of needed) {
    if (entries.has(key)) continue
    record(request.definition, { state: 'idle' })
    const operation = {}; entries.get(key)!.operation = operation
    void Promise.resolve().then(() => getPlatform().tracking.status(request.definition)).then(status => {
      const entry = entries.get(key)
      if (entry?.operation !== operation || entry.status.state !== 'idle') return
      if (status.state === 'idle') runVideoEditTracking(request.definition, neededTrackers().get(key)?.range ?? request.range, { direction: 'both' })
      else record(request.definition, status)
    }, (error: unknown) => { if (entries.get(key)?.operation === operation) failed(request.definition, error, 'video_edit.tracking.status_failed') })
  }
  let removed = false
  for (const [key, entry] of entries) {
    if (needed.has(key)) continue
    entries.delete(key); removed = true
    if (entry.status.state === 'tracking') stopVideoEditTracking(entry.definition)
  }
  if (removed) publish()
}

let stop: (() => void) | undefined
/** 应用启动时由剪辑领域登记一次。 */
export function startVideoEditTracking(): () => void {
  if (stop) return stop
  let stopProgress = (): void => undefined
  try {
    stopProgress = getPlatform().tracking.onProgress(({ definition, status }) => { if (entries.has(trackingDefinitionKey(definition))) record(definition, status) })
  } catch (error) {
    logger.debug('跟踪不可用', { event: 'video_edit.tracking.unavailable', error })
  }
  const stopDomain = subscribeVideoEditDomain(reconcile)
  reconcile()
  stop = () => { stopProgress(); stopDomain(); stop = undefined }
  return stop
}

export function videoEditTrackingStatus(definition: TrackingDefinition | undefined): TrackingStatus | undefined {
  return definition ? entries.get(trackingDefinitionKey(definition))?.status ?? { state: 'idle' } : undefined
}

/** 跟踪结果是否覆盖片段用到的范围（差一帧以内算覆盖）。 */
export function videoEditTrackingCovers(status: TrackingStatus | undefined, range: TrackingRange): boolean {
  const result = status?.result
  if (!result) return false
  const frame = 1e6 / result.fps
  return result.startUs <= range.startUs + frame && result.endUs >= range.endUs - frame
}

/** 用户语言的失败说明（跟踪面板、导出错误与助手读取共用）。 */
export function videoEditTrackingFailureText(reason: TrackingFailureReason): string {
  switch (reason) {
    case 'model': return '跟踪需要的本地模型下载失败。检查网络后重试，或在设置 › 文件与下载 › 本地模型里手动下载、切换下载源。'
    case 'decode': return '这段素材读取不出画面，无法跟踪。'
    case 'disk': return '跟踪结果保存失败，请检查磁盘空间后重试。'
    case 'prompt': return '提示不能用：框或点要落在画面里，请在节目画面上重新框选或点选。'
    default: return '本机跟踪失败，可以重试；多次失败请到日志里查看原因。'
  }
}

/** 给助手读的状态文字：ready:<覆盖率>%、tracking:<进度>%、stopped:<覆盖率>%、failed:<说明>、idle。 */
export function videoEditTrackingStatusText(status: TrackingStatus | undefined, range: TrackingRange | undefined): string {
  if (!status || !range) return 'failed:片段不是视频或图片，跟踪不会生效。'
  const coverage = (): number => {
    const result = status.result
    if (!result) return 0
    const covered = Math.max(0, Math.min(range.endUs, result.endUs) - Math.max(range.startUs, result.startUs))
    return Math.round(covered / Math.max(1, range.endUs - range.startUs) * 100)
  }
  if (status.state === 'tracking') return `tracking:${Math.round(status.progress * 100)}%`
  if (status.state === 'failed') return `failed:${videoEditTrackingFailureText(status.reason)}`
  if (status.state === 'ready') return `${status.stopped ? 'stopped' : 'ready'}:${coverage()}%`
  return 'idle'
}

/** 发给渲染 Worker 的跟踪结果：键与 Worker 按文档算出的一致（素材 ID + 方式 + 提示）。 */
export function videoEditTrackResults(snapshot?: Pick<VideoEditDocument, 'media' | 'items'> & { clips: readonly VideoEditClip[]; frameRate: { numerator: number; denominator: number } }): Record<string, { url: string; version: string }> {
  const result: Record<string, { url: string; version: string }> = {}
  const sources = snapshot ? [{ document: snapshot, sequences: [snapshot] }] : listVideoEditInstances().map(instance => ({ document: instance.document, sequences: instance.document.sequences }))
  for (const source of sources) for (const sequence of source.sequences) for (const clip of sequence.clips) for (const tracker of clip.trackers ?? []) {
    const media = videoEditClipMedia(source.document, clip)
    const request = videoEditTrackingRequest(source.document, sequence.frameRate, clip, tracker)
    const entry = request && entries.get(trackingDefinitionKey(request.definition))
    const status = entry?.status
    // 续跟会原地更新同一个结果文件：版本（覆盖范围）变了 Worker 就重新读。
    if (media && status?.result) result[videoEditTrackerKey(media.id, tracker)] = { url: toFetchableMediaUrl(status.result.path), version: String(entry?.version ?? 0) }
  }
  return result
}

/** 导出前：这条序列用到的跟踪（效果作用区域、遮罩跟随、片段跟随）都跟满片段范围；有失败时以用户语言报错。 */
export async function waitVideoEditTracking(document: Pick<VideoEditDocument, 'media' | 'items'>, sequence: { frameRate: { numerator: number; denominator: number }; clips: readonly VideoEditClip[] }, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const used = new Set<string>()
  for (const clip of sequence.clips) {
    for (const effect of clip.effects ?? []) {
      if (!effect.enabled || effect.amount <= 0 || !effect.mask) continue
      if (effect.mask.regionId === 'tracker') used.add(`${clip.id}\u0000${effect.mask.trackerId}`)
      if (effect.mask.regionId === 'shapes') for (const shape of effect.mask.shapes) if (shape.follow) used.add(`${clip.id}\u0000${shape.follow.trackerId}`)
    }
    if (clip.follow) used.add(`${clip.follow.clipId}\u0000${clip.follow.trackerId}`)
  }
  const requests = new Map<string, { definition: TrackingDefinition; range: TrackingRange }>()
  for (const reference of used) {
    const [clipId, trackerId] = reference.split('\u0000')
    const clip = sequence.clips.find(entry => entry.id === clipId); const tracker = clip?.trackers?.find(entry => entry.id === trackerId)
    const request = clip && tracker ? videoEditTrackingRequest(document, sequence.frameRate, clip, tracker) : undefined
    if (request) mergeRequest(requests, request)
  }
  if (!requests.size) return
  const lease = {}; exportRequests.set(lease, requests)
  try {
    const attempts = new Map<string, number>()
    for (const [key, request] of requests) {
      const status = entries.get(trackingDefinitionKey(request.definition))?.status
      if (status?.state !== 'tracking' && !videoEditTrackingCovers(status, request.range)) { if (status?.state === 'ready') attempts.set(key, 1); runVideoEditTracking(request.definition, request.range, { direction: 'both' }) }
    }
    await new Promise<void>((resolve, reject) => {
      const check = (): void => {
        const statuses = [...requests.entries()].map(([key, request]) => ({ status: entries.get(key)?.status, range: request.range }))
        const failure = statuses.find(entry => entry.status?.state === 'failed')
        if (failure?.status?.state === 'failed') { finish(); reject(new Error(`跟踪失败：${videoEditTrackingFailureText(failure.status.reason)}`)); return }
        if (statuses.every(entry => entry.status?.state === 'ready' && videoEditTrackingCovers(entry.status, entry.range))) { finish(); resolve(); return }
        // 跟踪停了但没跟满（例如有人点了停止）：导出接着跟完；接着跟过一次还不满（素材比片段短），按已跟到的部分导出。
        let pending = false
        for (const [key, request] of requests) {
          const status = entries.get(key)?.status
          if (status?.state === 'tracking') { pending = true; continue }
          if (status?.state !== 'ready' || videoEditTrackingCovers(status, request.range)) continue
          if ((attempts.get(key) ?? 0) < 1) { attempts.set(key, (attempts.get(key) ?? 0) + 1); pending = true; runVideoEditTracking(request.definition, request.range, { direction: 'both' }) }
        }
        if (!pending && statuses.every(entry => entry.status?.state === 'ready')) { finish(); resolve() }
      }
      const abort = (): void => { finish(); reject(signal?.reason ?? new DOMException('已取消', 'AbortError')) }
      const unsubscribe = subscribeVideoEditTracking(check)
      const finish = (): void => { unsubscribe(); signal?.removeEventListener('abort', abort) }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort(); else check()
    })
  } finally { exportRequests.delete(lease) }
}

/** 仅供测试：清空状态。 */
export function resetVideoEditTrackingForTests(): void { stop?.(); entries.clear(); exportRequests.clear(); revision = 0 }
