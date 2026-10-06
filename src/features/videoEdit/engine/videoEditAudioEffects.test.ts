import { beforeAll, describe, expect, it } from 'vitest'
import type { VideoEditBuiltinEffect } from '@/core/videoEdit/compositing'
import { normalizeVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import { planVideoEditAudioEffectBlock, VideoEditAudioEffectChain, videoEditCompressorCurve, videoEditFft, VIDEO_EDIT_RNNOISE_LATENCY } from './videoEditAudioEffects'

const RATE = 48000
// RNNoise 的 WebAssembly 只认浏览器或工作线程环境（运行时在剪辑渲染工作线程里）；单测在 Node 里模拟工作线程全局。
beforeAll(() => { (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope ??= class {} })

function effect(builtinId: string, params: Record<string, unknown> = {}, amount = 1, id = builtinId): VideoEditBuiltinEffect {
  return { id, name: builtinId, enabled: true, amount, builtin: { id: builtinId, params: normalizeVideoEditBuiltinParams(builtinId, params) } }
}
const sine = (frequency: number, amplitude: number, length: number, phase = 0): Float32Array => Float32Array.from({ length }, (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / RATE + phase))
const stereo = (left: Float32Array, right = left): Float32Array[] => [Float32Array.from(left), Float32Array.from(right)]
/** 跑一条效果链（一次处理全部样本）。 */
async function run(effects: VideoEditBuiltinEffect[], input: Float32Array[]): Promise<{ output: Float32Array[]; latency: number }> {
  const chain = new VideoEditAudioEffectChain(RATE, input.length)
  await chain.sync(effects)
  const output = input.map(channel => Float32Array.from(channel))
  chain.process(output, output[0].length)
  const latency = chain.latency; chain.dispose()
  return { output, latency }
}
const peak = (data: Float32Array, from = 0, to = data.length): number => { let value = 0; for (let index = from; index < to; index++) value = Math.max(value, Math.abs(data[index])); return value }
const rms = (data: Float32Array, from = 0, to = data.length): number => { let sum = 0; for (let index = from; index < to; index++) sum += data[index] ** 2; return Math.sqrt(sum / (to - from)) }
const db = (ratio: number): number => 20 * Math.log10(ratio)
/** 稳态（跳过前 0.25 秒）的增益，dB。 */
const steadyGain = (output: Float32Array, input: Float32Array): number => db(rms(output, RATE / 4) / rms(input, RATE / 4))

describe('音频内置效果的逐样本处理（4.7c）', () => {
  it('参数均衡：默认中性时逐样本不变；低频 +6 dB 只抬低频；“去低频嗡声”压掉 50/60 Hz 而 1 kHz 不变；“人声更清楚”切掉 40 Hz', async () => {
    const input = sine(1000, .3, RATE)
    expect((await run([effect('parametric_eq')], stereo(input))).output[0]).toEqual(input)
    const low = sine(40, .3, RATE); const high = sine(5000, .3, RATE)
    const boosted = await run([effect('parametric_eq', { low: 6 })], stereo(low, high))
    expect(steadyGain(boosted.output[0], low)).toBeGreaterThan(5.5); expect(steadyGain(boosted.output[0], low)).toBeLessThan(6.5)
    expect(Math.abs(steadyGain(boosted.output[1], high))).toBeLessThan(.2)
    const hum = await run([effect('parametric_eq', { preset: 'remove_hum' })], stereo(sine(50, .3, RATE), sine(60, .3, RATE)))
    expect(steadyGain(hum.output[0], sine(50, .3, RATE))).toBeLessThan(-30); expect(steadyGain(hum.output[1], sine(60, .3, RATE))).toBeLessThan(-30)
    expect(Math.abs(steadyGain((await run([effect('parametric_eq', { preset: 'remove_hum' })], stereo(input))).output[0], input))).toBeLessThan(.3)
    expect(steadyGain((await run([effect('parametric_eq', { preset: 'voice_clarity' })], stereo(sine(40, .3, RATE)))).output[0], sine(40, .3, RATE))).toBeLessThan(-10)
  })
  it('高通、低通：截止频率外明显衰减，陡峭坡度衰减更多，通带不变', async () => {
    const rumble = sine(20, .3, RATE); const voice = sine(1000, .3, RATE)
    const gentle = await run([effect('high_pass')], stereo(rumble, voice))
    const steep = await run([effect('high_pass', { slope: 'steep' })], stereo(rumble, voice))
    expect(steadyGain(gentle.output[0], rumble)).toBeLessThan(-20); expect(steadyGain(steep.output[0], rumble)).toBeLessThan(steadyGain(gentle.output[0], rumble) - 10)
    expect(Math.abs(steadyGain(gentle.output[1], voice))).toBeLessThan(.1)
    const hiss = sine(16000, .3, RATE)
    const filtered = await run([effect('low_pass')], stereo(hiss, voice))
    expect(steadyGain(filtered.output[0], hiss)).toBeLessThan(-12); expect(Math.abs(steadyGain(filtered.output[1], voice))).toBeLessThan(.1)
  })
  it('增益与声道平衡：+6.02 dB 为两倍；平衡 +100 只剩右声道；合成单声道两边相同；效果强度按比例混入原声', async () => {
    const left = sine(300, .2, 4800); const right = sine(500, .1, 4800)
    const doubled = (await run([effect('gain_balance', { gain: 20 * Math.log10(2) })], stereo(left, right))).output
    doubled[0].forEach((value, index) => expect(value).toBeCloseTo(left[index] * 2, 6))
    const panned = (await run([effect('gain_balance', { balance: 100 })], stereo(left, right))).output
    expect(peak(panned[0])).toBe(0); expect(panned[1]).toEqual(right)
    const mono = (await run([effect('gain_balance', { mono: true })], stereo(left, right))).output
    mono[0].forEach((value, index) => { expect(value).toBe(mono[1][index]); expect(value).toBeCloseTo((left[index] + right[index]) / 2, 6) })
    const half = (await run([effect('gain_balance', { gain: 20 * Math.log10(2) }, .5)], stereo(left, right))).output
    half[0].forEach((value, index) => expect(value).toBeCloseTo(left[index] * 1.5, 6))
  })
  it('压缩器：按压缩量的阈值与比率压低大声并自动补偿；小声只被补偿抬高', async () => {
    const curve = videoEditCompressorCurve(40)
    expect(curve.threshold).toBe(-16); expect(curve.ratio).toBeCloseTo(3.8)
    const loud = sine(200, 1, RATE); const quiet = sine(200, .01, RATE)
    const out = await run([effect('compressor')], stereo(loud, quiet))
    // 0 dBFS 峰值：静态曲线压下约 11.8 dB，补偿约 +5.9 dB（包络在峰值间回升，实际略少压）。
    expect(steadyGain(out.output[0], loud)).toBeLessThan(-3); expect(steadyGain(out.output[0], loud)).toBeGreaterThan(-8)
    const quietOnly = await run([effect('compressor')], stereo(quiet))
    expect(steadyGain(quietOnly.output[0], quiet)).toBeCloseTo(curve.makeup, 1)
    const noMakeup = await run([effect('compressor', { makeup: false })], stereo(quiet))
    expect(Math.abs(steadyGain(noMakeup.output[0], quiet))).toBeLessThan(.01)
  })
  it('限幅器：峰值永远不超过最大电平；低于上限的声音只是整体延迟，逐样本不变', async () => {
    const hot = Float32Array.from(sine(150, 2, RATE), (value, index) => value + (index % 997 === 0 ? 1.5 : 0))
    const limited = await run([effect('limiter', { ceiling: -1 })], stereo(hot))
    const ceiling = 10 ** (-1 / 20)
    expect(peak(limited.output[0])).toBeLessThanOrEqual(ceiling + 1e-7)
    expect(peak(limited.output[0], RATE / 2)).toBeGreaterThan(ceiling * .9)
    const quiet = sine(150, .3, 9600)
    const passed = await run([effect('limiter')], stereo(quiet))
    expect(passed.latency).toBe(239)
    for (let index = passed.latency; index < quiet.length; index++) expect(passed.output[0][index]).toBeCloseTo(quiet[index - passed.latency], 6)
    const boosted = await run([effect('limiter', { boost: 6 })], stereo(quiet))
    expect(peak(boosted.output[0], RATE / 10)).toBeCloseTo(Math.min(ceiling, .3 * 10 ** (6 / 20)), 2)
  })
  it('去齿音：只在高频齿音段压低，低频人声不受影响', async () => {
    const voiced = sine(300, .3, RATE); const sibilant = sine(8000, .3, RATE)
    expect(Math.abs(steadyGain((await run([effect('de_esser')], stereo(voiced))).output[0], voiced))).toBeLessThan(.1)
    expect(steadyGain((await run([effect('de_esser')], stereo(sibilant))).output[0], sibilant)).toBeLessThan(-6)
  })
  it('混响：混响量为 0 时原样输出；脉冲之后留下逐渐衰减的尾音，空间越大尾音越长', async () => {
    const impulse = new Float32Array(RATE); impulse[0] = 1
    expect((await run([effect('reverb', { mix: 0 })], stereo(impulse))).output[0]).toEqual(impulse)
    const small = (await run([effect('reverb', { room_size: 10 })], stereo(impulse))).output[0]
    const large = (await run([effect('reverb', { room_size: 90 })], stereo(impulse))).output[0]
    expect(rms(small, RATE / 10, RATE / 5)).toBeGreaterThan(0)
    expect(rms(large, RATE / 2, RATE)).toBeGreaterThan(rms(small, RATE / 2, RATE) * 10)
    expect(rms(large, RATE * .1, RATE * .2)).toBeGreaterThan(rms(large, RATE * .8, RATE * .9))
  })
  it('音调变换：0 半音时输出是延迟 1536 个样本的原声；+12 半音频率翻倍、-12 半音减半，速度与长度不变', async () => {
    const tone = sine(440, .3, RATE)
    const neutral = await run([effect('pitch_shift')], stereo(tone))
    expect(neutral.latency).toBe(1536)
    for (let index = 1536; index < RATE; index++) expect(neutral.output[0][index]).toBe(tone[index - 1536])
    const dominant = (data: Float32Array): number => {
      const size = 16384; const real = Float64Array.from({ length: size }, (_, index) => data[RATE / 2 + index] * (.5 - .5 * Math.cos(2 * Math.PI * index / size))); const imaginary = new Float64Array(size)
      videoEditFft(real, imaginary, -1)
      let best = 0
      for (let bin = 1; bin < size / 2; bin++) if (Math.hypot(real[bin], imaginary[bin]) > Math.hypot(real[best], imaginary[best])) best = bin
      return best * RATE / size
    }
    expect(dominant(tone)).toBeCloseTo(440, -1)
    expect(dominant((await run([effect('pitch_shift', { semitones: 12 })], stereo(tone))).output[0])).toBeCloseTo(880, -1)
    expect(dominant((await run([effect('pitch_shift', { semitones: -12 })], stereo(tone))).output[0])).toBeCloseTo(220, -1)
    expect(rms((await run([effect('pitch_shift', { semitones: 5 })], stereo(tone))).output[0], RATE / 2)).toBeGreaterThan(.15)
  })
  it('降噪（RNNoise）：声明的延迟就是实测延迟；强度 0 是对齐后的原声；强度 100 把白噪声压低 10 dB 以上', async () => {
    let seed = 7; const random = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - .5 }
    const noise = Float32Array.from({ length: RATE * 2 }, () => random() * .1)
    const off = await run([effect('noise_reduction', { strength: 0 })], stereo(noise))
    expect(off.latency).toBe(VIDEO_EDIT_RNNOISE_LATENCY)
    for (let index = off.latency; index < noise.length; index++) expect(off.output[0][index]).toBe(noise[index - off.latency])
    const cleaned = await run([effect('noise_reduction', { strength: 100 })], stereo(noise))
    expect(db(rms(cleaned.output[0], RATE) / rms(noise, RATE))).toBeLessThan(-10)
    // 类人声的谐波信号：输出与输入在声明的延迟处最相关（干声按同一延迟混入才不会梳状失真）。
    const voice = Float32Array.from({ length: RATE * 2 }, (_, index) => { const t = index / RATE; const f0 = 150 + 50 * Math.sin(2 * Math.PI * 3 * t); let value = 0; for (let h = 1; h < 8; h++) value += Math.sin(2 * Math.PI * f0 * h * t + h) / h; return value * .2 * (.5 + .5 * Math.sin(2 * Math.PI * 2 * t)) })
    const denoised = (await run([effect('noise_reduction', { strength: 100 })], stereo(voice))).output[0]
    const correlation = (lag: number): number => { let sum = 0; for (let index = RATE / 2; index < RATE * 1.8; index++) sum += denoised[index + lag] * voice[index]; return sum }
    const lags = [0, 480, 960, 1440, 1920]
    expect(lags.reduce((best, lag) => correlation(lag) > correlation(best) ? lag : best, 0)).toBe(VIDEO_EDIT_RNNOISE_LATENCY)
  })
  it('效果链按任意分块连续处理，结果与一次处理逐样本一致（预览与导出的分块不同也一样）', async () => {
    let seed = 3; const random = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - .5 }
    const source = Float32Array.from({ length: RATE }, (_, index) => .4 * Math.sin(2 * Math.PI * 220 * index / RATE) + random() * .05)
    const effects = [effect('noise_reduction', {}, 1, 'a'), effect('parametric_eq', { preset: 'voice_clarity', mid: 2 }, 1, 'b'), effect('compressor', {}, .8, 'c'), effect('de_esser', {}, 1, 'd'), effect('pitch_shift', { semitones: 3 }, 1, 'e'), effect('reverb', {}, 1, 'f'), effect('limiter', { boost: 3 }, 1, 'g'), effect('gain_balance', { balance: -20 }, 1, 'h')]
    const whole = await run(effects, stereo(source, Float32Array.from(source, value => -value)))
    const chain = new VideoEditAudioEffectChain(RATE, 2); await chain.sync(effects)
    const pieces: Float32Array[][] = []
    for (let start = 0, size = 37; start < RATE; start += size, size = (size * 7 + 101) % 9000 + 1) {
      const block = [Float32Array.from(source.subarray(start, Math.min(RATE, start + size))), Float32Array.from(source.subarray(start, Math.min(RATE, start + size)), value => -value)]
      chain.process(block, block[0].length); pieces.push(block)
    }
    chain.dispose()
    for (const channel of [0, 1]) {
      const joined = new Float32Array(RATE); let offset = 0
      for (const piece of pieces) { joined.set(piece[channel], offset); offset += piece[channel].length }
      expect(joined).toEqual(whole.output[channel])
    }
  })
  it('分块计划：连续时接着上一块读（跳过延迟），不连续时预读一段并丢掉预读与延迟部分', () => {
    const chain = { nextSample: 4800, latency: 100, preroll: 2400 }
    expect(planVideoEditAudioEffectBlock(chain, 4800, 480)).toEqual({ contiguous: true, inputStart: 4900, inputLength: 480, discard: 0 })
    expect(planVideoEditAudioEffectBlock(chain, 9600, 480)).toEqual({ contiguous: false, inputStart: 7200, inputLength: 2980, discard: 2500 })
  })
})
