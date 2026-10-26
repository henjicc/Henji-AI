import fs from 'node:fs/promises'
import path from 'node:path'
import type { LocalModelRunner } from '../analysis'
import type { LocalInferenceModelFile, LocalInferenceModelName } from '../protocol'
import type { LocalExecutionProvider, LocalInferenceLog } from '../providers'
import type { SeparationAudioIo } from './audioIo'
import { MDX_SAMPLE_RATE, MDX_SEPARATION_MODELS, MdxStft, mdxChannelGroups, mdxChunkPlan, separateMdx, type MdxSeparationModel } from './mdx'
import type { AudioSeparationJob, AudioSeparationJobResult, AudioSeparationMode } from './protocol'
import { Float32WavWriter, WAV_MAX_DATA_BYTES } from './wav'

/*
 * 一次人声分离 / 去混响（在本地推理后台进程里运行）：
 * 解码原声（原采样率、原声道）→ 需要时另解一份 44.1 kHz 给模型 → MDX-Net 分块推理 →
 * 模型分量（不是 44.1 kHz 时流式转回原采样率）与原声相减得到另一个分量 → 两个 32 位浮点 WAV 同步顺序写出。
 * 两个输出与输入等长、逐样本对齐，主分量 + 残差 = 原声（单精度舍入误差内）。
 *
 * 执行设备：先用调用方给的顺序（Windows 为 DirectML → CPU）；不是 CPU 时用一段合成声音的频谱
 * 同时跑一次 CPU 核对（每个进程每个模型只核对一次），输出全零、含非数值或与 CPU 相差过大就整段改用 CPU；
 * 推理中某一块出现非数值时也改用 CPU 重算这一块并继续。
 */

/** 最长 1 小时：44.1 kHz 立体声整段 PCM 常驻约 640 MB（非 44.1 kHz 时另有一份模型输入）。 */
export const SEPARATION_MAX_SECONDS = 60 * 60
export const SEPARATION_PRIMARY_FILE = 'primary.wav.tmp'
export const SEPARATION_RESIDUAL_FILE = 'residual.wav.tmp'
/** DirectML 与 CPU 输出的相对误差上限（RTX 4090 实测约 3e-6；坏驱动的输出通常差到 1 的量级）。 */
const PROVIDER_TOLERANCE = 0.02

const MODEL_NAMES: Readonly<Record<AudioSeparationMode, LocalInferenceModelName>> = { vocals: 'mdx_kim_vocal_2', dereverb: 'mdx_reverb_hq' }

export interface AudioSeparationDependencies {
  openModel(model: LocalInferenceModelFile, providers: readonly LocalExecutionProvider[], shape: string): Promise<LocalModelRunner>
  io: SeparationAudioIo
  signal: AbortSignal
  progress(done: number, total: number): void
  log: LocalInferenceLog
}

/** 同一进程内每个模型文件 × 执行提供者的核对结论。 */
const providerChecks = new Map<string, Promise<boolean>>()

async function runChunk(runner: LocalModelRunner, spec: Float32Array, model: MdxSeparationModel): Promise<Float32Array> {
  const outputs = await runner.run({ input: { type: 'float32', data: spec, dims: [1, 4, model.dimF, model.dimT] } })
  const data = (outputs.output ?? Object.values(outputs)[0])?.data
  if (!(data instanceof Float32Array) || data.length !== spec.length) throw new Error('分离模型输出形状不符。')
  return data
}

function allFinite(values: Float32Array): boolean {
  for (let index = 0; index < values.length; index++) if (!Number.isFinite(values[index])) return false
  return true
}

/** 核对用的固定输入：一段带谐波、包络起伏与噪声的合成立体声，经同样的前处理变成模型谱。 */
export function separationProbeSpectrogram(model: MdxSeparationModel): Float32Array {
  const stft = new MdxStft(model)
  const length = stft.chunkSize
  const left = new Float64Array(length), right = new Float64Array(length)
  let seed = 20_261_026
  const noise = (): number => { seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0; return seed / 2 ** 32 - 0.5 }
  for (let index = 0; index < length; index++) {
    const t = index / MDX_SAMPLE_RATE
    let voice = 0
    for (let harmonic = 1; harmonic <= 16; harmonic++) voice += Math.sin(2 * Math.PI * 140 * harmonic * t * (1 + 0.02 * Math.sin(2 * Math.PI * 0.7 * t)) + harmonic) / harmonic
    const envelope = 0.55 + 0.45 * Math.sin(2 * Math.PI * 2.5 * t)
    left[index] = 0.18 * voice * envelope + 0.04 * noise() + 0.08 * Math.sin(2 * Math.PI * 82.4 * t)
    right[index] = 0.15 * voice * envelope + 0.04 * noise() + 0.1 * Math.sin(2 * Math.PI * 110 * t)
  }
  const spec = new Float32Array(stft.specLength)
  stft.analyze(left, right, spec)
  return spec
}

/** 加速设备与 CPU 跑同一块输入，比较输出。 */
async function verifyProvider(fast: LocalModelRunner, cpu: () => Promise<LocalModelRunner>, model: MdxSeparationModel, job: AudioSeparationJob, log: LocalInferenceLog): Promise<boolean> {
  const probe = separationProbeSpectrogram(model)
  const provider = fast.provider
  const accelerated = await runChunk(fast, probe, model)
  // 首次运行失败时会话已自行换成 CPU，不必再核对。
  if (fast.provider === 'cpu') return true
  const reference = await runChunk(await cpu(), probe, model)
  let difference = 0, energy = 0, acceleratedEnergy = 0
  for (let index = 0; index < reference.length; index++) {
    const value = accelerated[index], expected = reference[index]
    difference += (value - expected) ** 2; energy += expected ** 2; acceleratedEnergy += value ** 2
  }
  const relativeError = energy > 0 ? Math.sqrt(difference / energy) : Number.POSITIVE_INFINITY
  const ok = allFinite(accelerated) && acceleratedEnergy > 0 && relativeError < PROVIDER_TOLERANCE
  const context = { mode: job.mode, provider, relativeError: Number.isFinite(relativeError) ? Number(relativeError.toExponential(2)) : null }
  if (ok) log('info', '分离模型加速推理与 CPU 结果一致', 'audio_separation.provider.verified', context)
  else log('warn', '分离模型加速推理结果异常，改用 CPU', 'audio_separation.provider.mismatch', context)
  return ok
}

/**
 * 写两个输出：收到按时间顺序的模型分量（已在原采样率上），与原声相减得到另一个分量。
 * 主分量先舍入成单精度再求残差，写出的两个文件相加与原声只差一次舍入。
 */
class SeparationOutputs {
  private offset = 0
  constructor(private readonly original: readonly Float32Array[], private readonly predicts: MdxSeparationModel['predicts'], private readonly primary: Float32WavWriter, private readonly residual: Float32WavWriter) {}

  get length(): number { return this.original[0].length }

  async write(component: readonly Float32Array[]): Promise<void> {
    const count = Math.min(component[0].length, this.length - this.offset)
    if (count <= 0) return
    const channels = this.original.length
    const primary = new Float32Array(count * channels), residual = new Float32Array(count * channels)
    for (let channel = 0; channel < channels; channel++) {
      const source = this.original[channel], values = component[channel]
      for (let index = 0; index < count; index++) {
        const original = source[this.offset + index]
        const main = Math.fround(this.predicts === 'primary' ? values[index] : original - values[index])
        primary[index * channels + channel] = main
        residual[index * channels + channel] = original - main
      }
    }
    this.offset += count
    await Promise.all([this.primary.write(primary), this.residual.write(residual)])
  }

  /** 重采样回来的样本偶尔少一两个：按模型分量为零补齐到原长。 */
  async finish(): Promise<void> {
    while (this.offset < this.length) {
      const count = Math.min(65_536, this.length - this.offset)
      await this.write(this.original.map(() => new Float32Array(count)))
    }
  }
}

export async function runAudioSeparation(job: AudioSeparationJob, deps: AudioSeparationDependencies): Promise<AudioSeparationJobResult> {
  const model = MDX_SEPARATION_MODELS[job.mode]
  if (!model) throw new Error('未知的分离方式。')
  const { signal, io, log } = deps
  let started = performance.now()
  const decoded = await io.decode(job.source, { maxSeconds: SEPARATION_MAX_SECONDS + 1 }, signal)
  const { sampleRate } = decoded
  const channels = decoded.channels.length, length = decoded.channels[0]?.length ?? 0
  if (!channels || !length) throw new Error('声音为空。')
  if (length > SEPARATION_MAX_SECONDS * sampleRate) throw new Error('声音超过 1 小时，请先剪短再分离。')
  if (length * channels * 4 > WAV_MAX_DATA_BYTES) throw new Error('声音太长（输出会超过 WAV 的 4 GB 上限），请先剪短再分离。')
  const resampled = sampleRate !== MDX_SAMPLE_RATE
  const input = resampled ? await io.decodeAt(job.source, { sampleRate: MDX_SAMPLE_RATE, channels, maxSeconds: SEPARATION_MAX_SECONDS + 1 }, signal) : decoded.channels
  if (input.length !== channels || !input[0]?.length) throw new Error('无法把声音转换成 44.1 kHz。')
  const decodeMs = performance.now() - started

  started = performance.now()
  const file: LocalInferenceModelFile = { name: MODEL_NAMES[job.mode], path: job.modelPath }
  const shape = `1x4x${model.dimF}x${model.dimT}`
  let cpuRunner: Promise<LocalModelRunner> | undefined
  const cpu = (): Promise<LocalModelRunner> => cpuRunner ??= deps.openModel(file, ['cpu'], shape)
  let active = await deps.openModel(file, job.providers, shape)
  if (active.provider !== 'cpu') {
    const key = `${job.modelPath}\u0000${active.provider}`
    let check = providerChecks.get(key)
    if (!check) {
      check = verifyProvider(active, cpu, model, job, log)
      providerChecks.set(key, check)
      check.catch(() => { if (providerChecks.get(key) === check) providerChecks.delete(key) })
    }
    if (!await check) active = await cpu()
  }
  const infer = async (spec: Float32Array): Promise<Float32Array> => {
    let output = await runChunk(active, spec, model)
    if (!allFinite(output) && active.provider !== 'cpu') {
      log('warn', '分离模型输出含非数值，改用 CPU', 'audio_separation.provider.non_finite', { mode: job.mode, provider: active.provider })
      active = await cpu()
      output = await runChunk(active, spec, model)
    }
    if (!allFinite(output)) throw new Error('分离模型输出含非数值。')
    return output
  }

  await fs.mkdir(job.outputDirectory, { recursive: true })
  const primaryPath = path.join(job.outputDirectory, SEPARATION_PRIMARY_FILE)
  const residualPath = path.join(job.outputDirectory, SEPARATION_RESIDUAL_FILE)
  let primary: Float32WavWriter | undefined, residual: Float32WavWriter | undefined
  let resampler: ReturnType<SeparationAudioIo['resample']> | undefined
  try {
    primary = await Float32WavWriter.create(primaryPath, { sampleRate, channels }, length)
    residual = await Float32WavWriter.create(residualPath, { sampleRate, channels }, length)
    const outputs = new SeparationOutputs(decoded.channels, model.predicts, primary, residual)
    const sink = resampled ? resampler = io.resample({ from: MDX_SAMPLE_RATE, to: sampleRate, channels }, signal, block => outputs.write(block)) : undefined
    await separateMdx({ channels: input, params: model, infer, emit: block => sink ? sink.write(block) : outputs.write(block), signal, progress: deps.progress })
    await sink?.end()
    await outputs.finish()
    await primary.close(); primary = undefined
    await residual.close(); residual = undefined
  } catch (error) {
    resampler?.destroy()
    await primary?.discard(); await residual?.discard()
    await Promise.all([fs.rm(primaryPath, { force: true }), fs.rm(residualPath, { force: true })]).catch(() => undefined)
    throw error
  }
  const inferenceMs = performance.now() - started
  const plan = mdxChunkPlan(input[0].length, model)
  log('info', '人声分离完成', 'audio_separation.completed', {
    mode: job.mode, provider: active.provider, sampleRate, channels, seconds: Math.round(length / sampleRate * 10) / 10,
    chunks: plan.count * mdxChannelGroups(channels).length, decodeMs: Math.round(decodeMs), inferenceMs: Math.round(inferenceMs),
  })
  return { primaryPath, residualPath, sampleRate, channels, provider: active.provider, decodeMs, inferenceMs }
}
