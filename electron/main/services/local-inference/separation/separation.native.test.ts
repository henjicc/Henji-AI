import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadFfmpegPath } from '../../video/ffmpeg-loader'
import { LocalModelSessions, loadOnnxRuntime } from '../onnxRuntime'
import type { LocalExecutionProvider } from '../providers'
import { runAudioSeparation } from './analyze'
import { ffmpegSeparationAudio } from './audioIo'
import type { AudioSeparationMode } from './protocol'
import { parseFloat32WavHeader } from './wav'

/*
 * 真实模型实跑（不进普通单测）：
 *   HENJI_SEPARATION_MODEL_DIR=<含 Kim_Vocal_2.onnx 与 Reverb_HQ_By_FoxJoy.onnx 的目录>
 *   HENJI_SEPARATION_SAMPLE=<口播录音>（只读；截取的片段写到仓库 .tmp/separation-native/）
 *   HENJI_SEPARATION_SECONDS=20（截取秒数，设成 600 可整段实测）
 *   npx vitest run electron/main/services/local-inference/separation/separation.native.test.ts
 * FFmpeg 依次取 HENJI_SEPARATION_FFMPEG、随包 FFmpeg、ffmpeg-ffprobe-static。
 * 打印 CPU 与 DirectML 各自的耗时与按比例估算的 10 分钟耗时。
 */
const MODELS = process.env.HENJI_SEPARATION_MODEL_DIR
const SAMPLE = process.env.HENJI_SEPARATION_SAMPLE
const SECONDS = Number(process.env.HENJI_SEPARATION_SECONDS ?? 20)
const MODEL_FILES: Record<AudioSeparationMode, string> = { vocals: 'Kim_Vocal_2.onnx', dereverb: 'Reverb_HQ_By_FoxJoy.onnx' }

async function ffmpegPath(): Promise<string> {
  if (process.env.HENJI_SEPARATION_FFMPEG) return process.env.HENJI_SEPARATION_FFMPEG
  try { return await loadFfmpegPath() } catch {
    const mod = await import('ffmpeg-ffprobe-static')
    if (!mod.ffmpegPath) throw new Error('没有可用的 FFmpeg。')
    return mod.ffmpegPath
  }
}

async function readWav(file: string): Promise<{ sampleRate: number; channels: Float32Array[] }> {
  const bytes = new Uint8Array(await fs.readFile(file))
  const header = parseFloat32WavHeader(bytes)!
  const data = bytes.slice(header.dataOffset, header.dataOffset + (header.dataBytes ?? bytes.length - header.dataOffset))
  const interleaved = new Float32Array(data.buffer, 0, Math.floor(data.byteLength / 4))
  const frames = interleaved.length / header.channels
  const channels = Array.from({ length: header.channels }, (_, channel) => Float32Array.from({ length: frames }, (_, frame) => interleaved[frame * header.channels + channel]))
  return { sampleRate: header.sampleRate, channels }
}

const energy = (channels: readonly Float32Array[]): number => channels.reduce((sum, values) => sum + values.reduce((total, value) => total + value * value, 0), 0)

describe.skipIf(!MODELS || !SAMPLE)('人声分离与去混响实跑（onnxruntime-node + FFmpeg）', () => {
  const work = path.resolve('.tmp', 'separation-native')
  let ffmpeg = ''
  let sessions: LocalModelSessions | undefined
  const excerpt = path.join(work, 'excerpt.wav'), mono48k = path.join(work, 'excerpt-48k-mono.wav')
  const outputs: Record<string, Float32Array[]> = {}

  beforeAll(async () => {
    await fs.mkdir(work, { recursive: true })
    ffmpeg = await ffmpegPath()
    // 只读原录音：截前 SECONDS 秒写进 .tmp（原采样率原声道）；另做一份 48 kHz 单声道核对重采样路径。
    for (const [target, extra] of [[excerpt, []], [mono48k, ['-ac', '1', '-ar', '48000']]] as const) {
      const run = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', SAMPLE!, '-map', '0:a:0', '-t', String(SECONDS), ...extra, '-c:a', 'pcm_f32le', target], { windowsHide: true })
      if (run.status !== 0) throw new Error(String(run.stderr))
    }
    sessions = new LocalModelSessions(await loadOnnxRuntime(), () => undefined)
  }, 120_000)
  afterAll(async () => { await sessions?.dispose() })

  async function separate(mode: AudioSeparationMode, providers: LocalExecutionProvider[], source: string, label: string) {
    const logs: string[] = []
    const outputDirectory = path.join(work, `${mode}-${label}`)
    const started = performance.now()
    const result = await runAudioSeparation({ id: `${mode}-${label}`, ffmpegPath: ffmpeg, source, mode, modelPath: path.join(MODELS!, MODEL_FILES[mode]), providers, outputDirectory }, {
      openModel: (model, order, shape) => sessions!.open(model, order, shape), io: ffmpegSeparationAudio(ffmpeg), signal: new AbortController().signal, progress: () => undefined,
      log: (_level, _message, event, context) => { logs.push(`${event} ${JSON.stringify(context)}`) },
    })
    const totalMs = performance.now() - started
    const original = await readWav(source), primary = await readWav(result.primaryPath), residual = await readWav(result.residualPath)
    let sumError = 0, finite = true
    for (const [channel, values] of original.channels.entries()) {
      for (let index = 0; index < values.length; index++) {
        const p = primary.channels[channel][index], r = residual.channels[channel][index]
        if (!Number.isFinite(p) || !Number.isFinite(r)) finite = false
        sumError = Math.max(sumError, Math.abs(p + r - values[index]))
      }
    }
    const seconds = original.channels[0].length / original.sampleRate
    const metrics = {
      mode, label, provider: result.provider, seconds: Math.round(seconds * 10) / 10,
      decodeMs: Math.round(result.decodeMs), inferenceMs: Math.round(result.inferenceMs), totalMs: Math.round(totalMs),
      estimateTenMinutesSeconds: Math.round(result.inferenceMs / seconds * 600 / 1000),
      primaryEnergyRatio: Number((energy(primary.channels) / energy(original.channels)).toFixed(4)),
      residualEnergyRatio: Number((energy(residual.channels) / energy(original.channels)).toFixed(4)),
      sumError: Number(sumError.toExponential(2)),
    }
    // eslint-disable-next-line no-console -- 显式实测命令的输出就是实测数据
    console.log(JSON.stringify(metrics), logs.filter(line => line.startsWith('audio_separation.provider')).join(' | '))
    return { result, original, primary, residual, metrics, finite }
  }

  // HENJI_SEPARATION_PROVIDERS=dml 只跑 DirectML（整段实测时省去 CPU 的几分钟）。
  const only = process.env.HENJI_SEPARATION_PROVIDERS?.split(',')
  const providerSets = ([['cpu', ['cpu']], ...(process.platform === 'win32' ? [['dml', ['dml', 'cpu']]] : [])] as Array<[string, LocalExecutionProvider[]]>)
    .filter(([label]) => !only || only.includes(label))

  for (const mode of ['dereverb', 'vocals'] as const) {
    for (const [label, providers] of providerSets) {
      it(`${mode} · ${label}：等长、主分量 + 残差 = 原声、无非数值，分量能量合理`, async () => {
        const run = await separate(mode, providers, excerpt, label)
        expect(run.result.sampleRate).toBe(run.original.sampleRate)
        expect(run.primary.channels).toHaveLength(run.original.channels.length)
        expect(run.primary.channels[0]).toHaveLength(run.original.channels[0].length)
        expect(run.residual.channels[0]).toHaveLength(run.original.channels[0].length)
        expect(run.finite).toBe(true)
        expect(run.metrics.sumError).toBeLessThan(1e-6)
        if (mode === 'vocals') {
          // 口播几乎全是人声：人声分量占绝大部分能量，伴奏（底噪）很小。
          expect(run.metrics.primaryEnergyRatio).toBeGreaterThan(0.9)
          expect(run.metrics.residualEnergyRatio).toBeLessThan(0.05)
        } else {
          // 预测出的混响远小于原声，干声保留绝大部分能量。
          expect(run.metrics.residualEnergyRatio).toBeLessThan(0.2)
          expect(run.metrics.primaryEnergyRatio).toBeGreaterThan(0.7)
        }
        outputs[`${mode}-${label}`] = run.primary.channels
        const cpu = outputs[`${mode}-cpu`], dml = outputs[`${mode}-dml`]
        if (cpu && dml) {
          let difference = 0
          for (const [channel, values] of cpu.entries()) for (let index = 0; index < values.length; index++) difference += (values[index] - dml[channel][index]) ** 2
          const relative = Math.sqrt(difference / energy(cpu))
          // eslint-disable-next-line no-console -- 显式实测命令的输出就是实测数据
          console.log(`${mode} DirectML 与 CPU 主分量相对误差 ${relative.toExponential(2)}`)
          expect(relative).toBeLessThan(1e-3)
        }
      }, 1_800_000)
    }
  }

  it('48 kHz 单声道：经 44.1 kHz 推理后转回原采样率，等长、对齐（人声分离的残差仍然很小）', async () => {
    const run = await separate('vocals', process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu'], mono48k, 'mono48k')
    expect(run.result).toMatchObject({ sampleRate: 48_000, channels: 1 })
    expect(run.primary.channels).toHaveLength(1)
    expect(run.primary.channels[0]).toHaveLength(run.original.channels[0].length)
    expect(run.finite).toBe(true)
    expect(run.metrics.sumError).toBeLessThan(1e-6)
    // 错位哪怕一个样本，残差（原声 − 人声）都会接近原声能量。
    expect(run.metrics.primaryEnergyRatio).toBeGreaterThan(0.9)
    expect(run.metrics.residualEnergyRatio).toBeLessThan(0.05)
  }, 1_800_000)
})
