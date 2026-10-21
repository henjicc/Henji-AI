import { spawn } from 'node:child_process'
import { SOUND_ANALYSIS_SAMPLE_RATE } from '../../../../../src/core/soundLibrary/soundFeatures'

/*
 * 音效与音乐解码：随包 FFmpeg 在后台进程里把任意常见格式解成双声道 32 位浮点 PCM（音效 48 kHz，节拍分析 22050 Hz）。
 * 单声道源被 FFmpeg 复制成两个相同声道，这里认出来后还原为单声道（响度按 BS.1770 单声道计）。
 * 最多读前 MAX_SECONDS 秒；更长的文件时长取容器报告的总时长。
 */

export const SOUND_DECODE_MAX_SECONDS = 60
const STDERR_LIMIT = 16_384

export interface DecodedSound { channels: Float32Array[]; durationSeconds: number }

export class SoundDecodeError extends Error {
  constructor(message: string) { super(message); this.name = 'SoundDecodeError' }
}

function containerDuration(stderr: string): number | null {
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null
}

/** 把用户可理解的失败原因从 FFmpeg 输出里归类出来（不带路径）。 */
function failureReason(stderr: string): string {
  if (/Invalid data found|could not find codec parameters|moov atom not found|Invalid argument|header|EBML/i.test(stderr)) return '文件已损坏或不是有效的音频'
  if (/does not contain any stream|Stream map '0:a:0' matches no streams|matches no streams/i.test(stderr)) return '文件里没有声音'
  if (/Permission denied/i.test(stderr)) return '没有读取这个文件的权限'
  if (/No such file/i.test(stderr)) return '文件已不存在'
  return '无法解码这个文件'
}

export interface DecodedPcm {
  /** 两个声道（单声道源由 FFmpeg 复制成相同的两路）。 */
  channels: [Float32Array, Float32Array]
  /** 实际解码的秒数。 */
  decodedSeconds: number
  /** 容器报告的总时长；读不到为 null。 */
  reportedSeconds: number | null
}

/** 随包 FFmpeg 把第一条音频流解成指定采样率的双声道 32 位浮点 PCM，最多 maxSeconds 秒。 */
export function decodePcm(ffmpegPath: string, file: string, options: { sampleRate: number; maxSeconds: number }, signal: AbortSignal): Promise<DecodedPcm> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-nostats', '-i', file, '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', String(options.maxSeconds), '-ac', '2', '-ar', String(options.sampleRate), '-f', 'f32le', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []; let bytes = 0; let stderr = ''
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk); bytes += chunk.byteLength })
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-STDERR_LIMIT) })
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) { reject(signal.reason ?? new Error('已取消')); return }
      const frames = Math.floor(bytes / 8)
      if (code !== 0 || frames === 0) { reject(new SoundDecodeError(code === 0 ? '声音为空' : failureReason(stderr))); return }
      // 拼进独立缓冲区：Node 的小块缓冲可能来自共享池，偏移不保证按 4 字节对齐。
      const aligned = new Uint8Array(frames * 8); let offset = 0
      for (const chunk of chunks) { const take = Math.min(chunk.byteLength, aligned.length - offset); aligned.set(chunk.subarray(0, take), offset); offset += take }
      const interleaved = new Float32Array(aligned.buffer)
      const left = new Float32Array(frames), right = new Float32Array(frames)
      for (let index = 0; index < frames; index++) { left[index] = interleaved[index * 2]; right[index] = interleaved[index * 2 + 1] }
      resolve({ channels: [left, right], decodedSeconds: frames / options.sampleRate, reportedSeconds: containerDuration(stderr) })
    })
  })
}

export async function decodeSound(ffmpegPath: string, file: string, signal: AbortSignal): Promise<DecodedSound> {
  const pcm = await decodePcm(ffmpegPath, file, { sampleRate: SOUND_ANALYSIS_SAMPLE_RATE, maxSeconds: SOUND_DECODE_MAX_SECONDS }, signal)
  const [left, right] = pcm.channels
  let identical = true
  for (let index = 0; identical && index < left.length; index++) if (left[index] !== right[index]) identical = false
  const decoded = pcm.decodedSeconds
  return { channels: identical ? [left] : [left, right], durationSeconds: decoded >= SOUND_DECODE_MAX_SECONDS - 0.01 && pcm.reportedSeconds ? Math.max(decoded, pcm.reportedSeconds) : decoded }
}
