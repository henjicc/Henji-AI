import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DocumentMeta } from '@/core/documents/types'

import { ImageDocumentPersistence } from './imageDocumentPersistence'

/*
 * 图片文档保存策略（3.5）：打开时的恢复询问、保存只落工作副本、写回带缩略图与覆盖标记、
 * 写回冲突后请会话再保存一次以弹出“重新载入 / 覆盖”、重新载入前先放下编辑器实例。
 */

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  describe: vi.fn(),
  create: vi.fn(),
  commit: vi.fn(),
}))

vi.mock('@/commands/imageEditorV3', () => ({
  createImageEditorV3RequestId: (operation: string) => `request:${operation}`,
  openImageEditorV3ImageDocument: mocks.open,
  describeImageEditorV3ImageDocument: mocks.describe,
  createImageEditorV3ImageDocument: mocks.create,
  commitImageEditorV3ImageDocument: mocks.commit,
}))

const meta: DocumentMeta = {
  id: 'doc-1', kind: 'image_document', name: '海报', path: 'D:/作品/图片文档/海报.henjiimg',
  container: { kind: 'user' }, draft: false, revision: 3, kindVersion: 1, createdAt: 1, updatedAt: 2,
}
const working = { documentRef: 'image-edit-v3:doc-1', revision: 7, previewRef: null, sourceUrl: null }
const readyResult = (imported = false) => ({
  status: 'ready',
  read: { meta, content: { workingRevision: 7, emptyUntilRevision: null, width: 10, height: 10, layers: 1 }, missingPaths: [], externalDirectories: [], unresolved: [] },
  working,
  imported,
})

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
})

describe('ImageDocumentPersistence', () => {
  it('工作副本有没写回的修改时先询问；选恢复后带 restore 再打开，取消则中止', async () => {
    mocks.open
      .mockResolvedValueOnce({ status: 'recovery', meta, workingSavedAt: 10, fileSavedAt: 5 })
      .mockResolvedValueOnce(readyResult())
    const chooseRecovery = vi.fn(async () => 'restore' as const)
    const persistence = new ImageDocumentPersistence({ chooseRecovery })
    const read = await persistence.read({ id: 'doc-1' }, 'open')
    expect(chooseRecovery).toHaveBeenCalledWith({ name: '海报', workingSavedAt: 10, fileSavedAt: 5 })
    expect(mocks.open.mock.calls.map(([request]) => request.recovery)).toEqual(['ask', 'restore'])
    expect(read.meta.id).toBe('doc-1')
    expect(persistence.working).toEqual(working)

    mocks.open.mockResolvedValueOnce({ status: 'recovery', meta, workingSavedAt: 10, fileSavedAt: 5 })
    const cancelled = new ImageDocumentPersistence({ chooseRecovery: async () => 'cancel' })
    await expect(cancelled.read({ id: 'doc-1' }, 'open')).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('后台打开（不询问）直接恢复工作副本，不丢修改', async () => {
    mocks.open
      .mockResolvedValueOnce({ status: 'recovery', meta, workingSavedAt: 10, fileSavedAt: 5 })
      .mockResolvedValueOnce(readyResult())
    await new ImageDocumentPersistence().read({ id: 'doc-1' }, 'open')
    expect(mocks.open.mock.calls[1][0].recovery).toBe('restore')
  })

  it('保存只把编辑器修改落进工作副本；写回带缩略图并返回新元信息', async () => {
    const persistence = new ImageDocumentPersistence()
    const flush = vi.fn(async () => undefined)
    const thumbnail = { bytes: new ArrayBuffer(4), mediaType: 'image/webp' as const, extension: 'webp' as const }
    persistence.setHooks({ flush, thumbnail: () => thumbnail })
    persistence.bindSession({ meta: () => meta, requestSave: () => undefined })
    await expect(persistence.save({ target: { id: 'doc-1' }, expectedRevision: 3, content: {} })).resolves.toEqual({ meta, unchanged: false })
    expect(flush).toHaveBeenCalledTimes(1)
    expect(mocks.commit).not.toHaveBeenCalled()

    mocks.commit.mockResolvedValueOnce({ meta: { ...meta, revision: 4 }, unchanged: false })
    await expect(persistence.commit('idle', meta)).resolves.toMatchObject({ revision: 4 })
    expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({
      target: { id: 'doc-1', path: meta.path }, expectedRevision: 3, thumbnail,
    }))
    expect(mocks.commit.mock.calls[0][0]).not.toHaveProperty('force')
  })

  it('写回冲突：请会话再保存一次，保存以冲突失败；选覆盖后下一次写回带 force；重新载入先放下实例再按文件解包', async () => {
    const persistence = new ImageDocumentPersistence()
    const requestSave = vi.fn()
    const beforeReload = vi.fn(async () => undefined)
    persistence.setHooks({ flush: async () => undefined, beforeReload })
    persistence.bindSession({ meta: () => meta, requestSave })
    mocks.commit.mockRejectedValueOnce(Object.assign(new Error('conflict'), { name: 'DocumentRevisionConflictError' }))
    await expect(persistence.commit('idle', meta)).rejects.toMatchObject({ name: 'DocumentRevisionConflictError' })
    expect(requestSave).toHaveBeenCalledTimes(1)
    await expect(persistence.save({ target: { id: 'doc-1' }, expectedRevision: 3, content: {} }))
      .rejects.toMatchObject({ name: 'DocumentRevisionConflictError' })

    await persistence.save({ target: { id: 'doc-1' }, expectedRevision: 3, content: {}, force: true })
    mocks.commit.mockResolvedValueOnce({ meta: { ...meta, revision: 9 }, unchanged: false })
    await persistence.commit('close', meta)
    expect(mocks.commit.mock.calls[1][0]).toMatchObject({ force: true })

    const replaced = vi.fn()
    persistence.onWorkingReplaced(replaced)
    mocks.open.mockResolvedValueOnce(readyResult(true))
    await persistence.read({ id: 'doc-1' }, 'reload')
    expect(beforeReload).toHaveBeenCalledTimes(1)
    expect(mocks.open.mock.calls.at(-1)?.[0].recovery).toBe('discard')
    expect(replaced).toHaveBeenCalledWith(working)
  })

  it('重新定位只描述工作副本，不重新解包', async () => {
    mocks.describe.mockResolvedValueOnce(readyResult())
    const persistence = new ImageDocumentPersistence()
    await persistence.read({ id: 'doc-1' }, 'relocate')
    expect(mocks.describe).toHaveBeenCalledTimes(1)
    expect(mocks.open).not.toHaveBeenCalled()
  })
})
