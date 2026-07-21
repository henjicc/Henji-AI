import { execFileAsyncBuffer, resolveLocalMediaPath } from '../media/shared'
import { loadFfmpegPath } from '../video/ffmpeg-loader'
import type { ExtractAudioSamplesResultDto } from './types'

const PCM_SAMPLE_RATE = 8000
const PCM_MAX_AMPLITUDE = 32768

/**
 * 重采样到 8kHz 单声道 PCM 后按 bucketCount 分桶算 RMS/峰值（÷32768 归一化到 0~1）。
 * 只做"重解码+分桶"这一步，百分位归一化/幂次/平滑等展示曲线调整留在渲染层
 * （见 useAudioWaveform.ts 的 postProcessWaveform），避免把浮点算法整体搬到 Node
 * 还要保证两边数值完全一致的风险。数值上与原渲染层 Web Audio 解码不完全等价
 * （重采样丢失了原始采样率/立体声细节），目标是视觉观感一致，不是逐比特一致。
 */
export async function extractAudioSamples(source: string, bucketCount: number): Promise<ExtractAudioSamplesResultDto> {
  const ffmpegPath = await loadFfmpegPath()
  const localPath = await resolveLocalMediaPath(source)

  const { stdout } = await execFileAsyncBuffer(ffmpegPath, [
    '-i', localPath,
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    '-ar', String(PCM_SAMPLE_RATE),
    '-ac', '1',
    '-v', 'quiet',
    'pipe:1',
  ])

  const sampleCount = Math.floor(stdout.length / 2)
  if (sampleCount === 0) {
    throw new Error('Audio source has no decodable samples')
  }

  const bucketCountSafe = Math.max(1, Math.floor(bucketCount))
  const step = Math.max(1, Math.floor(sampleCount / bucketCountSafe))
  const rms: number[] = []
  const peak: number[] = []

  for (let bucket = 0; bucket < bucketCountSafe; bucket += 1) {
    const start = bucket * step
    const end = Math.min(sampleCount, start + step)
    let sumSquares = 0
    let peakValue = 0
    let count = 0
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      const value = Math.abs(stdout.readInt16LE(sampleIndex * 2)) / PCM_MAX_AMPLITUDE
      sumSquares += value * value
      count += 1
      if (value > peakValue) peakValue = value
    }
    rms.push(count > 0 ? Math.sqrt(sumSquares / count) : 0)
    peak.push(peakValue)
  }

  return {
    rms,
    peak,
    durationSeconds: sampleCount / PCM_SAMPLE_RATE,
  }
}
