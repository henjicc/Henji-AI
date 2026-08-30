import { describe, expect, it } from 'vitest'

import {
  createImageEditAnnotationLayerV3,
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditCommandBusSnapshotV3 } from '../application/imageEditCommandBus'
import {
  collectImageEditorPreviewResourceRequestsV3,
  projectImageEditorPreviewDocumentV3,
} from './previewDocumentV3'
import { compileImageEditorPreviewPlanV3 } from './previewWorkerRendererV3'

const RESOURCE = `sha256:${'a'.repeat(64)}`
const MASK = `sha256:${'b'.repeat(64)}`

function documentWithLayers(): ImageEditDocumentV3 {
  const raster = {
    ...createImageEditRasterLayerV3('raster', '底图', RESOURCE),
    mask: { resourceId: MASK, inverted: false },
  }
  const annotation = createImageEditAnnotationLayerV3('annotations', '标注')
  const blur = createImageEditEffectLayerV3(
    'blur',
    '模糊',
    'image.gaussian-blur-v2',
    { radius: 20 },
  )
  return {
    ...createImageEditDocumentV3({ width: 20_000, height: 10_000, documentId: 'preview-doc' }),
    revision: 7,
    layers: [raster, annotation, blur],
  }
}

function snapshot(document: ImageEditDocumentV3): ImageEditCommandBusSnapshotV3 {
  return {
    document,
    previewOverrides: {},
    history: {
      undoCount: 0,
      redoCount: 0,
      retainedBytes: 0,
      retainedResourceCount: 0,
      retainedResourceBytes: 0,
      maxCommands: 200,
      maxBytes: 2 * 1024 * 1024 * 1024,
    },
  }
}

describe('ImageEditor V3 瞬态预览文档', () => {
  it('参数覆盖不修改权威文档、revision 或历史', () => {
    const document = documentWithLayers()
    const originalParams = document.layers[2].type === 'effect' ? document.layers[2].params : {}
    const projected = projectImageEditorPreviewDocumentV3({
      ...snapshot(document),
      previewOverrides: {
        slider: {
          id: 'slider',
          kind: 'parameter',
          targetId: 'blur',
          baseRevision: 7,
          value: { radius: 72 },
        },
      },
    })

    expect(projected).not.toBe(document)
    expect(projected.revision).toBe(7)
    expect(document.layers[2].type === 'effect' && document.layers[2].params).toBe(originalParams)
    expect(projected.layers[2]).toMatchObject({ type: 'effect', params: { radius: 72 } })
  })

  it('过期覆盖被忽略，裁剪覆盖只投影输出几何', () => {
    const document = documentWithLayers()
    const projected = projectImageEditorPreviewDocumentV3({
      ...snapshot(document),
      previewOverrides: {
        stale: {
          id: 'stale', kind: 'parameter', targetId: 'blur', baseRevision: 6,
          value: { radius: 99 },
        },
        crop: {
          id: 'crop', kind: 'crop', targetId: document.id, baseRevision: 7,
          value: {
            orientation: { rotate: 90, mirrored: true },
            crop: { x: 10, y: 20, width: 800, height: 600 },
          },
        },
      },
    })
    expect(projected.revision).toBe(document.revision)
    expect(projected.geometry.crop).toEqual({ x: 10, y: 20, width: 800, height: 600 })
    expect(projected.geometry.orientation).toEqual({ rotate: 90, mirrored: true })
    expect(projected.layers[2]).toMatchObject({ params: { radius: 20 } })
  })

  it('图层求值顺序决定模糊是否处理标注', () => {
    const document = documentWithLayers()
    const blurredMarks = compileImageEditorPreviewPlanV3(document, 'stable', 1_600)
    const clearMarks = compileImageEditorPreviewPlanV3({
      ...document,
      layers: [document.layers[0], document.layers[2], document.layers[1]],
    }, 'stable', 1_600)

    const blurredNode = blurredMarks.nodes.find((node) => node.layerId === 'blur')
    const annotationComposite = blurredMarks.nodes.filter(
      (node) => node.layerId === 'annotations',
    ).at(-1)
    expect(blurredNode?.inputNodeIds).toEqual([annotationComposite?.id])
    expect(clearMarks.layerEvaluationOrder).toEqual(['raster', 'blur', 'annotations'])
    expect(clearMarks.outputHash).not.toBe(blurredMarks.outputHash)
  })

  it('只收集合法的受管栅格、稀疏瓦片和蒙版资源', () => {
    const document = documentWithLayers()
    const raster = document.layers[0]
    if (raster.type !== 'raster') throw new Error('测试图层类型错误')
    raster.tiles['0/0/0'] = `sha256:${'c'.repeat(64)}`
    raster.tiles['0/1/0'] = 'file:///private/source.png'
    const requests = collectImageEditorPreviewResourceRequestsV3(document, 1_600)
    expect(requests).toEqual(expect.arrayContaining([
      { resourceId: RESOURCE, maxDimension: 1_600 },
      { resourceId: MASK, maxDimension: 1_600 },
      { resourceId: `sha256:${'c'.repeat(64)}`, maxDimension: 512 },
    ]))
    expect(requests.some((request) => request.resourceId.startsWith('file:'))).toBe(false)
  })
})
