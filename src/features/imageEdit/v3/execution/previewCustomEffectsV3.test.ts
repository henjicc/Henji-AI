import { describe, expect, it } from 'vitest'

import { createDefaultImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import {
  ImageEditorPreviewCustomEffectsV3,
  ImageEditorPreviewUnsupportedEffectErrorV3,
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
    parameters: {},
    mask: null,
    subtreeHash: 'effect-hash',
  }
}

describe('ImageEditor V3 现有效果 Worker 边界', () => {
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
        hdrMetadata: { standard: 'pq' as const },
      }
      const promise = effects.execute(node(definitionId), source, 'stable', color)
      await expect(promise).rejects.toBeInstanceOf(ImageEditorPreviewUnsupportedEffectErrorV3)
      await expect(promise).rejects.toThrow('HDR Worker 执行链')
      effects.dispose()
    },
  )
})
