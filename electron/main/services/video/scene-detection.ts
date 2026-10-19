import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { sceneDetectionRequestSchema, sceneDetectionResultSchema, sceneDetectionThreshold, type SceneDetectionRequest, type SceneDetectionResult } from '../../../../src/core/videoEdit/sceneDetection'
import { identifyMediaContent } from '../media/content-identity'
import type { ContentDiskCache } from '../media/content-disk-cache'
import { SharedMediaAnalysis } from '../media/shared-analysis'
import { loadFfmpegPath } from './ffmpeg-loader'
import { analyzeScreenChanges } from './screen-change-analysis'
import { validateScreenChangeAnalysis } from '../../../../src/core/media/screenChangeEvidence'
import { validateVideoMotionScan } from '../../../../src/core/media/motionEvidence'
import { analyzeVideoMotion } from './motion-analysis'

/** Streaming metadata only. Decode, scale and scene scoring run outside Electron's event loop. */
export async function detectScenesFfmpeg(request: SceneDetectionRequest, signal: AbortSignal, progress: (value: number) => void, binary?: string, onStillness?: (ranges: NonNullable<SceneDetectionResult['stillness']>) => void): Promise<number[]> {
  signal.throwIfAborted()
  const executable = binary ?? await loadFfmpegPath()
  signal.throwIfAborted()
  // Input seeking keeps original frame cadence; timestamps are reset, then shifted back to source time.
  const args = ['-hide_banner', '-nostdin', '-nostats', '-ss', String(request.startSeconds), '-threads', '2', '-i', request.source,
    '-t', String(request.endSeconds - request.startSeconds), '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', `setpts=PTS-STARTPTS,scale=512:-2,scdet=t=${sceneDetectionThreshold(request.sensitivity)}${request.includeStillness ? ',freezedetect=n=0.001:d=2' : ''}`,
    '-threads', '2', '-filter_threads', '2', '-progress', 'pipe:1', '-f', 'null', '-']
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const cuts: number[] = []; let stderr = ''; let stdout = ''
    const stillness: NonNullable<SceneDetectionResult['stillness']> = []; let freezeStart: number | undefined
    let decodedSeconds = 0
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
      const lines = stderr.split(/\r?\n/); stderr = lines.pop()!.slice(-8192)
      for (const line of lines) {
        const freeze = line.match(/lavfi\.freezedetect\.freeze_(start|end):\s*([\d.]+)/)
        if (freeze) {
          const time = Math.min(request.endSeconds, request.startSeconds + Number(freeze[2]))
          if (freeze[1] === 'start') freezeStart = Math.max(request.startSeconds, time)
          else if (freezeStart !== undefined) { if (time > freezeStart) stillness.push({ startSeconds: freezeStart, endSeconds: time }); freezeStart = undefined }
        }
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
        if (Number.isFinite(time)) { decodedSeconds = Math.max(decodedSeconds, time); progress(Math.min(.99, Math.max(0, time / (request.endSeconds - request.startSeconds)))) }
      }
    })
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason ?? new Error('场景检测已取消。'))
      else if (code !== 0) reject(new Error('场景检测失败，请确认原视频可读取后重试。'))
      else {
        const decodedEnd = Math.min(request.endSeconds, request.startSeconds + decodedSeconds)
        if (freezeStart !== undefined && decodedEnd > freezeStart) stillness.push({ startSeconds: freezeStart, endSeconds: decodedEnd })
        onStillness?.(stillness); progress(1); resolve(cuts)
      }
    })
  })
}

export class SceneDetectionService {
  private readonly shared = new SharedMediaAnalysis<SceneDetectionResult>()
  constructor(private readonly cache: ContentDiskCache, private readonly run = detectScenesFfmpeg, private readonly runScreenChanges = analyzeScreenChanges, private readonly runMotion = analyzeVideoMotion) {}
  async detect(raw: SceneDetectionRequest, signal: AbortSignal, progress: (value: number) => void): Promise<SceneDetectionResult> {
    const request = sceneDetectionRequestSchema.parse(raw)
    signal.throwIfAborted()
    const content = await identifyMediaContent(request.source)
    const screen = request.analysis === 'screen_changes'
    const motion = request.analysis === 'motion'
    const key = createHash('sha256').update(JSON.stringify([motion ? 'motion-opencv-display-v2' : screen ? 'screen-local-rgb-v1' : 'scdet-512-v2', content.identity, request.startSeconds, request.endSeconds, screen || motion ? null : request.sensitivity, request.includeStillness === true])).digest('hex')
    const bytes = await this.cache.read(key)
    if (bytes) {
      if ((await identifyMediaContent(request.source)).identity !== content.identity) throw new Error('读取缓存期间原视频已改变，请重新检测。')
      try {
        const result = sceneDetectionResultSchema.parse(JSON.parse(Buffer.from(bytes).toString('utf8')))
        if (result.contentIdentity !== content.identity || result.cutsSeconds.some((time, index, all) => time <= request.startSeconds || time >= request.endSeconds || index > 0 && time <= all[index - 1])) throw new Error('检测缓存无效。')
        if (request.includeStillness && (!result.stillness || result.stillness.some((range, i, all) => range.startSeconds < request.startSeconds || range.endSeconds > request.endSeconds || i > 0 && range.startSeconds < all[i - 1].endSeconds))) throw new Error('静止检测缓存无效。')
        if (screen) {
          if (!result.screenChanges || result.cutsSeconds.length) throw new Error('局部变化缓存无效。')
          validateScreenChangeAnalysis(result.screenChanges, request.startSeconds, request.endSeconds)
        }
        if (motion) {
          if (!result.motionScan || result.cutsSeconds.length) throw new Error('运动分析缓存无效。')
          validateVideoMotionScan(result.motionScan, request.startSeconds, request.endSeconds)
        }
        signal.throwIfAborted(); progress(1); return result
      } catch (error) { if (signal.aborted) throw error; await this.cache.remove(key) }
    }
    signal.throwIfAborted()
    const result = await this.shared.run(key, async (sharedSignal, report) => {
      let stillness: SceneDetectionResult['stillness']
      const screenChanges = screen ? await this.runScreenChanges({ ...request, source: content.path }, sharedSignal, report) : undefined
      const motionScan = motion ? await this.runMotion({ ...request, source: content.path }, sharedSignal, report) : undefined
      if (screen && !screenChanges) throw new Error('局部变化分析未返回证据。')
      if (motion && !motionScan) throw new Error('运动分析未返回证据。')
      const cutsSeconds = screen || motion ? [] : await this.run({ ...request, source: content.path }, sharedSignal, report, undefined, ranges => { stillness = ranges })
      sharedSignal.throwIfAborted()
      if ((await identifyMediaContent(request.source)).identity !== content.identity) throw new Error('检测期间原视频已改变，请重新检测。')
      if (request.includeStillness && !stillness) throw new Error('静止检测未返回证据。')
      if (screenChanges) validateScreenChangeAnalysis(screenChanges, request.startSeconds, request.endSeconds)
      if (motionScan) validateVideoMotionScan(motionScan, request.startSeconds, request.endSeconds)
      const result = sceneDetectionResultSchema.parse({ cutsSeconds, contentIdentity: content.identity, ...(request.includeStillness ? { stillness } : {}), ...(screenChanges ? { screenChanges } : {}), ...(motionScan ? { motionScan } : {}) })
      await this.cache.write(key, Buffer.from(JSON.stringify(result)))
      if ((await identifyMediaContent(request.source)).identity !== content.identity) throw new Error('保存分析缓存期间原视频已改变，请重新检测。')
      sharedSignal.throwIfAborted(); return result
    }, signal, progress)
    signal.throwIfAborted()
    if ((await identifyMediaContent(request.source)).identity !== content.identity) throw new Error('等待分析期间原视频已改变，请重新检测。')
    signal.throwIfAborted(); return result
  }
}
