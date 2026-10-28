import { createLogger } from '@/core/logging'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { RenderResponse } from '../engine/videoEditWorker'
import { VideoEditTimingHistogram, type VideoEditTimingDistribution } from '../engine/videoEditTimingHistogram'
import { listVideoEditInstances, subscribeVideoEditView, videoEditProgramCommandIdentity, type VideoEditInstance } from './videoEditService'

const logger = createLogger('features.videoEdit.playbackStats')

const round = (value: number): number => Math.round(value * 100) / 100

export type VideoEditPlaybackFrame = Pick<RenderResponse, 'presented' | 'renderCached' | 'renderElapsedMs' | 'renderStages'>

export interface VideoEditPlaybackSummary {
  startFrame: number; endFrame: number; expectedFrames: number; presentedFrames: number; droppedFrames: number; droppedRatio: number
  maxConsecutiveDropped: number; cachedFrames: number; durationMs: number
  /** Worker 报告的渲染耗时（不含等刷新时刻），只计实时合成的帧。 */
  renderMs: VideoEditTimingDistribution
  /** 节目发出这一帧的请求到它上屏（回执到达）的时间。 */
  presentLatencyMs: VideoEditTimingDistribution
  /** 各渲染分段（含诊断时的 gpu.*、lag.*）逐帧的分布；整次都是 0 的分段省略。 */
  stages: Record<string, VideoEditTimingDistribution>
}

/**
 * 一次连续正向播放的逐帧统计。第一帧是起播帧（含打开解码、等声音），只作为起点计入呈现，不进耗时样本；
 * 两次呈现之间被播放时钟跳过的帧记为跳帧。正常播放也一直在采集，所以耗时只进固定桶直方图（分位数相对误差 ≤1%，
 * 见 `VideoEditTimingHistogram`），播多久内存都有上限。
 */
export class VideoEditPlaybackCollector {
  private lastFrame: number
  private presented = 1
  private dropped = 0
  private maxConsecutive = 0
  private cached = 0
  private readonly render = new VideoEditTimingHistogram()
  private readonly latency = new VideoEditTimingHistogram()
  private readonly stages = new Map<string, VideoEditTimingHistogram>()
  constructor(readonly startFrame: number, private readonly startedAt: number) { this.lastFrame = startFrame }
  /** 返回 false 表示这一帧不在当前这次播放里（迟到或倒退），调用方忽略它。 */
  add(frame: number, result: VideoEditPlaybackFrame, latencyMs: number): boolean {
    if (frame <= this.lastFrame) return false
    const gap = frame - this.lastFrame - 1
    this.dropped += gap; this.maxConsecutive = Math.max(this.maxConsecutive, gap)
    this.lastFrame = frame; this.presented++
    this.latency.add(latencyMs)
    if (result.renderCached === false && result.renderElapsedMs !== undefined) this.render.add(result.renderElapsedMs)
    else if (result.renderCached) this.cached++
    for (const [stage, ms] of Object.entries(result.renderStages ?? {})) {
      let histogram = this.stages.get(stage)
      if (!histogram) { histogram = new VideoEditTimingHistogram(); this.stages.set(stage, histogram) }
      histogram.add(ms)
    }
    return true
  }
  summary(now: number): VideoEditPlaybackSummary {
    const expected = this.lastFrame - this.startFrame + 1
    return { startFrame: this.startFrame, endFrame: this.lastFrame, expectedFrames: expected, presentedFrames: this.presented, droppedFrames: this.dropped,
      droppedRatio: Math.round(this.dropped / expected * 1e6) / 1e6, maxConsecutiveDropped: this.maxConsecutive, cachedFrames: this.cached, durationMs: round(now - this.startedAt),
      renderMs: this.render.distribution(), presentLatencyMs: this.latency.distribution(),
      // 渲染分段逐帧带着全部阶段名（多数为 0）；整次播放都是 0 的阶段不写进日志。
      stages: Object.fromEntries([...this.stages].filter(([, histogram]) => histogram.max > 0).sort(([a], [b]) => a.localeCompare(b)).map(([stage, histogram]) => [stage, histogram.distribution()])) }
  }
}

interface Session { collector: VideoEditPlaybackCollector; sequenceId: string; fps: number; width: number; height: number; command: object; stop: () => void }
const sessions = new Map<string, Session>()

function finish(projectId: string, reason: 'stopped' | 'restarted'): void {
  const session = sessions.get(projectId)
  if (!session) return
  sessions.delete(projectId); session.stop()
  const summary = session.collector.summary(performance.now())
  // 只有起播帧的“播放”（刚起播就停）没有可比较的样本。
  if (summary.expectedFrames < 2) return
  logger.info('节目播放统计', { event: 'video_edit.playback.stats', context: { projectId, sequenceId: session.sequenceId, fps: session.fps, width: session.width, height: session.height, reason, ...summary } })
}

/**
 * 节目每呈现一帧调用一次：正常速度正向播放时累计，播放停止（或重新起播、跳转）时写一条 `video_edit.playback.stats` 日志。
 * 基准台与排障从正式日志查询读取这条记录。
 */
export function recordVideoEditPlaybackFrame(instance: VideoEditInstance, composition: VideoEditComposition, frame: number, result: VideoEditPlaybackFrame, requestedAt: number, scrubbing: boolean): void {
  const projectId = instance.document.id
  const playing = instance.playing && instance.playbackDirection === 1 && (instance.playbackRate ?? 1) === 1 && !scrubbing && !instance.scrubbing
  const command = videoEditProgramCommandIdentity(projectId)
  const current = sessions.get(projectId)
  if (current && (!playing || current.command !== command || current.sequenceId !== composition.id)) finish(projectId, playing ? 'restarted' : 'stopped')
  if (!playing || result.presented !== true) return
  const session = sessions.get(projectId)
  if (session) { session.collector.add(frame, result, performance.now() - requestedAt); return }
  const stop = subscribeVideoEditView(() => {
    if (!instance.playing || !listVideoEditInstances().includes(instance)) finish(projectId, 'stopped')
    else if (videoEditProgramCommandIdentity(projectId) !== command) finish(projectId, 'restarted')
  })
  sessions.set(projectId, { collector: new VideoEditPlaybackCollector(frame, performance.now()), sequenceId: composition.id, fps: composition.fps, width: composition.width, height: composition.height, command, stop })
}
