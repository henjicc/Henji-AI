import { describe, expect, it } from 'vitest'

import { createDefaultDiffusionOperationParams } from '@/core/imageEdit/diffusionParams'
import { createDefaultVgpuGlowOperationParams } from '@/core/imageEdit/vgpuGlowParams'
import type { ImageEditRenderPlan, ImageEditRenderPlanNode } from '@/core/imageEdit/v3'
import {
  createImageEditorGpuExportPlanV3,
  imageEditorGpuScatterSupportV3,
  resolveImageEditorGpuExportHaloV3,
} from './gpuExportPlanV3'

function node(definitionId: string, parameters: Readonly<Record<string, unknown>>): ImageEditRenderPlanNode {
  return {
    id: definitionId, layerId: definitionId, layerPath: [definitionId], definitionId,
    definitionVersion: 4, category: 'local', inputNodeIds: [], parameters,
    mask: null, subtreeHash: definitionId,
  }
}

function plan(nodes: readonly ImageEditRenderPlanNode[]): ImageEditRenderPlan {
  return {
    documentId: 'export-plan', revision: 1, quality: 'export',
    color: { workingSpace: 'srgb', bitDepth: 8, transferFunction: 'srgb',
      hdrMetadata: null, iccProfileResourceId: null },
    geometry: { width: 8192, height: 4096, crop: null,
      orientation: { rotate: 0, mirrored: false } },
    nodes, passes: [], outputNodeId: null, outputHash: 'plan',
    layerEvaluationOrder: [], diagnostics: [],
  }
}

describe('GPU 分块导出 support 规划', () => {
  it('按正式WGSL downsample/upsample采样链计算有限support', () => {
    expect(imageEditorGpuScatterSupportV3(2, 1)).toBe(3)
    expect(imageEditorGpuScatterSupportV3(4, 1)).toBe(12)
    expect(imageEditorGpuScatterSupportV3(4, 2)).toBe(15)
    expect(imageEditorGpuScatterSupportV3(4096, 2)).toBe(22_521)
  })

  it('最大合法 diffusion/glow 参数仍生成完整core覆盖且halo在文档边缘裁切', () => {
    const diffusion = { ...createDefaultDiffusionOperationParams(), mode: 'glow' as const,
      strength: 1, glowRange: 1, softness: 1 }
    const glow = { ...createDefaultVgpuGlowOperationParams(), intensity: 1, radius: 1,
      chromaticAberration: 1 }
    const renderPlan = plan([
      node('effect.diffusion', diffusion),
      node('effect.vgpu-glow', glow),
    ])
    const halo = resolveImageEditorGpuExportHaloV3(renderPlan, 8192, 4096)
    const output = createImageEditorGpuExportPlanV3({
      plan: renderPlan, width: 8192, height: 4096, tileSize: 512,
    })
    expect(output.halo).toBe(halo)
    expect(halo).toBeGreaterThan(4096)
    expect(output.tiles).toHaveLength(16 * 8)
    expect(output.multiscaleAnalysis).toEqual({ width: 2048, height: 1024, localHalo: 256 })
    for (const tile of output.tiles) {
      expect(tile.coreOffsetX + tile.width).toBeLessThanOrEqual(tile.renderWidth)
      expect(tile.coreOffsetY + tile.height).toBeLessThanOrEqual(tile.renderHeight)
    }
    expect(Math.max(...output.tiles.map((tile) => tile.renderWidth))).toBe(1024)
    expect(Math.max(...output.tiles.map((tile) => tile.renderHeight))).toBe(1024)
  })

  it('顺序效果support相加，避免前级邻域传播被后级截断', () => {
    const one = plan([node('effect.fast-blur', { radius: 64, mip: 0 })])
    const two = plan([
      node('effect.fast-blur', { radius: 64, mip: 0 }),
      node('effect.fast-blur', { radius: 64, mip: 0 }),
    ])
    expect(resolveImageEditorGpuExportHaloV3(two, 1024, 1024))
      .toBe(resolveImageEditorGpuExportHaloV3(one, 1024, 1024) * 2)
  })
})
