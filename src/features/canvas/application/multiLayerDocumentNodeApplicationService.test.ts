import { describe, expect, it, vi } from 'vitest'

import {
  imageEditV3GroupRef,
  imageEditV3LayerRef,
} from '@/features/imageEdit/v3/application/imageEditLiveSessionRegistry'

import type { LayerStackResultNodeData } from '../domain/canvasNodeData'
import {
  createStableLayerId,
  createStableLayerResourceId,
  createStableLayerStackId,
  type LayerStackDocumentV1,
} from '../domain/layerStack'
import {
  createMultiLayerDocumentNodeApplicationService,
  MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY,
  MultiLayerDocumentNodeApplicationError,
  type MultiLayerDocumentNodeCanvasPort,
  type MultiLayerDocumentNodePort,
  type MultiLayerDocumentNodeProjection,
} from './multiLayerDocumentNodeApplicationService'

const sourceImageUrl = 'henji-media://multi-layer/source.png'
const sourceSession = {
  kind: 'image-edit-v3' as const,
  sourceUrl: sourceImageUrl,
  documentRef: 'image-edit-v3:document-a' as const,
  revision: 2,
  previewRef: `sha256:${'a'.repeat(64)}` as const,
}
const flushedSession = { ...sourceSession, revision: 3 }

function nodeData(): LayerStackResultNodeData {
  return {
    resultKind: 'layer-stack',
    imageUrl: sourceImageUrl,
    previewImageUrl: 'henji-media://multi-layer/source-preview.webp',
    aspectRatio: '4:3',
    imageEditSession: sourceSession,
  }
}

function projection(
  documentRef = 'image-edit-v3:document-a',
  revision = 3,
): MultiLayerDocumentNodeProjection {
  const imageUrl = `henji-media://multi-layer/${documentRef.slice('image-edit-v3:'.length)}-${revision}.png`
  return {
    imageUrl,
    previewImageUrl: `${imageUrl}-preview.webp`,
    aspectRatio: '4:3',
    imageEditSession: {
      kind: 'image-edit-v3',
      sourceUrl: imageUrl,
      documentRef: documentRef as `image-edit-v3:${string}`,
      revision,
      previewRef: `sha256:${'b'.repeat(64)}`,
    },
  }
}

function legacyDocument(): LayerStackDocumentV1 {
  const completionId = 'completion-service'
  const stackId = createStableLayerStackId(completionId)
  const layerResourceId = createStableLayerResourceId(stackId, 0)
  return {
    version: 1,
    stackId,
    status: 'ready',
    source: { capabilityId: 'image.layer-separation', sourceNodeId: 'source', inputResourceId: 'input', providerId: 'volcengine', modelId: 'seedream', completionId },
    canvas: { width: 400, height: 300, colorSpace: 'srgb', alphaMode: 'straight', compositeOperation: 'source-over', clipPolicy: 'canvas-bounds' },
    compositeResourceId: `${stackId}:composite`,
    thumbnailResourceId: `${stackId}:thumbnail`,
    layers: [{ version: 1, layerId: createStableLayerId(stackId, 0), sourceOutputIndex: 0, providerZIndex: 0, order: 0, role: 'base', name: '底图', resourceId: layerResourceId, placement: { x: 0, y: 0, width: 400, height: 300 }, opacity: 1, visible: true, blendMode: 'normal', alpha: 'opaque' }],
    resources: [
      { version: 1, resourceId: layerResourceId, status: 'ready', filePath: '/base.jpg', mimeType: 'image/jpeg', width: 400, height: 300, hasAlpha: false, byteLength: 10, sha256: 'a' },
      { version: 1, resourceId: `${stackId}:composite`, status: 'ready', filePath: '/composite.png', mimeType: 'image/png', width: 400, height: 300, hasAlpha: true, byteLength: 10, sha256: 'b' },
      { version: 1, resourceId: `${stackId}:thumbnail`, status: 'ready', filePath: '/thumb.webp', mimeType: 'image/webp', width: 200, height: 150, hasAlpha: false, byteLength: 10, sha256: 'c' },
    ],
  }
}

function setup() {
  const documentPort: MultiLayerDocumentNodePort = {
    createFromLayerStack: vi.fn(async () => projection()),
    inspectDocument: vi.fn(async () => sourceSession),
    saveAndMaterialize: vi.fn(async () => ({
      projection: projection(),
      rollback: {
        documentRef: sourceSession.documentRef,
        revision: 3,
        sourceFingerprint: `sha256:${'c'.repeat(64)}` as const,
        previousPreviewRef: sourceSession.previewRef,
        installedPreviewRef: `sha256:${'b'.repeat(64)}` as const,
      },
    })),
    rollbackMaterialization: vi.fn(async () => true),
    finalizeMaterialization: vi.fn(async () => true),
    forkDocument: vi.fn(async () => projection('image-edit-v3:document-b', 1)),
    markReleaseCandidate: vi.fn(async () => undefined),
    materializeExportTarget: vi.fn(async () => ({
      imageUrl: 'henji-media://multi-layer/export.png',
      previewImageUrl: 'henji-media://multi-layer/export-preview.webp',
      aspectRatio: '4:3',
      width: 400,
      height: 300,
      mediaType: 'image/png' as const,
      hasAlpha: true as const,
      displayName: '图层 A',
      ownedFilePaths: ['/managed/export.png'],
      diagnostics: {
        documentId: 'document-a',
        revision: 2,
        targetKind: 'raster-layer' as const,
        targetId: 'layer-a',
        layerPath: ['layer-a'],
        canvasScope: 'document' as const,
        contentState: 'rendered' as const,
      },
    })),
    releaseExportRaster: vi.fn(async () => undefined),
  }
  const canvasPort: MultiLayerDocumentNodeCanvasPort = {
    commitMaterializedProjection: vi.fn(async () => undefined),
    commitLegacyMigration: vi.fn(async () => 'committed'),
    createExportedImageNode: vi.fn(async () => ({ nodeId: 'export-node', edgeId: 'export-edge' })),
  }
  return {
    documentPort,
    canvasPort,
    service: createMultiLayerDocumentNodeApplicationService({ documentPort, canvasPort }),
  }
}

describe('多图层文档节点 application 服务', () => {
  it('创建时只向窄端口传递 ready V1 文档并验证返回投影', async () => {
    const { service, documentPort } = setup()
    const document = legacyDocument()
    await expect(service.createFromLayerStack({ nodeId: 'node-a', document })).resolves.toMatchObject({
      imageEditSession: { documentRef: 'image-edit-v3:document-a' },
    })
    expect(documentPort.createFromLayerStack).toHaveBeenCalledWith({ nodeId: 'node-a', document })
  })

  it('打开时复核完整会话引用，版本不一致时返回可恢复冲突', async () => {
    const { service, documentPort } = setup()
    vi.mocked(documentPort.inspectDocument).mockResolvedValueOnce({ ...sourceSession, revision: 3 })
    await expect(service.openAndValidate({ nodeId: 'node-a', data: nodeData() })).rejects.toMatchObject({
      code: 'DOCUMENT_CONFLICT',
      recoverable: true,
    })
  })

  it('保存物化后以跳过画布历史策略原位回写', async () => {
    const { service, documentPort, canvasPort } = setup()
    const result = await service.saveMaterializedProjection({
      projectId: 'project-a',
      nodeId: 'node-a',
      data: nodeData(),
      session: flushedSession,
    })
    expect(result.imageEditSession.revision).toBe(3)
    expect(canvasPort.commitMaterializedProjection).toHaveBeenCalledWith({
      projectId: 'project-a',
      nodeId: 'node-a',
      expectedSession: sourceSession,
      projection: result,
      historyPolicy: MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY,
    })
    expect(documentPort.finalizeMaterialization).toHaveBeenCalledOnce()
  })

  it('画布 CAS 未接管新物化结果时精确回滚文档 previewRef', async () => {
    const { service, documentPort, canvasPort } = setup()
    vi.mocked(canvasPort.commitMaterializedProjection).mockRejectedValueOnce(new Error('节点已删除'))
    await expect(service.saveMaterializedProjection({
      projectId: 'project-a',
      nodeId: 'node-a',
      data: nodeData(),
      session: flushedSession,
    })).rejects.toMatchObject({ code: 'OPERATION_FAILED', recoverable: true })
    expect(documentPort.rollbackMaterialization).toHaveBeenCalledOnce()
    expect(documentPort.finalizeMaterialization).not.toHaveBeenCalled()
  })

  it('节点已接管投影后旧预览释放失败只登记清理候选，不回滚成功状态', async () => {
    const { service, documentPort, canvasPort } = setup()
    vi.mocked(documentPort.finalizeMaterialization).mockRejectedValueOnce(new Error('resource busy'))

    await expect(service.saveMaterializedProjection({
      projectId: 'project-a',
      nodeId: 'node-a',
      data: nodeData(),
      session: flushedSession,
    })).resolves.toMatchObject({ imageEditSession: { revision: 3 } })
    expect(canvasPort.commitMaterializedProjection).toHaveBeenCalledOnce()
    expect(documentPort.rollbackMaterialization).not.toHaveBeenCalled()
  })

  it('关闭 flush 结果切换文档或倒退 revision 时不进入物化端口', async () => {
    const { service, documentPort } = setup()
    await expect(service.saveMaterializedProjection({
      projectId: 'project-a',
      nodeId: 'node-a',
      data: nodeData(),
      session: { ...flushedSession, documentRef: 'image-edit-v3:other-document' },
    })).rejects.toMatchObject({ code: 'DOCUMENT_CONFLICT', recoverable: true })
    expect(documentPort.saveAndMaterialize).not.toHaveBeenCalled()
  })

  it('复制必须产生独立文档，释放只登记候选而不硬删除', async () => {
    const { service, documentPort } = setup()
    const forked = await service.forkDocument({
      sourceNodeId: 'node-a', targetNodeId: 'node-b', data: nodeData(),
    })
    expect(forked.imageEditSession.documentRef).toBe('image-edit-v3:document-b')
    await service.markReleaseCandidate({ nodeId: 'node-a', data: nodeData() })
    expect(documentPort.markReleaseCandidate).toHaveBeenCalledWith({
      nodeId: 'node-a', session: sourceSession, signal: undefined,
    })

    vi.mocked(documentPort.forkDocument).mockResolvedValueOnce(projection(sourceSession.documentRef, 3))
    await expect(service.forkDocument({
      sourceNodeId: 'node-a', targetNodeId: 'node-c', data: nodeData(),
    })).rejects.toMatchObject({ code: 'DOCUMENT_CONFLICT', recoverable: false })
  })

  it('独立导出先校验稳定引用所属文档，再创建普通图片节点与连线', async () => {
    const { service, documentPort, canvasPort } = setup()
    const target = { kind: 'raster-layer', ref: imageEditV3LayerRef('document-a', 'layer-a') }
    await expect(service.exportTarget({
      projectId: 'project-a', sourceNodeId: 'node-a', data: nodeData(), target,
    })).resolves.toMatchObject({ nodeId: 'export-node', edgeId: 'export-edge' })
    expect(documentPort.materializeExportTarget).toHaveBeenCalledWith({
      session: sourceSession,
      target,
      signal: undefined,
    })
    expect(canvasPort.createExportedImageNode).toHaveBeenCalledOnce()

    await expect(service.exportTarget({
      projectId: 'project-a',
      sourceNodeId: 'node-a',
      data: nodeData(),
      target: { kind: 'layer-group', ref: imageEditV3GroupRef('other-document', 'group-a') },
    })).rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(documentPort.materializeExportTarget).toHaveBeenCalledTimes(1)
  })

  it('画布事务未接管独立导出资源时执行补偿释放', async () => {
    const { service, documentPort, canvasPort } = setup()
    vi.mocked(canvasPort.createExportedImageNode).mockRejectedValueOnce(new Error('画布事务冲突'))
    await expect(service.exportTarget({
      projectId: 'project-a',
      sourceNodeId: 'node-a',
      data: nodeData(),
      target: { kind: 'raster-layer', ref: imageEditV3LayerRef('document-a', 'layer-a') },
    })).rejects.toMatchObject({ code: 'OPERATION_FAILED', recoverable: true })
    expect(documentPort.releaseExportRaster).toHaveBeenCalledWith({
      raster: expect.objectContaining({ imageUrl: 'henji-media://multi-layer/export.png' }),
    })
  })

  it('效果层、调整层和取消路径在进入窄端口前明确拒绝', async () => {
    const { service, documentPort } = setup()
    await expect(service.exportTarget({
      projectId: 'project-a', sourceNodeId: 'node-a', data: nodeData(), target: { kind: 'effect-layer' },
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_EXPORT_TARGET', recoverable: false })
    await expect(service.exportTarget({
      projectId: 'project-a', sourceNodeId: 'node-a', data: nodeData(), target: { kind: 'adjustment-layer' },
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_EXPORT_TARGET', recoverable: false })
    expect(documentPort.materializeExportTarget).not.toHaveBeenCalled()

    const controller = new AbortController()
    controller.abort()
    await expect(service.openAndValidate({
      nodeId: 'node-a', data: nodeData(), signal: controller.signal,
    })).rejects.toBeInstanceOf(MultiLayerDocumentNodeApplicationError)
    expect(documentPort.inspectDocument).not.toHaveBeenCalled()
  })

  it('旧 V1 节点开启时返回可恢复的迁移要求', async () => {
    const { service } = setup()
    await expect(service.openAndValidate({
      nodeId: 'node-a',
      data: {
        resultKind: 'layer-stack',
        imageUrl: '/composite.png',
        previewImageUrl: '/thumb.webp',
        aspectRatio: '4:3',
        layerStackDocument: legacyDocument(),
      },
    })).rejects.toMatchObject({ code: 'MIGRATION_REQUIRED', recoverable: true })
  })

  it('旧 V1 首次迁移创建 V3 并通过无画布历史 CAS 接管', async () => {
    const { service, documentPort, canvasPort } = setup()
    const document = legacyDocument()
    const data: LayerStackResultNodeData = {
      resultKind: 'layer-stack',
      imageUrl: '/composite.png',
      previewImageUrl: '/thumb.webp',
      aspectRatio: '4:3',
      layerStackDocument: document,
    }
    await expect(service.migrateLegacyDocument({
      projectId: 'project-a', nodeId: 'node-a', data,
    })).resolves.toMatchObject({ imageEditSession: { documentRef: 'image-edit-v3:document-a' } })
    expect(documentPort.createFromLayerStack).toHaveBeenCalledWith({ nodeId: 'node-a', document, signal: undefined })
    expect(canvasPort.commitLegacyMigration).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'project-a',
      nodeId: 'node-a',
      expectedDocument: document,
      historyPolicy: MULTI_LAYER_NODE_PROJECTION_HISTORY_POLICY,
    }))
  })

  it('旧 V1 迁移成功后再次打开直接复用同一会话，不重复摄取', async () => {
    const { service, documentPort, canvasPort } = setup()
    await expect(service.migrateLegacyDocument({
      projectId: 'project-a', nodeId: 'node-a', data: nodeData(),
    })).resolves.toMatchObject({ imageEditSession: sourceSession })
    expect(documentPort.createFromLayerStack).not.toHaveBeenCalled()
    expect(canvasPort.commitLegacyMigration).not.toHaveBeenCalled()
  })

  it('旧 V1 迁移 CAS 失败保留可重试错误并登记新文档候选', async () => {
    const { service, documentPort, canvasPort } = setup()
    vi.mocked(canvasPort.commitLegacyMigration).mockRejectedValueOnce(new Error('node changed'))
    await expect(service.migrateLegacyDocument({
      projectId: 'project-a',
      nodeId: 'node-a',
      data: {
        resultKind: 'layer-stack',
        imageUrl: '/composite.png',
        previewImageUrl: '/thumb.webp',
        aspectRatio: '4:3',
        layerStackDocument: legacyDocument(),
      },
    })).rejects.toMatchObject({ code: 'OPERATION_FAILED', recoverable: true })
    expect(documentPort.markReleaseCandidate).toHaveBeenCalledWith(expect.objectContaining({
      nodeId: 'node-a',
      session: expect.objectContaining({ documentRef: 'image-edit-v3:document-a' }),
    }))
  })
})
