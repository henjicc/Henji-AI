import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { colorGradeLinear, colorGradeSrgb, colorGradeWhiteBalance } from '@/core/videoEdit/colorGrade'
import { VideoEditBuiltinEffectsGpu } from './videoEditBuiltinEffectsGpu'
import { readVideoEditPreciseRow, videoEditGradientLevels, videoEditHalfToFloat } from './videoEditGpuShaders'

import { suggestColorGradeMatch } from '@/core/videoEdit/colorGradeMatch'
import { parseCubeLut } from '@/core/videoEdit/cubeLut'
import { encodeColorGradeCurve, colorGradeSpline } from '@/core/videoEdit/colorGradeCurves'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { ColorLutAsset } from '@/core/videoEdit/colorLutAsset'
const lutFixtures = new Map<string, string>()
const assets: ColorLutAsset[] = []

let gpu: Gpu; let effects: VideoEditBuiltinEffectsGpu
type Texture = ReturnType<Gpu['gpu']['createTexture']>
const textures: Texture[] = []
beforeAll(async () => {
  gpu = await init(); const device = gpu.gpu
  effects = new VideoEditBuiltinEffectsGpu(device as unknown as GpuDevice, device.createSampler({ minFilter: 'linear', magFilter: 'linear' }), { allocate: (width, height, format) => texture(width, format, height) as unknown as GpuTexture, release: value => value.destroy() }, async asset => parseCubeLut(lutFixtures.get(asset.id)!))
})
afterAll(() => { effects?.dispose(); textures.forEach(value => value.destroy()); gpu?.dispose() })
function texture(width: number, format: string, height = 1): Texture {
  const value = gpu.gpu.createTexture({ size: [width, height], format: format as 'rgba16float', usage: 1 | 2 | 4 | 16 }); textures.push(value); return value
}
function half(value: number): number {
  const bits = new Uint32Array(new Float32Array([value]).buffer)[0]; const exponent = ((bits >>> 23) & 255) - 127 + 15
  return exponent <= 0 ? 0 : (exponent << 10) | ((bits >>> 13) & 1023)
}
async function run(params: VideoEditBuiltinParams, pixels: readonly number[], width = 64, height = 1): Promise<number[]> {
  const source = texture(width, 'rgba16float', height); const target = texture(width, 'rgba16float', height)
  const input = new Uint16Array(width * height * 4)
  for (let i = 0; i < width * height; i++) input.set(pixels.length === 4 ? pixels.map(half) : pixels.slice(i * 4, i * 4 + 4).map(half), i * 4)
  gpu.gpu.queue.writeTexture({ texture: source }, input, { bytesPerRow: width * 8, rowsPerImage: height }, [width, height])
  await effects.render({ id: 'color_grade', params }, { texture: source as unknown as GpuTexture, width, height, format: 'rgba16float' }, target as unknown as GpuTexture, 0, 1, assets)
  const output: number[] = []
  for (let row = 0; row < height; row++) output.push(...[...await readVideoEditPreciseRow(gpu.gpu, target, width, row)].map(videoEditHalfToFloat))
  return output
}
const near = (got: readonly number[], expected: readonly number[]): void => { expected.forEach((value, i) => expect(got[i]).toBeCloseTo(value, 2)) }
describe('ColorGrade 正式 GPU 像素', () => {
  it('中性逐值恒等，1024 灰阶经中性及曝光保留高精度；透明度不变', async () => {
    const pixels = Array.from({ length: 1024 }, (_, i) => [i / 1023, i / 1023, i / 1023, 1]).flat()
    const neutral = await run({}, pixels, 1024)
    neutral.forEach((x, i) => expect(x).toBe(videoEditHalfToFloat(half(pixels[i]))))
    const exposed = await run({ exposure: -.25 }, pixels, 1024)
    expect(videoEditGradientLevels(new Uint16Array(neutral.map(half)))).toBe(1024)
    expect(new Set(exposed.filter((_, i) => i % 4 === 0)).size).toBeGreaterThan(1000)
    near(await run({ exposure: 1 }, [.2, .2, .2, .5]), [colorGradeSrgb(colorGradeLinear(.4) * 2) * .5, colorGradeSrgb(colorGradeLinear(.4) * 2) * .5, colorGradeSrgb(colorGradeLinear(.4) * 2) * .5, .5])
  })
  it('曝光/白平衡按线性增益；曲线固定点与通道独立；红色中间调轮保持亮度', async () => {
    const gains = colorGradeWhiteBalance(30, -20)
    near(await run({ temperature: 30, tint: -20 }, [.4, .4, .4, 1]), [...gains.map(g => colorGradeSrgb(colorGradeLinear(.4) * g)), 1])
    near(await run({ curve_master_2: 75 }, [.5, .5, .5, 1]), [.75, .75, .75, 1])
    near(await run({ curve_red_2: 75 }, [.5, .5, .5, 1]), [.75, .5, .5, 1])
    near(await run({ midtone_hue: 0, midtone_strength: 40 }, [.5, .5, .5, 1]), [.5 + .7874 * .1, .5 - .2126 * .1, .5 - .2126 * .1, 1])
    near(await run({ shadow_luminance: 40 }, [0, 0, 0, 1]), [.1, .1, .1, 1])
  })
  it('各分区的 WGSL 编译与组合执行，锐化/创意/曲线/三色轮/晕影保留透明度', async () => {
    const result = await run({ exposure: .2, contrast: 20, highlights: -20, shadows: 20, whites: 10, blacks: -10, saturation: 20, vibrance: 10, faded_film: 10, sharpen: 20, creative_shadow_hue: 240, creative_shadow_strength: 20, creative_highlight_hue: 60, creative_highlight_strength: 10, curve_green_1: 30, shadow_hue: 240, shadow_strength: 20, midtone_luminance: 10, highlight_hue: 60, highlight_strength: 10, vignette_amount: -20, vignette_roundness: 100 }, [.3, .3, .3, 1])
    expect(result.every(Number.isFinite)).toBe(true); expect(result.filter((_, i) => i % 4 === 3).every(x => x === 1)).toBe(true)
  })
})

describe('HSL 辅助正式 GPU 选区与校正', () => {
  const selection = { hsl_hue_start: 340, hsl_hue_end: 20 }
  const blocks = Array.from({ length: 64 }, (_, i) => i < 32 ? [.8, .1, .1, 1] : [.1, .1, .8, 1]).flat()
  it('跨0°选中红色校正，蓝色逐像素不变；反向只改蓝色', async () => {
    const baseline = await run({}, blocks)
    for (const invert of [false, true]) {
      const result = await run({ ...selection, hsl_invert: invert, hsl_saturation: -100 }, blocks)
      for (let i = 0; i < 64; i++) {
        if ((i < 32) !== invert) { expect(result[i * 4]).toBeCloseTo(result[i * 4 + 1], 3); expect(result[i * 4 + 1]).toBeCloseTo(result[i * 4 + 2], 3) }
        else expect(result.slice(i * 4, i * 4 + 4)).toEqual(baseline.slice(i * 4, i * 4 + 4))
        expect(result[i * 4 + 3]).toBe(1)
      }
    }
  })
  it('联合饱和度/亮度区间，显示蒙版为灰度且不经晕影，关闭恢复', async () => {
    const pixels = Array.from({ length: 64 }, (_, i) => i < 16 ? [1, 0, 0, 1] : i < 32 ? [.3, .2, .2, 1] : i < 48 ? [.1, 0, 0, 1] : [0, 0, 1, 1]).flat()
    const params = { ...selection, hsl_saturation_start: 50, hsl_luminance_start: 20 }
    const result = await run({ ...params, hsl_show_mask: true, vignette_amount: -100 }, pixels)
    for (let i = 0; i < 64; i++) expect(result.slice(i * 4, i * 4 + 4)).toEqual([i < 16 ? 1 : 0, i < 16 ? 1 : 0, i < 16 ? 1 : 0, 1])
    expect(await run({ ...params, hsl_show_mask: false }, pixels)).toEqual(await run({}, pixels))
  })
  it('色相羽化越过边界平滑下降且周期接缝连续', async () => {
    const huePixel = (h: number): number[] => h >= 0 ? [1, h / 60, 0, 1] : [1, 0, -h / 60, 1]
    const pixels = Array.from({ length: 64 }, (_, i) => huePixel([20, 30, 40, -10, 10][i % 5])).flat()
    const result = await run({ ...selection, hsl_hue_feather: 100 / 9, hsl_show_mask: true }, pixels)
    expect(result[0]).toBeCloseTo(1, 2); expect(result[4]).toBeCloseTo(.5, 2); expect(result[8]).toBeCloseTo(0, 2)
    expect(result[12]).toBe(1); expect(result[16]).toBe(1)
    for (let i = 0; i < 64; i++) { expect(result[i * 4]).toBe(result[i * 4 + 1]); expect(result[i * 4 + 1]).toBe(result[i * 4 + 2]) }
  })
  it('键控去噪/模糊复用高斯，二维孤立选区边缘被平滑', async () => {
    const pixels = Array.from({ length: 64 * 64 }, (_, i) => i === 32 * 64 + 32 ? [1, 0, 0, 1] : [0, 0, 1, 1]).flat()
    const cleanups: VideoEditBuiltinParams[] = [{ hsl_denoise: 100 }, { hsl_blur: 100 }]
    for (const cleanup of cleanups) {
      const mask = await run({ ...selection, ...cleanup, hsl_show_mask: true }, pixels, 64, 64)
      expect(mask[(32 * 64 + 32) * 4]).toBeGreaterThan(0); expect(mask[(32 * 64 + 32) * 4]).toBeLessThan(1)
      expect(mask[(32 * 64 + 33) * 4]).toBeGreaterThan(0)
    }
  })
  it('中性二级参数逐像素等于关闭；透明预乘颜色、色轮、白平衡与局部锐化组合有效', async () => {
    const pixels = Array.from({ length: 64 }, (_, i) => [i / 128, .1, .05, .5]).flat()
    expect(await run({ ...selection, hsl_denoise: 100, hsl_blur: 100, hsl_invert: true, hsl_grade_hue: 240 }, pixels)).toEqual(await run({}, pixels))
    const gains = colorGradeWhiteBalance(25, -15)
    near(await run({ hsl_temperature: 25, hsl_tint: -15 }, [.2, .2, .2, .5]), [...gains.map(g => colorGradeSrgb(colorGradeLinear(.4) * g) * .5), .5])
    const mixed = await run({ ...selection, hsl_sharpen: 50, hsl_grade_hue: 240, hsl_grade_strength: 30, hsl_grade_luminance: 10, hsl_contrast: 10 }, blocks)
    expect(mixed.every(Number.isFinite)).toBe(true)
    expect(mixed.slice(32 * 4)).toEqual((await run({}, blocks)).slice(32 * 4))
    const result = await run({ hsl_grade_strength: 20, hsl_grade_luminance: 15 }, [.2, .2, .2, .5])
    expect(result.filter((_, i) => i % 4 === 3).every(a => a === .5)).toBe(true)
  })
})

it('自由样条曲线LUT匹配求值，1024梯度保持高精度', async () => {
  const points = [{ x: 0, y: 0 }, { x: 12, y: 4 }, { x: 48, y: 70 }, { x: 100, y: 100 }]; const evaluate = colorGradeSpline(points)
  const pixels = Array.from({ length: 1024 }, (_, i) => [i / 1023, i / 1023, i / 1023, 1]).flat()
  const result = await run({ curve_master_points: encodeColorGradeCurve(points) }, pixels, 1024)
  result.forEach((value, i) => { if (i % 4 !== 3) expect(value).toBeCloseTo(evaluate(videoEditHalfToFloat(half(pixels[i])) * 100) / 100, 2) })
  expect(new Set(result.filter((_, i) => i % 4 === 0)).size).toBeGreaterThan(900)
})
it('色相三曲线已知像素及红色周期接缝；灰色不被染色', async () => {
  const constant = (y: number): string => encodeColorGradeCurve([{ x: 0, y }, { x: 100, y }])
  near(await run({ curve_hue_sat_points: constant(0) }, [1, 0, 0, 1]), [.5, .5, .5, 1])
  near(await run({ curve_hue_hue_points: constant(50 + 100 / 6) }, [1, 0, 0, 1]), [1, 1, 0, 1])
  near(await run({ curve_hue_luma_points: constant(75) }, [.5, 0, 0, 1]), [1, 0, 0, 1])
  near(await run({ curve_hue_hue_points: constant(100), curve_hue_luma_points: constant(75) }, [.4, .4, .4, 1]), [.4, .4, .4, 1])
})
it('1D/3D LUT恒等、反相、域归一化、强度与透明度；65³纹理', async () => {
  const add = (id: string, text: string): void => { lutFixtures.set(id, text); assets.push({ id, path: `/luts/${id}.cube`, name: id, contentIdentity: 'a'.repeat(64) }) }
  const rows = (inverse: boolean): string => Array.from({ length: 8 }, (_, i) => [i % 2, Math.floor(i / 2) % 2, Math.floor(i / 4)].map(x => inverse ? 1 - x : x).join(' ')).join('\n')
  add('identity', `LUT_3D_SIZE 2\n${rows(false)}`); add('inverse', `LUT_3D_SIZE 2\n${rows(true)}`)
  add('one', 'LUT_1D_SIZE 2\nDOMAIN_MIN -1 -1 -1\nDOMAIN_MAX 1 1 1\n0 0 0\n1 1 1')
  near(await run({ input_lut: 'identity' }, [.2, .4, .8, 1]), [.2, .4, .8, 1])
  near(await run({ look_lut: 'inverse' }, [.1, .2, .4, .5]), [.4, .3, .1, .5])
  near(await run({ look_lut: 'inverse', look_lut_strength: 50 }, [.2, .4, .8, 1]), [.5, .5, .5, 1])
  near(await run({ input_lut: 'one' }, [0, .5, 1, 1]), [.5, .75, 1, 1])
  add('large', `LUT_3D_SIZE 65\n${Array.from({ length: 65 ** 3 }, (_, i) => [i % 65 / 64, Math.floor(i / 65) % 65 / 64, Math.floor(i / 65 ** 2) / 64].join(' ')).join('\n')}`)
  near(await run({ input_lut: 'large' }, [.2, .4, .8, 1]), [.2, .4, .8, 1])
})

it('统计匹配建议经正式GPU曲线后收敛；1D大表跨纹理行精确插值', async () => {
  const source = Array.from({ length: 64 }, (_, i) => { const x = .3 + i / 63 * .3; return [x, x * .8, x * 1.1, 1] }).flat()
  const reference = Array.from({ length: 64 }, (_, i) => { const x = .2 + i / 63 * .6; return [x, x, x, 1] }).flat()
  const result = await run(suggestColorGradeMatch(source, reference, 'moments', 1), source)
  const error = (pixels: number[]): number => pixels.reduce((sum, value, i) => sum + (i % 4 === 3 ? 0 : (value - reference[i]) ** 2), 0)
  expect(error(result)).toBeLessThan(error(source) * .02)
  const id = 'one-large'; lutFixtures.set(id, `LUT_1D_SIZE 2048\n${Array.from({ length: 2048 }, (_, i) => { const x = i / 2047; return `${x} ${1 - x} ${x * x}` }).join('\n')}`); assets.push({ id, path: '/luts/one-large.cube', name: id, contentIdentity: 'b'.repeat(64) })
  near(await run({ input_lut: id }, [.25, .75, .5, 1]), [.25, .25, .25, 1])
})
