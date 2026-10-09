import { describe, expect, it } from 'vitest'

import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import {
  createImageEditAdjustmentLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3'
import type { ImageEditJsonObjectV3 } from '@/core/imageEdit/v3'
import { createDefaultVgpuGlowOperationParams } from '@/core/imageEdit/vgpuGlowParams'
import { estimateImageEditorGpuGraphResidentBytesV3 } from './imageEditorGpuMemoryBudgetV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import { resolveImageEditorGpuEffectViewportV3 } from './imageEditorGpuEffectViewportV3'
import { planImageEditorGpuGaussianRegionsV3 } from './imageEditorGpuGaussianRegionsV3'
import { planImageEditorGpuRasterTilesV3 } from './imageEditorGpuTilePlannerV3'

describe('GPU RenderGraph 常驻资源预算', () => {
  it('三效果按真实金字塔尺寸与活跃target计费，不把每一级误算成全尺寸', () => {
    const source = `sha256:${'a'.repeat(64)}` as const
    const document = createImageEditDocumentV3({ width: 1_600, height: 1_000 })
    document.layers = [
      createImageEditRasterLayerV3('source', '原图', source),
      createImageEditEffectLayerV3('glow', '辉光', 'image.vgpu-glow',
        json(createDefaultVgpuGlowOperationParams())),
      createImageEditEffectLayerV3('diffusion', '柔光', 'image.diffusion',
        json(createDefaultDiffusionOperationParams())),
      createImageEditEffectLayerV3('blur', '模糊', 'image.fast-blur-v3', { radius: 12 }),
    ]
    const compilation = compileImageEditorGpuRasterSceneV3(document, [{
      resourceRef: source, byteLength: 1_600 * 1_000 * 4, mediaType: 'image/png',
    }])
    expect(compilation.supported).toBe(true)
    if (!compilation.supported) return
    const size = [1_600, 1_000] as const
    const bytes = estimateImageEditorGpuGraphResidentBytesV3(compilation.scene, size)
    const oldFullSizeEstimate = size[0] * size[1] * 92

    expect(bytes).toBeLessThan(oldFullSizeEstimate)
    expect(bytes).toBeLessThan(256 * 1_024 * 1_024)
    expect(bytes).toBeGreaterThan(96 * 1_024 * 1_024)
  })
})

function json(value: unknown): ImageEditJsonObjectV3 {
  return JSON.parse(JSON.stringify(value)) as ImageEditJsonObjectV3
}

it('高斯预算保留完整 halo，并随完整输出网格缩小', () => {
  const source = `sha256:${'b'.repeat(64)}` as const
  const estimate = (radius: number, mip: number): number => {
    const document = createImageEditDocumentV3({ width: 1600, height: 1000 })
    document.layers = [createImageEditRasterLayerV3('source', '源', source), createImageEditEffectLayerV3('blur', '高斯', 'gaussian_blur', { sigma_fraction_height: radius / 1000 })]
    const compiled = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef: source, byteLength: 6400000, mediaType: 'image/png' }])
    if (!compiled.supported) throw new Error(compiled.reason)
    return estimateImageEditorGpuGraphResidentBytesV3(compiled.scene, [Math.ceil(1600 / 2 ** mip), Math.ceil(1000 / 2 ** mip)])
  }
  // 宽核会选择更深金字塔，scratch 不是 sigma 的单调函数；不能再统一截为 120px。
  expect(estimate(240, 0)).not.toBe(estimate(120, 0))
  expect(estimate(240, 1)).toBeLessThan(estimate(120, 0))
})

it('共享调整的边界与 ping-pong target 进入预算；中性不保留额外 target', () => {
  const source = `sha256:${'a'.repeat(64)}` as const
  const document = createImageEditDocumentV3({ width: 1000, height: 800 })
  document.layers = [createImageEditRasterLayerV3('source', '源', source), createImageEditAdjustmentLayerV3('grade', '调整', 'color_grade', {})]
  const estimate = (): number => { const compiled = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef: source, byteLength: 3200000, mediaType: 'image/png' }]); if (!compiled.supported) throw new Error(compiled.reason); return estimateImageEditorGpuGraphResidentBytesV3(compiled.scene, [1000, 800]) }
  const neutral = estimate()
  const layer = document.layers[1]; if (layer.type !== 'adjustment') throw new Error('缺少调整')
  layer.params = { exposure: 1 }
  expect(estimate() - neutral).toBe(5 * 1000 * 800 * 8)
})

it.each(['stable', 'export'] as const)('%s：8K 强高斯的真实局部纹理/halo/mip 预算低于256MiB，不预留整幅纹理', quality => {
  const ref = `sha256:${'c'.repeat(64)}` as const
  const document = createImageEditDocumentV3({ width: 7680, height: 4320 })
  document.layers = [createImageEditRasterLayerV3('source', '源', ref), createImageEditEffectLayerV3('blur', '高斯', 'gaussian_blur', { sigma_fraction_height: .03 })]
  const compiled = compileImageEditorGpuRasterSceneV3(document, [{ resourceRef: ref, byteLength: 7680 * 4320 * 4, mediaType: 'image/png' }], undefined, quality)
  if (!compiled.supported) throw new Error(compiled.reason)
  const layout = { stageWidth: 512, stageHeight: 512, viewportKey: 'budget', viewport: { documentX: 3000, documentY: 2000, width: 512, height: 512, zoom: 1, devicePixelRatio: 1 } }
  const working = resolveImageEditorGpuEffectViewportV3(compiled.scene, layout)
  const bytes = estimateImageEditorGpuGraphResidentBytesV3(compiled.scene, [working.layout.viewport.width, working.layout.viewport.height], planImageEditorGpuGaussianRegionsV3(compiled.scene, layout))
  expect(working.layout.viewport.width).toBeLessThan(2400)
  const tiles = planImageEditorGpuRasterTilesV3(compiled.scene, compiled.scene.layers[0], working.layout).tiles.length
  // atlas 按每页16个514² RGBA8槽分配，不把任意64MiB常量当成源窗口驻留量。
  const atlasBytes = Math.ceil(tiles / 16) * 16 * 514 * 514 * 4
  expect(bytes + 512 * 512 * 8 + atlasBytes).toBeLessThan(256 * 1024 * 1024)
})

it('同一蒙版挂到不同节点按各自的rgba16合成纹理计费', () => {
  const ref = `sha256:${'d'.repeat(64)}` as const, maskRef = `sha256:${'e'.repeat(64)}` as const
  const document = createImageEditDocumentV3({ width: 512, height: 512 })
  const first = createImageEditRasterLayerV3('first', '底图', ref), second = createImageEditRasterLayerV3('second', '前景', ref)
  document.layers = [first, second]
  const estimate = (): number => {
    const compiled = compileImageEditorGpuRasterSceneV3(document, [ref, maskRef].map(resourceRef => ({ resourceRef, byteLength: 512 * 512 * 4, mediaType: 'image/png' })))
    if (!compiled.supported) throw new Error(compiled.reason)
    return estimateImageEditorGpuGraphResidentBytesV3(compiled.scene, [512, 512])
  }
  const before = estimate()
  first.mask = { resourceId: maskRef, inverted: false }
  second.mask = { resourceId: maskRef, inverted: false }
  expect(estimate() - before).toBe(2 * 512 * 512 * 8)
})
