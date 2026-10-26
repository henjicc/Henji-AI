import { describe, expect, it } from 'vitest'
import { MDX_SAMPLE_RATE, MDX_SEPARATION_MODELS, MdxStft, mdxChannelGroups, mdxChunkPlan, separateMdx, symmetricHann, type MdxNetParameters } from './mdx'

/** 两端各 0.2 秒淡入淡出的多音合成声（都在模型保留的 17 Hz–17.6 kHz 频带内）。 */
function tones(length: number, frequencies: readonly number[], phase = 0): Float32Array {
  const fade = Math.round(0.2 * MDX_SAMPLE_RATE)
  return Float32Array.from({ length }, (_, index) => {
    const t = index / MDX_SAMPLE_RATE
    let value = 0
    for (const [order, frequency] of frequencies.entries()) value += 0.4 / (order + 1) * Math.sin(2 * Math.PI * frequency * t + phase + order)
    const edge = Math.min(1, index / fade, (length - 1 - index) / fade)
    return value * (0.5 - 0.5 * Math.cos(Math.PI * edge))
  })
}

const identity = async (spec: Float32Array): Promise<Float32Array> => spec
const maxAbs = (a: ArrayLike<number>, b: ArrayLike<number>): number => { let max = 0; for (let index = 0; index < a.length; index++) max = Math.max(max, Math.abs(a[index] - b[index])); return max }

async function collect(channels: Float32Array[], params: MdxNetParameters, infer = identity): Promise<{ out: Float32Array[]; offsets: number[] }> {
  const out = channels.map(channel => new Float32Array(channel.length)); const offsets: number[] = []
  let expected = 0
  await separateMdx({
    channels, params, infer,
    emit: (block, offset) => {
      expect(offset).toBe(expected)
      offsets.push(offset)
      for (const [channel, values] of block.entries()) out[channel].set(values, offset)
      expected += block[0].length
    },
  })
  expect(expected).toBe(channels[0].length)
  return { out, offsets }
}

const small: MdxNetParameters = { nFft: 256, hop: 64, dimF: 129, dimT: 24, compensate: 1 }

describe('MDX-Net 频谱', () => {
  it.each(['vocals', 'dereverb'] as const)('%s 参数下 STFT→iSTFT 往返误差 < 1e-4（不截频时）', (mode) => {
    const { nFft, hop } = MDX_SEPARATION_MODELS[mode]
    const params = { nFft, hop, dimF: nFft / 2 + 1, dimT: 24, compensate: 1 }
    const stft = new MdxStft(params, 0)
    const left = Float64Array.from(tones(stft.chunkSize, [220, 1250, 5100])), right = Float64Array.from(tones(stft.chunkSize, [330, 2700], 1))
    // 端点不为零：反射补边也必须完全还原。
    left[0] = 0.3; right[stft.chunkSize - 1] = -0.25
    const spec = new Float32Array(stft.specLength)
    stft.analyze(left, right, spec)
    const outLeft = new Float64Array(stft.chunkSize), outRight = new Float64Array(stft.chunkSize)
    stft.synthesize(spec, outLeft, outRight)
    expect(maxAbs(outLeft, left)).toBeLessThan(1e-4)
    expect(maxAbs(outRight, right)).toBeLessThan(1e-4)
  })

  it('谱的排布与 torch.stft(center=True) 一致：[左实, 左虚, 右实, 右虚] × 频点 × 帧，帧以 t·hop 为中心，前 3 个频点为零', () => {
    const params = { nFft: 512, hop: 128, dimF: 200, dimT: 16, compensate: 1 }
    const stft = new MdxStft(params)
    const bin = 37, amplitude = 0.5
    const left = Float64Array.from({ length: stft.chunkSize }, (_, n) => amplitude * Math.cos(2 * Math.PI * bin * n / params.nFft))
    const right = new Float64Array(stft.chunkSize).fill(0.1)
    const spec = new Float32Array(stft.specLength)
    stft.analyze(left, right, spec)
    const plane = params.dimF * params.dimT
    for (const t of [4, 9]) {
      // 中心在 t·hop：X[bin] = A·N/4·e^{i·2π·bin·(t·hop − N/2)/N}
      const angle = 2 * Math.PI * bin * (t * params.hop - params.nFft / 2) / params.nFft
      expect(spec[bin * params.dimT + t]).toBeCloseTo(amplitude * params.nFft / 4 * Math.cos(angle), 2)
      expect(spec[plane + bin * params.dimT + t]).toBeCloseTo(amplitude * params.nFft / 4 * Math.sin(angle), 2)
      // 右声道是常数：能量只在直流，被清零。
      for (let f = 0; f < 3; f++) expect(spec[2 * plane + f * params.dimT + t]).toBe(0)
      expect(Math.abs(spec[2 * plane + 10 * params.dimT + t])).toBeLessThan(1e-4)
    }
  })
})

describe('MDX-Net 分块推理', () => {
  it('UVR 的分块：块长 hop·(dim_t−1)、步长块长 − n_fft、前补 n_fft/2', () => {
    // 10 分钟：UVR 取 106 / 53 块，最后一块整个落在补零区，不推理。
    expect(mdxChunkPlan(MDX_SAMPLE_RATE * 600, MDX_SEPARATION_MODELS.vocals)).toMatchObject({ trim: 3840, chunkSize: 261_120, step: 253_440, mixtureLength: 26_618_880, count: 105 })
    expect(mdxChunkPlan(MDX_SAMPLE_RATE * 600, MDX_SEPARATION_MODELS.dereverb)).toMatchObject({ trim: 3072, chunkSize: 523_264, step: 517_120, mixtureLength: 26_896_384, count: 52 })
    expect(symmetricHann(1)).toEqual(Float64Array.of(1))
    expect(Array.from(symmetricHann(5))).toEqual([0, 0.5, 1, 0.5, 0].map(value => expect.closeTo(value, 12)))
  })

  it('恒等模型：分块重叠拼接与整段一次推理逐样本接近', async () => {
    const params = { ...MDX_SEPARATION_MODELS.vocals, compensate: 1 }
    const plan = mdxChunkPlan(1, params)
    // 约 2.6 块长，跨过两处拼接
    const length = Math.round(plan.chunkSize * 2.6)
    const channels = [tones(length, [180, 950, 4300]), tones(length, [260, 1800, 7200], 2)]
    const { out } = await collect(channels, params)
    // 整段一次：一个覆盖全长（再各留半个 n_fft 余量）的大块，前后补零，与分块的补边方式相同。
    const frames = Math.ceil((length + params.nFft) / params.hop) + 1
    const whole = new MdxStft({ ...params, dimT: frames })
    const pad = (values: Float32Array): Float64Array => { const target = new Float64Array(whole.chunkSize); target.set(values, params.nFft / 2); return target }
    const spec = new Float32Array(whole.specLength)
    whole.analyze(pad(channels[0]), pad(channels[1]), spec)
    const wholeLeft = new Float64Array(whole.chunkSize), wholeRight = new Float64Array(whole.chunkSize)
    whole.synthesize(spec, wholeLeft, wholeRight)
    const shift = params.nFft / 2
    for (const [channel, reference] of [wholeLeft, wholeRight].entries()) {
      let seams = 0, elsewhere = 0
      for (let index = 0; index < length; index++) {
        const error = Math.abs(out[channel][index] - reference[index + shift])
        // 拼接处（每块开头 n_fft 个样本）受分块补边与截频影响，UVR 同样如此。
        if ((index + plan.trim) % plan.step < params.nFft) seams = Math.max(seams, error)
        else elsewhere = Math.max(elsewhere, error)
      }
      expect(elsewhere).toBeLessThan(1e-6)
      expect(seams).toBeLessThan(1e-3)
    }
    // 恒等模型只截掉了频带外的内容：与原声也很接近。
    expect(maxAbs(out[0], channels[0])).toBeLessThan(1e-3)
  })

  // small：步长 1216、前补 128，块数在 1088 / 2304 处跳变
  it.each([1, 7, 63, 200, 1088, 1089, 2304, 2305, 5000])('长度 %i：输出与输入等长、按顺序无缝交付', async (length) => {
    const channels = [tones(length, [3000]), tones(length, [5000])]
    const { out } = await collect(channels, small)
    expect(out[0]).toHaveLength(length)
    expect(out.flatMap(values => Array.from(values)).every(Number.isFinite)).toBe(true)
  })

  it('左右声道送进模型时不串位，compensate 乘在输出上', async () => {
    const length = 4000
    const channels = [tones(length, [3000]), tones(length, [9000], 1)]
    const plane = small.dimF * small.dimT
    // 交换左右声道的假模型：输出的左声道应等于输入的右声道。
    const swap = async (spec: Float32Array): Promise<Float32Array> => { const out = new Float32Array(spec.length); out.set(spec.subarray(2 * plane), 0); out.set(spec.subarray(0, 2 * plane), 2 * plane); return out }
    const { out } = await collect(channels, { ...small, compensate: 2 }, swap)
    const { out: plain } = await collect(channels, small)
    expect(maxAbs(out[0], plain[1].map(value => value * 2))).toBeLessThan(1e-5)
    expect(maxAbs(out[1], plain[0].map(value => value * 2))).toBeLessThan(1e-5)
  })

  it('单声道复制成立体声推理、输出取平均；多声道两两成组，落单的一路单独成组', async () => {
    expect(mdxChannelGroups(1)).toEqual([[0]])
    expect(mdxChannelGroups(2)).toEqual([[0, 1]])
    expect(mdxChannelGroups(5)).toEqual([[0, 1], [2, 3], [4]])
    const length = 3000
    const mono = tones(length, [2500, 7000])
    const { out: single } = await collect([mono], small)
    const { out: pair } = await collect([mono, mono], small)
    expect(single).toHaveLength(1)
    expect(maxAbs(single[0], pair[0])).toBeLessThan(1e-6)
    const seen: number[] = []
    const { out: three } = await collect([mono, tones(length, [4000]), tones(length, [6000])], small, async (spec) => { seen.push(spec.length); return spec })
    expect(three).toHaveLength(3)
    expect(seen.length).toBe(2 * mdxChunkPlan(length, small).count)
    expect(maxAbs(three[0], single[0])).toBeLessThan(1e-6)
  })

  it('取消后立即停止，不再推理后面的块', async () => {
    const controller = new AbortController()
    let calls = 0
    const length = 6000
    const run = separateMdx({
      channels: [tones(length, [3000])], params: small, signal: controller.signal, emit: () => undefined,
      infer: async (spec) => { calls++; if (calls === 2) controller.abort(new Error('已取消')); return spec },
    })
    await expect(run).rejects.toThrow('已取消')
    expect(calls).toBe(2)
    expect(mdxChunkPlan(length, small).count).toBeGreaterThan(2)
  })

  it('进度按块数汇报到总块数', async () => {
    const progress: Array<[number, number]> = []
    await separateMdx({ channels: [tones(3000, [3000]), tones(3000, [4000])], params: small, infer: identity, emit: () => undefined, progress: (done, total) => progress.push([done, total]) })
    const total = mdxChunkPlan(3000, small).count
    expect(progress).toEqual(Array.from({ length: total }, (_, index) => [index + 1, total]))
  })
})
