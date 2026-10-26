import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { LocalModelRunner, LocalTensorInput } from '../analysis'
import type { LocalExecutionProvider } from '../providers'
import { runAudioSeparation, SEPARATION_PRIMARY_FILE, SEPARATION_RESIDUAL_FILE, type AudioSeparationDependencies } from './analyze'
import type { DecodedAudio, SeparationAudioIo } from './audioIo'
import { MDX_SAMPLE_RATE, MDX_SEPARATION_MODELS } from './mdx'
import type { AudioSeparationJob } from './protocol'
import { parseFloat32WavHeader } from './wav'

const root = path.join(os.tmpdir(), `henji-separation-${process.pid}`)
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }) })

function tones(length: number, sampleRate: number, frequencies: readonly number[]): Float32Array {
  return Float32Array.from({ length }, (_, index) => frequencies.reduce((sum, frequency, order) => sum + 0.3 / (order + 1) * Math.sin(2 * Math.PI * frequency * index / sampleRate + order), 0))
}

/** 输出 = 输入谱 × factor 的假模型（factor 为函数时按调用次数给）。 */
function runner(provider: LocalExecutionProvider, factor: number | ((call: number) => number)): LocalModelRunner & { calls: number } {
  const state = {
    provider, calls: 0,
    async run(feeds: Readonly<Record<string, LocalTensorInput>>) {
      const input = feeds.input.data as Float32Array
      const scale = typeof factor === 'number' ? factor : factor(state.calls)
      state.calls++
      return { output: { data: input.map(value => value * scale), dims: feeds.input.dims } }
    },
  }
  return state
}

function fakeIo(native: DecodedAudio, at44k?: Float32Array[]): SeparationAudioIo {
  return {
    decode: async () => native,
    decodeAt: async (_source, options) => { expect(options.sampleRate).toBe(MDX_SAMPLE_RATE); expect(options.channels).toBe(native.channels.length); return at44k! },
    // 线性插值的假重采样：收齐后分两段交付。
    resample: (options, _signal, onOutput) => {
      const received: Float32Array[][] = []
      return {
        write: async (block) => { received.push(block.map(values => values.slice())) },
        end: async () => {
          const joined = Array.from({ length: options.channels }, (_, channel) => Float32Array.from(received.flatMap(block => Array.from(block[channel]))))
          const length = Math.round(joined[0].length * options.to / options.from)
          const out = joined.map(values => Float32Array.from({ length }, (_, index) => {
            const at = index * options.from / options.to, low = Math.floor(at), high = Math.min(values.length - 1, low + 1)
            return values[low] + (values[high] - values[low]) * (at - low)
          }))
          const half = Math.floor(length / 2)
          await onOutput(out.map(values => values.slice(0, half)))
          await onOutput(out.map(values => values.slice(half)))
        },
        destroy: () => undefined,
      }
    },
  }
}

interface Harness { deps: AudioSeparationDependencies; logs: string[]; opened: string[] }
function harness(io: SeparationAudioIo, runners: { cpu: LocalModelRunner; fast?: LocalModelRunner }, signal = new AbortController().signal): Harness {
  const logs: string[] = [], opened: string[] = []
  return {
    logs, opened,
    deps: {
      io, signal, progress: () => undefined, log: (_level, _message, event) => { logs.push(event) },
      openModel: async (_model, providers) => { opened.push(providers.join(',')); return providers[0] === 'cpu' || !runners.fast ? runners.cpu : runners.fast },
    },
  }
}

let jobs = 0
function job(mode: AudioSeparationJob['mode'], providers: LocalExecutionProvider[] = ['cpu'], modelPath = `model-${++jobs}.onnx`): AudioSeparationJob {
  return { id: `job-${jobs}`, ffmpegPath: 'ffmpeg', source: 'source.wav', mode, modelPath, providers, outputDirectory: path.join(root, `job-${++jobs}`) }
}

async function readWav(file: string): Promise<{ sampleRate: number; channels: Float32Array[] }> {
  const bytes = new Uint8Array(await fs.readFile(file))
  const header = parseFloat32WavHeader(bytes)!
  expect(header.dataBytes).toBe(bytes.length - header.dataOffset)
  const interleaved = new Float32Array(bytes.slice(header.dataOffset).buffer)
  const frames = interleaved.length / header.channels
  return { sampleRate: header.sampleRate, channels: Array.from({ length: header.channels }, (_, channel) => Float32Array.from({ length: frames }, (_, frame) => interleaved[frame * header.channels + channel])) }
}

const energy = (values: Float32Array): number => values.reduce((sum, value) => sum + value * value, 0)

async function expectComplementary(primaryPath: string, residualPath: string, original: Float32Array[], sampleRate: number) {
  const primary = await readWav(primaryPath), residual = await readWav(residualPath)
  expect(primary.sampleRate).toBe(sampleRate); expect(residual.sampleRate).toBe(sampleRate)
  expect(primary.channels).toHaveLength(original.length)
  for (const [channel, values] of original.entries()) {
    expect(primary.channels[channel]).toHaveLength(values.length)
    expect(residual.channels[channel]).toHaveLength(values.length)
    let error = 0
    for (let index = 0; index < values.length; index++) error = Math.max(error, Math.abs(primary.channels[channel][index] + residual.channels[channel][index] - values[index]))
    expect(error).toBeLessThan(1e-6)
  }
  return { primary, residual }
}

describe('人声分离作业', () => {
  it('44.1 kHz 立体声 · 人声：模型分量乘 compensate 是主分量，残差 = 原声 − 主分量，两个 WAV 与输入等长', async () => {
    const length = Math.round(1.5 * MDX_SAMPLE_RATE)
    const original = [tones(length, MDX_SAMPLE_RATE, [220, 1300]), tones(length, MDX_SAMPLE_RATE, [330, 2100])]
    const cpu = runner('cpu', 0.5)
    const { deps } = harness(fakeIo({ sampleRate: MDX_SAMPLE_RATE, channels: original }), { cpu })
    const separation = job('vocals')
    const result = await runAudioSeparation(separation, deps)
    expect(result).toMatchObject({ sampleRate: MDX_SAMPLE_RATE, channels: 2, provider: 'cpu', primaryPath: path.join(separation.outputDirectory, SEPARATION_PRIMARY_FILE), residualPath: path.join(separation.outputDirectory, SEPARATION_RESIDUAL_FILE) })
    const { primary } = await expectComplementary(result.primaryPath, result.residualPath, original, MDX_SAMPLE_RATE)
    const expected = (0.5 * MDX_SEPARATION_MODELS.vocals.compensate) ** 2
    expect(energy(primary.channels[0]) / energy(original[0])).toBeCloseTo(expected, 2)
  })

  it('去混响：模型预测的是混响（残差），干声 = 原声 − 混响', async () => {
    const length = MDX_SAMPLE_RATE
    const original = [tones(length, MDX_SAMPLE_RATE, [440, 3000])]
    const { deps } = harness(fakeIo({ sampleRate: MDX_SAMPLE_RATE, channels: original }), { cpu: runner('cpu', 0.1) })
    const result = await runAudioSeparation(job('dereverb'), deps)
    expect(result.channels).toBe(1)
    const { residual, primary } = await expectComplementary(result.primaryPath, result.residualPath, original, MDX_SAMPLE_RATE)
    expect(energy(residual.channels[0]) / energy(original[0])).toBeCloseTo((0.1 * MDX_SEPARATION_MODELS.dereverb.compensate) ** 2, 3)
    expect(energy(primary.channels[0]) / energy(original[0])).toBeGreaterThan(0.75)
  })

  it('48 kHz 单声道：模型用 44.1 kHz，分量转回 48 kHz 后与原声相减，输出单声道、等长', async () => {
    const native = tones(48_000, 48_000, [500, 1500])
    const at44k = tones(MDX_SAMPLE_RATE, MDX_SAMPLE_RATE, [500, 1500])
    const { deps } = harness(fakeIo({ sampleRate: 48_000, channels: [native] }, [at44k]), { cpu: runner('cpu', 1) })
    const result = await runAudioSeparation(job('vocals'), deps)
    expect(result).toMatchObject({ sampleRate: 48_000, channels: 1 })
    const { residual } = await expectComplementary(result.primaryPath, result.residualPath, [native], 48_000)
    // 恒等模型：残差只剩 compensate 多出来的 0.9% 与插值误差。
    expect(energy(residual.channels[0]) / energy(native)).toBeLessThan(1e-3)
  })

  it('加速设备输出全零：与 CPU 核对不通过，整段改用 CPU', async () => {
    const original = [tones(MDX_SAMPLE_RATE, MDX_SAMPLE_RATE, [300])]
    const cpu = runner('cpu', 0.5), fast = runner('dml', 0)
    const { deps, logs } = harness(fakeIo({ sampleRate: MDX_SAMPLE_RATE, channels: original }), { cpu, fast })
    const result = await runAudioSeparation(job('vocals', ['dml', 'cpu']), deps)
    expect(result.provider).toBe('cpu')
    expect(logs).toContain('audio_separation.provider.mismatch')
    expect(fast.calls).toBe(1)
  })

  it('加速设备与 CPU 一致时用加速设备；同一模型只核对一次', async () => {
    const original = [tones(MDX_SAMPLE_RATE, MDX_SAMPLE_RATE, [300])]
    const cpu = runner('cpu', 0.5), fast = runner('dml', 0.5)
    const io = fakeIo({ sampleRate: MDX_SAMPLE_RATE, channels: original })
    const first = harness(io, { cpu, fast }), second = harness(io, { cpu, fast })
    const model = `shared-${Date.now()}.onnx`
    expect((await runAudioSeparation(job('vocals', ['dml', 'cpu'], model), first.deps)).provider).toBe('dml')
    expect((await runAudioSeparation(job('vocals', ['dml', 'cpu'], model), second.deps)).provider).toBe('dml')
    expect(first.logs).toContain('audio_separation.provider.verified')
    expect(second.logs).not.toContain('audio_separation.provider.verified')
    expect(cpu.calls).toBe(1)
  })

  it('推理中某块出现非数值：改用 CPU 重算并继续', async () => {
    const length = Math.round(12 * MDX_SAMPLE_RATE)
    const original = [tones(length, MDX_SAMPLE_RATE, [300]), tones(length, MDX_SAMPLE_RATE, [600])]
    const cpu = runner('cpu', 0.5), fast = runner('dml', call => call === 2 ? Number.NaN : 0.5)
    const { deps, logs } = harness(fakeIo({ sampleRate: MDX_SAMPLE_RATE, channels: original }), { cpu, fast })
    const result = await runAudioSeparation(job('vocals', ['dml', 'cpu']), deps)
    expect(result.provider).toBe('cpu')
    expect(logs).toContain('audio_separation.provider.non_finite')
    await expectComplementary(result.primaryPath, result.residualPath, original, MDX_SAMPLE_RATE)
  })

  it('取消：停止推理并删除已写的部分文件', async () => {
    const length = Math.round(12 * MDX_SAMPLE_RATE)
    const controller = new AbortController()
    const cpu = runner('cpu', (call) => { if (call === 0) controller.abort(new Error('已取消')); return 1 })
    const { deps } = harness(fakeIo({ sampleRate: MDX_SAMPLE_RATE, channels: [tones(length, MDX_SAMPLE_RATE, [300])] }), { cpu }, controller.signal)
    const separation = job('vocals')
    await expect(runAudioSeparation(separation, deps)).rejects.toThrow('已取消')
    expect(cpu.calls).toBe(1)
    expect(await fs.readdir(separation.outputDirectory)).toEqual([])
  })

  it('超过 1 小时的声音直接拒绝，不推理', async () => {
    const cpu = runner('cpu', 1)
    const { deps } = harness(fakeIo({ sampleRate: 1, channels: [new Float32Array(3601)] }), { cpu })
    await expect(runAudioSeparation(job('vocals'), deps)).rejects.toThrow('超过 1 小时')
    expect(cpu.calls).toBe(0)
  })
})
