import { beforeAll, describe, expect, it } from 'vitest'

import { composeModelDefinition } from '@/core/composeModelDefinition'
import { registry } from '@/core/ModelRegistry'
import { derivedMediaStateKey } from '@/core/params/derivedMediaState'
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes'
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
      type: CANVAS_NODE_TYPES.exportImage,
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

  it('收集元素编辑参数中的受管遮罩并同步改写编辑文档来源', () => {
    const sourcePath = '/managed/source.png'
    const maskPath = '/managed/inpainting-mask.png'
    const stateKey = derivedMediaStateKey('apimartGptImage2MaskUrl')
    const node = {
      id: 'element-edit-node',
      type: CANVAS_NODE_TYPES.imageEdit,
      position: { x: 0, y: 0 },
      data: {
        imageUrl: null,
        aspectRatio: '1:1',
        prompt: '把选中区域改成红色雨伞',
        modelId: 'apimart-gpt-image-2',
        mediaInputs: { image: [sourcePath] },
        params: {
          apimartGptImage2Version: 'official',
          apimartGptImage2MaskUrl: [maskPath],
          [stateKey]: {
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
        },
      },
    } as CanvasNode

    const collected = collectAndRewriteMedia([node])
    expect(collected.mediaFiles).toEqual([
      { srcPath: sourcePath, packagePath: 'media/1-source.png' },
      { srcPath: maskPath, packagePath: 'media/2-inpainting-mask.png' },
    ])
    expect((collected.nodes[0].data.params as DynamicValueMap)).toMatchObject({
      apimartGptImage2MaskUrl: ['media/2-inpainting-mask.png'],
      [stateKey]: { sourceRef: 'media/1-source.png', version: 1 },
    })

    const restored = rewritePackagePathsToLocal(collected.nodes, {
      'media/1-source.png': '/unpacked/source.png',
      'media/2-inpainting-mask.png': '/unpacked/inpainting-mask.png',
    })
    expect((restored[0].data.params as DynamicValueMap)).toMatchObject({
      apimartGptImage2MaskUrl: ['/unpacked/inpainting-mask.png'],
      [stateKey]: { sourceRef: '/unpacked/source.png', version: 1 },
    })
  })
})
