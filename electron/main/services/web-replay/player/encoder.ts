import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { loadFfmpegPath } from '../../video/ffmpeg-loader'
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
export function rawFrameBytes(width: number, height: number, format: RawPixelFormat): number {
  return format === 'nv12' ? width * height * 3 / 2 : width * height * 4
}

/**
 * Raw frames in (BGRA, or NV12 already converted with BT.601 limited range, the matrix NVENC applies to
 * BGRA and the one the output is tagged with), constant-frame-rate H.264 MP4 out. Each frame is sent once with its timestamp
 * (raw Matroska); FFmpeg's fps filter repeats it until the next one, so an unchanged picture is not sent
 * again. Width and height are rounded down to even numbers.
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

  constructor(width: number, height: number, private readonly fps: number, private readonly output: string, readonly format: RawPixelFormat = 'bgra') {
    this.width = Math.max(2, Math.floor(width / 2) * 2)
    this.height = Math.max(2, Math.floor(height / 2) * 2)
  }

  async start(sourceWidth: number, sourceHeight: number): Promise<void> {
    this.sourceWidth = sourceWidth
    this.sourceHeight = sourceHeight
    const ffmpeg = await loadFfmpegPath()
    const crop = sourceWidth !== this.width || sourceHeight !== this.height ? `crop=${this.width}:${this.height}:0:0,` : ''
    // A keyframe every half second, each one a clean entry point (IDR / closed GOP): the editor seeks and
    // scrubs these videos, and seeking decodes from the keyframe before the target.
    const gop = String(keyframeInterval(this.fps))
    // NVENC takes BGRA as is and converts on the GPU; libx264 needs a CPU conversion first.
    const codec = await probeNvenc(ffmpeg)
      ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '16', '-b:v', '0', '-g', gop, '-forced-idr', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-g', gop, '-flags', '+cgop']
    // Same tags whichever way the frames came in: BT.601, limited range.
    const color = ['-colorspace', 'bt470bg', '-color_range', 'tv']
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'matroska', '-i', 'pipe:0',
      // round=near maps each timestamp (whole frames, rounded to µs) back onto its own frame.
      '-vf', `${crop}fps=${this.fps}:round=near`, '-fps_mode', 'passthrough',
      ...codec, ...color, '-movflags', '+faststart', this.output,
    ])
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-4000) })
    // 编码器中途退出（含 abort）后管道写入会报 EPIPE；结果由退出码报告，这里只防止未处理的错误事件。
    child.stdin.on('error', error => { this.stderr = (this.stderr + String(error)).slice(-4000) })
    this.exit = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', code => (code === 0 ? resolve() : reject(new Error(`视频编码失败（${code}）：${this.stderr.trim()}`))))
    })
    this.process = child
    await this.send(rawMatroskaHeader(sourceWidth, sourceHeight, this.fps, this.format))
  }

  private async send(chunk: Buffer): Promise<void> {
    const child = this.process
    if (!child) throw new Error('编码器未启动')
    if (!child.stdin.write(chunk)) await new Promise<void>(resolve => child.stdin.once('drain', () => resolve()))
  }

  private async sendFrame(bitmap: Buffer, frame: number): Promise<void> {
    await this.send(rawMatroskaFrameHeader(frame * 1e6 / this.fps, bitmap.length))
    await this.send(bitmap)
    this.sent += 1
  }

  /** Output frame `frame` (0-based) shows `bitmap` until a later write; frames must not go backwards. */
  async write(bitmap: Buffer, frame: number): Promise<void> {
    if (bitmap.length !== rawFrameBytes(this.sourceWidth, this.sourceHeight, this.format)) throw new Error('帧尺寸与编码器不一致')
    if (this.last && frame <= this.last.frame) throw new Error('重演帧的时间不能倒退')
    await this.sendFrame(bitmap, frame)
    this.last = { bitmap, frame }
    this.frames = frame + 1
  }

  /** Ends the video after output frame `lastFrame`, holding the last picture until then. */
  async finish(lastFrame: number): Promise<void> {
    if (this.last && lastFrame > this.last.frame) { await this.sendFrame(this.last.bitmap, lastFrame); this.frames = lastFrame + 1 }
    this.process?.stdin.end()
    await this.exit
    this.finished = true
  }

  /** 停掉编码并等进程放开输出文件。返回 true 表示输出只写了一半，调用方应删掉它。 */
  async abort(): Promise<boolean> {
    const child = this.process
    if (!child || this.finished) return false
    child.kill()
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([this.exit?.catch(() => undefined), new Promise(resolve => { timer = setTimeout(resolve, 5_000) })])
    clearTimeout(timer)
    return true
  }
}
