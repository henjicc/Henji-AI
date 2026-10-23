import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { loadFfmpegPath } from '../../video/ffmpeg-loader'

/** Raw BGRA frames in, H.264 MP4 out. Width and height are rounded down to even numbers. */
export class FrameEncoder {
  private process: ChildProcessWithoutNullStreams | null = null
  private exit: Promise<void> | null = null
  private stderr = ''
  frames = 0
  sourceWidth = 0
  sourceHeight = 0
  readonly width: number
  readonly height: number

  constructor(width: number, height: number, private readonly fps: number, private readonly output: string) {
    this.width = Math.max(2, Math.floor(width / 2) * 2)
    this.height = Math.max(2, Math.floor(height / 2) * 2)
  }

  async start(sourceWidth: number, sourceHeight: number): Promise<void> {
    this.sourceWidth = sourceWidth
    this.sourceHeight = sourceHeight
    const ffmpeg = await loadFfmpegPath()
    const crop = sourceWidth !== this.width || sourceHeight !== this.height ? ['-vf', `crop=${this.width}:${this.height}:0:0`] : []
    const child = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${sourceWidth}x${sourceHeight}`, '-r', String(this.fps), '-i', 'pipe:0',
      ...crop, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', this.output,
    ])
    child.stderr.on('data', chunk => { this.stderr = (this.stderr + String(chunk)).slice(-4000) })
    this.exit = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', code => (code === 0 ? resolve() : reject(new Error(`视频编码失败（${code}）：${this.stderr.trim()}`))))
    })
    this.process = child
  }

  /** Writes one frame, respecting back-pressure. */
  async write(bitmap: Buffer): Promise<void> {
    const child = this.process
    if (!child) throw new Error('编码器未启动')
    this.frames += 1
    if (!child.stdin.write(bitmap)) await new Promise<void>(resolve => child.stdin.once('drain', () => resolve()))
  }

  async finish(): Promise<void> {
    this.process?.stdin.end()
    await this.exit
  }

  abort(): void { this.process?.kill() }
}
