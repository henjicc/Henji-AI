import { spawn, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import type { FrameRequest } from './analysis'
import { SmartRegionAnalysisError } from './analysis'
import type { SmartRegionAnalysisJob } from './protocol'

/*
 * 分析用的取帧：与缩略帧、导出同一份 FFmpeg（Windows 为随包的 BtbN 9.0 构建），在后台进程里以子进程运行，
 * 直接按模型输入尺寸缩小并输出 RGB24 原始帧，只把小帧读进内存。
 * - `-ss` 放在输入前（精确定位，相对容器起点，由主进程换算好），`-t` 限定分析范围；
 * - `fps` 滤镜把帧放到固定间隔上：第 i 帧对应 起点 + i / fps，与结果文件里的时间换算一致；
 * - FFmpeg 默认按显示矩阵自动旋转，宽高由主进程按显示比例算好后直接拉伸到目标尺寸。
 */

export function analysisFfmpegArgs(job: Pick<SmartRegionAnalysisJob, 'source' | 'seekSeconds' | 'durationSeconds' | 'fps'>, request: FrameRequest): string[] {
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-threads', '2']
  const still = job.durationSeconds === null
  if (!still && job.seekSeconds > 0) args.push('-ss', job.seekSeconds.toFixed(6))
  args.push('-i', job.source)
  if (!still) args.push('-t', job.durationSeconds!.toFixed(6))
  const filters = [...(still ? [] : [`fps=fps=${job.fps}:round=near`]), `scale=${request.width}:${request.height}:flags=area`]
  args.push('-map', '0:v:0', '-an', '-sn', '-dn', '-vf', filters.join(','), ...(still ? ['-frames:v', '1'] : []), '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1')
  return args
}

/** 把字节流切成固定大小的帧。 */
export async function* rawFrames(stream: AsyncIterable<Buffer | Uint8Array>, frameBytes: number): AsyncGenerator<Uint8Array> {
  let pending = new Uint8Array(frameBytes); let filled = 0
  for await (const chunk of stream) {
    let offset = 0
    while (offset < chunk.byteLength) {
      const take = Math.min(frameBytes - filled, chunk.byteLength - offset)
      pending.set(chunk.subarray(offset, offset + take), filled)
      filled += take; offset += take
      if (filled === frameBytes) { yield pending; pending = new Uint8Array(frameBytes); filled = 0 }
    }
  }
}

const STDERR_LIMIT = 2048

export async function* ffmpegFrames(ffmpegPath: string, job: SmartRegionAnalysisJob, request: FrameRequest, signal: AbortSignal): AsyncGenerator<Uint8Array> {
  const child: ChildProcessByStdio<null, Readable, Readable> = spawn(ffmpegPath, analysisFfmpegArgs(job, request), { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < STDERR_LIMIT) stderr += chunk.toString('utf8').slice(0, STDERR_LIMIT - stderr.length) })
  const exited = new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)) })
  const abort = (): void => { child.kill() }
  signal.addEventListener('abort', abort, { once: true })
  let finished = false
  try {
    yield* rawFrames(child.stdout, request.width * request.height * 3)
    const code = await exited
    finished = true
    if (code !== 0 && !signal.aborted) throw new SmartRegionAnalysisError('decode', `素材解码失败（FFmpeg ${code}）：${stderr.trim().slice(0, 300)}`)
  } catch (error) {
    if (error instanceof SmartRegionAnalysisError) throw error
    if (signal.aborted) throw new SmartRegionAnalysisError('cancelled', '分析已取消。')
    throw new SmartRegionAnalysisError('decode', `素材解码失败：${error instanceof Error ? error.message : String(error)}`, { cause: error })
  } finally {
    signal.removeEventListener('abort', abort)
    // 提前结束（取消、推理失败）时结束 FFmpeg，避免它阻塞在写管道上。
    if (!finished) { child.kill(); await exited.catch(() => null) }
  }
}
