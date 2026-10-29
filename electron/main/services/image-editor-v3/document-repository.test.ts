import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { recordingFixtureSession } from '../../../../src/core/creativeIntent/fixtures/recordingFixtures'
import { ImageEditCommandHistoryV3 } from '../../../../src/core/imageEdit/v3/commandHistory'
import {
  createImageEditDocumentV3,
  createImageEditEffectLayerV3,
  createImageEditRasterLayerV3,
} from '../../../../src/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '../../../../src/core/imageEdit/v3/documentTypes'

import { writeBufferAtomically } from '../fs/atomic-file'
import {
  DocumentRevisionConflictError,
  ImageEditDocumentRepository,
  toProjectReference,
} from './document-repository'
import { ContentAddressedResourceStore } from './resource-store'
import { ImageEditHistoryPageStoreV3 } from './history-pages/store'
import { createImageEditSourceFingerprint } from './raster-export-snapshot'
import { normalizeImageEditorV3Document } from '../../ipc/image-editor-v3-payloads'

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-document-'))
})

afterEach(async () => {
  vi.restoreAllMocks()
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
  it('生成的大工作副本经 IPC 校验与分块落盘后完整读回', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    const rows = Array.from({ length: 530 }, (_, index) => `${index}:${'汉'.repeat(44_000)}`)
    const document: ImageEditDocumentV3 = {
      ...documentAt('large-checkpoint', 0),
      layers: [createImageEditEffectLayerV3('effect', '参数', 'test.effect', { rows })],
    }
    await repository.create(normalizeImageEditorV3Document(document))
    expect((await fsp.stat(path.join(rootDir, `${document.id}.json`))).size).toBeGreaterThan(64 * 1024 ** 2)
    const restored = (await repository.load(document.id)).document as ImageEditDocumentV3
    expect(restored.layers).toEqual(document.layers)
  }, 60_000)

  it('锁内预览发布保持最新检查点，不读写历史页；拒绝过期快照', async () => {
    const resources = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
    const repository = new ImageEditDocumentRepository(path.join(rootDir, 'documents'), { resources })
    const history = new ImageEditCommandHistoryV3()
    const initial = documentAt('preview-history', 0, 'start')
    const document = history.execute(initial, { type: 'layer.update-common', commandId: 'rename',
      expectedRevision: 0, layerId: 'layer-start', patch: { name: '最新名称' } })
    await repository.create({ documentId: document.id, revision: document.revision, document,
      history: history.createSnapshot() })
    const baseline = await repository.loadCheckpoint(document.id)
    const preview = await resources.putBuffer(Buffer.from('preview'))
    const prepare = vi.spyOn(ImageEditHistoryPageStoreV3.prototype, 'prepare')
    const validate = vi.spyOn(ImageEditHistoryPageStoreV3.prototype, 'validate')
    const open = vi.spyOn(ImageEditHistoryPageStoreV3.prototype, 'open')
    const saved = await repository.publishPreview(document.id, { expectedRevision: baseline.revision,
      sourceFingerprint: createImageEditSourceFingerprint(baseline), previewRef: preview.id })
    expect(saved.historyCheckpoint).toEqual(baseline.historyCheckpoint)
    expect(saved.previewRef).toBe(preview.id)
    expect(prepare).not.toHaveBeenCalled(); expect(validate).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled()
    const file = path.join(repository.rootDir, `${document.id}.json`)
    const bytes = await fsp.readFile(file)
    await expect(repository.publishPreview(document.id, { expectedRevision: 0,
      sourceFingerprint: createImageEditSourceFingerprint(saved), previewRef: preview.id })).rejects.toThrow('snapshot changed')
    await expect(repository.publishPreview(document.id, { expectedRevision: saved.revision,
      sourceFingerprint: `sha256:${'0'.repeat(64)}`, previewRef: preview.id })).rejects.toThrow('snapshot changed')
    expect(await fsp.readFile(file)).toEqual(bytes)
  })

  it('文档引用目录按稳定引用分页，不读取文档内容或暴露本地路径', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    for (const id of ['b', 'a0', 'a']) await repository.create({ documentId: id, revision: 0, document: documentAt(id, 0) })
    await fsp.writeFile(path.join(rootDir, 'incomplete.tmp'), 'temporary')
    const first = await repository.listReferences(undefined, 2)
    expect(first).toEqual({ documentRefs: ['image-edit-v3:a', 'image-edit-v3:a0'], nextCursor: 'image-edit-v3:a0' })
    expect(await repository.listReferences(first.nextCursor!, 2)).toEqual({ documentRefs: ['image-edit-v3:b'], nextCursor: null })
    await expect(repository.listReferences('image-edit-v3:../outside', 2)).rejects.toThrow()
    await expect(repository.listReferences(undefined, 101)).rejects.toThrow('limit')
  })

  it('从精确 revision fork 独立文档，后续编辑互不影响', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    await repository.create({
      documentId: 'fork-source',
      revision: 2,
      document: documentAt('fork-source', 2, 'source'),
    })

    const forked = await repository.fork({
      sourceDocumentRef: 'image-edit-v3:fork-source',
      expectedRevision: 2,
      targetDocumentId: 'fork-target',
    })
    expect(forked).toMatchObject({ documentId: 'fork-target', revision: 2 })
    expect((forked.document as ImageEditDocumentV3).id).toBe('fork-target')

    await repository.save({
      documentId: 'fork-target',
      expectedRevision: 2,
      document: documentAt('fork-target', 3, 'target-edited'),
      resourceRefs: [],
    })
    expect((await repository.load('fork-source')).revision).toBe(2)
    expect(((await repository.load('fork-source')).document as ImageEditDocumentV3).layers[0]?.name)
      .toBe('source')
    await expect(repository.fork({
      sourceDocumentRef: 'image-edit-v3:fork-source',
      expectedRevision: 1,
      targetDocumentId: 'fork-conflict',
    })).rejects.toBeInstanceOf(DocumentRevisionConflictError)
  })

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

  it('跨存储补偿只删除仍处于调用方精确 revision 的文档', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    await repository.create({
      documentId: 'rollback-document',
      document: documentAt('rollback-document', 0),
    })

    await expect(repository.deleteIfRevision('image-edit-v3:rollback-document', 1))
      .resolves.toBe(false)
    await expect(repository.load('rollback-document')).resolves.toMatchObject({ revision: 0 })
    await expect(repository.deleteIfRevision('image-edit-v3:rollback-document', 0))
      .resolves.toBe(true)
    await expect(repository.load('rollback-document')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(repository.deleteIfRevision('image-edit-v3:rollback-document', 0))
      .resolves.toBe(false)
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

  it('阻止 autosave 跨文档串写', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
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

  it('未知效果只保留 V3 参数；旧 V2 载荷和未登记图层明确拒绝', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    const futureEffect = {
      ...createImageEditEffectLayerV3(
        'future-effect',
        '未来效果',
        'image.future-effect',
        {},
        false,
      ),

    }
    const document: ImageEditDocumentV3 = {
      ...documentAt('future-document', 0),
      layers: [futureEffect],
    }
    const saved = await repository.create({
      documentId: document.id,
      document,
    })
    expect(saved.history).toBeUndefined()
    expect((saved.document as ImageEditDocumentV3).layers[0]).toMatchObject({
      renderable: false,
      params: {},
    })

    await expect(repository.create({ documentId: 'retired', document: { ...documentAt('retired', 0), layers: [{ ...futureEffect, legacyOperation: { sourceVersion: 2, operation: { amount: 0.5 } } }] } })).rejects.toThrow('invalid-v3-document')
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
    const repository = new ImageEditDocumentRepository(path.join(rootDir, 'documents'), { resources })
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
    expect(collected.deleted).toContain(tile.id)
    expect(await resources.has(tile.id)).toBe(false)
  })
})


it('讲解删除进入冷历史，正文画面免于回收，重开后能撤销和重做', async () => {
  const resources = new ContentAddressedResourceStore(path.join(rootDir, 'resources'))
  const repository = new ImageEditDocumentRepository(path.join(rootDir, 'documents'), { resources })
  const body = await resources.putBuffer(Buffer.from('private transcript'))
  const visual = await resources.putBuffer(Buffer.from('private visual'))
  const session = recordingFixtureSession('static')
  session.state = 'reviewing'; session.ownerRef = { kind: 'image_edit.document', id: 'v3:privacy' }
  const refs = [body, visual].map(resource => ({ resourceId: resource.id, digest: resource.id, path: `resources/${resource.sha256}`, bytes: resource.byteLength, kind: 'page' as const }))
  session.pages = [{ resourceId: body.id, digest: body.id, bytes: body.byteLength, kind: 'transcript', count: 1, monoSpanUs: [0, 1], seqSpan: [0, 0] }]
  session.clockSegments = [{ id: 'static', mode: 'hold', monoSpanUs: [0, 1], start: null, end: null, anchors: [] }]
  session.visualEvidenceRefs = [{ id: 'visual', kind: 'frame', resourceRef: { resourceId: visual.id, digest: visual.id, bytes: visual.byteLength }, size: [1, 1], pixelBudget: 1,
    frames: [{ eventId: 'frame', seq: 0, monoUs: 0, timeline: null, unavailableReason: 'static', clockSegmentRef: 'static', stateDigest: session.sourceDigest, geometrySnapshotRef: 'geometry', sourceRefs: [], pointer: null, reason: 'reference', attachmentRect: [0, 0, 1, 1] }] }]
  const initial = documentAt('privacy', 0, 'keep')
  const history = new ImageEditCommandHistoryV3(); history.clear(initial)
  const document = history.execute(initial, { type: 'document.set-creative-intents', commandId: 'private-head', expectedRevision: 0,
    intents: { drafts: [], sessions: [session], resources: refs }, resources: refs.map(ref => ({ resourceId: ref.resourceId, byteSize: ref.bytes })).sort((a, b) => a.resourceId.localeCompare(b.resourceId)) })
  const saved = await repository.create({ documentId: document.id, revision: document.revision, document, history: history.createSnapshot() })
  const reopened = await repository.loadPaged(document.id)
  expect(reopened.history).toHaveProperty('cold')
  const cold = new ImageEditCommandHistoryV3({ readPage: (checkpoint, index) => repository.readHistoryPage(checkpoint, index) })
  cold.restore(reopened.document as ImageEditDocumentV3, reopened.history)
  const obsolete = new Set(reopened.resourceRefs)
  const clean = cold.execute(reopened.document as ImageEditDocumentV3, { type: 'document.set-creative-intents', commandId: 'remove-explanation', expectedRevision: (reopened.document as ImageEditDocumentV3).revision,
    intents: { drafts: [], sessions: [], resources: [] }, resources: refs.map(ref => ({ resourceId: ref.resourceId, byteSize: ref.bytes })).sort((a, b) => a.resourceId.localeCompare(b.resourceId)) })
  await repository.save({ documentId: clean.id, expectedRevision: saved.revision, nextRevision: clean.revision, document: clean, history: cold.createSnapshot(), resourceRefs: [] })
  const live = new Set((await repository.list()).flatMap(value => value.resourceRefs))
  const erased = await resources.garbageCollect(live, { minimumAgeMs: 0, onlyResourceIds: obsolete })
  expect(erased.deleted).not.toContain(body.id); expect(erased.deleted).not.toContain(visual.id)
  expect(await resources.has(body.id)).toBe(true); expect(await resources.has(visual.id)).toBe(true)
  const persisted = await repository.loadPaged(clean.id)
  const final = new ImageEditCommandHistoryV3({ readPage: (checkpoint, index) => repository.readHistoryPage(checkpoint, index) })
  final.restore(persisted.document as ImageEditDocumentV3, persisted.history)
  let current = persisted.document as ImageEditDocumentV3
  await final.readEntryAt(final.getState().undoCount - 1)
  current = final.undo(current).document
  expect(JSON.stringify(current)).toContain(session.id)
  current = final.redo(current).document
  expect(JSON.stringify(current)).not.toContain(session.id)
  expect(current.layers).toEqual(initial.layers)
})
