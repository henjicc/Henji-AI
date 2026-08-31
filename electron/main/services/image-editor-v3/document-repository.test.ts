import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ImageEditCommandHistoryV3 } from '../../../../src/core/imageEdit/v3/commandHistory'
import {
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '../../../../src/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '../../../../src/core/imageEdit/v3/documentTypes'

import { writeBufferAtomically } from './atomic-file'
import {
  DocumentRevisionConflictError,
  ImageEditDocumentRepository,
  toProjectReference,
} from './document-repository'
import { ContentAddressedResourceStore } from './resource-store'

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-document-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

function documentAt(documentId: string, revision: number, marker = ''): ImageEditDocumentV3 {
  return {
    ...createImageEditDocumentV3({ width: 100, height: 80, documentId }),
    revision,
    layers: marker ? [createImageEditRasterLayerV3(`layer-${marker}`, marker)] : [],
  }
}

describe('ImageEditDocumentRepository', () => {
  it('以 revision CAS 保存并生成稳定的项目引用', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    const created = await repository.create({
      documentId: 'document-a',
      document: documentAt('document-a', 0),
    })
    const saved = await repository.save({
      documentId: created.documentId,
      expectedRevision: 0,
      nextRevision: 4,
      document: documentAt('document-a', 4, 'annotation'),
      resourceRefs: [],
    })

    expect(saved.revision).toBe(4)
    expect(toProjectReference(saved)).toEqual({ documentRef: 'image-edit-v3:document-a', revision: 4 })
    await expect(repository.save({
      documentId: created.documentId,
      expectedRevision: 0,
      document: documentAt('document-a', 5),
      resourceRefs: [],
    })).rejects.toBeInstanceOf(DocumentRevisionConflictError)
    expect((await repository.load('image-edit-v3:document-a')).revision).toBe(4)
  })

  it('原子写失败时保留旧 revision 和旧文档', async () => {
    let failWrites = false
    const repository = new ImageEditDocumentRepository(rootDir, {
      writeAtomically: async (targetPath, content) => {
        if (failWrites) throw new Error('injected disk failure')
        await writeBufferAtomically(targetPath, content)
      },
    })
    await repository.create({ documentId: 'atomic', document: documentAt('atomic', 0, 'before') })
    failWrites = true

    await expect(repository.save({
      documentId: 'atomic',
      expectedRevision: 0,
      document: documentAt('atomic', 1, 'after'),
      resourceRefs: [],
    })).rejects.toThrow('injected disk failure')

    const current = await repository.load('atomic')
    expect(current.revision).toBe(0)
    expect((current.document as ImageEditDocumentV3).layers[0]?.name).toBe('before')
  })

  it('两个 repository 实例并发写同一 revision 时只有一个 CAS 成功', async () => {
    const firstRepository = new ImageEditDocumentRepository(rootDir)
    const secondRepository = new ImageEditDocumentRepository(rootDir)
    await firstRepository.create({
      documentId: 'concurrent',
      document: documentAt('concurrent', 0, 'none'),
    })
    const writes = await Promise.allSettled([
      firstRepository.save({
        documentId: 'concurrent',
        expectedRevision: 0,
        document: documentAt('concurrent', 1, 'first'),
        resourceRefs: [],
      }),
      secondRepository.save({
        documentId: 'concurrent',
        expectedRevision: 0,
        document: documentAt('concurrent', 1, 'second'),
        resourceRefs: [],
      }),
    ])

    expect(writes.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const rejected = writes.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({ reason: expect.any(DocumentRevisionConflictError) })
    expect((await firstRepository.load('concurrent')).revision).toBe(1)
  })

  it('500ms 接口可合并连续自动保存并只提交最新快照', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    await repository.create({ documentId: 'autosave', document: documentAt('autosave', 0) })
    const scheduler = repository.createAutosaveScheduler(10)
    const first = scheduler.schedule({
      documentId: 'autosave',
      expectedRevision: 0,
      document: documentAt('autosave', 1, 'first'),
      resourceRefs: [],
    })
    const second = scheduler.schedule({
      documentId: 'autosave',
      expectedRevision: 0,
      document: documentAt('autosave', 1, 'latest'),
      resourceRefs: [],
    })

    await expect(first).resolves.toMatchObject({ revision: 1 })
    await expect(second).resolves.toMatchObject({ revision: 1 })
    expect(((await repository.load('autosave')).document as ImageEditDocumentV3).layers[0]?.name)
      .toBe('latest')
  })

  it('写入前执行与读取一致的体积准入，并阻止 autosave 跨文档串写', async () => {
    const repository = new ImageEditDocumentRepository(rootDir, { maxDocumentBytes: 1_024 })
    const oversized: ImageEditDocumentV3 = {
      ...documentAt('oversized', 0),
      layers: [createImageEditEffectLayerV3(
        'oversized-effect',
        '过大参数',
        'test.effect',
        { payload: 'x'.repeat(4_096) },
      )],
    }
    await expect(repository.create({
      documentId: 'oversized',
      document: oversized,
    })).rejects.toThrow('byte limit')

    await repository.create({ documentId: 'document-a', document: documentAt('document-a', 0) })
    const scheduler = repository.createAutosaveScheduler(10)
    const pending = scheduler.schedule({
      documentId: 'document-a',
      expectedRevision: 0,
      document: documentAt('document-a', 1, 'pending'),
      resourceRefs: [],
    })
    expect(() => scheduler.schedule({
      documentId: 'document-b',
      expectedRevision: 0,
      document: documentAt('document-b', 1, 'other'),
      resourceRefs: [],
    })).toThrow('already bound')
    await scheduler.flush()
    await expect(pending).resolves.toMatchObject({ documentId: 'document-a', revision: 1 })
  })

  it('持久化历史后重载仍可撤销，并拒绝未知字段、错头和篡改补丁', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    const initial = createImageEditDocumentV3({
      width: 100,
      height: 80,
      documentId: 'history-restart',
    })
    const history = new ImageEditCommandHistoryV3()
    history.clear(initial)
    const edited = history.execute(initial, {
      type: 'layer.add',
      commandId: 'persisted-add',
      expectedRevision: 0,
      parentId: null,
      index: 0,
      layer: createImageEditRasterLayerV3('persisted-layer', '图层'),
      resources: [],
    })
    const snapshot = history.createSnapshot()
    await repository.create({
      documentId: edited.id,
      revision: edited.revision,
      document: edited,
      history: snapshot,
    })

    const loaded = await repository.load(edited.id)
    const restored = new ImageEditCommandHistoryV3()
    restored.restore(loaded.document as ImageEditDocumentV3, loaded.history)
    expect(restored.undo(loaded.document as ImageEditDocumentV3).document.layers).toHaveLength(0)

    await expect(repository.create({
      documentId: 'history-unknown',
      revision: edited.revision,
      document: { ...edited, id: 'history-unknown' },
      history: { ...snapshot, documentId: 'history-unknown', surprise: true } as never,
    })).rejects.toThrow('未知字段')
    await expect(repository.create({
      documentId: 'history-wrong-head',
      revision: edited.revision,
      document: { ...edited, id: 'history-wrong-head' },
      history: { ...snapshot, documentId: 'history-wrong-head', headRevision: 99 },
    })).rejects.toThrow('head')
    const tampered = structuredClone(snapshot)
    const inverse = tampered.undo[0]?.inverse
    if (inverse?.type === 'layer.delete') inverse.layerId = 'some-other-layer'
    await expect(repository.create({
      documentId: 'history-tampered',
      revision: edited.revision,
      document: { ...edited, id: 'history-tampered' },
      history: { ...tampered, documentId: 'history-tampered' },
    })).rejects.toThrow('逆向补丁')
  })

  it('无历史的早期 V3 也必须通过严格文档 codec，并保留 legacy 效果载荷', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    const legacy = {
      ...createImageEditEffectLayerV3(
        'legacy-effect',
        '旧效果',
        'legacy.v2.unknown',
        {},
        false,
      ),
      legacyOperation: {
        sourceVersion: 2 as const,
        operation: { type: 'future-effect', amount: 0.5 },
      },
    }
    const document: ImageEditDocumentV3 = {
      ...documentAt('legacy-document', 0),
      layers: [legacy],
    }
    const saved = await repository.create({
      documentId: document.id,
      document,
    })
    expect(saved.history).toBeUndefined()
    expect((saved.document as ImageEditDocumentV3).layers[0]).toMatchObject({
      renderable: false,
      legacyOperation: { operation: { type: 'future-effect', amount: 0.5 } },
    })

    await expect(repository.create({
      documentId: 'invalid-layer-document',
      document: {
        ...documentAt('invalid-layer-document', 0),
        layers: [{ type: 'unknown-layer', payload: true }],
      },
    })).rejects.toThrow('invalid-v3-document')
  })

  it('历史独占瓦片在保存期间进入 live set，清空历史后可由 GC 回收', async () => {
    const resources = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
    const tile = await resources.putBuffer(Buffer.from('undo tile'))
    const repository = new ImageEditDocumentRepository(path.join(rootDir, 'documents'))
    const initial: ImageEditDocumentV3 = {
      ...createImageEditDocumentV3({ width: 32, height: 32, documentId: 'history-gc' }),
      layers: [createImageEditRasterLayerV3('paint', '画笔')],
    }
    const history = new ImageEditCommandHistoryV3()
    history.clear(initial)
    const painted = history.execute(initial, {
      type: 'raster.apply-tile-delta',
      commandId: 'paint-one-tile',
      expectedRevision: 0,
      layerId: 'paint',
      changes: [{
        tileKey: '0:0:0',
        previousResourceId: null,
        previousByteSize: 0,
        resourceId: tile.id,
        byteSize: tile.byteLength,
      }],
    })
    const undone = history.undo(painted).document
    await repository.create({
      documentId: undone.id,
      revision: undone.revision,
      document: undone,
      history: history.createSnapshot(),
    })
    const liveBeforeClear = new Set((await repository.list()).flatMap((entry) => entry.resourceRefs))
    const retained = await resources.garbageCollect(liveBeforeClear, { minimumAgeMs: 0 })
    expect(retained.deleted).toEqual([])
    expect(await resources.has(tile.id)).toBe(true)

    history.clear(undone)
    await repository.save({
      documentId: undone.id,
      expectedRevision: undone.revision,
      nextRevision: undone.revision,
      document: undone,
      history: history.createSnapshot(),
      resourceRefs: [],
    })
    const liveAfterClear = new Set((await repository.list()).flatMap((entry) => entry.resourceRefs))
    const collected = await resources.garbageCollect(liveAfterClear, { minimumAgeMs: 0 })
    expect(collected.deleted).toEqual([tile.id])
    expect(await resources.has(tile.id)).toBe(false)
  })
})
