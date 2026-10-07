import fs from 'node:fs/promises'
import { deflateRawSync, inflateRawSync } from 'node:zlib'
import { runSmartRegionAnalysis, SmartRegionAnalysisError } from './services/local-inference/analysis'
import { ffmpegFrames } from './services/local-inference/frameReader'
import { LocalModelSessions, loadOnnxRuntime } from './services/local-inference/onnxRuntime'
import type { LocalInferenceEvent, LocalInferenceRequest, SmartRegionAnalysisJob } from './services/local-inference/protocol'
import { runTracking, runTrackingCandidates, TrackingError, type TrackFrameRequest } from './services/local-inference/tracking/trackJob'
import type { TrackingCandidatesJob, TrackingJob } from './services/local-inference/tracking/trackingProtocol'
import { RenderedTrackingFrames } from './services/local-inference/tracking/renderedFrames'

/*
 * 本地推理后台进程（重要记录 003、任务 4.7d）：onnxruntime-node 原生推理与取帧都在这里，主进程只协调。
 * 一次只跑一个分析（显卡与解码都是独占型负载），其余排队；主进程发 cancel 时停止当前帧并结束 FFmpeg。
 */

const port = process.parentPort
if (!port) throw new Error('本地推理进程缺少宿主连接')
const post = (event: LocalInferenceEvent): void => port.postMessage(event)
const log = (level: 'info' | 'warn', message: string, event: string, context: Record<string, unknown>): void => post({ type: 'log', level, message, event, context })
const renderedFrames = new RenderedTrackingFrames((id, requestId, request) => post({ type: 'frames', id, requestId, request }))

let sessions: Promise<LocalModelSessions> | undefined
type QueuedJob = { type: 'analyze'; job: SmartRegionAnalysisJob } | { type: 'track'; job: TrackingJob } | { type: 'candidates'; job: TrackingCandidatesJob }
const queue: QueuedJob[] = []
const controllers = new Map<string, AbortController>()
let running = false

/** 跟踪取帧：帧网格第 first 帧起 count 帧（素材绝对时钟换成相对容器起点交给 FFmpeg）。 */
function trackFrames(job: TrackingJob | TrackingCandidatesJob, request: TrackFrameRequest, signal: AbortSignal): AsyncIterable<Uint8Array> {
  if (typeof job.source !== 'string') return renderedFrames.frames(job.id, request, signal)
  const startUs = request.first * 1e6 / job.fps - job.containerStartUs
  return ffmpegFrames(job.ffmpegPath, { source: job.source, seekSeconds: Math.max(0, startUs / 1e6), durationSeconds: (request.count + 0.5) / job.fps, fps: job.fps } as SmartRegionAnalysisJob, request, signal)
}

async function runTrack(entry: Exclude<QueuedJob, { type: 'analyze' }>): Promise<void> {
  const job = entry.job
  const controller = controllers.get(job.id) ?? new AbortController()
  controllers.set(job.id, controller)
  let lastProgress = 0
  try {
    sessions ??= loadOnnxRuntime().then(runtime => new LocalModelSessions(runtime, log))
    const pool = await sessions
    const openModel = (model: Parameters<LocalModelSessions['open']>[0], providers: Parameters<LocalModelSessions['open']>[1], shape: string) => pool.open(model, providers, shape)
    if (entry.type === 'candidates') {
      const result = await runTrackingCandidates(entry.job, { openModel, frames: request => trackFrames(entry.job, request, controller.signal) })
      post({ type: 'done', id: job.id, result })
      return
    }
    const track = entry.job
    // 停止按钮：当前帧算完后停下，已跟踪的部分照样写出（下次接着跟）。
    const result = await runTracking(track, {
      openModel, frames: request => trackFrames(track, request, controller.signal),
      readFile: file => fs.readFile(file).then(buffer => new Uint8Array(buffer)), writeFile: (file, bytes) => fs.writeFile(file, bytes),
      deflate: bytes => deflateRawSync(bytes, { level: 6 }), inflate: bytes => new Uint8Array(inflateRawSync(bytes)),
      progress: (done, total) => {
        const now = Date.now()
        if (done < total && now - lastProgress < 150) return
        lastProgress = now; post({ type: 'progress', id: job.id, done, total })
      },
      log, signal: controller.signal,
    })
    post({ type: 'done', id: job.id, result })
  } catch (error) {
    const code = error instanceof TrackingError ? error.code : controller.signal.aborted ? 'cancelled' : 'inference'
    if (entry.type === 'track') await fs.rm(entry.job.outputPath, { force: true }).catch(() => undefined)
    post({ type: 'failed', id: job.id, code, message: error instanceof Error ? error.message.slice(0, 500) : String(error) })
  } finally { controllers.delete(job.id) }
}

async function run(job: SmartRegionAnalysisJob): Promise<void> {
  const controller = controllers.get(job.id) ?? new AbortController()
  controllers.set(job.id, controller)
  let lastProgress = 0
  try {
    sessions ??= loadOnnxRuntime().then(runtime => new LocalModelSessions(runtime, log))
    const pool = await sessions
    const result = await runSmartRegionAnalysis(job, {
      openModel: (model, providers, shape) => pool.open(model, providers, shape),
      frames: request => ffmpegFrames(job.ffmpegPath, job, request, controller.signal),
      deflate: bytes => deflateRawSync(bytes, { level: 6 }),
      writeFile: (file, bytes) => fs.writeFile(file, bytes),
      progress: (done, total) => {
        const now = Date.now()
        if (done < total && now - lastProgress < 200) return
        lastProgress = now; post({ type: 'progress', id: job.id, done, total })
      },
      log,
      signal: controller.signal,
    })
    post({ type: 'done', id: job.id, result })
  } catch (error) {
    const code = error instanceof SmartRegionAnalysisError ? error.code : controller.signal.aborted ? 'cancelled' : 'inference'
    await fs.rm(job.outputPath, { force: true }).catch(() => undefined)
    post({ type: 'failed', id: job.id, code, message: error instanceof Error ? error.message.slice(0, 500) : String(error) })
  } finally { controllers.delete(job.id) }
}

async function drain(): Promise<void> {
  if (running) return
  running = true
  try {
    for (let entry = queue.shift(); entry; entry = queue.shift()) await (entry.type === 'analyze' ? run(entry.job) : runTrack(entry))
  } finally { running = false }
}

port.on('message', (event) => {
  const request = event.data as LocalInferenceRequest
  if (request.type === 'frames') { renderedFrames.reply(request.id, request.reply); return }
  if (request.type === 'analyze' || request.type === 'track' || request.type === 'candidates') { queue.push(request as QueuedJob); void drain() }
  else if (request.type === 'cancel') {
    const index = queue.findIndex(entry => entry.job.id === request.id)
    if (index >= 0) { const [entry] = queue.splice(index, 1); post({ type: 'failed', id: entry.job.id, code: 'cancelled', message: '分析已取消。' }) }
    controllers.get(request.id)?.abort()
  }
})
