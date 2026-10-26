import { spawn } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { soundDecodeFailureReason, SoundDecodeError } from '../sound/decode'
import { parseFloat32WavHeader } from './wav'

/*
 * 人声分离的声音进出（随包 FFmpeg，在本地推理后台进程里运行）：
 * - decode：原采样率、原声道解成 32 位浮点（经管道输出 WAV，从文件头读出采样率与声道数）；
 * - decodeAt：同一条音轨按指定采样率解码（声道数不变），给模型用的 44.1 kHz；
 * - resample：把模型在 44.1 kHz 上的输出流式转回原采样率（边写边读，不整段常驻）。
 * FFmpeg 的重采样没有延迟偏移、首尾对齐（2026-10-26 用 48 kHz → 44.1 kHz → 48 kHz 往返核对，零滞后误差最小、长度不变）。
 * 解码结果直接按声道拆开存放，增长时按 1.5 倍扩容，不在内存里另留一份交错副本。
 */

export interface DecodedAudio { sampleRate: number; channels: Float32Array[] }

export interface SeparationResampler {
  /** 写入一段（每声道一段，等长）；重采样结果经 onOutput 按顺序交付。 */
  write(block: readonly Float32Array[]): Promise<void>
  /** 输入结束，等全部输出交付完。 */
  end(): Promise<void>
  /** 出错或取消时结束 FFmpeg（可重复调用）。 */
  destroy(): void
}

export interface SeparationAudioIo {
  decode(source: string, options: { maxSeconds: number }, signal: AbortSignal): Promise<DecodedAudio>
  decodeAt(source: string, options: { sampleRate: number; channels: number; maxSeconds: number }, signal: AbortSignal): Promise<Float32Array[]>
  resample(options: { from: number; to: number; channels: number }, signal: AbortSignal, onOutput: (block: Float32Array[]) => Promise<void>): SeparationResampler
}

const STDERR_LIMIT = 16_384

function containerSeconds(stderr: string): number | null {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null
}

/** 把管道送来的任意切分的字节拼成完整的帧（交错 32 位浮点），返回的数组按 4 字节对齐。 */
class FrameAssembler {
  private carry = new Uint8Array(0)
  constructor(private readonly frameBytes: number) {}
  push(chunk: Uint8Array): Float32Array | null {
    const total = this.carry.length + chunk.length
    const whole = total - total % this.frameBytes
    if (!whole) { const next = new Uint8Array(total); next.set(this.carry); next.set(chunk, this.carry.length); this.carry = next; return null }
    const bytes = new Uint8Array(whole)
    bytes.set(this.carry); bytes.set(chunk.subarray(0, whole - this.carry.length), this.carry.length)
    // 复制余下的字节（Buffer.slice 只是视图）。
    this.carry = new Uint8Array(chunk.subarray(whole - this.carry.length))
    return new Float32Array(bytes.buffer)
  }
}

/** 按声道拆开的 PCM，边解码边追加。 */
class PlanarCollector {
  private data: Float32Array[]
  private length = 0
  constructor(channels: number, capacity: number) { this.data = Array.from({ length: channels }, () => new Float32Array(Math.max(1, capacity))) }
  push(interleaved: Float32Array): void {
    const channels = this.data.length, frames = interleaved.length / channels
    if (this.length + frames > this.data[0].length) {
      const capacity = Math.max(this.length + frames, Math.ceil(this.data[0].length * 1.5))
      this.data = this.data.map((values) => { const next = new Float32Array(capacity); next.set(values.subarray(0, this.length)); return next })
    }
    for (let channel = 0; channel < channels; channel++) {
      const target = this.data[channel]
      for (let frame = 0; frame < frames; frame++) target[this.length + frame] = interleaved[frame * channels + channel]
    }
    this.length += frames
  }
  result(): Float32Array[] {
    // 预估偏大时收成准确长度（逐声道复制，峰值只多一个声道）。
    return this.data.map(values => values.length - this.length > 44_100 ? values.slice(0, this.length) : values.subarray(0, this.length))
  }
}

function runFfmpeg(ffmpegPath: string, args: string[], signal: AbortSignal, onData: (chunk: Buffer, stderr: string) => void): Promise<void> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''; let failure: unknown
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      if (failure !== undefined) return
      try { onData(chunk, stderr) } catch (error) { failure = error; child.kill() }
    })
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-STDERR_LIMIT) })
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason ?? new Error('已取消'))
      else if (failure !== undefined) reject(failure)
      else if (code !== 0) reject(new SoundDecodeError(soundDecodeFailureReason(stderr)))
      else resolve()
    })
  })
}

const decodeArgs = (source: string, maxSeconds: number): string[] => ['-hide_banner', '-nostdin', '-nostats', '-i', source, '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', String(maxSeconds), '-map_metadata', '-1']

async function decodeNative(ffmpegPath: string, source: string, maxSeconds: number, signal: AbortSignal): Promise<DecodedAudio> {
  let head = new Uint8Array(0)
  let format: { sampleRate: number; channels: number } | undefined
  let assembler: FrameAssembler | undefined
  let collector: PlanarCollector | undefined
  await runFfmpeg(ffmpegPath, [...decodeArgs(source, maxSeconds), '-c:a', 'pcm_f32le', '-f', 'wav', 'pipe:1'], signal, (chunk, stderr) => {
    let bytes: Uint8Array = chunk
    if (!format) {
      const joined = new Uint8Array(head.length + chunk.length); joined.set(head); joined.set(chunk, head.length)
      const header = parseFloat32WavHeader(joined)
      if (!header) { head = joined; return }
      format = { sampleRate: header.sampleRate, channels: header.channels }
      assembler = new FrameAssembler(header.channels * 4)
      // 按容器时长预留（读不到时先留 1 分钟，不够再扩）。
      const seconds = Math.min(maxSeconds, containerSeconds(stderr) ?? 60)
      collector = new PlanarCollector(header.channels, Math.ceil(seconds * header.sampleRate) + header.sampleRate)
      bytes = joined.subarray(header.dataOffset)
    }
    const frames = assembler!.push(bytes)
    if (frames) collector!.push(frames)
  })
  if (!format || !collector) throw new SoundDecodeError('声音为空')
  const channels = collector.result()
  if (!channels[0].length) throw new SoundDecodeError('声音为空')
  return { sampleRate: format.sampleRate, channels }
}

async function decodeResampled(ffmpegPath: string, source: string, options: { sampleRate: number; channels: number; maxSeconds: number }, signal: AbortSignal): Promise<Float32Array[]> {
  const assembler = new FrameAssembler(options.channels * 4)
  let collector: PlanarCollector | undefined
  await runFfmpeg(ffmpegPath, [...decodeArgs(source, options.maxSeconds), '-ac', String(options.channels), '-ar', String(options.sampleRate), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], signal, (chunk, stderr) => {
    collector ??= new PlanarCollector(options.channels, Math.ceil(Math.min(options.maxSeconds, containerSeconds(stderr) ?? 60) * options.sampleRate) + options.sampleRate)
    const frames = assembler.push(chunk)
    if (frames) collector.push(frames)
  })
  if (!collector) throw new SoundDecodeError('声音为空')
  return collector.result()
}

function interleave(block: readonly Float32Array[]): Uint8Array {
  const channels = block.length, frames = block[0]?.length ?? 0
  const out = new Float32Array(frames * channels)
  for (let channel = 0; channel < channels; channel++) {
    const values = block[channel]
    for (let frame = 0; frame < frames; frame++) out[frame * channels + channel] = values[frame]
  }
  return new Uint8Array(out.buffer)
}

function deinterleave(interleaved: Float32Array, channels: number): Float32Array[] {
  const frames = interleaved.length / channels
  return Array.from({ length: channels }, (_, channel) => {
    const out = new Float32Array(frames)
    for (let frame = 0; frame < frames; frame++) out[frame] = interleaved[frame * channels + channel]
    return out
  })
}

/** 等可写流排空（或流已关闭 / 出错，交给调用方从结束状态取失败原因）。 */
function drained(stream: Writable): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => { stream.off('drain', done); stream.off('close', done); stream.off('error', done); resolve() }
    stream.on('drain', done); stream.on('close', done); stream.on('error', done)
  })
}

function streamingResampler(ffmpegPath: string, options: { from: number; to: number; channels: number }, signal: AbortSignal, onOutput: (block: Float32Array[]) => Promise<void>): SeparationResampler {
  signal.throwIfAborted()
  const { channels } = options
  const child = spawn(ffmpegPath, [
    '-hide_banner', '-nostdin', '-nostats', '-f', 'f32le', '-ar', String(options.from), '-ac', String(channels), '-i', 'pipe:0',
    '-ar', String(options.to), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1',
  ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  const stdin = child.stdin as Writable, stdout = child.stdout as Readable
  let stderr = ''
  let failure: unknown
  let delivered: Promise<void> = Promise.resolve()
  const assembler = new FrameAssembler(channels * 4)
  const fail = (error: unknown): void => { failure ??= error; child.kill() }
  const abort = (): void => fail(signal.reason ?? new Error('已取消'))
  signal.addEventListener('abort', abort, { once: true })
  const closed = new Promise<number | null>((resolve) => {
    child.once('error', (error) => { failure ??= error; resolve(null) })
    child.once('close', code => resolve(code))
  })
  // FFmpeg 提前退出时写端会报 EPIPE，失败原因以退出状态为准。
  stdin.on('error', () => undefined)
  stdout.on('error', (error) => fail(error))
  child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-STDERR_LIMIT) })
  stdout.on('data', (chunk: Buffer) => {
    const frames = assembler.push(chunk)
    if (!frames || failure !== undefined) return
    const block = deinterleave(frames, channels)
    // 写文件期间暂停读取，FFmpeg 会随之暂停，内存里最多积压一段。
    stdout.pause()
    delivered = delivered.then(async () => {
      if (failure === undefined) await onOutput(block)
      stdout.resume()
    }).catch((error: unknown) => { fail(error); stdout.resume() })
  })
  return {
    async write(block) {
      if (failure !== undefined) throw failure
      if (!stdin.write(interleave(block))) await drained(stdin)
      if (failure !== undefined) throw failure
    },
    async end() {
      if (failure === undefined) stdin.end()
      const code = await closed
      await delivered
      signal.removeEventListener('abort', abort)
      if (failure !== undefined) throw failure
      if (code !== 0) throw new Error(`重采样失败：${stderr.split('\n').filter(Boolean).at(-1) ?? code}`)
    },
    destroy() { signal.removeEventListener('abort', abort); child.kill() },
  }
}

export function ffmpegSeparationAudio(ffmpegPath: string): SeparationAudioIo {
  return {
    decode: (source, options, signal) => decodeNative(ffmpegPath, source, options.maxSeconds, signal),
    decodeAt: (source, options, signal) => decodeResampled(ffmpegPath, source, options, signal),
    resample: (options, signal, onOutput) => streamingResampler(ffmpegPath, options, signal, onOutput),
  }
}
