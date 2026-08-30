import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { writeBufferAtomically } from './atomic-file'
import {
  DocumentRevisionConflictError,
  ImageEditDocumentRepository,
  toProjectReference,
} from './document-repository'

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-document-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('ImageEditDocumentRepository', () => {
  it('以 revision CAS 保存并生成稳定的项目引用', async () => {
    const repository = new ImageEditDocumentRepository(rootDir)
    const created = await repository.create({ documentId: 'document-a', document: { layers: [] } })
    const saved = await repository.save({
      documentId: created.documentId,
      expectedRevision: 0,
      nextRevision: 4,
      document: { layers: [{ id: 'annotation' }] },
      resourceRefs: [],
    })

    expect(saved.revision).toBe(4)
    expect(toProjectReference(saved)).toEqual({ documentRef: 'image-edit-v3:document-a', revision: 4 })
    await expect(repository.save({
      documentId: created.documentId,
      expectedRevision: 0,
      document: { layers: [] },
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
    await repository.create({ documentId: 'atomic', document: { value: 'before' } })
    failWrites = true

    await expect(repository.save({
      documentId: 'atomic',
      expectedRevision: 0,
      document: { value: 'after' },
      resourceRefs: [],
    })).rejects.toThrow('injected disk failure')

    const current = await repository.load('atomic')
    expect(current.revision).toBe(0)
    expect(current.document).toEqual({ value: 'before' })
  })

  it('两个 repository 实例并发写同一 revision 时只有一个 CAS 成功', async () => {
    const firstRepository = new ImageEditDocumentRepository(rootDir)
    const secondRepository = new ImageEditDocumentRepository(rootDir)
    await firstRepository.create({ documentId: 'concurrent', document: { writer: 'none' } })
    const writes = await Promise.allSettled([
      firstRepository.save({
        documentId: 'concurrent',
        expectedRevision: 0,
        document: { writer: 'first' },
        resourceRefs: [],
      }),
      secondRepository.save({
        documentId: 'concurrent',
        expectedRevision: 0,
        document: { writer: 'second' },
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
    await repository.create({ documentId: 'autosave', document: { value: 0 } })
    const scheduler = repository.createAutosaveScheduler(10)
    const first = scheduler.schedule({
      documentId: 'autosave',
      expectedRevision: 0,
      document: { value: 1 },
      resourceRefs: [],
    })
    const second = scheduler.schedule({
      documentId: 'autosave',
      expectedRevision: 0,
      document: { value: 2 },
      resourceRefs: [],
    })

    await expect(first).resolves.toMatchObject({ revision: 1, document: { value: 2 } })
    await expect(second).resolves.toMatchObject({ revision: 1, document: { value: 2 } })
    expect((await repository.load('autosave')).document).toEqual({ value: 2 })
  })

  it('写入前执行与读取一致的体积准入，并阻止 autosave 跨文档串写', async () => {
    const repository = new ImageEditDocumentRepository(rootDir, { maxDocumentBytes: 256 })
    await expect(repository.create({
      documentId: 'oversized',
      document: { payload: 'x'.repeat(512) },
    })).rejects.toThrow('byte limit')

    await repository.create({ documentId: 'document-a', document: { value: 0 } })
    const scheduler = repository.createAutosaveScheduler(10)
    const pending = scheduler.schedule({
      documentId: 'document-a',
      expectedRevision: 0,
      document: { value: 1 },
      resourceRefs: [],
    })
    expect(() => scheduler.schedule({
      documentId: 'document-b',
      expectedRevision: 0,
      document: { value: 1 },
      resourceRefs: [],
    })).toThrow('already bound')
    await scheduler.flush()
    await expect(pending).resolves.toMatchObject({ documentId: 'document-a', revision: 1 })
  })
})
