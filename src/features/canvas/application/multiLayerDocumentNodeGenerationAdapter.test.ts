import { describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'

import {
  createStableLayerId,
  createStableLayerResourceId,
  createStableLayerStackId,
  type LayerStackDocumentV1,
} from '../domain/layerStack'
import {
  createLayerStackV3DocumentId,
  createLayerStackV3Projection,
  inspectMultiLayerDocumentSession,
} from './multiLayerDocumentNodeGenerationAdapter'

const completionId = 'generation-output:adapter-placeholder'
const stackId = createStableLayerStackId(completionId)
const layerResourceId = createStableLayerResourceId(stackId, 0)
const managedResourceRef = `sha256:${'a'.repeat(64)}` as const

function layerStackDocument(): LayerStackDocumentV1 {
  return {
    version: 1,
    stackId,
    status: 'ready',
    source: {
      capabilityId: 'image.layer-separation',
      sourceNodeId: 'source',
      inputResourceId: '/source.png',
      providerId: 'volcengine',
      modelId: 'seedream-5.0-pro',
      completionId,
    },
    canvas: {
      width: 640,
      height: 320,
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
      placement: { x: 0, y: 0, width: 640, height: 320 },
      opacity: 1,
      visible: true,
      blendMode: 'normal',
      alpha: 'opaque',
    }],
    resources: [
      {
        version: 1,
        resourceId: layerResourceId,
        status: 'ready',
        filePath: '/managed/base.jpg',
        mimeType: 'image/jpeg',
        width: 640,
        height: 320,
        hasAlpha: false,
        byteLength: 20,
        sha256: 'base',
      },
      {
        version: 1,
        resourceId: `${stackId}:composite`,
        status: 'ready',
        filePath: '/managed/composite.png',
        mimeType: 'image/png',
        width: 640,
        height: 320,
        hasAlpha: true,
        byteLength: 30,
        sha256: 'composite',
      },
      {
        version: 1,
        resourceId: `${stackId}:thumbnail`,
        status: 'ready',
        filePath: '/managed/thumbnail.webp',
        mimeType: 'image/webp',
        width: 320,
        height: 160,
        hasAlpha: false,
        byteLength: 10,
        sha256: 'thumbnail',
      },
    ],
  }
}

function importedDocument(documentId: string) {
  const document = createImageEditDocumentV3({ width: 640, height: 320, documentId })
  document.layers = [createImageEditRasterLayerV3('base-layer', '底图', managedResourceRef)]
  return {
    document,
    resourceDescriptors: [{
      resourceRef: managedResourceRef,
      byteLength: 20,
      mediaType: 'image/jpeg',
    }],
  }
}

describe('多图层文档生成适配器', () => {
  it('打开前按节点引用校验权威文档 revision 与 preview', async () => {
    const document = createImageEditDocumentV3({ width: 640, height: 320, documentId: 'authoritative' })
    const session = {
      kind: 'image-edit-v3' as const,
      sourceUrl: '/managed/composite.png',
      documentRef: 'image-edit-v3:authoritative' as const,
      revision: 0,
      previewRef: null,
    }
    const loadSnapshot = vi.fn(async () => ({
      documentRef: session.documentRef,
      revision: 0,
      previewRef: null,
      document,
      history: null,
      resourceRefs: [],
      resources: [],
      sourceFingerprint: `sha256:${'b'.repeat(64)}` as const,
    }))

    await expect(inspectMultiLayerDocumentSession(
      { session },
      { loadSnapshot },
    )).resolves.toBe(session)
    expect(loadSnapshot).toHaveBeenCalledOnce()
  })

  it('拒绝节点引用与权威文档版本不一致', async () => {
    const document = {
      ...createImageEditDocumentV3({ width: 640, height: 320, documentId: 'authoritative' }),
      revision: 2,
    }
    const session = {
      kind: 'image-edit-v3' as const,
      sourceUrl: '/managed/composite.png',
      documentRef: 'image-edit-v3:authoritative' as const,
      revision: 1,
      previewRef: null,
    }

    await expect(inspectMultiLayerDocumentSession({ session }, {
      loadSnapshot: vi.fn(async () => ({
        documentRef: session.documentRef,
        revision: 2,
        previewRef: null,
        document,
        history: null,
        resourceRefs: [],
        resources: [],
        sourceFingerprint: `sha256:${'c'.repeat(64)}` as const,
      })),
    })).rejects.toThrow('版本与节点记录不一致')
  })

  it('使用节点与图层栈稳定身份初始保存 V3，并返回同源节点投影', async () => {
    const expectedDocumentId = createLayerStackV3DocumentId('placeholder', stackId)
    const importDocument = vi.fn(async (input: { documentId: string }) => (
      importedDocument(input.documentId)
    ))
    const save = vi.fn(async () => ({
      documentId: expectedDocumentId,
      revision: 0,
      previewRef: null,
    }))

    const projection = await createLayerStackV3Projection(
      { nodeId: 'placeholder', document: layerStackDocument() },
      {
        importDocument: importDocument as never,
        repository: { save } as never,
      },
    )

    expect(importDocument).toHaveBeenCalledWith(expect.objectContaining({
      documentId: expectedDocumentId,
      document: expect.objectContaining({ stackId }),
    }))
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ id: expectedDocumentId, layers: [expect.objectContaining({ type: 'raster' })] }),
      expect.objectContaining({ expectedRevision: 0, previewRef: null }),
    )
    expect(projection).toEqual({
      imageEditSession: {
        kind: 'image-edit-v3',
        sourceUrl: '/managed/composite.png',
        documentRef: `image-edit-v3:${expectedDocumentId}`,
        revision: 0,
        previewRef: null,
      },
      imageUrl: '/managed/composite.png',
      previewImageUrl: '/managed/thumbnail.webp',
      aspectRatio: '640:320',
    })
    expect(createLayerStackV3DocumentId('placeholder', stackId)).toBe(expectedDocumentId)
  })

  it('初始保存失败时回收未被文档接管的受管资源并保留原错误', async () => {
    const collectGarbage = vi.fn(async () => undefined)
    await expect(createLayerStackV3Projection(
      { nodeId: 'placeholder', document: layerStackDocument() },
      {
        importDocument: vi.fn(async (input: { documentId: string }) => (
          importedDocument(input.documentId)
        )) as never,
        repository: {
          save: vi.fn(async () => { throw new Error('磁盘保存失败') }),
        } as never,
        collectGarbage,
      },
    )).rejects.toThrow('磁盘保存失败')
    expect(collectGarbage).toHaveBeenCalledOnce()
  })
})
