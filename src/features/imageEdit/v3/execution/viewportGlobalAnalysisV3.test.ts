import { describe, expect, it, vi } from 'vitest'

import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  createFloat32PremultipliedRgbaTile,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
} from '@/core/imageEdit/v3'
import { createDefaultVgpuGlowOperationParams } from '@/core/imageEdit'
import { scaleImageEditorPreviewEffectsV3 } from './previewEffectScalingV3'
import {
  ImageEditorViewportGlobalAnalysisCacheV3,
  resolveImageEditorViewportAnalysisMipV3,
} from './viewportGlobalAnalysisV3'

const registry = createBuiltInImageEditRenderNodeRegistry()

function fastBlurDocument(width = 4, height = 1) {
  const document = createImageEditDocumentV3({
    width,
    height,
    sourceResourceId: `sha256:${'a'.repeat(64)}`,
    idFactory: () => 'source',
  })
  document.layers.push(createImageEditEffectLayerV3(
    'blur', '模糊', 'image.fast-blur-v3', { radius: 40, quality: 'high', mip: 0 },
  ))
  return document
}

describe('视口全局效果分析缓存', () => {
  it('按注册节点的最严格 maxEdge 选择全图分析 mip', () => {
    const document = fastBlurDocument(20_000, 10_000)
    document.layers.push(createImageEditEffectLayerV3(
      'glow',
      '辉光',
      'image.vgpu-glow',
      JSON.parse(JSON.stringify(createDefaultVgpuGlowOperationParams())),
    ))
    const plan = compileImageEditRenderPlanV3(document, registry, 'stable')

    expect(resolveImageEditorViewportAnalysisMipV3(document, plan)).toBe(5)
    expect(resolveImageEditorViewportAnalysisMipV3(
      createImageEditDocumentV3({ width: 20_000, height: 10_000 }),
      compileImageEditRenderPlanV3(
        createImageEditDocumentV3({ width: 20_000, height: 10_000 }),
        registry,
        'stable',
      ),
    )).toBeNull()
  })

  it('全局模糊只分析一次，相邻 ROI 合成共用同一张分析图', async () => {
    const document = fastBlurDocument()
    const originalPlan = compileImageEditRenderPlanV3(document, registry, 'stable')
    const scaledPlan = compileImageEditRenderPlanV3(
      scaleImageEditorPreviewEffectsV3(document, 1),
      registry,
      'stable',
    )
    const input = createFloat32PremultipliedRgbaTile(
      4,
      1,
      'linear-light',
      Float32Array.from([
        1, 1, 1, 1,
        0, 0, 0, 1,
        0, 0, 0, 1,
        0, 0, 0, 1,
      ]),
    )
    const renderInput = vi.fn(async () => input)
    const cache = new ImageEditorViewportGlobalAnalysisCacheV3()
    const prepare = {
      document,
      originalPlan,
      scaledPlan,
      mip: 0,
      quality: 'stable' as const,
      signal: new AbortController().signal,
      renderInput,
    }
    await cache.prepare(prepare)
    await cache.prepare(prepare)
    expect(renderInput).toHaveBeenCalledTimes(1)

    const node = scaledPlan.nodes.find((candidate) => candidate.definitionId === 'effect.fast-blur')
    const originalNode = originalPlan.nodes.find((candidate) => candidate.id === node?.id)
    if (!node || !originalNode) throw new Error('测试缺少全局模糊节点')
    const fallback = vi.fn(async () => input)
    const left = await cache.execute({
      node,
      originalNode,
      source: createFloat32PremultipliedRgbaTile(
        2, 1, 'linear-light', new Float32Array(2 * 4),
      ),
      region: { x: 0, y: 0, width: 2, height: 1 },
      mip: 0,
      document,
      quality: 'stable',
      fallback,
    })
    const right = await cache.execute({
      node,
      originalNode,
      source: createFloat32PremultipliedRgbaTile(
        2, 1, 'linear-light', new Float32Array(2 * 4),
      ),
      region: { x: 2, y: 0, width: 2, height: 1 },
      mip: 0,
      document,
      quality: 'stable',
      fallback,
    })

    expect(fallback).not.toHaveBeenCalled()
    expect(left.data[0]).toBeGreaterThan(right.data[0])
    expect(right.data[0]).toBeGreaterThan(0)
    cache.dispose()

    await expect(cache.execute({
      node,
      originalNode,
      source: input,
      region: { x: 0, y: 0, width: 4, height: 1 },
      mip: 0,
      document,
      quality: 'stable',
      required: true,
      fallback,
    })).rejects.toThrow('缺少共享全局分析')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('共享分析未完成时拒绝按单个瓦片计算全局效果', async () => {
    const document = fastBlurDocument()
    const originalPlan = compileImageEditRenderPlanV3(document, registry, 'stable')
    const scaledPlan = compileImageEditRenderPlanV3(
      scaleImageEditorPreviewEffectsV3(document, 1),
      registry,
      'draft',
    )
    const node = scaledPlan.nodes.find((candidate) => candidate.definitionId === 'effect.fast-blur')
    const originalNode = originalPlan.nodes.find((candidate) => candidate.id === node?.id)
    if (!node || !originalNode) throw new Error('测试缺少全局模糊节点')
    const source = createFloat32PremultipliedRgbaTile(
      4, 1, 'linear-light', new Float32Array(4 * 4),
    )
    const fallback = vi.fn(async () => source)
    const cache = new ImageEditorViewportGlobalAnalysisCacheV3()

    await expect(cache.execute({
      node,
      originalNode,
      source,
      region: { x: 0, y: 0, width: 4, height: 1 },
      mip: 0,
      document,
      quality: 'draft',
      fallback,
    })).rejects.toThrow('全局效果预览缺少共享全局分析')
    expect(fallback).not.toHaveBeenCalled()
    cache.dispose()
  })
})
