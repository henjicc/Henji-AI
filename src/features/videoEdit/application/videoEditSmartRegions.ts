import { createLogger } from '@/core/logging'
import { videoEditClipMedia, type VideoEditClip, type VideoEditDocument, type VideoEditMedia } from '@/core/videoEdit/document'
import type { VideoEditEffect } from '@/core/videoEdit/compositing'
import { smartRegionAnalysisKind, type SmartRegionAnalysisKind } from '@/core/videoEdit/smartRegions'
import { isSmartRegionMask } from '@/core/videoEdit/effectMasks'
import { videoEditFps } from '@/core/videoEdit/time'
import { getPlatform } from '@/platform/runtime'
import { normalizeSmartRegionRange, smartRegionRequestKey, type SmartRegionFailureReason, type SmartRegionRequest, type SmartRegionStatus } from '@/platform/contracts/smartRegions'
import { toFetchableMediaUrl } from '@/services/imageSource'
import type { VideoEditSmartRegionSegments } from '../engine/videoEditSmartRegionMasks'
import { listVideoEditInstances, subscribeVideoEditDomain } from './videoEditService'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'

/*
 * 智能区域协调（任务 4.7d，渲染层）：打开着的剪辑里，凡是挂了“作用区域”的内置画面效果，就按片段用到的素材范围
 * 请求后台分析（主进程去重、缓存），记下每个请求的进度与结果，供效果控件显示、预览与导出取用、助手读取。
 * 不依赖页面是否打开：助手在后台给片段加“人脸打码”也会立刻开始分析。
 */

const logger = createLogger('features.videoEdit.smartRegions')

interface Entry { request: SmartRegionRequest; status: SmartRegionStatus }
const entries = new Map<string, Entry>()
const listeners = new Set<() => void>()
let revision = 0

function publish(): void { revision++; for (const listener of listeners) listener() }
export function subscribeVideoEditSmartRegions(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function videoEditSmartRegionsRevision(): number { return revision }

/** 片段 + 效果需要的分析请求；片段不是画面素材（文字、图形、调整图层等）时为 undefined。 */
export function videoEditSmartRegionRequest(document: Pick<VideoEditDocument, 'media' | 'items'>, frameRate: { numerator: number; denominator: number }, clip: VideoEditClip, effect: Pick<VideoEditEffect, 'mask'>): SmartRegionRequest | undefined {
  // 只有智能区域要分析素材；手绘遮罩（4.10）是确定的几何，不需要分析。
  if (!isSmartRegionMask(effect.mask)) return undefined
  const media = videoEditClipMedia(document, clip)
  return media ? requestFor(media, smartRegionAnalysisKind(effect.mask.regionId), clip, videoEditFps(frameRate)) : undefined
}

function requestFor(media: VideoEditMedia, kind: SmartRegionAnalysisKind, clip: VideoEditClip, fps: number): SmartRegionRequest | undefined {
  if (media.kind !== 'video' && media.kind !== 'image') return undefined
  const still = media.kind === 'image'
  // 片段用到的源范围按速度与倒放换算（4.13 clipSpeed.ts）。
  const range = videoEditClipSourceRange(clip, fps)
  const startUs = Math.max(0, Math.floor(range.from * 1e6)); const endUs = Math.ceil(range.to * 1e6)
  return { source: media.path, kind, still, ...normalizeSmartRegionRange(startUs, endUs, still) }
}

/** 打开着的全部剪辑里需要的分析请求（含暂时关闭的效果：打开时马上可用）。 */
function neededRequests(): Map<string, SmartRegionRequest> {
  const needed = new Map<string, SmartRegionRequest>()
  for (const instance of listVideoEditInstances()) {
    const document = instance.document
    for (const sequence of document.sequences) for (const clip of sequence.clips) for (const effect of clip.effects ?? []) {
      const request = videoEditSmartRegionRequest(document, sequence.frameRate, clip, effect)
      if (request) needed.set(smartRegionRequestKey(request), request)
    }
  }
  return needed
}

function record(request: SmartRegionRequest, status: SmartRegionStatus): void {
  const key = smartRegionRequestKey(request)
  const previous = entries.get(key)
  if (previous && JSON.stringify(previous.status) === JSON.stringify(status)) return
  entries.set(key, { request, status })
  publish()
}

function ensure(request: SmartRegionRequest): void {
  const current = entries.get(smartRegionRequestKey(request))?.status
  record(request, current?.state === 'ready' ? current : { state: 'analyzing', progress: 0 })
  void Promise.resolve().then(() => getPlatform().smartRegions.ensure(request)).then(status => record(request, status), (error: unknown) => {
    logger.warn('智能区域分析请求失败', { event: 'video_edit.smart_region.ensure_failed', error, context: { kind: request.kind } })
    record(request, { state: 'failed', reason: 'inference' })
  })
}

/** 新出现的需求开始分析；不再需要且还在分析的取消；失败的不自动重试（由用户点“重试”或修改设置后重新请求）。 */
function reconcile(): void {
  const needed = neededRequests()
  for (const [key, request] of needed) if (!entries.has(key)) ensure(request)
  for (const [key, entry] of entries) {
    if (needed.has(key)) continue
    entries.delete(key)
    if (entry.status.state === 'analyzing') void Promise.resolve().then(() => getPlatform().smartRegions.cancel(entry.request)).catch(() => undefined)
  }
}

let stop: (() => void) | undefined
/** 应用启动时由剪辑领域登记一次。 */
export function startVideoEditSmartRegions(): () => void {
  if (stop) return stop
  let stopProgress = (): void => undefined
  try {
    stopProgress = getPlatform().smartRegions.onProgress(({ request, status }) => { if (entries.has(smartRegionRequestKey(request))) record(request, status) })
  } catch (error) {
    // 没有桌面宿主（裸浏览器、部分测试）：不订阅进度，请求时再如实失败。
    logger.debug('智能区域分析不可用', { event: 'video_edit.smart_region.unavailable', error })
  }
  const stopDomain = subscribeVideoEditDomain(reconcile)
  reconcile()
  stop = () => { stopProgress(); stopDomain(); stop = undefined }
  return stop
}

/** 片段上这个效果的区域分析状态；没有区域、或片段不是画面素材时为 undefined。 */
export function videoEditSmartRegionStatus(document: Pick<VideoEditDocument, 'media' | 'items'>, frameRate: { numerator: number; denominator: number }, clip: VideoEditClip, effect: Pick<VideoEditEffect, 'mask'>): SmartRegionStatus | undefined {
  const request = videoEditSmartRegionRequest(document, frameRate, clip, effect)
  if (!request) return undefined
  return entries.get(smartRegionRequestKey(request))?.status ?? { state: 'analyzing', progress: 0 }
}

/** 给助手读的状态文字：'' 没有作用区域；ready；analyzing:45%；failed:<给用户的说明>。 */
export function videoEditSmartRegionStatusText(document: Pick<VideoEditDocument, 'media' | 'items'>, frameRate: { numerator: number; denominator: number }, clip: VideoEditClip, effect: Pick<VideoEditEffect, 'mask'>): string {
  if (!effect.mask) return ''
  if (!isSmartRegionMask(effect.mask)) return 'ready'
  const status = videoEditSmartRegionStatus(document, frameRate, clip, effect)
  if (!status) return 'failed:片段不是视频或图片，作用区域不会生效。'
  if (status.state === 'ready') return 'ready'
  if (status.state === 'analyzing') return `analyzing:${Math.round(status.progress * 100)}%`
  return `failed:${videoEditSmartRegionFailureText(status.reason)}`
}

/** 重新分析（失败后的“重试”）。 */
export function retryVideoEditSmartRegion(request: SmartRegionRequest): void { ensure(request) }

/** 发给渲染 Worker 的已分析段落：素材与结果文件都换成 Worker 可 fetch 的地址。 */
export function videoEditSmartRegionSegments(): VideoEditSmartRegionSegments {
  const result: Record<string, Partial<Record<SmartRegionAnalysisKind, Array<{ url: string; startUs: number; endUs: number; still: boolean }>>>> = {}
  for (const { request, status } of entries.values()) {
    if (status.state !== 'ready') continue
    const media = result[toFetchableMediaUrl(request.source)] ??= {}
    const list = media[request.kind] ??= []
    const url = toFetchableMediaUrl(status.segment.path)
    if (!list.some(segment => segment.url === url)) list.push({ url, startUs: status.segment.startUs, endUs: status.segment.endUs, still: status.segment.still })
  }
  return result
}

/** 用户语言的失败说明（效果控件、导出错误与助手读取共用）。 */
export function videoEditSmartRegionFailureText(reason: SmartRegionFailureReason): string {
  switch (reason) {
    case 'model': return '分析需要的本地模型下载失败。检查网络后重试，或在设置 › 文件与下载 › 本地模型里手动下载、切换下载源。'
    case 'decode': return '这段素材读取不出画面，无法分析。可以换一段素材或重新导入后重试。'
    case 'disk': return '分析结果保存失败，请检查磁盘空间后重试。'
    default: return '本机分析失败，可以重试；多次失败请到日志里查看原因。'
  }
}

/** 导出前：等这份剪辑序列需要的区域全部分析完成；有失败时以用户语言报错。 */
export async function waitVideoEditSmartRegions(document: Pick<VideoEditDocument, 'media' | 'items'>, sequence: { frameRate: { numerator: number; denominator: number }; clips: readonly VideoEditClip[] }, signal?: AbortSignal): Promise<void> {
  const requests = new Map<string, SmartRegionRequest>()
  for (const clip of sequence.clips) for (const effect of clip.effects ?? []) {
    if (!effect.enabled || effect.amount <= 0) continue
    const request = videoEditSmartRegionRequest(document, sequence.frameRate, clip, effect)
    if (request) requests.set(smartRegionRequestKey(request), request)
  }
  if (!requests.size) return
  for (const request of requests.values()) {
    const key = smartRegionRequestKey(request)
    if (entries.get(key)?.status.state === 'failed') ensure(request)
    else if (!entries.has(key)) ensure(request)
  }
  await new Promise<void>((resolve, reject) => {
    const check = (): void => {
      const statuses = [...requests.keys()].map(key => entries.get(key)?.status)
      const failed = statuses.find(status => status?.state === 'failed')
      if (failed?.state === 'failed') { finish(); reject(new Error(`作用区域分析失败：${videoEditSmartRegionFailureText(failed.reason)}`)); return }
      if (statuses.every(status => status?.state === 'ready')) { finish(); resolve() }
    }
    const abort = (): void => { finish(); reject(signal?.reason ?? new DOMException('已取消', 'AbortError')) }
    const unsubscribe = subscribeVideoEditSmartRegions(check)
    const finish = (): void => { unsubscribe(); signal?.removeEventListener('abort', abort) }
    signal?.addEventListener('abort', abort, { once: true })
    check()
  })
}

/** 仅供测试：清空状态。 */
export function resetVideoEditSmartRegionsForTests(): void { stop?.(); entries.clear(); revision = 0 }
