import { beforeAll, describe, expect, it } from 'vitest'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, VIDEO_EDIT_BUILTIN_GROUP_NAMES, requireVideoEditBuiltinEffect, type VideoEditBuiltinParam } from '@/core/videoEdit/builtinEffects'
import { AUDIO_EFFECT_DEFINITIONS } from '../audioEffectDefinitions'
import { AudioEffectChain } from '../audioEffectChain'
import { effect, expectSamples, isFiniteSignal, noise, peak, RATE, run, runChunked, sine } from './audioEffects.testSupport'

/** 本次补齐的效果，以及让它们真正起作用的一组参数（中性默认的效果给出非中性值）。 */
const ACTIVE: Readonly<Record<string, Record<string, unknown>>> = {
  graphic_eq: { band_63: 4, band_1k: -3, band_8k: 5, output: -2 },
  eq_bands: { hp_on: true, lp_on: true, low_gain: 3, band1_gain: -4, band2_gain: 5, band2_q: 70, band3_gain: 3, high_gain: -2 },
  notch: {},
  dehum: {},
  noise_gate: { threshold: -20 },
  speech_leveler: { speed: 'fast' },
  multiband_compressor: { low_amount: 60, mid_amount: 50, high_amount: 70 },
  echo: { delay: 40, ping_pong: true },
  delay: { left_delay: 3.3, right_delay: 12, mix: 70 },
  chorus: { voices: 4 },
  flanger: { rate: 2 },
  phaser: { rate: 2, stages: '12' },
  stereo_width: { width: 160, center: 3 },
  polarity_invert: { channels: 'left' },
  distortion: { character: 'tube' },
  vocal_enhancer: { voice: 'high' },
}
const NEW_EFFECTS = Object.keys(ACTIVE)
// RNNoise 的 WebAssembly 只认浏览器或工作线程环境；登记检查会建出降噪处理器，单测在 Node 里模拟工作线程全局。
beforeAll(() => { (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope ??= class {} })
/** 一段有起伏的测试声音：正弦 + 噪声，中间有一段很轻的停顿，左右不同。 */
function program(length: number): Float32Array[] {
  const make = (frequency: number, seed: number): Float32Array => {
    const hiss = noise(length, .05, seed)
    return Float32Array.from({ length }, (_, index) => (index > length * .4 && index < length * .55 ? .002 : 1) * (.4 * Math.sin(2 * Math.PI * frequency * index / RATE) + hiss[index]))
  }
  return [make(180, 3), make(270, 4)]
}

describe('新增音频效果的公共约束', () => {
  it('登记：16 个效果都有处理器、分组与参数说明；效果 ID 不与任何内置效果重名；同组的效果在登记表里相邻', async () => {
    const ids = VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.map(definition => definition.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of NEW_EFFECTS) {
      const definition = requireVideoEditBuiltinEffect(id)
      expect(definition.media).toBe('audio'); expect(VIDEO_EDIT_BUILTIN_GROUP_NAMES[definition.group]).toBeTruthy()
    }
    for (const definition of AUDIO_EFFECT_DEFINITIONS) {
      const chain = new AudioEffectChain(RATE, 2)
      await expect(chain.sync([effect(definition.id)])).resolves.toBe(true)
      chain.dispose()
    }
    const groups = AUDIO_EFFECT_DEFINITIONS.map(definition => definition.group)
    expect(groups.filter((group, index) => group !== groups[index - 1])).toEqual([...new Set(groups)])
    expect(requireVideoEditBuiltinEffect('pitch_shift').group).toBe('audio_pitch')
  })
  it('任意分块（1、128、4096 及不规则块长）处理与一次处理逐样本一致；单声道与立体声都能处理', async () => {
    const input = program(RATE / 2)
    for (const id of NEW_EFFECTS) {
      const effects = [effect(id, ACTIVE[id])]
      const whole = (await run(effects, input)).output
      for (const sizes of [[1], [128], [4096], [37, 1000, 3, 2311]]) {
        const chunked = await runChunked(effects, input, sizes)
        for (const channel of [0, 1]) expectSamples(chunked[channel], whole[channel])
      }
      const mono = (await run(effects, [input[0]])).output
      expect(isFiniteSignal(mono), id).toBe(true)
    }
  })
  it('极端参数（全部取最小、全部取最大、各个选项）下输出都是有限值，没有失控', async () => {
    const loud = [noise(RATE, 1, 5), noise(RATE, 1, 6)]
    loud[0][RATE / 2] = 1; loud[1][RATE / 3] = -1
    const extreme = (param: VideoEditBuiltinParam, side: 'min' | 'max'): unknown => param.type === 'number' ? param[side] : param.type === 'boolean' ? side === 'max' : param.default
    for (const id of NEW_EFFECTS) {
      const { params } = requireVideoEditBuiltinEffect(id)
      const sets: Record<string, unknown>[] = [
        Object.fromEntries(params.map(param => [param.key, extreme(param, 'min')])),
        Object.fromEntries(params.map(param => [param.key, extreme(param, 'max')])),
        ...params.flatMap(param => param.type === 'enum' ? param.options.map(option => ({ [param.key]: option.value })) : []),
      ]
      for (const values of sets) {
        for (const input of [loud, [loud[0]]]) {
          const output = (await run([effect(id, values)], input.map(channel => Float32Array.from(channel)))).output
          expect(isFiniteSignal(output), `${id} ${JSON.stringify(values)}`).toBe(true)
          expect(Math.max(...output.map(channel => peak(channel))), `${id} ${JSON.stringify(values)}`).toBeLessThan(1000)
        }
      }
    }
  })
  it('参数原地更新：同样的参数重新同步不改变任何样本（状态不清空）；改参数不重建、不爆音', async () => {
    const input = [sine(220, .3, RATE), sine(330, .25, RATE)]
    for (const id of NEW_EFFECTS) {
      const effects = [effect(id, ACTIVE[id])]
      const whole = (await run(effects, input)).output
      const chain = new AudioEffectChain(RATE, 2); await chain.sync(effects)
      const first = input.map(channel => channel.slice(0, RATE / 2)); chain.process(first, RATE / 2)
      expect(await chain.sync([effect(id, ACTIVE[id])])).toBe(false)
      const second = input.map(channel => channel.slice(RATE / 2)); chain.process(second, RATE / 2)
      for (const channel of [0, 1]) { expectSamples(first[channel], whole[channel].subarray(0, RATE / 2)); expectSamples(second[channel], whole[channel].subarray(RATE / 2)) }
      chain.dispose()
      // 每个数值参数朝另一端挪 5% 的范围：不重建，衔接处的样本跳变不超过平稳段的几倍。
      const { params } = requireVideoEditBuiltinEffect(id)
      const nudged = Object.fromEntries(params.flatMap(param => {
        if (param.type !== 'number') return []
        const current = (effects[0].builtin.params[param.key] as number); const span = param.max - param.min
        return [[param.key, current + (current - param.min > span / 2 ? -span : span) * .05]]
      }))
      const moving = new AudioEffectChain(RATE, 2); await moving.sync(effects)
      const before = input.map(channel => channel.slice(0, RATE / 2)); moving.process(before, RATE / 2)
      expect(await moving.sync([effect(id, { ...ACTIVE[id], ...nudged })])).toBe(false)
      const after = input.map(channel => channel.slice(RATE / 2)); moving.process(after, RATE / 2)
      moving.dispose()
      for (const channel of [0, 1]) {
        const joined = new Float32Array(RATE); joined.set(before[channel]); joined.set(after[channel], RATE / 2)
        let steady = 0; let seam = 0
        for (let index = RATE / 4; index < RATE / 2; index++) steady = Math.max(steady, Math.abs(joined[index] - joined[index - 1]))
        for (let index = RATE / 2; index < RATE / 2 + 256; index++) seam = Math.max(seam, Math.abs(joined[index] - joined[index - 1]))
        expect(seam, `${id} 声道 ${channel}`).toBeLessThan(steady * 3 + .02)
      }
    }
  })
  it('预读：有尾音、延迟线或慢包络的效果登记足够的预读', async () => {
    const preroll = async (id: string): Promise<number> => { const chain = new AudioEffectChain(RATE, 2); await chain.sync([effect(id)]); const value = chain.preroll / RATE; chain.dispose(); return value }
    expect(await preroll('echo')).toBeGreaterThanOrEqual(4)
    expect(await preroll('delay')).toBeGreaterThan(1)
    expect(await preroll('flanger')).toBeGreaterThanOrEqual(1)
    expect(await preroll('speech_leveler')).toBeGreaterThanOrEqual(2)
    expect(await preroll('dehum')).toBeGreaterThanOrEqual(1)
    expect(await preroll('stereo_width')).toBeCloseTo(.05)
  })
})

// 基准：10 秒 48 kHz 立体声，每个效果单独处理；只在 HENJI_AUDIO_FX_BENCHMARK=1 时运行（不进 CI）。
if (process.env.HENJI_AUDIO_FX_BENCHMARK === '1') it('新增音频效果 10 秒立体声处理耗时', async () => {
  const input = program(RATE * 10)
  const timings: Record<string, number> = {}
  for (const id of NEW_EFFECTS) {
    const chain = new AudioEffectChain(RATE, 2); await chain.sync([effect(id, ACTIVE[id])])
    const work = input.map(channel => Float32Array.from(channel))
    chain.process(work.map(channel => channel.slice(0, RATE)), RATE)
    const start = performance.now()
    for (let offset = 0; offset < RATE * 10; offset += 2400) chain.process(work.map(channel => channel.subarray(offset, offset + 2400)), 2400)
    timings[id] = Math.round(performance.now() - start)
    chain.dispose()
  }
  process.stdout.write(`音频效果基准（毫秒，10 秒 48 kHz 立体声）${JSON.stringify(timings)}\n`)
  for (const [id, ms] of Object.entries(timings)) expect(ms, id).toBeLessThan(300)
})
