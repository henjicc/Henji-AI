import { describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditPersistenceSnapshotV3 } from '@/core/imageEdit/v3/serviceContracts'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import { ImageMarkV3PersistenceQueue } from './imageMarkV3Persistence'
import { ImageEditCommandBusV3 } from '@/features/imageEdit/v3/application/imageEditCommandBus'

function documentAt(revision: number): ImageEditDocumentV3 {
  return {
    ...createImageEditDocumentV3({ width: 100, height: 80, documentId: 'toolbox-document' }),
    revision,
  }
}

function historyAt(revision: number): ImageEditCommandHistorySnapshotV3 {
  return {
    version: 1,
    documentId: 'toolbox-document',
    headRevision: revision,
    undo: [],
    redo: [],
  }
}

function persistenceAt(revision: number): ImageEditPersistenceSnapshotV3 {
  return { document: documentAt(revision), history: historyAt(revision), retainedResources: [] }
}

describe('ImageMarkV3PersistenceQueue', () => {
  it('合并中间 revision，只保存最新文档', async () => {
    const save = vi.fn(async (document: ImageEditDocumentV3) => ({
      documentId: document.id,
      revision: document.revision,
      previewRef: null,
    }))
    const queue = new ImageMarkV3PersistenceQueue({
      repository: { save },
      initialReference: { documentId: 'toolbox-document', revision: 0, previewRef: null },
      initialHistory: historyAt(0),
    })

    queue.enqueue(persistenceAt(1))
    queue.enqueue(persistenceAt(3))
    await expect(queue.flush()).resolves.toMatchObject({ revision: 3, previewRef: null })
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 3 }),
      expect.objectContaining({ expectedRevision: 0, previewRef: null, history: historyAt(3) }),
    )
  })

  it('保存失败后保留最新文档，重试仍使用已落盘 revision', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('disk unavailable'))
      .mockImplementationOnce(async (document: ImageEditDocumentV3) => ({
        documentId: document.id,
        revision: document.revision,
        previewRef: null,
      }))
    const queue = new ImageMarkV3PersistenceQueue({
      repository: { save },
      initialReference: { documentId: 'toolbox-document', revision: 0, previewRef: null },
      initialHistory: historyAt(0),
    })
    queue.enqueue(persistenceAt(2))

    await expect(queue.flush()).rejects.toThrow('disk unavailable')
    await expect(queue.flush()).resolves.toMatchObject({ revision: 2 })
    expect(save).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ revision: 2 }),
      expect.objectContaining({ expectedRevision: 0, previewRef: null, history: historyAt(2) }),
    )
  })

  it('拒绝把另一个文档混入同一保存队列', () => {
    const queue = new ImageMarkV3PersistenceQueue({
      repository: { save: vi.fn() },
      initialReference: { documentId: 'toolbox-document', revision: 0, previewRef: null },
      initialHistory: historyAt(0),
    })
    expect(() => queue.enqueue({
      ...persistenceAt(1),
      document: { ...documentAt(1), id: 'another-document' },
    })).toThrow(
      '不能切换文档',
    )
  })

  it('文档 revision 不变时仍可持久化清空后的历史', async () => {
    const bus = new ImageEditCommandBusV3(documentAt(0))
    bus.dispatch({
      type: 'layer.add',
      commandId: 'queue-add',
      expectedRevision: 0,
      parentId: null,
      index: 0,
      layer: createImageEditRasterLayerV3('layer', '图层'),
    })
    const persisted = bus.getPersistenceSnapshot()
    bus.clearHistory()
    const cleared = bus.getPersistenceSnapshot()
    const save = vi.fn(async (document: ImageEditDocumentV3) => ({
      documentId: document.id,
      revision: document.revision,
      previewRef: null,
    }))
    const queue = new ImageMarkV3PersistenceQueue({
      repository: { save },
      initialReference: {
        documentId: persisted.document.id,
        revision: persisted.document.revision,
        previewRef: null,
      },
      initialHistory: persisted.history,
    })

    queue.enqueue(cleared)
    await queue.flush()

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ revision: 1 }),
      expect.objectContaining({
        expectedRevision: 1,
        history: expect.objectContaining({ undo: [], redo: [], headRevision: 1 }),
      }),
    )
  })
})
