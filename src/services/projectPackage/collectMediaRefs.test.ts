import { beforeAll, describe, expect, it } from 'vitest'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import { registry } from '@/core/ModelRegistry'
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { createStableLayerId, createStableLayerResourceId, createStableLayerStackId, type LayerStackDocumentV1 } from '@/features/canvas/domain/layerStack'
import { modelPresentations } from '@/models/presentation'
import { apimartGptImage2Model } from '../../../packages/ai-sdk/src/catalog/apimart/gpt-image-2.model'
import { collectAndRewriteMedia, rewritePackagePathsToLocal } from './collectMediaRefs'

describe('结构化提示词项目包媒体收集', () => {
  beforeAll(() => {
    registry.clear()
    registry.register(composeModelDefinition(
      apimartGptImage2Model,
      modelPresentations[apimartGptImage2Model.meta.id],
    ))
  })

  it('收集并恢复 mediaInputs 与 promptMediaBindings 中的本地路径', () => {
    const mediaPath = 'C:\\media\\reference.png'
    const node = {
      id: 'generation-node',
      type: CANVAS_NODE_TYPES.imageEdit,
      position: { x: 0, y: 0 },
      data: {
        imageUrl: null,
        aspectRatio: '1:1',
        prompt: '参考@图片1',
        mediaInputs: { image: [mediaPath] },
        promptMediaBindings: [{
          resourceId: 'canvas-local:generation-node:media-1',
          mediaType: 'image',
          dataUrl: mediaPath,
          filePath: mediaPath,
        }],
        promptDocument: {
          version: 1,
          type: 'doc',
          content: [{ type: 'paragraph' }],
        },
      },
    } as CanvasNode

    const collected = collectAndRewriteMedia([node])
    expect(collected.mediaFiles).toEqual([{
      srcPath: mediaPath,
      packagePath: 'media/1-reference.png',
    }])
    expect(collected.nodes[0].data.mediaInputs).toEqual({
      image: ['media/1-reference.png'],
    })
    expect(collected.nodes[0].data.promptMediaBindings).toEqual([expect.objectContaining({
      dataUrl: 'media/1-reference.png',
      filePath: 'media/1-reference.png',
    })])

    const restored = rewritePackagePathsToLocal(collected.nodes, {
      'media/1-reference.png': 'D:\\unpacked\\reference.png',
    })
    expect(restored[0].data.mediaInputs).toEqual({ image: ['D:\\unpacked\\reference.png'] })
    expect(restored[0].data.promptMediaBindings).toEqual([expect.objectContaining({
      dataUrl: 'D:\\unpacked\\reference.png',
      filePath: 'D:\\unpacked\\reference.png',
    })])
  })

  it('全景结果打包和恢复后保留 resultKind 与本地媒体引用', () => {
    const mediaPath = '/managed/panorama.png'
    const node = {
      id: 'panorama-result',
      type: CANVAS_NODE_TYPES.panoramaViewer,
      position: { x: 0, y: 0 },
      data: {
        imageUrl: mediaPath,
        previewImageUrl: mediaPath,
        aspectRatio: '2:1',
        resultKind: 'panorama',
      },
    } as CanvasNode

    const collected = collectAndRewriteMedia([node])

    expect(collected.mediaFiles).toEqual([{
      srcPath: mediaPath,
      packagePath: 'media/1-panorama.png',
    }])
    expect(collected.nodes[0].data.resultKind).toBe('panorama')
    expect(collected.nodes[0].data.imageUrl).toBe('media/1-panorama.png')
    expect(collected.nodes[0].data.previewImageUrl).toBe('media/1-panorama.png')

    const restored = rewritePackagePathsToLocal(collected.nodes, {
      'media/1-panorama.png': '/unpacked/panorama.png',
    })
    expect(restored[0].data).toMatchObject({
      resultKind: 'panorama',
      imageUrl: '/unpacked/panorama.png',
      previewImageUrl: '/unpacked/panorama.png',
    })
  })

  it('收集局部重绘节点的受管遮罩并同步改写编辑文档来源', () => {
    const sourcePath = '/managed/source.png'
    const maskPath = '/managed/inpainting-mask.png'
    const node = {
      id: 'element-edit-node',
      type: CANVAS_NODE_TYPES.elementEditGen,
      position: { x: 0, y: 0 },
      data: {
        imageUrl: null,
        aspectRatio: '1:1',
        prompt: '把选中区域改成红色雨伞',
        modelId: 'apimart-gpt-image-2',
        mediaInputs: { image: [sourcePath] },
        localRedrawMaskSource: maskPath,
        localRedrawMaskDocument: {
          version: 1,
          sourceRef: sourcePath,
          width: 1024,
          height: 768,
          strokes: [{
            id: 'paint-1',
            kind: 'rectangle',
            mode: 'paint',
            points: [{ x: 20, y: 30 }, { x: 120, y: 140 }],
          }],
          },
        generationLocalRedrawContext: {
          version: 1,
          source: sourcePath,
          mask: maskPath,
          sourceWidth: 1024,
          sourceHeight: 768,
          crop: { x: 10, y: 20, width: 400, height: 400 },
          settings: { contextScale: 2, aspectRatio: 'auto', registrationQuality: 'precise', featherPixels: 12, forceRegistration: false },
        },
        },
      } as CanvasNode

    const collected = collectAndRewriteMedia([node])
    expect(collected.mediaFiles).toEqual([
      { srcPath: maskPath, packagePath: 'media/1-inpainting-mask.png' },
      { srcPath: sourcePath, packagePath: 'media/2-source.png' },
    ])
    expect(collected.nodes[0].data).toMatchObject({
      localRedrawMaskSource: 'media/1-inpainting-mask.png',
      localRedrawMaskDocument: { sourceRef: 'media/2-source.png', version: 1 },
      generationLocalRedrawContext: { source: 'media/2-source.png', mask: 'media/1-inpainting-mask.png' },
    })

    const restored = rewritePackagePathsToLocal(collected.nodes, {
      'media/1-inpainting-mask.png': '/unpacked/inpainting-mask.png',
      'media/2-source.png': '/unpacked/source.png',
    })
    expect(restored[0].data).toMatchObject({
      localRedrawMaskSource: '/unpacked/inpainting-mask.png',
      localRedrawMaskDocument: { sourceRef: '/unpacked/source.png', version: 1 },
      generationLocalRedrawContext: { source: '/unpacked/source.png', mask: '/unpacked/inpainting-mask.png' },
    })
  })

  it('导出导入完整重写图层媒体，缺失层明确降级且不保留失效路径', () => {
    const completionId = 'generation-output:layer-result'
    const stackId = createStableLayerStackId(completionId)
    const layerResourceId = createStableLayerResourceId(stackId, 0)
    const document: LayerStackDocumentV1 = {
      version: 1,
      stackId,
      status: 'ready',
      source: { capabilityId: 'image.layer-separation', sourceNodeId: 'source', inputResourceId: '/managed/source.png', providerId: 'volcengine', modelId: 'volcengine-seedream-5.0-pro', completionId },
      canvas: { width: 8, height: 8, colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over', clipPolicy: 'canvas-bounds' },
      compositeResourceId: `${stackId}:composite`,
      thumbnailResourceId: `${stackId}:thumbnail`,
      layers: [{ version: 1, layerId: createStableLayerId(stackId, 0), sourceOutputIndex: 0, providerZIndex: 0, order: 0, role: 'base', name: '底图', resourceId: layerResourceId, placement: { x: 0, y: 0, width: 8, height: 8 }, opacity: 1, visible: true, blendMode: 'normal', alpha: 'opaque' }],
      resources: [
        { version: 1, resourceId: layerResourceId, status: 'ready', filePath: '/managed/base.jpg', mimeType: 'image/jpeg', width: 8, height: 8, hasAlpha: false, byteLength: 16, sha256: 'base-hash' },
        { version: 1, resourceId: `${stackId}:composite`, status: 'ready', filePath: '/managed/composite.png', mimeType: 'image/png', width: 8, height: 8, hasAlpha: true, byteLength: null, sha256: 'composite-hash' },
        { version: 1, resourceId: `${stackId}:thumbnail`, status: 'ready', filePath: '/managed/thumb.webp', mimeType: 'image/webp', width: 8, height: 8, hasAlpha: false, byteLength: null, sha256: 'thumb-hash' },
      ],
    }
    const node = { id: 'layer-result', type: CANVAS_NODE_TYPES.layerStackResult, position: { x: 0, y: 0 }, data: { displayName: '图层结果', imageUrl: '/managed/composite.png', previewImageUrl: '/managed/thumb.webp', aspectRatio: '1:1', resultKind: 'layer-stack', layerStackDocument: document } } as CanvasNode
    const collected = collectAndRewriteMedia([node])
    expect(collected.mediaFiles).toHaveLength(4)
    const packedDocument = collected.nodes[0].data.layerStackDocument as unknown as LayerStackDocumentV1
    expect(packedDocument.source.inputResourceId).toMatch(/^media\//)
    expect(packedDocument.resources.every((resource) => resource.filePath?.startsWith('media/'))).toBe(true)
    expect(JSON.stringify(collected.nodes[0])).not.toContain('/managed/')

    const compositePackagePath = packedDocument.resources.find((resource) => resource.resourceId === document.compositeResourceId)?.filePath as string
    const thumbPackagePath = packedDocument.resources.find((resource) => resource.resourceId === document.thumbnailResourceId)?.filePath as string
    const restored = rewritePackagePathsToLocal(collected.nodes, {
      [compositePackagePath]: '/unpacked/composite.png',
      [thumbPackagePath]: '/unpacked/thumb.webp',
    })
    const restoredDocument = restored[0].data.layerStackDocument as unknown as LayerStackDocumentV1
    expect(restoredDocument.status).toBe('degraded')
    expect(restoredDocument.source).toMatchObject({
      inputResourceId: packedDocument.source.inputResourceId,
      inputResourceStatus: 'missing',
    })
    expect(restoredDocument.resources.find((resource) => resource.resourceId === layerResourceId)).toMatchObject({ status: 'missing', filePath: null, sha256: null })
    expect(restored[0].data.imageUrl).toBe('/unpacked/composite.png')
    expect(restored[0].data.previewImageUrl).toBe('/unpacked/thumb.webp')

    const restoredWithSource = rewritePackagePathsToLocal(collected.nodes, {
      [packedDocument.source.inputResourceId]: '/unpacked/source.png',
      [compositePackagePath]: '/unpacked/composite.png',
      [thumbPackagePath]: '/unpacked/thumb.webp',
    })
    const restoredWithSourceDocument = restoredWithSource[0].data.layerStackDocument as unknown as LayerStackDocumentV1
    expect(restoredWithSourceDocument.source).toMatchObject({
      inputResourceId: '/unpacked/source.png',
      inputResourceStatus: 'ready',
    })
  })
})
