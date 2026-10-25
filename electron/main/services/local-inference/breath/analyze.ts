import { spawn } from 'node:child_process'
import {
  BREATH_DETECTION_VERSION, RESPIRO_CHUNK_FRAMES, RESPIRO_CHUNK_SAMPLES, RESPIRO_SAMPLE_RATE,
  aggregateRespiro, respiroChunkStarts, respiroSegments, respiroWindow,
} from '../../../../../src/core/audioAnalysis/breath/respiro'
import type { LocalModelRunner } from '../analysis'
import type { LocalInferenceModelFile } from '../protocol'
import type { LocalExecutionProvider, LocalInferenceLog } from '../providers'
import type { BreathDetectionJob, BreathDetectionJobResult } from './protocol'

/** 口播通常几分钟到一小时；3 小时以上不做（整段 16 kHz 单声道常驻内存约 690 MB）。 */
export const BREATH_MAX_SECONDS = 3 * 60 * 60

export interface BreathDetectionDependencies {
  openModel(model: LocalInferenceModelFile, providers: readonly LocalExecutionProvider[], shape: string): Promise<LocalModelRunner>
  signal: AbortSignal
  progress(done: number, total: number): void
  log: LocalInferenceLog
}

/** 随包 FFmpeg 解成 16 kHz 单声道 32 位浮点（多声道取平均，与官方 librosa.load(mono=True) 一致）。 */
function decodeMono(ffmpegPath: string, file: string, signal: AbortSignal): Promise<Float32Array> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-nostats', '-i', file, '-map', '0:a:0', '-vn', '-sn', '-dn', '-t', String(BREATH_MAX_SECONDS), '-ac', '1', '-ar', String(RESPIRO_SAMPLE_RATE), '-f', 'f32le', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks: Buffer[] = []; let bytes = 0; let stderr = ''
    const abort = (): void => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk); bytes += chunk.byteLength })
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-4000) })
    child.once('error', error => { signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) { reject(signal.reason ?? new Error('已取消')); return }
      const samples = Math.floor(bytes / 4)
      if (code !== 0 || samples === 0) { reject(new Error(code === 0 ? '声音为空。' : `无法解码这段声音：${stderr.split('\n').filter(Boolean).at(-1) ?? code}`)); return }
      // 拼进独立缓冲区：Node 的小块缓冲可能来自共享池，偏移不保证按 4 字节对齐。
      const aligned = new Uint8Array(samples * 4); let offset = 0
      for (const chunk of chunks) { const take = Math.min(chunk.byteLength, aligned.length - offset); aligned.set(chunk.subarray(0, take), offset); offset += take }
      resolve(new Float32Array(aligned.buffer))
    })
  })
}

export async function runBreathDetection(job: BreathDetectionJob, deps: BreathDetectionDependencies): Promise<BreathDetectionJobResult> {
  let started = performance.now()
  const mono = await decodeMono(job.ffmpegPath, job.source, deps.signal)
  const decodeMs = performance.now() - started
  started = performance.now()
  const runner = await deps.openModel({ name: 'respiro', path: job.modelPath }, job.providers, `1x${RESPIRO_CHUNK_SAMPLES}`)
  const starts = respiroChunkStarts(mono.length)
  const probabilities: Float32Array[] = []
  for (const [index, start] of starts.entries()) {
    deps.signal.throwIfAborted()
    const { wave, frames } = respiroWindow(mono, start)
    const outputs = await runner.run({
      wave: { type: 'float32', data: wave, dims: [1, RESPIRO_CHUNK_SAMPLES] },
      length: { type: 'int64', data: BigInt64Array.from([BigInt(frames)]), dims: [1] },
    })
    const data = outputs.breath?.data
    if (!(data instanceof Float32Array) || data.length !== RESPIRO_CHUNK_FRAMES) throw new Error('呼吸声模型输出形状不符。')
    probabilities.push(data.slice(0, frames))
    deps.progress(index + 1, starts.length)
  }
  const merged = aggregateRespiro(mono.length, starts, probabilities)
  const breaths = respiroSegments(merged)
  const inferenceMs = performance.now() - started
  deps.log('info', '呼吸声检测完成', 'breath_detection.completed', { windows: starts.length, breaths: breaths.length, decodeMs: Math.round(decodeMs), inferenceMs: Math.round(inferenceMs), provider: runner.provider })
  return {
    detection: { version: BREATH_DETECTION_VERSION, model: 'respiro-en', durationMs: mono.length / RESPIRO_SAMPLE_RATE * 1000, breaths },
    provider: runner.provider, decodeMs, inferenceMs,
  }
}
