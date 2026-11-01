import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { loadFfmpegPath } from '../../video/ffmpeg-loader'
import { WEB_CACHE_COLOR_ARGS, webCacheEncodeArgs } from '../../video/hwaccel'
import type { VideoEditRatio } from '../../../../../src/core/videoEdit/time'
import { rawMatroskaFrameHeader, rawMatroskaHeader, type RawPixelFormat } from './rawMatroska'

let nvencProbe: Promise<boolean> | null = null
/** One tiny NVENC encode decides whether frames go to the GPU encoder; large frames outrun libx264. */
function probeNvenc(ffmpeg: string): Promise<boolean> {
  nvencProbe ??= new Promise(resolve => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=256x256:r=30', '-frames:v', '1', '-c:v', 'h264_nvenc', '-f', 'null', '-'])
    child.on('error', () => resolve(false))
    child.on('close', code => resolve(code === 0))
  })
  return nvencProbe
}

/** Frames between keyframes: half a second. */
export function keyframeInterval(fps: number): number { return Math.max(1, Math.round(fps / 2)) }

/** 先找好 ffmpeg、试过 NVENC，免得第一帧才去做。 */
export async function prepareFrameEncoder(): Promise<void> { await probeNvenc(await loadFfmpegPath()) }

/** Bytes of one raw frame. NV12 needs even sizes. */
export function rawFrameBytes(width: number, height: number, format: RawPixelFormat | 'yuv444p'): number {
  return width * height * (format === 'nv12' ? 3 / 2 : format === 'yuv444p' ? 3 : 4)
}

/**
 * 重演的 BGRA/NV12 使用 BT.601 与带时间戳的 Matroska，允许延长静帧。
 * 网页缓存的平面444已经做过 BT.709 转换，使用完整逐帧输入与无损 HEVC；奇数边缘只向右下补齐。
 */
export class FrameEncoder {
  private process: ChildProcessWithoutNullStreams | null = null
  private exit: Promise<void> | null = null
  private stderr = ''
  private finished = false
  private last: { bitmap: Buffer; frame: number } | null = null
  /** Distinct pictures sent to FFmpeg. */
  sent = 0
  /** Frames the output holds (the last frame index + 1). */
  frames = 0
  sourceWidth = 0
  sourceHeight = 0
  readonly width: number
  readonly height: number
  private readonly fps: number
  private readonly rate: string
  private failure?: Error
  private starting = false
  private writing = false

  constructor(width: number, height: number, fps: number | VideoEditRatio, private readonly output: string, readonly format: RawPixelFormat | 'yuv444p' = 'bgra', private readonly executable?: string) {
    this.fps = typeof fps === 'number' ? fps : fps.numerator / fps.denominator
    this.rate = typeof fps === 'number' ? String(fps) : `${fps.numerator}/${fps.denominator}`
    this.width = format === 'yuv444p' ? Math.max(2, Math.ceil(width / 2) * 2) : Math.max(2, Math.floor(width / 2) * 2)
    this.height = format === 'yuv444p' ? Math.max(2, Math.ceil(height / 2) * 2) : Math.max(2, Math.floor(height / 2) * 2)
  }

  async start(sourceWidth: number, sourceHeight: number): Promise<void> {
    if (this.starting || this.process || this.finished) throw new Error('编码会话已经启动或结束')
    this.starting = true
    this.sourceWidth = sourceWidth
    this.sourceHeight = sourceHeight
    const ffmpeg = this.executable ?? await loadFfmpegPath()
    const crop = sourceWidth !== this.width || sourceHeight !== this.height ? `crop=${this.width}:${this.height}:0:0,` : ''
    // A keyframe every half second, each one a clean entry point (IDR / closed GOP): the editor seeks and
    // scrubs these videos, and seeking decodes from the keyframe before the target.
    const gop = String(keyframeInterval(this.fps))
    // NVENC takes BGRA as is and converts on the GPU; libx264 needs a CPU conversion first.
    const codec = this.format === 'yuv444p' ? webCacheEncodeArgs(this.fps) : await probeNvenc(ffmpeg)
      ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '16', '-b:v', '0', '-g', gop, '-forced-idr', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', gop, '-flags', '+cgop']
    // Same tags whichever way the frames came in: BT.601, limited range.
    const color = this.format === 'yuv444p' ? [...WEB_CACHE_COLOR_ARGS] : ['-colorspace', 'bt470bg', '-color_range', 'tv']
    const input = this.format === 'yuv444p'
      ? ['-f', 'rawvideo', '-pixel_format', 'yuv444p', '-video_size', `${sourceWidth}x${sourceHeight}`, '-framerate', this.rate, ...color, '-i', 'pipe:0',
        ...(sourceWidth !== this.width || sourceHeight !== this.height ? ['-vf', `pad=${this.width}:${this.height}:0:0`] : [])]
      : ['-f', 'matroska', '-i', 'pipe:0', '-vf', `${crop}fps=${this.rate}:round=near`]
    if (this.finished) throw new Error('编码会话已取消')
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      ...input,
      // round=near maps each timestamp (whole frames, rounded to µs) back onto its own frame.
      '-fps_mode', 'passthrough', ...codec, ...color, '-movflags', '+faststart', '-f', 'mp4', this.output,
    ], { windowsHide: true })
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-4000) })
    // 编码器中途退出（含 abort）后管道写入会报 EPIPE；结果由退出码报告，这里只防止未处理的错误事件。
    child.stdin.on('error', error => { this.failure = error; this.stderr = (this.stderr + String(error)).slice(-4000) })
    this.exit = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', code => (code === 0 ? resolve() : reject(new Error(`视频编码失败（${code}）：${this.stderr.trim()}`))))
    })
    // 退出可能先于下一次 write/finish；提前观察拒绝，仍由公开操作交回失败。
    void this.exit.catch(error => { this.failure = error instanceof Error ? error : new Error(String(error)) })
    this.process = child
    if (this.format !== 'yuv444p') await this.send(rawMatroskaHeader(sourceWidth, sourceHeight, this.fps, this.format))
  }

  private async send(chunk: Buffer): Promise<void> {
    const child = this.process
    if (!child) throw new Error('编码器未启动')
    if (this.failure) throw this.failure
    // 写回调同时处理背压与 EPIPE；只等 drain 会在编码进程退出后永久挂起。
    await new Promise<void>((resolve, reject) => child.stdin.write(chunk, error => error ? reject(error) : resolve()))
  }

  private async sendFrame(bitmap: Buffer, frame: number): Promise<void> {
    if (this.format !== 'yuv444p') await this.send(rawMatroskaFrameHeader(frame * 1e6 / this.fps, bitmap.length))
    await this.send(bitmap)
    this.sent += 1
  }

  /** Output frame `frame` (0-based) shows `bitmap` until a later write; frames must not go backwards. */
  async write(bitmap: Buffer, frame: number): Promise<void> {
    if (this.finished) throw new Error('编码器已结束')
    if (this.writing) throw new Error('编码帧需要串行提交')
    if (bitmap.length !== rawFrameBytes(this.sourceWidth, this.sourceHeight, this.format)) throw new Error('帧尺寸与编码器不一致')
    if (this.last && frame <= this.last.frame) throw new Error('重演帧的时间不能倒退')
    if (this.format === 'yuv444p' && frame !== this.frames) throw new Error('网页缓存不能补重复帧，必须从段首逐帧重演')
    this.writing = true
    try {
      await this.sendFrame(bitmap, frame)
      this.last = { bitmap, frame }
      this.frames = frame + 1
    } finally { this.writing = false }
  }

  /** Ends the video after output frame `lastFrame`, holding the last picture until then. */
  async finish(lastFrame: number): Promise<void> {
    if (this.writing) throw new Error('请等待当前编码帧提交完成')
    if (!this.process || !this.last || this.finished) throw new Error('编码器没有可结束的帧')
    if (this.format === 'yuv444p' && lastFrame !== this.last.frame) throw new Error('网页缓存不能延长或截短已提交的帧')
    if (this.last && lastFrame > this.last.frame) { await this.sendFrame(this.last.bitmap, lastFrame); this.frames = lastFrame + 1 }
    this.process?.stdin.end()
    await this.exit
    this.finished = true
  }

  /** 停掉编码并等进程放开输出文件。返回 true 表示输出只写了一半，调用方应删掉它。 */
  async abort(): Promise<boolean> {
    const child = this.process
    if (this.finished) return false
    this.finished = true
    if (!child) return false
    child.kill()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([this.exit?.catch(() => undefined), new Promise(resolve => { timer = setTimeout(resolve, 5_000) })])
    clearTimeout(timer)
    return true
  }
}
