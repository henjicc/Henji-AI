import { authorEffectBleed, resolveAuthorEffects } from '@/core/videoEdit/authorEffects'
import { describe, expect, it } from 'vitest'
import { isShaderGraphEffect } from '@/core/videoEdit/shaderGraph/effects'
import { isShaderGraphTransition } from '@/core/videoEdit/shaderGraph/transitions'
import { isGlTransition } from '@/core/videoEdit/glTransitions/transitions'
import { RECORDING_FRAME_SOLID_DEFAULT_HEX, VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX, WHITE_HEX } from '@/core/theme/colorTokens'
import { VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS, videoEditBuiltinDefaults } from '@/core/videoEdit/builtinEffects'
import { planVideoEditBuiltinEffect, planVideoEditBuiltinTransition, videoEditGrainSeed, type VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'
import { resolveVideoEditTransitionParams, VIDEO_EDIT_BUILTIN_TRANSITION_KINDS } from '@/core/videoEdit/transitionParams'
import { VIDEO_EDIT_BUILTIN_EFFECT_ENTRIES, VIDEO_EDIT_BUILTIN_EFFECT_SHADER } from './videoEditBuiltinEffectShaders'
import { recordingZoomDraw } from './videoEditRecordingZoomPlan'
import { blurLineLength, blurRangeLevelSigma, blurSigma, blurSpinAngle } from '@/core/videoEdit/blur'

const plan = (id: string, params: Record<string, unknown>, width = 1920, height = 1080, frame = 0): VideoEditBuiltinPlan => planVideoEditBuiltinEffect({ id, params: params as Record<string, number> }, { width, height, frame })
/** 一道工序的全尺寸像素 sigma：降采样倍数 × 低分辨率 sigma。 */
function blurSigmas(result: VideoEditBuiltinPlan): number[] {
  return result.passes.filter(pass => pass.entry === 'gaussian_blur').map(pass => pass.uniforms[6] * result.width / pass.uniforms[2])
}

describe('内置效果工序与参数打包', () => {
  it('每个效果按默认参数都能规划：最后一道写输出，入口都在着色器里，参数是 16 个 float（带局部坐标的 24 个）、开头是目标与输入尺寸', () => {
    // shaders.* 组件效果走着色器图（shaderEngines），不经这里的工序规划。
    for (const definition of VIDEO_EDIT_BUILTIN_EFFECTS_DEFINITIONS.filter(value => value.media !== 'audio' && !isShaderGraphEffect(value.id))) {
      const result = plan(definition.id, videoEditBuiltinDefaults(definition))
      expect(result.passes.at(-1)!.target, definition.id).toBe('output')
      for (const pass of result.passes) {
        expect(VIDEO_EDIT_BUILTIN_EFFECT_ENTRIES).toContain(pass.entry)
        expect(VIDEO_EDIT_BUILTIN_EFFECT_SHADER).toContain(`@fragment fn ${pass.entry}(`)
        expect([16, 24]).toContain(pass.uniforms.length)
        expect(pass.uniforms.every(Number.isFinite)).toBe(true)
        const target = typeof pass.target === 'number' ? result.scratch[pass.target] : result
        expect([pass.uniforms[0], pass.uniforms[1]]).toEqual([target.width, target.height])
        // 工序只读已经写过的中间纹理
        if (typeof pass.source === 'number') expect(result.passes.indexOf(pass)).toBeGreaterThan(result.passes.findIndex(value => value.target === pass.source))
      }
    }
  })
  it('均匀模糊按画面高度换算：不同渲染尺寸下相对模糊量相同；大半径先降采样，每道取样数有上限', () => {
    const full = plan('blur', { amount: 79.67 }); const quarter = plan('blur', { amount: 79.67 }, 480, 270)
    expect(full.passes.filter(pass => pass.entry === 'gaussian_resample').length).toBeGreaterThan(2)
    expect(full.passes.filter(pass => pass.entry === 'gaussian_blur').every(pass => pass.uniforms[7] <= 10)).toBe(true)
    // 低分辨率工序里的 sigma × 降采样倍数，加上降采样本身的模糊，约等于要求的全尺寸 sigma（画面高度的 3%）
    expect(Math.max(...blurSigmas(full))).toBeLessThan(0.03 * 1080)
    expect(Math.abs(Math.max(...blurSigmas(full)) / 1080 / (Math.max(...blurSigmas(quarter)) / 270) - 1)).toBeLessThan(.05)
    // 小半径不降采样，横竖两道直接写输出
    const light = plan('blur', { amount: 9.53 })
    expect(light.passes.map(pass => pass.entry)).toEqual(['gaussian_linear', 'gaussian_blur', 'gaussian_blur', 'gaussian_encoded'])
    expect(light.passes[1].uniforms.slice(4, 6)).toEqual(new Float32Array([1, 0]))
    expect(light.passes[2].uniforms.slice(4, 6)).toEqual(new Float32Array([0, 1]))
    // 只模糊水平方向时垂直方向不降采样
    const horizontal = plan('blur', { amount: 79.67, axis: 'horizontal' })
    expect(horizontal.scratch.every(size => size.height === 1080)).toBe(true)
    expect(horizontal.passes.filter(pass => pass.entry === 'gaussian_blur').every(pass => pass.uniforms[5] === 0)).toBe(true)
    expect(plan('blur', { amount: 0.0 }).passes.map(pass => pass.entry)).toEqual(['copy'])
    expect(plan('blur', { amount: 40, repeat_edges: false }).passes.find(pass => pass.entry === 'gaussian_blur')!.uniforms[8]).toBe(0)
  })
  it('颜色与风格化参数换算：黑白一道，色度抠像传入色度坐标，马赛克块按画面高度', () => {
    expect(plan('black_white', {}).passes.map(pass => pass.entry)).toEqual(['black_white'])
    const key = plan('chroma_key', { key_color: VIDEO_EDIT_CHROMA_KEY_DEFAULT_HEX, tolerance: 30, softness: 10, spill: 50 }).passes[0].uniforms
    expect(key[4]).toBeLessThan(0); expect(key[5]).toBeLessThan(0); expect(key[8]).toBeCloseTo(.5)
    const mosaic = plan('mosaic', { block_size: 30 }).passes[0].uniforms
    expect(mosaic[4] * 1920).toBeCloseTo(0.03 * 1080); expect(mosaic[5] * 1080).toBeCloseTo(0.03 * 1080)
    const crop = plan('crop', { left: 10, top: 12, right: 0, bottom: 12, feather: 0 }).passes[0].uniforms
    expect([...crop.slice(4, 8)].map(value => Math.round(value * 100) / 100)).toEqual([.1, .12, 1, .88])
    expect(plan('flip', { axis: 'vertical' }).passes[0].uniforms.slice(4, 6)).toEqual(new Float32Array([0, 1]))
  })
  it('胶片颗粒的种子只由帧号决定：同一帧预览与导出相同，相邻帧不同', () => {
    expect(plan('film_grain', {}, 1920, 1080, 42).passes[0].uniforms[6]).toBe(videoEditGrainSeed(42))
    expect(videoEditGrainSeed(42)).toBe(videoEditGrainSeed(42)); expect(videoEditGrainSeed(42)).not.toBe(videoEditGrainSeed(43))
  })
  it('回放分辨率（4.9）：颗粒不能细于一个像素，降低分辨率时幅度按每个像素覆盖的颗粒数减弱；完整分辨率不变', () => {
    const grain = (height: number, renderScale?: number, size = 30) => planVideoEditBuiltinEffect({ id: 'film_grain', params: { amount: 40, size } }, { width: Math.round(height * 16 / 9), height, frame: 0, renderScale }).passes[0].uniforms
    const full = grain(1080); const same = grain(1080, 1)
    expect(same[4]).toBe(full[4])
    // 1080 下 30 号颗粒约 1.7 像素；1/4 时一个像素盖 4×4 个序列像素，约 2.3×2.3 个颗粒 → 幅度约为 1/2.3
    const quarter = grain(270, 0.25)
    expect(quarter[5]).toBeCloseTo(full[5] / 4)
    expect(quarter[4] / full[4]).toBeCloseTo(0.25 * full[5], 3)
    // 粗颗粒（一颗大于缩小后的一个像素）在 1/2 下幅度不变
    expect(grain(540, 0.5, 100)[4]).toBeCloseTo(grain(1080, 1, 100)[4])
  })
  it('视频过渡（4.7）：每种过渡在任意进度都能规划，入口都在着色器里；羽化按画面高度换算；单侧标记写进参数', () => {
    for (const kind of VIDEO_EDIT_BUILTIN_TRANSITION_KINDS.filter(value => !isShaderGraphTransition(value) && !isGlTransition(value))) {
      for (const progress of [0, 0.3, 1]) {
        const result = planVideoEditBuiltinTransition({ kind, params: resolveVideoEditTransitionParams(kind, {}), progress }, { width: 1920, height: 1080 })
        expect(result.passes.at(-1)!.target, kind).toBe('output')
        for (const pass of result.passes) {
          expect(VIDEO_EDIT_BUILTIN_EFFECT_SHADER).toContain(`@fragment fn ${pass.entry}(`)
          expect(pass.uniforms.every(Number.isFinite)).toBe(true)
        }
      }
    }
    const wipe = (height: number) => planVideoEditBuiltinTransition({ kind: 'wipe', params: resolveVideoEditTransitionParams('wipe', { feather: 50 }), progress: 0.5, emptyIncoming: true }, { width: height * 2, height }).passes[0].uniforms
    expect(wipe(1080)[6] / 1080).toBeCloseTo(wipe(540)[6] / 540)
    expect(wipe(1080)[6]).toBeCloseTo(0.1 * 1080)
    expect([...wipe(1080).slice(12, 15)]).toEqual([0.5, 0, 1])
    expect(() => planVideoEditBuiltinTransition({ kind: 'wipe', params: {}, progress: 2 }, { width: 4, height: 4 })).toThrow('进度')
  })
})

describe('录屏自动缩放与画框工序', () => {
  it('自动缩放：没有放大时直接复制；放大时一道双三次取样，取样仿射把视野放大到片段范围', () => {
    expect(planVideoEditBuiltinEffect({ id: 'recording_zoom', params: {} }, { width: 1920, height: 1080, frame: 0 }).passes.map(pass => pass.entry)).toEqual(['copy'])
    const clip = { x: 0, y: 0, scale: 1, rotation: 0, anchorX: 0.5, anchorY: 0.5, kind: 'video' as const, itemId: 'item' }
    const document = { width: 1920, height: 1080, media: [{ id: 'm', width: 1920, height: 1080 }], items: [{ id: 'item', mediaId: 'm' }], sequences: [] } as unknown as Parameters<typeof recordingZoomDraw>[2]
    const draw = recordingZoomDraw({ scale: 2, centerX: 0.75, centerY: 0.25 }, clip as unknown as Parameters<typeof recordingZoomDraw>[1], document)!
    const result = planVideoEditBuiltinEffect({ id: 'recording_zoom', params: {}, zoom: draw }, { width: 1920, height: 1080, frame: 0 })
    expect(result.passes.map(pass => pass.entry)).toEqual(['recording_zoom'])
    const u = result.passes[0].uniforms
    // 取样 = 倍数 × 输出 + 平移：输出左上角取样视野左上角（0.5, 0），输出中心取样视野中心；不模糊时取样 1 次
    expect(u[4]).toBeCloseTo(0.5); expect(u[5]).toBeCloseTo(0.5); expect(u[6]).toBeCloseTo(0)
    expect(u[4] * 0.5 + u[5]).toBeCloseTo(0.75); expect(u[4] * 0.5 + u[6]).toBeCloseTo(0.25); expect(u[2]).toBe(1)
    expect(recordingZoomDraw({ scale: 1, centerX: 0.5, centerY: 0.5 }, clip as unknown as Parameters<typeof recordingZoomDraw>[1], document)).toBeUndefined()
    // 运动模糊：快门内视野不动时不模糊；平移了才按画面移动的像素数取样
    const view = { scale: 2, centerX: 0.75, centerY: 0.25 }
    expect(recordingZoomDraw(view, clip as unknown as Parameters<typeof recordingZoomDraw>[1], document, { zoom: view, maxSamples: 16 })!.shutter).toBeUndefined()
    const moving = recordingZoomDraw(view, clip as unknown as Parameters<typeof recordingZoomDraw>[1], document, { zoom: { ...view, centerX: 0.749 }, maxSamples: 16 })!
    // 视野中心移动 0.001 → 2 倍下画面移动 0.002 × 1920 ≈ 3.8 像素 → 3 次取样
    expect(moving.shutter?.samples).toBe(3)
    expect(recordingZoomDraw(view, clip as unknown as Parameters<typeof recordingZoomDraw>[1], document, { zoom: { ...view, centerX: 0.6 }, maxSamples: 8 })!.shutter?.samples).toBe(8)
  })
  it('录屏画框：内容按边距等比缩小居中，投影走高斯模糊，最后合成不透明背景；纯色背景用指定颜色', () => {
    const result = planVideoEditBuiltinEffect({ id: 'recording_frame', params: { padding: 10, radius: 2, shadow: 50 } }, { width: 1920, height: 1080, frame: 0 })
    expect(result.passes[0].entry).toBe('recording_frame_content')
    expect(result.passes.at(-1)!.entry).toBe('recording_frame_compose')
    expect(result.passes.some(pass => pass.entry === 'blur')).toBe(true)
    const content = result.passes[0].uniforms
    // 上下各留 10% 画面高度，宽度按比例缩小同样倍数
    expect(content[5]).toBeCloseTo(0.1); expect(content[7]).toBeCloseTo(0.9); expect(content[6] - content[4]).toBeCloseTo(0.8)
    expect(content[12]).toBeCloseTo(0.02 * 1080)
    const flat = planVideoEditBuiltinEffect({ id: 'recording_frame', params: { background: 'solid', color: RECORDING_FRAME_SOLID_DEFAULT_HEX, shadow: 0 }, frameContent: [0.25, 0, 0.75, 1] }, { width: 1920, height: 1080, frame: 0 })
    expect(flat.passes.map(pass => pass.entry)).toEqual(['recording_frame_content', 'recording_frame_compose'])
    expect([...flat.passes[1].uniforms.slice(4, 7)].map(v => Math.round(v * 255))).toEqual([1, 3, 5].map(index => parseInt(RECORDING_FRAME_SOLID_DEFAULT_HEX.slice(index, index + 2), 16)))
    expect([...flat.passes[0].uniforms.slice(8, 12)]).toEqual([0.25, 0, 0.75, 1])
  })
})

it('小 bounds 用完整参考高度换算，外扩只移动原点；邻域链累加支撑', () => {
  const base = { referenceSize: { width: 1920, height: 1080 }, contentBounds: { x: 500, y: 300, width: 80, height: 30 }, rasterScale: 1, rasterOrigin: [64, 64] as const, quality: 'final' as const }
  const gaussian = resolveAuthorEffects([{ id: 'blur', params: { amount: 42.9 } }])
  const direction = resolveAuthorEffects([{ id: 'blur', params: { mode: 'directional', amount: 30, angle: 0 } }])
  expect(authorEffectBleed([...gaussian, ...direction], base)).toBeCloseTo(authorEffectBleed(gaussian, base) + authorEffectBleed(direction, base))
  expect(authorEffectBleed(gaussian, base) * 1080).toBeGreaterThan(3 * .01 * 1080)
  const length = blurLineLength(30) * 1080
  for (const scale of [.25, 1, 2]) for (const pad of [32, 128]) {
    const width = 80 * scale + pad * 2, height = Math.ceil(30 * scale) + pad * 2, layer = { ...base, rasterScale: scale, rasterOrigin: [pad, pad] as const }
    const directional = planVideoEditBuiltinEffect(direction[0], { width, height, frame: 0, layer })
    // 两道直线取样的总位移按参考 H 缩放，不依赖纹理 padding。
    expect(directional.passes[0].uniforms[4] * width).toBeCloseTo(length * scale / 16)
    const zoom = planVideoEditBuiltinEffect({ id: 'blur', params: { mode: 'radial', amount: 60, center_x: 25, center_y: 75 } }, { width, height, frame: 0, layer })
    expect(zoom.passes[0].uniforms[4] * width - pad).toBeCloseTo(20 * scale, 4)
    expect(zoom.passes[0].uniforms[5] * height - pad).toBeCloseTo(22.5 * scale, 4)
  }
})

it('模糊四种方式：同一个模糊度换算成相近的方差，放射按道迭代到最细间距不到一个像素，镜头大半径先降采样', () => {
  const sigma = blurSigma(60) * 1080
  // 直线长度 √12·σ、圆盘半径 2σ 时方差与高斯相同。
  const line = plan('blur', { mode: 'directional', amount: 60, angle: 90 })
  expect(line.passes.map(pass => pass.entry)).toEqual(['blur_line', 'blur_line'])
  expect(line.passes[0].uniforms[5] * 1080 * 16).toBeCloseTo(Math.sqrt(12) * sigma, 3)
  // 拖影很长时多加道数，最细一道的间距不到一个像素。
  const long = plan('blur', { mode: 'directional', amount: 200, angle: 90 })
  expect(long.passes.length).toBeGreaterThan(2); expect(long.passes.at(-1)!.uniforms[5] * 1080).toBeLessThan(1)
  const lens = plan('blur', { mode: 'lens', amount: 60, highlights: 100 })
  expect(lens.passes.at(-1)!.entry).toBe('blur_lens'); expect(lens.passes.at(-1)!.uniforms[4]).toBeCloseTo(2 * sigma, 3); expect(lens.passes.at(-1)!.uniforms[5]).toBe(4)
  expect(lens.passes.slice(0, -1).every(pass => pass.entry === 'copy')).toBe(true); expect(lens.scratch.length).toBeGreaterThan(0)
  expect(plan('blur', { mode: 'lens', amount: 5 }).passes.map(pass => pass.entry)).toEqual(['blur_lens'])
  for (const amount of [10, 60, 150]) {
    const radial = plan('blur', { mode: 'radial', amount, center_x: 0, center_y: 0 })
    const steps = radial.passes.map(pass => pass.uniforms[6])
    // 每道间距是上一道的 1/16；最细一道在最远的角上间距不到一个像素。
    expect(steps.every((step, index) => index === 0 || Math.abs(step * 16 / steps[index - 1] - 1) < 1e-5)).toBe(true)
    expect(steps.at(-1)! * Math.hypot(1920, 1080)).toBeLessThan(1)
  }
  expect(plan('blur', { mode: 'radial', amount: 0 }).passes.map(pass => pass.entry)).toEqual(['copy'])
})

it('模糊旋转首道取满转角、迭代到最远角弧步不到一个像素；范围金字塔最粗一层盖住最糊处，模糊度 0 只复制', () => {
  const spin = plan('blur', { mode: 'spin', amount: 40 })
  const steps = spin.passes.map(pass => pass.uniforms[6])
  expect(spin.passes.every(pass => pass.entry === 'blur_spin')).toBe(true)
  expect(steps[0] * 16).toBeCloseTo(blurSpinAngle(40), 6)
  expect(steps.every((step, index) => index === 0 || Math.abs(step * 16 / steps[index - 1] - 1) < 1e-5)).toBe(true)
  expect(steps.at(-1)! * Math.hypot(960, 540)).toBeLessThan(1)
  const sigma = blurSigma(100) * 1080
  const ranged = plan('blur', { range: 'tilt', amount: 100 })
  const levels = ranged.passes.filter(pass => pass.entry === 'blur_range_down').length
  expect(blurRangeLevelSigma(levels)).toBeGreaterThanOrEqual(sigma); expect(blurRangeLevelSigma(levels - 1)).toBeLessThan(sigma)
  expect(ranged.passes.at(-1)!.entry).toBe('blur_range_finish')
  for (const pass of [...ranged.passes, ...plan('blur', { mode: 'lens', range: 'tilt', amount: 100 }).passes]) expect([16, 24], pass.entry).toContain(pass.uniforms.length)
  // 图层上位置锚在内容框里，距离按完整画幅高度换算，与纹理外扩无关。
  const layer = { referenceSize: { width: 1920, height: 1080 }, contentBounds: { x: 500, y: 300, width: 80, height: 30 }, rasterScale: 2, rasterOrigin: [64, 32] as const, quality: 'final' as const }
  const anchored = planVideoEditBuiltinEffect({ id: 'blur', params: { range: 'progressive', range_x: 25, range_y: 100 } }, { width: 288, height: 124, frame: 0, layer }).passes.at(-1)!.uniforms
  expect([anchored[8] * 2160, anchored[9] * 2160]).toEqual([expect.closeTo(64 + 40, 3), expect.closeTo(32 + 60, 3)])
  for (const params of [{ range: 'tilt', amount: 0 }, { mode: 'lens', range: 'progressive', amount: 0 }, { mode: 'spin', amount: 0 }]) expect(plan('blur', params).passes.map(pass => pass.entry)).toEqual(['copy'])
})

it('锐化按半径换算模糊、带阈值；暗角带颜色', () => {
  const sharpen = plan('sharpen', { amount: 60, radius: 50, threshold: 20 })
  expect(sharpen.passes.at(-1)!.entry).toBe('unsharp')
  expect([...sharpen.passes.at(-1)!.uniforms.slice(4, 6)].map(value => Math.round(value * 1000) / 1000)).toEqual([1.8, 0.05])
  const vignette = plan('vignette', { amount: 50, color: WHITE_HEX }).passes[0].uniforms
  expect([...vignette.slice(8, 11)]).toEqual([1, 1, 1])
})
