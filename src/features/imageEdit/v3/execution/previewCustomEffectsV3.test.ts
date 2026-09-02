import { describe, expect, it } from 'vitest'

import {
  createDefaultImageEditColorModeV3,
  createImageEditHdrMetadataV3,
} from '@/core/imageEdit/v3/colorTypes'
import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import { createDefaultVgpuGlowOperationParams } from '@/core/imageEdit/vgpuGlowParams'
import { createFloat32PremultipliedRgbaTile } from '@/core/imageEdit/v3/effects'
import type { ImageEditRenderPlanNode } from '@/core/imageEdit/v3/renderPlan'
import {
  ImageEditorPreviewCustomEffectsV3,
  isPlausibleVgpuFastBlurPreviewV3,
  isPlausibleVgpuGlowPreviewV3,
} from './previewCustomEffectsV3'

function node(
  definitionId: 'effect.fast-blur' | 'effect.diffusion' | 'effect.vgpu-glow',
): ImageEditRenderPlanNode {
  return {
    id: 'node',
    layerId: 'effect',
    layerPath: ['effect'],
    definitionId,
    definitionVersion: definitionId === 'effect.fast-blur' ? 3 : 4,
    category: definitionId === 'effect.diffusion' ? 'local' : 'global-analysis',
    inputNodeIds: ['source'],
    parameters: definitionId === 'effect.fast-blur'
      ? { radius: 8, mip: 0 }
      : definitionId === 'effect.diffusion'
      ? { ...createDefaultDiffusionOperationParams() }
      : { ...createDefaultVgpuGlowOperationParams() },
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

  it('拒绝把有内容的模糊结果替换成透明或纯黑暗帧', () => {
    const source = createFloat32PremultipliedRgbaTile(
      2, 1, 'linear-light', new Float32Array([0.8, 0.6, 0.4, 1, 0.2, 0.1, 0.05, 1]),
    )
    const transparentDarkFrame = createFloat32PremultipliedRgbaTile(
      2, 1, 'linear-light', new Float32Array(8),
    )
    const opaqueDarkFrame = createFloat32PremultipliedRgbaTile(
      2, 1, 'linear-light', new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
    )
    expect(isPlausibleVgpuFastBlurPreviewV3(source, transparentDarkFrame)).toBe(false)
    expect(isPlausibleVgpuFastBlurPreviewV3(source, opaqueDarkFrame)).toBe(false)
    expect(isPlausibleVgpuFastBlurPreviewV3(source, source)).toBe(true)
  })

  it('模糊半径为零时直接保留原图，不启动 GPU 或 CPU 卷积', async () => {
    const effects = new ImageEditorPreviewCustomEffectsV3()
    const executions: Array<readonly [string, string | undefined]> = []
    const source = createFloat32PremultipliedRgbaTile(
      2, 1, 'linear-light', new Float32Array([0.8, 0.6, 0.4, 1, 0.2, 0.1, 0.05, 1]),
    )
    const zeroNode = {
      ...node('effect.fast-blur'),
      parameters: { radius: 0, mip: 0 },
    }

    const rendered = await effects.execute(
      zeroNode,
      source,
      'draft',
      createDefaultImageEditColorModeV3(),
      undefined,
      (backend, reason) => executions.push([backend, reason]),
    )

    expect(rendered).toBe(source)
    expect(executions).toEqual([['cpu', 'radius-zero-bypass']])
    effects.dispose()
  })

  it('WebGPU 不可用时柔光使用同参数的 Float32 CPU 参考实现', async () => {
    const runtimeStates: string[] = []
    const effects = new ImageEditorPreviewCustomEffectsV3({
      onRuntimeState: (state) => runtimeStates.push(state.status),
    })
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

    expect(runtimeStates).toEqual(['cpu-fallback'])

    expect(rendered).not.toBe(source)
    expect(rendered.data).toHaveLength(source.data.length)
    expect([...rendered.data].every(Number.isFinite)).toBe(true)
    effects.dispose()
  })

  it('WebGPU 不可用时模糊使用固定成本的三方框 CPU 后备', async () => {
    const effects = new ImageEditorPreviewCustomEffectsV3()
    const executions: Array<readonly [string, string | undefined]> = []
    const source = createFloat32PremultipliedRgbaTile(
      5,
      1,
      'linear-light',
      new Float32Array([
        0, 0, 0, 1,
        0, 0, 0, 1,
        1, 1, 1, 1,
        0, 0, 0, 1,
        0, 0, 0, 1,
      ]),
    )
    const rendered = await effects.execute(
      node('effect.fast-blur'),
      source,
      'draft',
      createDefaultImageEditColorModeV3(),
      undefined,
      (backend, reason) => executions.push([backend, reason]),
    )
    expect(rendered.data[8]).toBeLessThan(1)
    expect(rendered.data[0]).toBeGreaterThan(0)
    expect(executions).toEqual([['cpu', 'webgpu-unavailable']])
    effects.dispose()
  })

  it.each(['effect.diffusion', 'effect.vgpu-glow'] as const)(
    '%s 在 HDR 文档中使用 Float32 CPU 后备且不经过 8-bit 位图',
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
      const rendered = await effects.execute(node(definitionId), source, 'stable', color)
      expect(rendered).toMatchObject({ workingSpace: 'rec2020', transferFunction: 'pq' })
      expect([...rendered.data].every(Number.isFinite)).toBe(true)
      effects.dispose()
    },
  )

  it('HDR 文档中的模糊直接使用 Float32 CPU 后备，不进行 8-bit 位图往返', async () => {
    const effects = new ImageEditorPreviewCustomEffectsV3()
    const executions: Array<readonly [string, string | undefined]> = []
    const source = createFloat32PremultipliedRgbaTile(
      2, 1, 'linear-light', new Float32Array([2, 1, 0.5, 1, 0, 0, 0, 1]),
      'rec2020', 'pq', 203,
    )
    const color = {
      ...createDefaultImageEditColorModeV3(),
      workingSpace: 'rec2020' as const,
      transferFunction: 'pq' as const,
      bitDepth: 'float16' as const,
      hdrMetadata: createImageEditHdrMetadataV3('pq'),
    }
    await expect(effects.execute(
      node('effect.fast-blur'),
      source,
      'stable',
      color,
      undefined,
      (backend, reason) => executions.push([backend, reason]),
    )).resolves.toMatchObject({
      workingSpace: 'rec2020',
      transferFunction: 'pq',
    })
    expect(executions).toEqual([['cpu', 'hdr-float-interoperability']])
    effects.dispose()
  })
})
