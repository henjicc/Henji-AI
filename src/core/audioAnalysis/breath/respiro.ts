import { z } from 'zod'

/*
 * 呼吸声检测（Respiro-en，MIT，INTERSPEECH 2024 “Frame-Wise Breath Detection with Self-Training” 的官方模型）。
 * 我们把特征提取（STFT、128 带梅尔、dB、跨带方差、过零率）与模型一起导出成一个 ONNX：输入 30 秒 16 kHz 单声道波形
 * 与有效帧数，输出每 10 ms 一帧的呼吸概率；在真实口播上与官方 librosa + PyTorch 实现逐帧一致。
 *
 * 模型按 30 秒一窗训练和导出：长录音按 25 秒步长切窗、最后一窗对齐到结尾（不补零，补零会让双向 LSTM 看到假静音）；
 * 重叠处每帧取离窗口边缘最远的那一窗的结果。只有不足 30 秒的录音才补零并告诉模型有效帧数。
 */

export const RESPIRO_SAMPLE_RATE = 16_000
export const RESPIRO_HOP = 160
export const RESPIRO_CHUNK_SAMPLES = 30 * RESPIRO_SAMPLE_RATE
export const RESPIRO_CHUNK_FRAMES = 1 + RESPIRO_CHUNK_SAMPLES / RESPIRO_HOP
export const RESPIRO_STEP_SAMPLES = 25 * RESPIRO_SAMPLE_RATE
/** 官方在验证集上调出的阈值与最短长度（超过 20 帧，即 200 ms 以上） */
export const RESPIRO_THRESHOLD = 0.064
export const RESPIRO_MIN_FRAMES = 20
/** 2：改为只用 CPU 推理（DirectML 结果不可用），作废此前的检测缓存 */
export const BREATH_DETECTION_VERSION = 2

export const audioBreathSchema = z.object({
  startMs: z.number().nonnegative(),
  endMs: z.number().positive(),
  /** 区间内最高的呼吸概率 */
  peak: z.number().min(0).max(1),
}).strict()
export type AudioBreath = z.infer<typeof audioBreathSchema>

export const breathDetectionSchema = z.object({
  version: z.literal(BREATH_DETECTION_VERSION),
  model: z.literal('respiro-en'),
  durationMs: z.number().nonnegative(),
  breaths: z.array(audioBreathSchema).max(200_000),
}).strict()
export type BreathDetection = z.infer<typeof breathDetectionSchema>

/** 每一窗的起点（采样）：不足 30 秒只有一窗；否则 25 秒步长，最后一窗对齐结尾。 */
export function respiroChunkStarts(totalSamples: number): number[] {
  if (totalSamples <= RESPIRO_CHUNK_SAMPLES) return [0]
  const starts: number[] = []
  for (let start = 0; start + RESPIRO_CHUNK_SAMPLES < totalSamples; start += RESPIRO_STEP_SAMPLES) starts.push(start)
  starts.push(totalSamples - RESPIRO_CHUNK_SAMPLES)
  return starts
}

/** 一窗的输入波形（不足 30 秒补零）与有效帧数。 */
export function respiroWindow(mono: Float32Array, start: number): { wave: Float32Array; frames: number } {
  const wave = new Float32Array(RESPIRO_CHUNK_SAMPLES)
  const piece = mono.subarray(start, start + RESPIRO_CHUNK_SAMPLES)
  wave.set(piece)
  return { wave, frames: Math.min(RESPIRO_CHUNK_FRAMES, 1 + Math.floor(piece.length / RESPIRO_HOP)) }
}

/** 合并各窗的逐帧概率：每帧取离所在窗口边缘最远的那一窗。 */
export function aggregateRespiro(totalSamples: number, starts: readonly number[], probabilities: readonly Float32Array[]): Float32Array {
  const frames = 1 + Math.floor(totalSamples / RESPIRO_HOP)
  const output = new Float32Array(frames)
  const margin = new Float32Array(frames).fill(-1)
  starts.forEach((start, index) => {
    const offset = Math.round(start / RESPIRO_HOP)
    const probs = probabilities[index]
    for (let local = 0; local < probs.length && offset + local < frames; local++) {
      const edge = Math.min(local, probs.length - 1 - local)
      if (edge > margin[offset + local]) { margin[offset + local] = edge; output[offset + local] = probs[local] }
    }
  })
  return output
}

/** 逐帧概率 → 呼吸区间（毫秒，左闭右开）。 */
export function respiroSegments(probabilities: Float32Array, threshold = RESPIRO_THRESHOLD, minFrames = RESPIRO_MIN_FRAMES): AudioBreath[] {
  const breaths: AudioBreath[] = []
  for (let frame = 0; frame < probabilities.length;) {
    if (probabilities[frame] <= threshold) { frame++; continue }
    let end = frame, peak = 0
    while (end < probabilities.length && probabilities[end] > threshold) { peak = Math.max(peak, probabilities[end]); end++ }
    if (end - frame > minFrames) breaths.push({ startMs: frame * 10, endMs: end * 10, peak: Math.min(1, peak) })
    frame = end
  }
  return breaths
}
