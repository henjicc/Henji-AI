import { describe, expect, it } from 'vitest'

import {
  createDefaultImageEditColorModeV3,
  createImageEditHdrMetadataV3,
} from '@/core/imageEdit/v3/colorTypes'
import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import {
  ImageEditorPreviewCustomEffectsV3,
  ImageEditorPreviewUnsupportedEffectErrorV3,
  isPlausibleVgpuGlowPreviewV3,
} from './previewCustomEffectsV3'

function node(definitionId: 'effect.diffusion' | 'effect.vgpu-glow'): ImageEditRenderPlanNode {
  return {
    id: 'node',
    layerId: 'effect',
    layerPath: ['effect'],
    definitionId,
    definitionVersion: 4,
    category: definitionId === 'effect.diffusion' ? 'local' : 'global-analysis',
    inputNodeIds: ['source'],
    parameters: definitionId === 'effect.diffusion'
      ? { ...createDefaultDiffusionOperationParams() }
      : {},
    mask: null,
    subtreeHash: 'effect-hash',
  }
}

describe('ImageEditor V3 现有效果 Worker 边界', () => {
  it('拒绝把非黑源的辉光结果替换成 GPU 暗帧', () => {
    const source = createFloat32PremultipliedRgbaTile(
      2, 1, 'linear-light', new Float32Array([0.8, 0.6, 0.4, 1, 0.2, 0.1, 0.05, 1]),
    )
    const darkFrame = createFloat32PremultipliedRgbaTile(
      2, 1, 'linear-light', new Float32Array(8),
    )
    expect(isPlausibleVgpuGlowPreviewV3(source, darkFrame)).toBe(false)
    expect(isPlausibleVgpuGlowPreviewV3(source, source)).toBe(true)
  })

  it('WebGPU 不可用时柔光使用同参数的 Float32 CPU 参考实现', async () => {
    const effects = new ImageEditorPreviewCustomEffectsV3()
    const source = createFloat32PremultipliedRgbaTile(
      2,
      1,
      'linear-light',
      new Float32Array([0.9, 0.8, 0.7, 1, 0.1, 0.1, 0.1, 1]),
    )

    const rendered = await effects.execute(
      node('effect.diffusion'),
      source,
      'draft',
      createDefaultImageEditColorModeV3(),
    )

    expect(rendered).not.toBe(source)
    expect(rendered.data).toHaveLength(source.data.length)
    expect([...rendered.data].every(Number.isFinite)).toBe(true)
    effects.dispose()
  })

  it.each(['effect.diffusion', 'effect.vgpu-glow'] as const)(
    '%s 在 HDR 文档中明确拒绝 8-bit 位图往返',
    async (definitionId) => {
      const effects = new ImageEditorPreviewCustomEffectsV3()
      const source = createFloat32PremultipliedRgbaTile(
        1,
        1,
        'linear-light',
        new Float32Array([2, 1, 0.5, 1]),
        'rec2020',
        'pq',
        203,
      )
      const color = {
        ...createDefaultImageEditColorModeV3(),
        workingSpace: 'rec2020' as const,
        transferFunction: 'pq' as const,
        bitDepth: 'float16' as const,
        hdrMetadata: createImageEditHdrMetadataV3('pq'),
      }
      const promise = effects.execute(node(definitionId), source, 'stable', color)
      await expect(promise).rejects.toBeInstanceOf(ImageEditorPreviewUnsupportedEffectErrorV3)
      await expect(promise).rejects.toThrow('HDR Worker 执行链')
      effects.dispose()
    },
  )
})
