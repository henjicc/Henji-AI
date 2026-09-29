import { execFile, spawn } from 'node:child_process'

import { resolveLocalMediaPath } from '../media/shared'
import { loadFfmpegPath, loadFfprobePath } from '../video/ffmpeg-loader'
import type { ExtractAudioSamplesResultDto } from './types'

const PCM_SAMPLE_RATE = 8000
const PCM_MAX_AMPLITUDE = 32768

function probeDuration(binary: string, source: string): Promise<number> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', source], { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`ffprobe failed: ${error.message}\n${stderr}`))
      const duration = Number(stdout.trim())
      if (!Number.isFinite(duration) || duration <= 0) return reject(new Error('Audio source duration is unavailable'))
      resolve(duration)
    })
  })
}

/** 流式降采样并直接聚合固定数量的峰值桶；一小时素材不会在主进程保留整段 PCM。 */
export async function extractAudioSamples(source: string, bucketCount: number): Promise<ExtractAudioSamplesResultDto> {
  const [ffmpegPath, ffprobePath, localPath] = await Promise.all([
    loadFfmpegPath(), loadFfprobePath(), resolveLocalMediaPath(source),
  ])
  const durationSeconds = await probeDuration(ffprobePath, localPath)
  const bucketCountSafe = Math.max(1, Math.floor(bucketCount))
  const expectedSamples = Math.max(1, Math.round(durationSeconds * PCM_SAMPLE_RATE))
  const sumSquares = new Float64Array(bucketCountSafe)
  const peaks = new Float64Array(bucketCountSafe)
  const counts = new Uint32Array(bucketCountSafe)

  await new Promise<void>((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-i', localPath, '-f', 's16le', '-acodec', 'pcm_s16le', '-ar', String(PCM_SAMPLE_RATE), '-ac', '1', '-v', 'quiet', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let sampleIndex = 0
    let remainder: Buffer | null = null
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.stdout.on('data', (chunk: Buffer) => {
      const data = remainder ? Buffer.concat([remainder, chunk]) : chunk
      const byteLength = data.byteLength - data.byteLength % 2
      for (let offset = 0; offset < byteLength; offset += 2) {
        const value = Math.abs(data.readInt16LE(offset)) / PCM_MAX_AMPLITUDE
        const bucket = Math.min(bucketCountSafe - 1, Math.floor(sampleIndex * bucketCountSafe / expectedSamples))
        sumSquares[bucket] += value * value
        counts[bucket] += 1
        if (value > peaks[bucket]) peaks[bucket] = value
        sampleIndex += 1
      }
      remainder = byteLength < data.byteLength ? data.subarray(byteLength) : null
    })
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${Buffer.concat(stderr).toString('utf8')}`)))
  })

  return {
    rms: Array.from(sumSquares, (sum, index) => counts[index] > 0 ? Math.sqrt(sum / counts[index]) : 0),
    peak: Array.from(peaks),
    durationSeconds,
  }
}
