import { afterEach, expect, it, vi } from 'vitest'
import type { MediaCollectorOptions } from './collector'

const mocks = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), documents: vi.fn(), handoff: vi.fn(), collect: vi.fn(), trash: vi.fn(), coverage: vi.fn(), databaseAccess: vi.fn(), closed: false }))
vi.mock('electron', () => ({ shell: { trashItem: mocks.trash } }))
vi.mock('../db', () => ({ getDb: () => { mocks.databaseAccess(); if (mocks.closed) throw new Error('closed'); return { prepare: () => ({ get: () => ({ n: 11_263 }) }) } } }))
vi.mock('../db-locations', () => ({ databaseLocationContext: vi.fn() }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: vi.fn() }))
vi.mock('../logging/main-logger', () => ({ createMainLogger: () => ({ info: mocks.info, warn: mocks.warn }) }))
vi.mock('../image/managed-media-leases', () => ({ listManagedMediaFileLeases: () => [] }))
vi.mock('../image/path-utils', () => ({ listUploadImageLeases: () => [] }))
vi.mock('./queue', () => ({ managedMediaRoots: () => [] }))
vi.mock('./schema', () => ({ assertMediaStorageCoverage: mocks.coverage, MEDIA_REFERENCE_TABLES: {} }))
vi.mock('./providers', () => ({ collectDocumentReferences: mocks.documents, collectSqlReferences: vi.fn(), decodeReferenceValues: vi.fn(), recordReferences: vi.fn(), releaseDocumentSubmissionReferences: mocks.handoff }))
vi.mock('./collector', () => ({ collectUnreferencedMedia: mocks.collect }))
vi.mock('./store', () => ({ createRecycleStore: () => ({ store: {}, revision: () => 'stable', referencesReady: () => {}, remaining: () => 11_263, checkpointError: () => undefined, dispose: () => {} }) }))
import { runMediaRecycle } from './runtime'
import { MediaRecycleDeadline } from './lifecycle'

afterEach(() => { vi.resetAllMocks(); mocks.closed = false })

it.each([true, false])('引用普查未完成时保留全部候选，区分时间片结束与真实失败：%s', async deadline => {
  const controller = new AbortController()
  const error = deadline ? new MediaRecycleDeadline() : new Error('Unreadable document')
  if (deadline) controller.abort(error)
  mocks.documents.mockRejectedValue(error)
  await runMediaRecycle(controller.signal)
  expect(mocks.collect).not.toHaveBeenCalled()
  expect(mocks.trash).not.toHaveBeenCalled()
  if (deadline) {
    expect(mocks.warn).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ event: 'media_recycle.references.deferred' }))
  } else expect(mocks.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'media_recycle.sweep.failed', error }))
})

it('完整引用普查后交给回收器，删除适配器使用系统回收站', async () => {
  mocks.documents.mockResolvedValue({ references: [], protection: [] })
  await runMediaRecycle(new AbortController().signal)
  const options = mocks.collect.mock.calls[0][0] as MediaCollectorOptions
  await options.trashItem('owned-media.png')
  expect(mocks.trash).toHaveBeenCalledWith('owned-media.png')
})

it('退出关闭数据库后的延期日志只读内存计数，不重新取得数据库连接', async () => {
  mocks.documents.mockResolvedValue({ references: [], protection: [] })
  await runMediaRecycle(new AbortController().signal)
  const options = mocks.collect.mock.calls[0][0] as MediaCollectorOptions
  const accesses = mocks.databaseAccess.mock.calls.length
  mocks.closed = true
  options.log('deferred', { candidates: 11_263, deleted: 0, recycledBytes: 0, retained: {} })
  expect(mocks.databaseAccess).toHaveBeenCalledTimes(accesses)
  expect(mocks.warn).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ event: 'media_recycle.sweep.deferred', context: expect.objectContaining({ remaining: 11_263 }) }))
})

it('不可读链接的保守保护只参与回收保护，不当作生成结果已经进入文档', async () => {
  mocks.documents.mockResolvedValue({ references: ['actual.png'], protection: ['unpublished.png'] })
  await runMediaRecycle(new AbortController().signal)
  expect(mocks.handoff).toHaveBeenCalledWith(['actual.png'], expect.any(AbortSignal))
  const options = mocks.collect.mock.calls[0][0] as MediaCollectorOptions
  const held = await options.providers.find(provider => provider.id === 'documents-and-saved-history')!.collect(new AbortController().signal)
  expect([...held]).toEqual(['actual.png', 'unpublished.png'])
})
