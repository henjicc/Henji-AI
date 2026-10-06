import type { SmartRegionAnalysisKind, SmartRegionSummary } from '../../core/videoEdit/smartRegions'

/*
 * 智能区域分析（任务 4.7d）：对一段素材在后台逐帧分析一次（人脸 / 人物 / 文字），结果缓存在程序目录，
 * 预览、拖动、导出都直接读缓存。主进程实现在 `electron/main/services/smart-regions/`，
 * 渲染层经 `src/commands/smartRegions.ts` 调用；分析进度经 `smartRegions:progress` 推给所有窗口。
 */

export interface SmartRegionRequest {
  /** 素材的本地绝对路径（必须已授权）。 */
  source: string
  kind: SmartRegionAnalysisKind
  /** 需要覆盖的素材时间（微秒，素材绝对时钟）；静态图片两者都填 0。 */
  startUs: number
  endUs: number
  still: boolean
}

/** 一段已分析好的结果；`path` 交给 Worker 前先过 `toFetchableMediaUrl()`。 */
export interface SmartRegionSegmentRef {
  path: string
  startUs: number
  endUs: number
  still: boolean
  model: string
  summary: SmartRegionSummary
}

/**
 * 失败原因（界面换成用户语言）：
 * - `model`：需要的本地模型下载失败（没网、源不可用），去设置的“本地模型”可以手动下载或换下载源
 * - `decode`：素材解码不出画面
 * - `inference`：本机推理失败
 * - `disk`：结果写不进缓存
 */
export type SmartRegionFailureReason = 'model' | 'decode' | 'inference' | 'disk'

export type SmartRegionStatus =
  | { state: 'ready'; segment: SmartRegionSegmentRef }
  /** `progress` 0–1；还在下载模型时为 0。 */
  | { state: 'analyzing'; progress: number }
  | { state: 'failed'; reason: SmartRegionFailureReason }

export interface SmartRegionProgressEvent { request: SmartRegionRequest; status: SmartRegionStatus }

/** 请求的规范键（同一素材、同一分析、同一范围）。 */
export function smartRegionRequestKey(request: SmartRegionRequest): string {
  return JSON.stringify([request.source, request.kind, request.startUs, request.endUs, request.still])
}

/** 分析范围按整秒取整（片段稍微修剪后仍能命中同一份缓存）。 */
export function normalizeSmartRegionRange(startUs: number, endUs: number, still: boolean): { startUs: number; endUs: number } {
  if (still) return { startUs: 0, endUs: 0 }
  const start = Math.max(0, Math.floor(startUs / 1e6) * 1e6)
  return { startUs: start, endUs: Math.max(start + 1e6, Math.ceil(endUs / 1e6) * 1e6) }
}

export const SMART_REGIONS_IPC_CHANNELS = {
  ensure: 'smartRegions:ensure',
  cancel: 'smartRegions:cancel',
  progress: 'smartRegions:progress',
} as const

export interface SmartRegionsPlatform {
  /** 已有缓存直接返回；否则开始（或加入进行中的）后台分析并返回当前进度，不等待完成。 */
  ensure(request: SmartRegionRequest): Promise<SmartRegionStatus>
  cancel(request: SmartRegionRequest): Promise<void>
  onProgress(handler: (event: SmartRegionProgressEvent) => void): () => void
}
