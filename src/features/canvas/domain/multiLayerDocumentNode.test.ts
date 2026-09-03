import { describe, expect, it } from 'vitest'

import {
  imageEditV3AnnotationRef,
  imageEditV3GroupRef,
  imageEditV3LayerRef,
} from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'

import { CANVAS_NODE_TYPES, type CanvasNode } from './canvasNodes'
import { isEditableLayerStackResultNode, isUploadNode } from './canvasNodeGuards'
import {
  createStableLayerId,
  createStableLayerResourceId,
  createStableLayerStackId,
  type LayerStackDocumentV1,
} from './layerStack'
import {
  MultiLayerDocumentNodeContractError,
  parseMultiLayerDocumentExportTarget,
  parseMultiLayerDocumentNodeState,
} from './multiLayerDocumentNode'

const imageUrl = 'henji-media://multi-layer/composite.png'
const previewImageUrl = 'henji-media://multi-layer/preview.webp'
const session = {
  kind: 'image-edit-v3' as const,
  sourceUrl: imageUrl,
  documentRef: 'image-edit-v3:multi-layer-doc' as const,
  revision: 3,
  previewRef: `sha256:${'a'.repeat(64)}` as const,
}

function legacyDocument(status: 'ready' | 'degraded' = 'ready'): LayerStackDocumentV1 {
  const completionId = 'multi-layer-completion'
  const stackId = createStableLayerStackId(completionId)
  const layerResourceId = createStableLayerResourceId(stackId, 0)
  return {
    version: 1,
    stackId,
    status,
    source: {
      capabilityId: 'image.layer-separation',
      sourceNodeId: 'source-node',
      inputResourceId: 'input-resource',
      inputResourceStatus: status === 'degraded' ? 'missing' : 'ready',
      providerId: 'volcengine',
      modelId: 'seedream-5-0-pro',
      completionId,
    },
    canvas: {
      width: 512,
      height: 512,
      colorSpace: 'srgb',
      alphaMode: 'straight',
      compositeOperation: 'source-over',
      clipPolicy: 'canvas-bounds',
    },
    compositeResourceId: `${stackId}:composite`,
    thumbnailResourceId: `${stackId}:thumbnail`,
    layers: [{
      version: 1,
      layerId: createStableLayerId(stackId, 0),
      sourceOutputIndex: 0,
      providerZIndex: 0,
      order: 0,
      role: 'base',
      name: '底图',
      resourceId: layerResourceId,
      placement: { x: 0, y: 0, width: 512, height: 512 },
      opacity: 1,
      visible: true,
      blendMode: 'normal',
      alpha: 'opaque',
    }],
    resources: [
      { version: 1, resourceId: layerResourceId, status: 'ready', filePath: '/base.jpg', mimeType: 'image/jpeg', width: 512, height: 512, hasAlpha: false, byteLength: 10, sha256: 'a' },
      { version: 1, resourceId: `${stackId}:composite`, status: 'ready', filePath: '/composite.png', mimeType: 'image/png', width: 512, height: 512, hasAlpha: true, byteLength: 10, sha256: 'b' },
      { version: 1, resourceId: `${stackId}:thumbnail`, status: 'ready', filePath: '/preview.webp', mimeType: 'image/webp', width: 256, height: 256, hasAlpha: false, byteLength: 10, sha256: 'c' },
    ],
  }
}

function layerStackNode(): CanvasNode {
  return {
    id: 'layer-stack-node',
    type: CANVAS_NODE_TYPES.layerStackResult,
    position: { x: 0, y: 0 },
    data: {
      resultKind: 'layer-stack',
      imageUrl,
      previewImageUrl,
      aspectRatio: '1:1',
      imageEditSession: session,
    },
  }
}

describe('多图层文档节点契约', () => {
  it('稳定区分生成占位、V1 待迁移、V3 可编辑和资源降级四态', () => {
    expect(parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack', imageUrl: null, previewImageUrl: null, aspectRatio: '1:1', isGenerating: true,
    })).toMatchObject({ kind: 'generation-placeholder', status: 'generating' })

    expect(parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack', imageUrl, previewImageUrl, aspectRatio: '1:1', layerStackDocument: legacyDocument(),
    })).toMatchObject({ kind: 'legacy-v1-pending-migration' })

    expect(parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack', imageUrl, previewImageUrl, aspectRatio: '1:1', imageEditSession: session,
    })).toMatchObject({ kind: 'editable-v3', session })

    expect(parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack', imageUrl, previewImageUrl, aspectRatio: '1:1', layerStackDocument: legacyDocument('degraded'),
    })).toMatchObject({ kind: 'degraded', reason: 'legacy-resources-unavailable' })

    expect(parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack', imageUrl: null, previewImageUrl: null, aspectRatio: '1:1', imageEditSession: session,
    })).toMatchObject({ kind: 'degraded', reason: 'materialized-image-unavailable', session })
  })

  it('保留已迁移节点上的 V1 只读字段，但完成态只以 V3 会话为权威', () => {
    const state = parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack',
      imageUrl,
      previewImageUrl,
      aspectRatio: '1:1',
      imageEditSession: session,
      layerStackDocument: legacyDocument(),
    })
    expect(state).toMatchObject({ kind: 'editable-v3', legacyDocument: { version: 1 } })
  })

  it('拒绝会话来源不一致、只有预览图和损坏 V1 的非法混合状态', () => {
    expect(() => parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack', imageUrl: '/other.png', previewImageUrl, aspectRatio: '1:1', imageEditSession: session,
    })).toThrow(/\u4e0d\u4e00\u81f4/)
    expect(() => parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack', imageUrl: null, previewImageUrl, aspectRatio: '1:1',
    })).toThrow(/\u53ea\u4fdd\u5b58\u9884\u89c8\u56fe/)
    expect(() => parseMultiLayerDocumentNodeState({
      resultKind: 'layer-stack', imageUrl, previewImageUrl, aspectRatio: '1:1',
      layerStackDocument: { ...legacyDocument(), stackId: 'broken' },
    })).toThrow(/\u65e7\u7248\u56fe\u5c42\u6587\u6863\u65e0\u6548/)
  })

  it('类型守卫不影响普通图片节点，并且只将合法 V3 图层节点判为可编辑', () => {
    const upload: CanvasNode = {
      id: 'upload',
      type: CANVAS_NODE_TYPES.upload,
      position: { x: 0, y: 0 },
      data: { imageUrl: '/plain.png', aspectRatio: '1:1' },
    }
    expect(isUploadNode(upload)).toBe(true)
    expect(isEditableLayerStackResultNode(upload)).toBe(false)
    expect(isEditableLayerStackResultNode(layerStackNode())).toBe(true)
  })

  it('只接受栅格层、组与标注元素稳定引用', () => {
    expect(parseMultiLayerDocumentExportTarget({
      kind: 'raster-layer', ref: imageEditV3LayerRef('multi-layer-doc', 'raster-a'),
    })).toMatchObject({ kind: 'raster-layer', ref: { kind: 'image_edit.layer' } })
    expect(parseMultiLayerDocumentExportTarget({
      kind: 'layer-group', ref: imageEditV3GroupRef('multi-layer-doc', 'group-a'),
    })).toMatchObject({ kind: 'layer-group', ref: { kind: 'image_edit.group' } })
    expect(parseMultiLayerDocumentExportTarget({
      kind: 'annotation-element', ref: imageEditV3AnnotationRef('multi-layer-doc', 'marks-a', 'mark-a'),
    })).toMatchObject({ kind: 'annotation-element', ref: { kind: 'image_mark.annotation' } })
  })

  it('对效果层和调整层返回明确的不支持原因', () => {
    for (const kind of ['effect-layer', 'adjustment-layer'] as const) {
      try {
        parseMultiLayerDocumentExportTarget({ kind })
        throw new Error('应当拒绝上下文图层')
      } catch (error) {
        expect(error).toBeInstanceOf(MultiLayerDocumentNodeContractError)
        expect(error).toMatchObject({ code: 'UNSUPPORTED_EXPORT_TARGET' })
        expect((error as Error).message).toMatch(/\u4f9d赖下方图层/)
      }
    }
  })
})
