import { spawn } from 'node:child_process'
import type { ScreenChangeOptions, ScreenChangeScan } from '../../../../src/core/videoEdit/screenChanges'
import type { VideoMotionOptions, VideoMotionScan } from '../../../../src/core/media/motionEvidence'
import { ScreenChangeWorker } from './screen-change-worker-client'
import { createMainLogger } from '../logging'

const logger = createMainLogger('main.video.frame_analysis')
export function scanVideoFrames(source: string, options: VideoMotionOptions, executable: string, signal: AbortSignal, progress: (value: number) => void, workerPath?: string | URL): Promise<VideoMotionScan>
export function scanVideoFrames(source: string, options: ScreenChangeOptions, executable: string, signal: AbortSignal, progress: (value: number) => void, workerPath?: string | URL): Promise<ScreenChangeScan>
/** One decode/Worker transport for pixel analyses. Backpressure bounds bytes in flight. */
export async function scanVideoFrames(source: string, options: ScreenChangeOptions | VideoMotionOptions, executable: string, signal: AbortSignal,
  progress: (value: number) => void, workerPath?: string | URL): Promise<ScreenChangeScan | VideoMotionScan> {
  signal.throwIfAborted()
  const { width, height, channels, fps, startSeconds, endSeconds } = options
  const motion = 'analysis' in options && options.analysis === 'motion'
  const frameBytes = width * height * channels
  const worker = new ScreenChangeWorker(options, workerPath)
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-ss', String(startSeconds), '-threads', '2', ...(motion ? ['-noautorotate'] : []), '-i', source,
    '-t', String(endSeconds - startSeconds), '-map', '0:v:0', '-an', '-sn', '-dn',
    '-vf', `setpts=PTS-STARTPTS,fps=${fps}:start_time=0:eof_action=pass,scale=${width}:${height}:flags=area,format=${channels === 1 ? 'gray' : 'rgb24'}`,
    '-frames:v', String(Math.ceil((endSeconds - startSeconds) * fps - 1e-9)), '-threads', '2', '-filter_threads', '2', '-f', 'rawvideo', 'pipe:1']
  const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = '', bytes = 0, spawnError: Error | undefined
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
      progress(Math.min(.99, Math.floor(bytes / frameBytes) / fps / (endSeconds - startSeconds)))
    }
    const code = await closed
    signal.throwIfAborted()
    if (spawnError) throw spawnError
    if (code !== 0) {
      logger.warn('画面分析解码失败', { event: 'video.frame_analysis.decode.failed', context: { analysis: motion ? 'motion' : 'screen_changes', exitCode: code }, error: new Error(stderr) })
      throw new Error(motion ? '运动分析解码失败，请检查原视频后重试。' : '局部画面解码失败，请检查原视频后重试。')
    }
    const result = motion ? await worker.finishMotion() : await worker.finish()
    signal.throwIfAborted(); progress(1); return result
  } finally {
    signal.removeEventListener('abort', abort)
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await closed
    await worker.dispose()
  }
}
