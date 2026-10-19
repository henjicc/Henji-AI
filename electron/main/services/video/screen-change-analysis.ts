import { spawn } from 'node:child_process'
import { planScreenChangeRefinement, type ScreenChangeScan } from '../../../../src/core/videoEdit/screenChanges'
import { validateScreenChangeAnalysis, type ScreenChangeAnalysis } from '../../../../src/core/media/screenChangeEvidence'
import type { SceneDetectionRequest } from '../../../../src/core/videoEdit/sceneDetection'
import { loadFfmpegPath } from './ffmpeg-loader'
import { ScreenChangeWorker } from './screen-change-worker-client'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.video.screen_changes')

async function scanSource(source: string, fromSeconds: number, toSeconds: number, fps: number, executable: string, signal: AbortSignal,
  progress: (value: number) => void, workerPath?: string | URL): Promise<ScreenChangeScan> {
  signal.throwIfAborted()
  const width = 480; const height = 270; const frameBytes = width * height * 3
  const worker = new ScreenChangeWorker({ width, height, channels: 3, fps, startSeconds: fromSeconds, endSeconds: toSeconds }, workerPath)
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-ss', String(fromSeconds), '-threads', '2', '-i', source,
    '-t', String(toSeconds - fromSeconds), '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', `setpts=PTS-STARTPTS,fps=${fps}:start_time=0:eof_action=pass,scale=${width}:${height}:flags=area,format=rgb24`,
    '-frames:v', String(Math.ceil((toSeconds - fromSeconds) * fps - 1e-9)), '-threads', '2', '-filter_threads', '2', '-f', 'rawvideo', 'pipe:1']
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''; let bytes = 0; let spawnError: Error | undefined
  const closed = new Promise<number | null>(resolve => {
    child.once('error', error => { spawnError = error })
    child.once('close', resolve)
  })
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000) })
  const abort = (): void => { child.kill(); void worker.dispose() }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    for await (const chunk of child.stdout) {
      signal.throwIfAborted()
      const block = chunk as Buffer
      for (let offset = 0; offset < block.length; offset += 1024 * 1024) await worker.push(block.subarray(offset, offset + 1024 * 1024))
      bytes += block.length
      progress(Math.min(.99, Math.floor(bytes / frameBytes) / fps / (toSeconds - fromSeconds)))
    }
    const code = await closed
    signal.throwIfAborted()
    if (spawnError) throw spawnError
    if (code !== 0) {
      logger.warn('局部画面解码失败', { event: 'video.screen_changes.decode.failed', context: { exitCode: code }, error: spawnError ?? new Error(stderr) })
      throw new Error('局部画面解码失败，请检查原视频后重试。')
    }
    const result = await worker.finish()
    signal.throwIfAborted(); progress(1); return result
  } finally {
    signal.removeEventListener('abort', abort)
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await closed
    await worker.dispose()
  }
}

/** FFmpeg owns decode, the Worker owns pixels, and backpressure bounds bytes in flight. */
export async function analyzeScreenChanges(request: SceneDetectionRequest, signal: AbortSignal, progress: (value: number) => void,
  binary?: string, workerPath?: string | URL): Promise<ScreenChangeAnalysis> {
  signal.throwIfAborted()
  const executable = binary ?? await loadFfmpegPath()
  const coarse = await scanSource(request.source, request.startSeconds, request.endSeconds, 5, executable, signal, value => progress(value * .7), workerPath)
  const plan = planScreenChangeRefinement(coarse.candidates, request.startSeconds, request.endSeconds)
  const refinements: ScreenChangeAnalysis['refinements'] = []
  const totalSeconds = plan.ranges.reduce((total, range) => total + range.toSeconds - range.fromSeconds, 0)
  let completedSeconds = 0
  for (const range of plan.ranges) {
    const duration = range.toSeconds - range.fromSeconds
    const scan = await scanSource(request.source, range.fromSeconds, range.toSeconds, 30, executable, signal,
      value => progress(.7 + .29 * (completedSeconds + duration * value) / totalSeconds), workerPath)
    refinements.push({ ...range, scan }); completedSeconds += duration
  }
  const result = { coarse, refinements, omittedCandidates: plan.omitted }
  validateScreenChangeAnalysis(result, request.startSeconds, request.endSeconds)
  signal.throwIfAborted(); progress(1); return result
}
