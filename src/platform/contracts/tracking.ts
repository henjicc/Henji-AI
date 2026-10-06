import type { VideoEditTrackMethod, VideoEditTrackPrompt } from '../../core/videoEdit/tracking'

/*
 * 跟踪器（任务 4.10）：主进程实现在 `electron/main/services/tracking/`，渲染层经 `getPlatform().tracking` 调用；
 * 推理与取帧在本地推理后台进程里（与 4.7d 智能区域同一个进程、同一个队列），进度经 `tracking:progress` 推给所有窗口。
 */

/** 一个跟踪定义：素材 + 方式 + 提示（结果按这三样缓存；提示改了就是另一份结果）。 */
export interface TrackingDefinition {
  /** 素材的本地绝对路径（必须已授权）。 */
  source: string
  method: VideoEditTrackMethod
  /** 按时间排序的提示（坐标是片段画面的归一化坐标，时间是素材绝对时钟的微秒）。 */
  prompts: VideoEditTrackPrompt[]
}

/** 要跟踪到的素材时间范围（片段用到的范围，微秒，结束不含）。 */
export interface TrackingRange { startUs: number; endUs: number }

/** both：从提示帧往两边跟满范围；forward / backward：AE 的“向前 / 向后跟踪”；limit 1 为“向前 / 向后一帧”。 */
export interface TrackingRunOptions { direction: 'both' | 'forward' | 'backward'; limit?: number }

/** 已有结果；`path` 交给 Worker 前先过 `toFetchableMediaUrl()`。 */
export interface TrackingResultRef {
  path: string
  /** 覆盖的素材时间（微秒，结束不含）。 */
  startUs: number
  endUs: number
  fps: number
  summary: { tracked: number; lost: number }
}

/**
 * 失败原因（界面换成用户语言）：model 模型下载失败；decode 素材解码失败；inference 本机推理失败；disk 写不进缓存；
 * prompt 提示不能用（例如框完全在画面外）。
 */
export type TrackingFailureReason = 'model' | 'decode' | 'inference' | 'disk' | 'prompt'

export type TrackingStatus =
  | { state: 'idle'; result?: undefined }
  /** `progress` 0–1；还在下载模型时为 0。跟踪中也带着上一次的结果（续跟时画面不闪空）。 */
  | { state: 'tracking'; progress: number; direction: TrackingRunOptions['direction']; result?: TrackingResultRef }
  /** `stopped`：上一次是被停止的（部分完成）。 */
  | { state: 'ready'; result: TrackingResultRef; stopped?: boolean }
  | { state: 'failed'; reason: TrackingFailureReason; message?: string; result?: TrackingResultRef }

export interface TrackingProgressEvent { definition: TrackingDefinition; status: TrackingStatus }

/** 点选候选：在 timeUs 这一帧点了 points，返回 3 个候选掩码（size × size 的 int8 logit，× 4）与可信度。 */
export interface TrackingCandidatesRequest { source: string; timeUs: number; points: Array<[number, number, 0 | 1]> }
export interface TrackingCandidates { size: number; candidates: Array<{ logits: Int8Array; score: number }> }

export function trackingDefinitionKey(definition: TrackingDefinition): string {
  return JSON.stringify([definition.source, definition.method, [...definition.prompts].sort((a, b) => a.timeUs - b.timeUs)])
}

export const TRACKING_IPC_CHANNELS = {
  status: 'tracking:status',
  run: 'tracking:run',
  stop: 'tracking:stop',
  candidates: 'tracking:candidates',
  progress: 'tracking:progress',
} as const

export interface TrackingPlatform {
  /** 已有结果与是否在跟踪（不开始跟踪）。 */
  status(definition: TrackingDefinition): Promise<TrackingStatus>
  /** 开始（或加入进行中的）跟踪并返回当前状态，不等待完成。 */
  run(definition: TrackingDefinition, range: TrackingRange, options: TrackingRunOptions): Promise<TrackingStatus>
  /** 停止：当前帧算完就停，已跟踪的部分保留。 */
  stop(definition: TrackingDefinition): Promise<void>
  candidates(request: TrackingCandidatesRequest): Promise<TrackingCandidates>
  onProgress(handler: (event: TrackingProgressEvent) => void): () => void
}
