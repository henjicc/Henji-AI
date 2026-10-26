import { parentPort, workerData } from 'node:worker_threads'
import { detectAudioEditMouthClicks, type AudioEditMouthClick } from '../../../../src/core/audioEdit/mouthClicks'
import { openF32Wav } from './pcm-wav'

/**
 * 口水音检测（主进程工作线程）：编辑后的声音按 60 秒一块读，块前后各多读 1 秒上下文，只保留峰值落在本块核心区内的结果，
 * 内存与时长无关、块边界不漏检不重复。检测算法在 src/core/audioEdit/mouthClicks.ts。
 */
interface Job { input: string; sensitivity: number; startFrame: number; endFrame: number }
const BLOCK_SECONDS = 60, CONTEXT_SECONDS = 1

async function run(job: Job): Promise<AudioEditMouthClick[]> {
  const reader = await openF32Wav(job.input)
  if (!reader) throw new Error('口水音检测只接受 32 位浮点 WAV。')
  try {
    const { sampleRate, channels } = reader
    const end = Math.min(reader.frames, job.endFrame), block = BLOCK_SECONDS * sampleRate, context = CONTEXT_SECONDS * sampleRate
    const found: AudioEditMouthClick[] = []
    for (let core = Math.max(0, job.startFrame); core < end; core += block) {
      const coreEnd = Math.min(end, core + block)
      const from = Math.max(0, core - context), to = Math.min(reader.frames, coreEnd + context)
      const pcm = await reader.read(from, to - from)
      const planar = Array.from({ length: channels }, (_, channel) => { const lane = new Float32Array(to - from); for (let frame = 0; frame < lane.length; frame++) lane[frame] = pcm[frame * channels + channel]; return lane })
      for (const click of detectAudioEditMouthClicks(planar, sampleRate, { sensitivity: job.sensitivity })) {
        const peak = click.peakFrame + from
        if (peak < core || peak >= coreEnd) continue
        found.push({ ...click, startFrame: click.startFrame + from, endFrame: click.endFrame + from, peakFrame: peak })
      }
      parentPort?.postMessage({ type: 'progress', value: (coreEnd - job.startFrame) / Math.max(1, end - job.startFrame) })
    }
    return found
  } finally { await reader.close() }
}

run(workerData as Job).then(clicks => parentPort?.postMessage({ type: 'done', clicks }), (error: unknown) => parentPort?.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }))
