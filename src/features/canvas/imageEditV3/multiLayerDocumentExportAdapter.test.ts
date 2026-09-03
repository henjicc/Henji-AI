import { describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
} from '@/core/imageEdit/v3'
import {
  imageEditV3LayerRef,
} from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'
import type {
  ImageEditorV3DocumentSnapshot,
  ImageEditorV3StandaloneRasterExportResult,
} from '@/platform/contracts/imageEditorV3'

import type { MultiLayerDocumentExportTarget } from '../domain/multiLayerDocumentNode'
import { createMultiLayerDocumentExportPort } from './multiLayerDocumentExportAdapter'

const SOURCE = `sha256:${'1'.repeat(64)}` as const
const PREVIEW = `sha256:${'2'.repeat(64)}` as const
const FINGERPRINT = `sha256:${'3'.repeat(64)}` as const

function snapshot(includeSource = true): ImageEditorV3DocumentSnapshot {
  const document = createImageEditDocumentV3({
    width: 4,
    height: 2,
    documentId: 'document-a',
    sourceResourceId: SOURCE,
  })
  document.revision = 3
  document.layers[0].id = 'layer-a'
  document.layers[0].name = '人物'
  return {
    documentRef: 'image-edit-v3:document-a',
    revision: 3,
    previewRef: PREVIEW,
    document,
    history: null,
    resourceRefs: includeSource ? [SOURCE, PREVIEW] : [PREVIEW],
    resources: [
      ...(includeSource ? [{ resourceRef: SOURCE, byteLength: 32, mediaType: 'image/png' }] : []),
      { resourceRef: PREVIEW, byteLength: 16, mediaType: 'image/png' },
    ],
    sourceFingerprint: FINGERPRINT,
  }
}

const session = {
  kind: 'image-edit-v3' as const,
  sourceUrl: '/source.png',
  documentRef: 'image-edit-v3:document-a' as const,
  revision: 3,
  previewRef: PREVIEW,
}

const target: MultiLayerDocumentExportTarget = {
  kind: 'raster-layer',
  ref: imageEditV3LayerRef('document-a', 'layer-a') as Extract<
    MultiLayerDocumentExportTarget,
    { kind: 'raster-layer' }
  >['ref'],
}

function materialized(): ImageEditorV3StandaloneRasterExportResult {
  return {
    outputRef: 'image-export-v3:document-a@3:png8',
    documentRef: 'image-edit-v3:document-a',
    revision: 3,
    sourceFingerprint: FINGERPRINT,
    format: 'png8',
    width: 4,
    height: 2,
    publication: 'standalone-image',
    imagePath: '/managed/person.png',
    createdFilePaths: ['/managed/person.png'],
  }
}

describe('多图层文档独立导出窄适配器', () => {
  it('从稳定图层引用物化原画布 PNG 并返回 3.2 所需诊断信息', async () => {
    const source = snapshot()
    const before = JSON.stringify(source)
    const materialize = vi.fn(async () => materialized())
    const releaseManagedImages = vi.fn(async () => undefined)
    const port = createMultiLayerDocumentExportPort({
      loadDocument: vi.fn(async () => source),
      materialize,
      releaseManagedImages,
    })

    const raster = await port.materializeExportTarget({ session, target })
    expect(raster).toMatchObject({
      imageUrl: '/managed/person.png',
      previewImageUrl: '/managed/person.png',
      aspectRatio: '2:1',
      width: 4,
      height: 2,
      mediaType: 'image/png',
      hasAlpha: true,
      displayName: '人物',
      diagnostics: {
        documentId: 'document-a',
        revision: 3,
        targetKind: 'raster-layer',
        targetId: 'layer-a',
        layerPath: ['layer-a'],
        canvasScope: 'document',
        contentState: 'rendered',
      },
    })
    expect(materialize).toHaveBeenCalledWith(expect.objectContaining({
      documentRef: source.documentRef,
      revision: source.revision,
      sourceFingerprint: source.sourceFingerprint,
      format: 'png8',
      description: expect.objectContaining({ width: 4, height: 2, alphaMode: 'straight' }),
      tileSize: 512,
    }), undefined)
    expect(JSON.stringify(source)).toBe(before)

    await port.releaseExportRaster({ raster })
    expect(releaseManagedImages).toHaveBeenCalledWith(['/managed/person.png'])
  })

  it('在像素资源缺失和版本冲突时禁止进入物化', async () => {
    const materialize = vi.fn(async () => materialized())
    const missingPort = createMultiLayerDocumentExportPort({
      loadDocument: vi.fn(async () => snapshot(false)),
      materialize,
    })
    await expect(missingPort.materializeExportTarget({ session, target })).rejects.toMatchObject({
      code: 'OPERATION_FAILED',
      recoverable: true,
    })

    const conflict = snapshot()
    conflict.revision = 4
    conflict.document.revision = 4
    const conflictPort = createMultiLayerDocumentExportPort({
      loadDocument: vi.fn(async () => conflict),
      materialize,
    })
    await expect(conflictPort.materializeExportTarget({ session, target })).rejects.toMatchObject({
      code: 'DOCUMENT_CONFLICT',
      recoverable: true,
    })
    expect(materialize).not.toHaveBeenCalled()
  })

  it('对伪装成栅格引用的效果层和已取消任务明确拒绝', async () => {
    const source = snapshot()
    source.document.layers.push(createImageEditEffectLayerV3(
      'effect-a', '模糊', 'image.gaussian-blur-v2', { radius: 4 },
    ))
    const materialize = vi.fn(async () => materialized())
    const port = createMultiLayerDocumentExportPort({
      loadDocument: vi.fn(async () => source),
      materialize,
    })
    await expect(port.materializeExportTarget({
      session,
      target: {
        kind: 'raster-layer',
        ref: imageEditV3LayerRef('document-a', 'effect-a') as Extract<
          MultiLayerDocumentExportTarget,
          { kind: 'raster-layer' }
        >['ref'],
      },
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_EXPORT_TARGET' })

    const controller = new AbortController()
    controller.abort()
    await expect(port.materializeExportTarget({ session, target, signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' })
    expect(materialize).not.toHaveBeenCalled()
  })

  it('物化回传版本不一致时先补偿新建图片', async () => {
    const releaseManagedImages = vi.fn(async () => undefined)
    const port = createMultiLayerDocumentExportPort({
      loadDocument: vi.fn(async () => snapshot()),
      materialize: vi.fn(async () => ({ ...materialized(), revision: 4 })),
      releaseManagedImages,
    })
    await expect(port.materializeExportTarget({ session, target })).rejects.toMatchObject({
      code: 'DOCUMENT_CONFLICT',
    })
    expect(releaseManagedImages).toHaveBeenCalledWith(['/managed/person.png'])
  })

  it('HDR 文档在创建任何受管图片前被明确拒绝', async () => {
    const source = snapshot()
    source.document.color.hdrMetadata = {
      standard: 'pq', referenceWhiteNits: 203,
      cicp: { colorPrimaries: 9, transferCharacteristics: 16, matrixCoefficients: 9, fullRange: false },
    }
    const materialize = vi.fn(async () => materialized())
    const port = createMultiLayerDocumentExportPort({
      loadDocument: vi.fn(async () => source), materialize,
    })

    await expect(port.materializeExportTarget({ session, target })).rejects.toMatchObject({
      code: 'UNSUPPORTED_EXPORT_TARGET',
      message: expect.stringContaining('HDR'),
    })
    expect(materialize).not.toHaveBeenCalled()
  })
})
