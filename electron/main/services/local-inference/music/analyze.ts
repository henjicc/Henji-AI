import fs from 'node:fs/promises'
import { BeatAnalyzer } from '../../../../../src/core/audioAnalysis/beatAnalysis'
import { aggregateBeatThis, BEAT_THIS_CHUNK, BEAT_THIS_MELS, BEAT_THIS_SAMPLE_RATE, beatThisChunkStarts, beatThisMinimalPostprocess, beatThisSpectrogram, beatThisWindow, meanDownmix } from '../../../../../src/core/audioAnalysis/music/beatThis'
import { buildMusicAnalysis } from '../../../../../src/core/audioAnalysis/music/musicAnalysis'
import type { LocalModelRunner } from '../analysis'
import type { LocalInferenceModelFile } from '../protocol'
import type { LocalExecutionProvider, LocalInferenceLog } from '../providers'
import { decodePcm } from '../sound/decode'
import type { MusicAnalysisJob, MusicAnalysisJobResult } from './protocol'

/*
 * 后台进程里的音乐结构分析。Beat This! 每次只喂一个 1500 帧窗口（官方说明：整批会生成巨大的时间注意力张量），
 * 窗口之间串行；RTX 4090 DirectML 实测约 70 ms/窗口（30 秒音乐），首次运行另有一次性的着色器编译。
 */

/** 超过 20 分钟的音频不按音乐重构处理（整曲 PCM 常驻内存）。 */
export const MUSIC_MAX_SECONDS = 20 * 60

export interface MusicAnalysisDependencies {
  openModel(model: LocalInferenceModelFile, providers: readonly LocalExecutionProvider[], shape: string): Promise<LocalModelRunner>
  signal: AbortSignal
  progress(done: number, total: number): void
  log: LocalInferenceLog
}

function logits(outputs: Record<string, { data: unknown }>, name: string): Float32Array {
  const data = outputs[name]?.data
  if (!(data instanceof Float32Array) || data.length !== BEAT_THIS_CHUNK) throw new Error(`节拍模型输出 ${name} 形状不符。`)
  return data
}

/** 回退路径只用谱算色度与音色，不喂模型：按对数频率把 513 个频点均分到 128 个带。 */
function approximateFilterbank(): Float32Array {
  const bank = new Float32Array(513 * BEAT_THIS_MELS)
  for (let bin = 1; bin < 513; bin++) bank[bin * BEAT_THIS_MELS + Math.min(BEAT_THIS_MELS - 1, Math.floor(BEAT_THIS_MELS * Math.log1p(bin) / Math.log1p(512)))] = 1
  return bank
}

export async function runMusicAnalysis(job: MusicAnalysisJob, deps: MusicAnalysisDependencies): Promise<MusicAnalysisJobResult> {
  let started = performance.now()
  const pcm = await decodePcm(job.ffmpegPath, job.source, { sampleRate: BEAT_THIS_SAMPLE_RATE, maxSeconds: MUSIC_MAX_SECONDS }, deps.signal)
  if (pcm.decodedSeconds >= MUSIC_MAX_SECONDS - 0.5) throw new Error('音频超过 20 分钟，不做音乐重构。')
  const mono = meanDownmix(pcm.channels)
  const decodeMs = performance.now() - started
  deps.signal.throwIfAborted()
  started = performance.now()
  let filterbank = approximateFilterbank()
  if (job.model) {
    const bytes = await fs.readFile(job.model.filterbankPath)
    filterbank = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
  }
  const spectrogram = beatThisSpectrogram(mono, filterbank)
  let featureMs = performance.now() - started
  started = performance.now()
  let provider: LocalExecutionProvider | null = null
  let input: Parameters<typeof buildMusicAnalysis>[0]
  if (job.model) {
    const runner = await deps.openModel({ name: 'beat_this', path: job.model.modelPath }, job.providers, `1x${BEAT_THIS_CHUNK}x${BEAT_THIS_MELS}`)
    const starts = beatThisChunkStarts(spectrogram.frames)
    const predictions: Array<{ beat: Float32Array; downbeat: Float32Array }> = []
    for (const [index, start] of starts.entries()) {
      deps.signal.throwIfAborted()
      const outputs = await runner.run({ spect: { type: 'float32', data: beatThisWindow(spectrogram, start), dims: [1, BEAT_THIS_CHUNK, BEAT_THIS_MELS] } })
      predictions.push({ beat: logits(outputs, 'beat'), downbeat: logits(outputs, 'downbeat') })
      deps.progress(index + 1, starts.length)
    }
    provider = runner.provider
    const aggregated = aggregateBeatThis(spectrogram.frames, starts, predictions)
    const result = beatThisMinimalPostprocess(aggregated.beat, aggregated.downbeat)
    input = { mono, spectrogram, beats: result.beats, downbeats: result.downbeats, beatSource: 'beat_this' }
  } else {
    const analyzer = new BeatAnalyzer(BEAT_THIS_SAMPLE_RATE)
    const block = 1 << 16
    for (let offset = 0; offset < mono.length; offset += block) { deps.signal.throwIfAborted(); analyzer.append([mono.subarray(offset, offset + block)]) }
    const result = analyzer.finish()
    input = { mono, spectrogram, beats: result.beats.map(beat => beat.seconds), accents: result.beats.map(beat => beat.strength), beatSource: 'spectral_flux' }
    deps.progress(1, 1)
  }
  const inferenceMs = performance.now() - started
  started = performance.now()
  const analysis = buildMusicAnalysis(input)
  featureMs += performance.now() - started
  return { analysis, provider, decodeMs: Math.round(decodeMs), inferenceMs: Math.round(inferenceMs), featureMs: Math.round(featureMs) }
}
