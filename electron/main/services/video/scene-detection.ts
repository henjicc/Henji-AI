import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { sceneDetectionRequestSchema, sceneDetectionResultSchema, sceneDetectionThreshold, type SceneDetectionRequest, type SceneDetectionResult } from '../../../../src/core/videoEdit/sceneDetection'
import { identifyMediaContent } from '../media/content-identity'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { loadFfmpegPath } from './ffmpeg-loader'

/** Streaming metadata only. Decode, scale and scene scoring run outside Electron's event loop. */
export async function detectScenesFfmpeg(request: SceneDetectionRequest, signal: AbortSignal, progress: (value: number) => void, binary?: string): Promise<number[]> {
  signal.throwIfAborted()
  const executable = binary ?? await loadFfmpegPath()
  signal.throwIfAborted()
  // Input seeking keeps original frame cadence; timestamps are reset, then shifted back to source time.
  const args = ['-hide_banner', '-nostdin', '-nostats', '-ss', String(request.startSeconds), '-threads', '2', '-i', request.source,
    '-t', String(request.endSeconds - request.startSeconds), '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', `setpts=PTS-STARTPTS,scale=512:-2,scdet=t=${sceneDetectionThreshold(request.sensitivity)}`,
    '-threads', '2', '-filter_threads', '2', '-progress', 'pipe:1', '-f', 'null', '-']
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const cuts: number[] = []; let stderr = ''; let stdout = ''
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
      const lines = stderr.split(/\r?\n/); stderr = lines.pop()!.slice(-8192)
      for (const line of lines) {
        const match = line.match(/lavfi\.scd\.time:\s*([\d.]+)/)
        if (!match) continue
        const time = request.startSeconds + Number(match[1])
        if (time <= request.startSeconds + 1e-7 || time >= request.endSeconds - 1e-7 || cuts.at(-1) === time) continue
        cuts.push(time)
      }
    })
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
      const lines = stdout.split(/\r?\n/); stdout = lines.pop()!.slice(-8192)
      for (const line of lines) if (line.startsWith('out_time_us=')) {
        const time = Number(line.slice(12)) / 1e6
        if (Number.isFinite(time)) progress(Math.min(.99, Math.max(0, time / (request.endSeconds - request.startSeconds))))
      }
    })
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason ?? new Error('场景检测已取消。'))
      else if (code !== 0) reject(new Error('场景检测失败，请确认原视频可读取后重试。'))
      else { progress(1); resolve(cuts) }
    })
  })
}

export class SceneDetectionService {
  private active = 0
  private readonly flights = new Map<string, { controller: AbortController; promise: Promise<SceneDetectionResult>; listeners: Set<(value: number) => void>; consumers: number }>()
  constructor(private readonly cache: ContentDiskCache, private readonly run = detectScenesFfmpeg) {}
  async detect(raw: SceneDetectionRequest, signal: AbortSignal, progress: (value: number) => void): Promise<SceneDetectionResult> {
    const request = sceneDetectionRequestSchema.parse(raw)
    signal.throwIfAborted()
    const content = await identifyMediaContent(request.source)
    const key = createHash('sha256').update(JSON.stringify(['scdet-512-v1', content.identity, request.startSeconds, request.endSeconds, request.sensitivity])).digest('hex')
    const bytes = await this.cache.read(key)
    if (bytes) {
      try {
        const result = sceneDetectionResultSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
        if (result.contentIdentity !== content.identity || result.cutsSeconds.some((time, index, all) => time <= request.startSeconds || time >= request.endSeconds || index > 0 && time <= all[index - 1])) throw new Error('检测缓存无效。')
        signal.throwIfAborted(); progress(1); return result
      } catch (error) { if (signal.aborted) throw error; await this.cache.remove(key) }
    }
    signal.throwIfAborted()
    let flight = this.flights.get(key)
    if (flight?.controller.signal.aborted) throw new Error('原分析正在取消，请稍后重试。')
    if (!flight) {
      if (this.active >= 2) throw new Error('已有两段视频正在分析，请等待或取消后再试。')
      this.active++
      const controller = new AbortController(); const listeners = new Set<(value: number) => void>()
      const promise = (async (): Promise<SceneDetectionResult> => {
        const cutsSeconds = await this.run({ ...request, source: content.path }, controller.signal, value => { for (const listener of listeners) listener(value) })
        controller.signal.throwIfAborted()
        if ((await identifyMediaContent(content.path)).identity !== content.identity) throw new Error('检测期间原视频已改变，请重新检测。')
        const result = sceneDetectionResultSchema.parse({ cutsSeconds, contentIdentity: content.identity })
        await this.cache.write(key, Buffer.from(JSON.stringify(result)))
        controller.signal.throwIfAborted(); return result
      })().finally(() => { this.active--; this.flights.delete(key) })
      flight = { controller, promise, listeners, consumers: 0 }; this.flights.set(key, flight)
    }
    // Each caller owns its waiting/cancellation; shared decode stops only when the last caller leaves.
    const shared = flight; shared.consumers++; shared.listeners.add(progress)
    return new Promise((resolve, reject) => {
      let settled = false
      const release = (): boolean => {
        if (settled) return false
        settled = true; signal.removeEventListener('abort', abort); shared.listeners.delete(progress); shared.consumers--
        return true
      }
      const abort = (): void => {
        if (!release()) return
        if (!shared.consumers) shared.controller.abort(signal.reason ?? new Error('场景检测已取消。'))
        reject(signal.reason ?? new Error('场景检测已取消。'))
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      shared.promise.then(result => { if (release()) resolve(result) }, error => { if (release()) reject(error) })
    })
  }
}
