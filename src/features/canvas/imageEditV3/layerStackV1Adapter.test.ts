import { describe, expect, it, vi } from 'vitest'

import {
  createStableLayerId,
  createStableLayerResourceId,
  createStableLayerStackId,
  type LayerStackDocumentV1,
  type LayerStackMediaResourceV1,
} from '../domain/layerStack'
import type { ImageEditorV3ManagedSource } from '@/platform/contracts/imageEditorV3'
import {
  CANVAS_EDIT_V3_LAYER_STACK_OPTION,
  importLayerStackV1AsImageEditDocumentV3,
  readLayerStackV1ImageEditorOption,
  serializeLayerStackV1ForImageEditor,
} from './layerStackV1Adapter'

const COMPLETION_ID = 'layer-stack-import-test'
const STACK_ID = createStableLayerStackId(COMPLETION_ID)

function resource(
  resourceId: string,
  filePath: string,
  width: number,
  height: number,
  hasAlpha: boolean,
): LayerStackMediaResourceV1 {
  return {
    version: 1,
    resourceId,
    status: 'ready',
    filePath,
    mimeType: hasAlpha ? 'image/png' : 'image/jpeg',
    width,
    height,
    hasAlpha,
    byteLength: 4_096,
    sha256: resourceId,
  }
}

function layerStack(): LayerStackDocumentV1 {
  const baseResourceId = createStableLayerResourceId(STACK_ID, 0)
  const contentResourceId = createStableLayerResourceId(STACK_ID, 1)
  return {
    version: 1,
    stackId: STACK_ID,
    status: 'ready',
    source: {
      capabilityId: 'image.layer-separation',
      sourceNodeId: 'source-node',
      inputResourceId: 'input-resource',
      providerId: 'test-provider',
      modelId: 'test-model',
      completionId: COMPLETION_ID,
    },
    canvas: {
      width: 1_000,
      height: 800,
      colorSpace: 'srgb',
      alphaMode: 'straight',
      compositeOperation: 'source-over',
      clipPolicy: 'canvas-bounds',
    },
    compositeResourceId: 'composite-resource',
    thumbnailResourceId: 'thumbnail-resource',
    layers: [
      {
        version: 1,
        layerId: createStableLayerId(STACK_ID, 0),
        sourceOutputIndex: 0,
        providerZIndex: 0,
        order: 0,
        role: 'base',
        name: '背景',
        resourceId: baseResourceId,
        placement: { x: 0, y: 0, width: 1_000, height: 800 },
        opacity: 1,
        visible: true,
        blendMode: 'normal',
        alpha: 'opaque',
      },
      {
        version: 1,
        layerId: createStableLayerId(STACK_ID, 1),
        sourceOutputIndex: 1,
        providerZIndex: 1,
        order: 1,
        role: 'content',
        name: '主体',
        resourceId: contentResourceId,
        placement: { x: 120, y: 80, width: 400, height: 300 },
        opacity: 0.75,
        visible: false,
        blendMode: 'normal',
        alpha: 'straight',
      },
    ],
    resources: [
      resource(baseResourceId, '/layers/base.jpg', 1_000, 800, false),
      resource(contentResourceId, '/layers/content.png', 400, 300, true),
      resource('composite-resource', '/layers/composite.png', 1_000, 800, true),
      resource('thumbnail-resource', '/layers/thumbnail.jpg', 200, 160, false),
    ],
  }
}

function managed(index: number, width: number, height: number, hasAlpha: boolean): ImageEditorV3ManagedSource {
  const resourceRef = `sha256:${String(index).padStart(64, 'a')}` as const
  return {
    resource: { resourceRef, byteLength: 10_000 + index, mediaType: hasAlpha ? 'image/png' : 'image/jpeg' },
    mediaUrl: `henji-media://image-editor-v3/${resourceRef.slice(7)}`,
    metadata: {
      resourceRef,
      width,
      height,
      encodedWidth: width,
      encodedHeight: height,
      format: hasAlpha ? 'png' : 'jpeg',
      channels: hasAlpha ? 4 : 3,
      depth: 'uchar',
      bitsPerSample: 8,
      colorSpace: 'srgb',
      orientation: 1,
      orientationApplied: true,
      density: null,
      pages: 1,
      hasAlpha,
      hasIccProfile: false,
      iccProfileResourceRef: null,
      cicp: null,
      hdr: false,
    },
  }
}

describe('LayerStackDocumentV1 → ImageEditDocumentV3 适配器', () => {
  it('保持由下到上的顺序、透明度、显隐和 placement 平移，并只导入图层权威资源', async () => {
    const ingestSource = vi.fn(async (request: { source: { filePath: string } }) => (
      request.source.filePath.endsWith('base.jpg')
        ? managed(1, 1_000, 800, false)
        : managed(2, 400, 300, true)
    ))
    const imported = await importLayerStackV1AsImageEditDocumentV3({
      document: layerStack(),
      documentId: 'v3-layer-stack',
      ingestSource: ingestSource as never,
    })

    expect(ingestSource).toHaveBeenCalledTimes(2)
    expect(imported.document).toMatchObject({
      id: 'v3-layer-stack',
      geometry: { width: 1_000, height: 800 },
      color: { workingSpace: 'srgb', bitDepth: 8, transferFunction: 'srgb' },
    })
    expect(imported.document.layers).toMatchObject([
      { type: 'raster', name: '背景', visible: true, opacity: 1, transform: [1, 0, 0, 1, 0, 0] },
      { type: 'raster', name: '主体', visible: false, opacity: 0.75, transform: [1, 0, 0, 1, 120, 80] },
    ])
    expect(imported.resourceDescriptors.map(({ resourceRef }) => resourceRef)).toEqual([
      managed(1, 1_000, 800, false).resource.resourceRef,
      managed(2, 400, 300, true).resource.resourceRef,
    ])
  })

  it('稳定 JSON 选项可往返，缺失资源和尺寸漂移会在保存文档前明确失败', async () => {
    const source = layerStack()
    const encoded = serializeLayerStackV1ForImageEditor(source)
    expect(readLayerStackV1ImageEditorOption({
      [CANVAS_EDIT_V3_LAYER_STACK_OPTION]: encoded,
    })).toEqual(source)

    const degraded = layerStack()
    degraded.status = 'degraded'
    degraded.resources[1] = {
      ...degraded.resources[1],
      status: 'missing',
      filePath: null,
      byteLength: null,
      sha256: null,
    }
    await expect(importLayerStackV1AsImageEditDocumentV3({
      document: degraded,
      documentId: 'missing',
      ingestSource: vi.fn() as never,
    })).rejects.toThrow('缺失资源')

    await expect(importLayerStackV1AsImageEditDocumentV3({
      document: source,
      documentId: 'drifted',
      ingestSource: vi.fn(async () => managed(3, 1, 1, true)) as never,
    })).rejects.toThrow('尺寸已变化')
  })
})
