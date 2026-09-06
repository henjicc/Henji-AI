import { describe, expect, it } from 'vitest'

import {
  compileImageEditRenderPlanV3,
  createBuiltInImageEditRenderNodeRegistry,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditSparseMaskReferenceV3,
} from '@/core/imageEdit/v3'
import { createImageEditorViewportSamplingGridResolverV3 } from './viewportCompositeSamplingGridV3'

const SOURCE = `sha256:${'1'.repeat(64)}` as const
const MASK = `sha256:${'2'.repeat(64)}` as const
const registry = createBuiltInImageEditRenderNodeRegistry()

describe('图片编辑 V3 viewport 实际采样网格', () => {
  it('栅格使用真实源mip，图层合成后的全局效果仍使用输出网格', () => {
    const document = createImageEditDocumentV3({
      width: 64,
      height: 64,
      sourceResourceId: SOURCE,
      idFactory: () => 'source',
    })
    document.layers.push(createImageEditEffectLayerV3(
      'effect',
      '效果',
      'image.gaussian-blur-v2',
      { radius: 2 },
    ))
    const plan = compileImageEditRenderPlanV3(document, registry, 'stable')
    const effect = plan.nodes.find((node) => node.definitionId.startsWith('effect.'))
    const source = plan.nodes.find((node) => node.definitionId === 'source.raster')
    if (!effect) throw new Error('测试缺少效果节点')
    if (!source) throw new Error('测试缺少图片源节点')
    const resolve = createImageEditorViewportSamplingGridResolverV3(
      plan,
      new Map([[SOURCE, { width: 1, height: 1 }]]),
      new Map([[SOURCE, 0]]),
      document.geometry,
      3,
    )

    expect(resolve({ kind: 'content', node: source })).toEqual({
      size: { width: 1, height: 1 },
      toEvaluation: [1 / 8, 0, 0, 1 / 8, 0, 0],
    })
    expect(resolve({ kind: 'content', node: effect })).toEqual({
      size: { width: 8, height: 8 },
      toEvaluation: [1, 0, 0, 1, 0, 0],
    })
  })

  it('资源蒙版与稀疏蒙版分别使用自己的实际网格', () => {
    const document = createImageEditDocumentV3({
      width: 64,
      height: 64,
      sourceResourceId: SOURCE,
      idFactory: () => 'source',
    })
    const plan = compileImageEditRenderPlanV3(document, registry, 'stable')
    const ownerNode = plan.nodes.find((node) => node.definitionId === 'composite.layer')
    if (!ownerNode) throw new Error('测试缺少合成节点')
    const resolve = createImageEditorViewportSamplingGridResolverV3(
      plan,
      new Map([
        [SOURCE, { width: 1, height: 1 }],
        [MASK, { width: 64, height: 64 }],
      ]),
      new Map([[SOURCE, 0], [MASK, 2]]),
      document.geometry,
      3,
    )
    expect(resolve({
      kind: 'mask',
      ownerNode,
      reference: { resourceId: MASK, inverted: false },
    })).toEqual({
      size: { width: 16, height: 16 },
      toEvaluation: [1 / 2, 0, 0, 1 / 2, 0, 0],
    })
    expect(resolve({
      kind: 'mask',
      ownerNode,
      reference: createImageEditSparseMaskReferenceV3('mask'),
    })).toEqual({
      size: { width: 8, height: 8 },
      toEvaluation: [1, 0, 0, 1, 0, 0],
    })
  })

  it('资源节点缺少权威尺寸或mip时明确拒绝', () => {
    const document = createImageEditDocumentV3({ width: 64, height: 64, sourceResourceId: SOURCE })
    const plan = compileImageEditRenderPlanV3(document, registry, 'stable')
    const source = plan.nodes.find((node) => node.definitionId === 'source.raster')
    if (!source) throw new Error('测试缺少图片源节点')
    const missingSize = createImageEditorViewportSamplingGridResolverV3(
      plan,
      new Map(),
      new Map([[SOURCE, 0]]),
      document.geometry,
      0,
    )
    expect(() => missingSize({ kind: 'content', node: source })).toThrow('缺少图片源几何')
    const missingMip = createImageEditorViewportSamplingGridResolverV3(
      plan,
      new Map([[SOURCE, document.geometry]]),
      new Map(),
      document.geometry,
      0,
    )
    expect(() => missingMip({ kind: 'content', node: source })).toThrow('缺少图片源 mip')
  })
})
