import { parentPort, workerData } from 'node:worker_threads'
import { AudioEffectChain, type AudioEffectInstance } from '../../../../src/core/audio/effects/audioEffectChain'
import { createF32WavWriter, openF32Wav } from './pcm-wav'

/**
 * 音频编辑导出时离线跑效果链（与试听同一份实现，src/core/audio/effects）：整条声音按块顺序处理，状态连续；
 * 效果链的固定延迟用尾部补零冲出、开头丢掉同样长度，输出与输入逐样本对齐、等长。
 */

// RNNoise 的 WebAssembly 只认浏览器窗口或 Web Worker 环境；Node 工作线程补上同名全局后照常加载（模型内嵌在包里，不联网）。
const scope = globalThis as unknown as Record<string, unknown>
scope.WorkerGlobalScope ??= class {}
scope.self ??= globalThis

interface Job { input: string; output: string; effects: AudioEffectInstance[] }
const BLOCK = 8192

async function run(job: Job): Promise<void> {
  const reader = await openF32Wav(job.input)
  if (!reader) throw new Error('效果处理只接受 32 位浮点 WAV。')
  const { sampleRate, channels, frames } = reader
  const chain = new AudioEffectChain(sampleRate, channels)
  await chain.sync(job.effects)
  const latency = chain.latency
  const writer = await createF32WavWriter(job.output, sampleRate, channels, frames)
  const planar = Array.from({ length: channels }, () => new Float32Array(BLOCK))
  let skip = latency, written = 0
  try {
    for (let start = 0; written < frames; start += BLOCK) {
      const count = Math.min(BLOCK, frames + latency - start)
      const real = Math.max(0, Math.min(count, frames - start))
      const pcm = real ? await reader.read(start, real) : new Float32Array(0)
      for (let channel = 0; channel < channels; channel++) {
        const lane = planar[channel]
        for (let frame = 0; frame < count; frame++) lane[frame] = frame < real ? pcm[frame * channels + channel] : 0
      }
      chain.process(planar, count)
      const drop = Math.min(skip, count); skip -= drop
      const keep = Math.min(count - drop, frames - written)
      if (keep > 0) {
        const out = new Float32Array(keep * channels)
        for (let frame = 0; frame < keep; frame++) for (let channel = 0; channel < channels; channel++) out[frame * channels + channel] = planar[channel][drop + frame]
        await writer.write(out)
        written += keep
      }
      parentPort?.postMessage({ type: 'progress', value: Math.min(1, written / Math.max(1, frames)) })
    }
  } finally {
    chain.dispose()
    await writer.close()
    await reader.close()
  }
}

run(workerData as Job).then(() => parentPort?.postMessage({ type: 'done' }), (error: unknown) => parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
