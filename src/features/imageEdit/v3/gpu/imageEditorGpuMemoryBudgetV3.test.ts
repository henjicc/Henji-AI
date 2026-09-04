import { describe, expect, it } from 'vitest'

import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import {
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3'
import type { ImageEditJsonObjectV3 } from '@/core/imageEdit/v3'
import { createDefaultVgpuGlowOperationParams } from '@/core/imageEdit/vgpuGlowParams'
import { estimateImageEditorGpuGraphResidentBytesV3 } from './imageEditorGpuMemoryBudgetV3'
import { compileImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'

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
