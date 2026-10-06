import fs from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'
import { runSmartRegionAnalysis, SmartRegionAnalysisError } from './services/local-inference/analysis'
import { ffmpegFrames } from './services/local-inference/frameReader'
import { LocalModelSessions, loadOnnxRuntime } from './services/local-inference/onnxRuntime'
import type { LocalInferenceEvent, LocalInferenceRequest, SmartRegionAnalysisJob } from './services/local-inference/protocol'

/*
 * 本地推理后台进程（重要记录 003、任务 4.7d）：onnxruntime-node 原生推理与取帧都在这里，主进程只协调。
 * 一次只跑一个分析（显卡与解码都是独占型负载），其余排队；主进程发 cancel 时停止当前帧并结束 FFmpeg。
 */

const port = process.parentPort
if (!port) throw new Error('本地推理进程缺少宿主连接')
const post = (event: LocalInferenceEvent): void => port.postMessage(event)
const log = (level: 'info' | 'warn', message: string, event: string, context: Record<string, unknown>): void => post({ type: 'log', level, message, event, context })

let sessions: Promise<LocalModelSessions> | undefined
const queue: SmartRegionAnalysisJob[] = []
const controllers = new Map<string, AbortController>()
let running = false

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
    for (let job = queue.shift(); job; job = queue.shift()) await run(job)
  } finally { running = false }
}

port.on('message', (event) => {
  const request = event.data as LocalInferenceRequest
  if (request.type === 'analyze') { queue.push(request.job); void drain() }
  else if (request.type === 'cancel') {
    const index = queue.findIndex(job => job.id === request.id)
    if (index >= 0) { const [job] = queue.splice(index, 1); post({ type: 'failed', id: job.id, code: 'cancelled', message: '分析已取消。' }) }
    controllers.get(request.id)?.abort()
  }
})
