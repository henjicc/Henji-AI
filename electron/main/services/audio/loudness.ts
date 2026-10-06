import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import { videoEditLoudnessSettingsSchema, type VideoEditLoudnessMeasurement, type VideoEditLoudnessSettings } from '../../../../src/core/videoEdit/loudness'
import { invertVideoEditSilence, videoEditActivityThreshold, type VideoEditAudioActivity } from '../../../../src/core/videoEdit/audioDucking'

const number = (text: string | undefined): number | null => text !== undefined && Number.isFinite(Number(text)) ? Number(text) : null
/** FFmpeg's final summary is authoritative; silence/ungated audio has no integrated LUFS. */
export function parseLoudnessLog(text: string, durationSeconds: number, samplePeak: number | null): VideoEditLoudnessMeasurement {
  const summary = text.slice(text.lastIndexOf('Summary:'))
  const integrated = number(summary.match(/Integrated loudness:\s*I:\s*([-\d.]+)/)?.[1])
  const threshold = number(summary.match(/Integrated loudness:[\s\S]*?Threshold:\s*([-\d.]+)/)?.[1])
  const short = [...text.matchAll(/\bS:\s*([-\d.]+)/g)].at(-1)?.[1]
  const peak = number(summary.match(/Sample peak:\s*Peak:\s*([-\d.inf]+)/)?.[1])
  if (integrated === null || threshold === null) throw new Error('响度测量未返回完整结果。')
  return { integratedLufs: integrated <= -70 || peak === null ? null : integrated, shortTermLufs: durationSeconds < 3 || number(short) === null || Number(short) <= -70 ? null : Number(short), truePeakDbtp: peak, samplePeakDbfs: samplePeak, durationSeconds }
}

/** All DSP is performed in a background FFmpeg process; memory and stderr are bounded. */
export async function runLoudnessFfmpeg(args: string[], signal: AbortSignal, binary?: string, onLine?: (line: string) => void): Promise<string> {
  signal.throwIfAborted()
  const executable = binary ?? await loadFfmpegPath()
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['-hide_banner', '-nostdin', '-nostats', ...args], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
    let tail = ''
    let pending = ''; let lineFailure: unknown
    child.stderr.on('data', chunk => {
      tail = (tail + String(chunk)).slice(-65536)
      if (!onLine || lineFailure) return
      pending += String(chunk)
      const lines = pending.split(/\r?\n/); pending = lines.pop()!.slice(-65536)
      try { for (const line of lines) onLine(line) } catch (error) { lineFailure = error; child.kill() }
    })
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason ?? new Error('响度处理已取消。'))
      else if (lineFailure) reject(lineFailure)
      else if (code !== 0) reject(new Error('声音测量或标准化失败，请确认声音完整且磁盘空间充足。'))
      else { try { if (pending && onLine) onLine(pending); resolve(tail) } catch (error) { reject(error) } }
    })
  })
}

/** Disk spool is sequential, at most 30 minutes of mono/stereo PCM. Released even on cancellation. */
export class AudioLoudnessSession {
  private frames = 0
  private peak = 0
  private directory = ''
  private normalized = false
  private sealed = false
  private busy = false
  private closed = false
  private readonly controller = new AbortController()
  constructor(readonly sampleRate: number, readonly channels: number, private readonly binary?: string) {
    if (![44100, 48000].includes(sampleRate) || ![1, 2].includes(channels)) throw new Error('响度测量支持 44.1/48 kHz 的单声道或立体声。')
  }
  async initialize(): Promise<void> {
    this.directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-loudness-'))
    await fs.writeFile(this.file('input'), new Uint8Array(), { flag: 'wx' })
    if (this.closed) { await fs.rm(this.directory, { recursive: true, force: true }); throw new Error('响度处理已取消。') }
  }
  private file(name: string): string { return path.join(this.directory, `${name}.f32`) }
  private input(file: string): string[] { return ['-f', 'f32le', '-ar', String(this.sampleRate), '-ac', String(this.channels), '-i', file] }
  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed || !this.directory) throw new Error('声音测量会话已关闭。')
    if (this.busy) throw new Error('声音测量会话正在处理，请等待当前操作。')
    this.busy = true
    try { return await work() } finally { this.busy = false }
  }
  async append(planes: Float32Array[]): Promise<void> {
    return this.exclusive(async () => {
      if (this.sealed) throw new Error('已测量的声音不能继续追加。')
      const length = planes[0]?.length
      if (planes.length !== this.channels || !length || length > this.sampleRate * 2 || planes.some(plane => !(plane instanceof Float32Array) || plane.length !== length)) throw new Error('声音块必须是最多两秒的完整浮点声道。')
      if (this.frames + length > this.sampleRate * 1800) throw new Error('声音长度超过 30 分钟。')
      const data = Buffer.allocUnsafe(length * this.channels * 4)
      let peak = 0
      for (let frame = 0; frame < length; frame++) for (let channel = 0; channel < this.channels; channel++) {
        const value = planes[channel][frame]
        if (!Number.isFinite(value)) throw new Error('声音中包含无效采样。')
        data.writeFloatLE(value, (frame * this.channels + channel) * 4); peak = Math.max(peak, Math.abs(value))
      }
      await fs.appendFile(this.file('input'), data); this.frames += length; this.peak = Math.max(this.peak, peak)
    })
  }
  private async analyze(file: string, original: boolean): Promise<VideoEditLoudnessMeasurement> {
    // Exactly 4× at BOTH supported rates. ebur128 meters the reconstructed signal's peak.
    const log = await runLoudnessFfmpeg([...this.input(file), '-af', `aresample=${this.sampleRate * 4},ebur128=peak=sample:framelog=info`, '-f', 'null', '-'], this.controller.signal, this.binary)
    return parseLoudnessLog(log, this.frames / this.sampleRate, original && this.peak > 0 ? 20 * Math.log10(this.peak) : null)
  }
  async measure(): Promise<VideoEditLoudnessMeasurement> {
    return this.exclusive(async () => { this.sealed = true; return this.analyze(this.file('input'), true) })
  }
  async detectActivity(sensitivity: number): Promise<VideoEditAudioActivity[]> {
    return this.exclusive(async () => {
      const threshold = videoEditActivityThreshold(sensitivity); this.sealed = true
      if (!this.frames) throw new Error('没有可分析的声音。')
      const silence: VideoEditAudioActivity[] = []; let start: number | undefined
      await runLoudnessFfmpeg([...this.input(this.file('input')), '-af', `asetpts=PTS-STARTPTS,silencedetect=noise=${threshold}dB:d=0.15`, '-f', 'null', '-'], this.controller.signal, this.binary, line => {
        const began = /silence_start: ([\d.e+-]+)/.exec(line); const ended = /silence_end: ([\d.e+-]+)/.exec(line)
        if (began) start = Math.max(0, Number(began[1]))
        if (ended && start !== undefined) { silence.push({ startSeconds: start, endSeconds: Number(ended[1]) }); start = undefined }
        if (silence.length > 12000) throw new Error('声音活动过于密集，请分段分析。')
      })
      const duration = this.frames / this.sampleRate
      if (start !== undefined) silence.push({ startSeconds: start, endSeconds: duration })
      return invertVideoEditSilence(silence, duration)
    })
  }
  async normalize(settings: VideoEditLoudnessSettings): Promise<VideoEditLoudnessMeasurement> {
    return this.exclusive(async () => {
      settings = videoEditLoudnessSettingsSchema.parse(settings); this.sealed = true
      const measured = await this.analyze(this.file('input'), true)
      if (measured.integratedLufs === null) throw new Error('声音低于响度门限或不足 400 毫秒，无法标准化。')
      const base = `loudnorm=I=${settings.targetLufs}:TP=${settings.truePeakDbtp - .2}:LRA=50`
      const first = await runLoudnessFfmpeg([...this.input(this.file('input')), '-af', `${base}:print_format=json`, '-f', 'null', '-'], this.controller.signal, this.binary)
      const json = first.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0]
      if (!json) throw new Error('标准化分析未返回结果。')
      const stats = JSON.parse(json) as Record<string, unknown>
      const fields = ['input_i', 'input_tp', 'input_lra', 'input_thresh', 'target_offset'] as const
      if (fields.some(key => typeof stats[key] !== 'string' || !Number.isFinite(Number(stats[key])))) throw new Error('标准化分析结果无效。')
      let offset = Number(stats.target_offset)
      for (let attempt = 0; attempt < 3; attempt++) {
        const filter = `${base}:measured_I=${Number(stats.input_i)}:measured_TP=${Number(stats.input_tp)}:measured_LRA=${Number(stats.input_lra)}:measured_thresh=${Number(stats.input_thresh)}:offset=${offset}:linear=true`
        await runLoudnessFfmpeg(['-y', ...this.input(this.file('input')), '-af', filter, '-ar', String(this.sampleRate), '-f', 'f32le', this.file('output')], this.controller.signal, this.binary)
        const result = await this.analyze(this.file('output'), false)
        if (result.integratedLufs !== null && Math.abs(result.integratedLufs - settings.targetLufs) <= .5 && result.truePeakDbtp !== null && result.truePeakDbtp <= settings.truePeakDbtp + .05) {
          const size = (await fs.stat(this.file('output'))).size
          if (size !== this.frames * this.channels * 4) throw new Error('标准化改变了声音长度，导出已停止。')
          this.normalized = true; return result
        }
        if (result.integratedLufs === null) break
        offset += settings.targetLufs - result.integratedLufs
      }
      throw new Error('当前声音无法同时达到目标响度和真峰值上限，请降低目标响度后重试。')
    })
  }
  async read(startFrame: number, frames: number): Promise<Float32Array[]> {
    return this.exclusive(async () => {
      if (!this.normalized) throw new Error('声音尚未完成标准化。')
      if (!Number.isSafeInteger(startFrame) || startFrame < 0 || !Number.isSafeInteger(frames) || frames < 1 || frames > this.sampleRate * 2 || startFrame + frames > this.frames) throw new Error('声音读取范围无效。')
      const bytes = Buffer.alloc(frames * this.channels * 4)
      const handle = await fs.open(this.file('output'), 'r')
      try {
        let read = 0
        while (read < bytes.length) { const result = await handle.read(bytes, read, bytes.length - read, startFrame * this.channels * 4 + read); if (!result.bytesRead) throw new Error('标准化声音数据不完整。'); read += result.bytesRead }
      } finally { await handle.close() }
      return Array.from({ length: this.channels }, (_, channel) => Float32Array.from({ length: frames }, (_, frame) => bytes.readFloatLE((frame * this.channels + channel) * 4)))
    })
  }
  async close(): Promise<void> {
    this.closed = true; this.controller.abort(new Error('响度处理已取消。'))
    // Wait only for bounded I/O/child exit, without blocking the event loop.
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 10))
    if (this.directory) await fs.rm(this.directory, { recursive: true, force: true })
  }
}
