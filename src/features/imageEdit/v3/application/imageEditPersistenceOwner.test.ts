import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentRepositoryV3 } from '@/core/imageEdit/v3/serviceContracts'
import { ImageMarkV3PersistenceQueue } from '@/features/imageMark/standalone/imageMarkV3Persistence'
import { ImageEditCommandBusV3 } from './imageEditCommandBus'
import { ImageEditPersistenceOwnerV3 } from './imageEditPersistenceOwner'
import { getLogEvents } from '@/core/logging/store'

function setup(save?: ImageEditDocumentRepositoryV3['save']) {
  const bus = new ImageEditCommandBusV3(createImageEditDocumentV3({ width: 8, height: 8, documentId: 'owned' }))
  const write = vi.fn(save ?? (async (document) => ({ documentId: document.id, revision: document.revision, previewRef: null })))
  const queue = new ImageMarkV3PersistenceQueue({ repository: { save: write },
    initialReference: { documentId: 'owned', revision: 0, previewRef: null }, initialHistory: bus.getPersistenceSnapshot().history })
  const owner = new ImageEditPersistenceOwnerV3('owned', queue, () => bus.getPersistenceSnapshot())
  const add = (id: string) => bus.dispatch({ type: 'layer.add', commandId: id,
    expectedRevision: bus.getSnapshot().document.revision, parentId: null, index: 0,
    layer: createImageEditRasterLayerV3(id, id) })
  return { bus, queue, owner, write, add }
}

describe('图片编辑唯一保存宿主', () => {
  it('保存成功和失败的正式日志context保留文档归属，而不是被logger忽略的顶层字段', async () => {
    const successful = setup()
    successful.add('logged-success')
    await successful.owner.confirm()
    expect(getLogEvents().filter((event) => event.event === 'image_edit.v3.persistence.confirm.completed').at(-1)?.context)
      .toEqual({ documentId: 'owned', revision: 1 })
    const failed = setup(async () => { throw new Error('受控拒写') })
    failed.add('logged-failure')
    await expect(failed.owner.confirm()).rejects.toThrow('保存未确认')
    expect(getLogEvents().filter((event) => event.event === 'image_edit.v3.persistence.confirm.failed').at(-1)?.context)
      .toEqual({ documentId: 'owned', stage: 'document' })
    successful.owner.dispose()
    failed.owner.dispose()
  })
  it('已有自动保存进行中时在业务修改前拒绝新批次，旧确认不能借新批次令牌落中间状态', async () => {
    let finish!: () => void
    const delayed = new Promise<void>((resolve) => { finish = resolve })
    const { owner, add, write } = setup(async (document) => {
      await delayed
      return { documentId: document.id, revision: document.revision, previewRef: null }
    })
    add('first')
    const autosave = owner.confirm()
    expect(() => owner.begin()).toThrow('REVISION_CONFLICT')
    finish(); await autosave
    const batch = owner.begin()
    add('second'); owner.acceptCurrent()
    add('third'); owner.acceptCurrent()
    await batch.confirm(); batch.release()
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls.map(([document]) => document.revision)).toEqual([1, 3])
  })
  it('跨步骤自动保存加入最终确认，不写中间快照', async () => {
    const { owner, add, write } = setup()
    const batch = owner.begin()
    add('first'); owner.acceptCurrent()
    const autosave = owner.confirm()
    await Promise.resolve()
    expect(write).not.toHaveBeenCalled()
    add('second'); owner.acceptCurrent()
    await batch.confirm()
    batch.release()
    await expect(autosave).resolves.toMatchObject({ revision: 2 })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0].layers).toHaveLength(2)
  })

  it('存储拒绝同时通知业务与 UI，重试保存最新内容而不重放命令', async () => {
    const { owner, add, write, bus } = setup()
    write.mockRejectedValueOnce(new Error('拒绝写入'))
    const batch = owner.begin()
    add('first'); owner.acceptCurrent()
    const autosave = owner.confirm()
    const automaticFailure = expect(autosave).rejects.toMatchObject({ facts: {
      memoryState: 'modified', persistenceState: 'unconfirmed', recovery: { replayMutation: false } } })
    await expect(batch.confirm()).rejects.toThrow('不要重复')
    batch.release()
    await automaticFailure
    expect(write).toHaveBeenCalledTimes(1)
    add('later')
    const history = bus.getPersistenceSnapshot().history
    await owner.confirm(true)
    expect(bus.getSnapshot().document.revision).toBe(2)
    expect(bus.getPersistenceSnapshot().history).toEqual(history)
    expect(write).toHaveBeenCalledTimes(2)
    expect(write.mock.calls[1]).toEqual([expect.objectContaining({ revision: 2 }),
      expect.objectContaining({ expectedRevision: 0 })])
  })

  it('异步步骤遇到外部新编辑时拒绝陈旧写入，确认仍保存最新内容', async () => {
    const { owner, add, write } = setup()
    const batch = owner.begin()
    add('external')
    expect(() => owner.assertCurrent()).toThrow('新的编辑')
    await batch.confirm(); batch.release()
    expect(write.mock.calls[0][0].revision).toBe(1)
  })

  it('原 owner 被替换后拒绝新确认，不能使用新宿主队列', async () => {
    const first = setup()
    first.add('old'); first.owner.dispose()
    const second = setup()
    await expect(first.owner.confirm()).rejects.toThrow('保存未确认')
    expect(first.write).not.toHaveBeenCalled()
    expect(second.write).not.toHaveBeenCalled()
    expect(first.owner.ownsQueue(second.queue)).toBe(false)
  })

  it('文档落盘后投影失败，重试只执行投影并回灌同版本权威预览', async () => {
    const { bus, queue, write, add } = setup()
    const projection = vi.fn().mockRejectedValueOnce(new Error('预览不可写')).mockResolvedValue({
      reference: { documentId: 'owned', revision: 1, previewRef: 'sha256:preview' },
      effects: [], resultingRevisions: { canvas: 4 },
    })
    const owner = new ImageEditPersistenceOwnerV3('owned', queue, () => bus.getPersistenceSnapshot(), projection)
    add('one')
    await expect(owner.confirm(true)).rejects.toMatchObject({ facts: { stage: 'projection' } })
    await expect(owner.confirm()).resolves.toMatchObject({ revision: 1, previewRef: 'sha256:preview' })
    expect(write).toHaveBeenCalledTimes(1)
    expect(projection).toHaveBeenCalledTimes(2)
    expect(bus.getSnapshot().document.revision).toBe(1)
    await owner.confirm(true)
    expect(projection).toHaveBeenCalledTimes(2)
  })

  it('低版本物化结果不能替换已经保存的新版本引用', async () => {
    const { queue, owner, add } = setup()
    add('one'); add('two'); await owner.confirm()
    expect(() => queue.confirmProjectionReference({ documentId: 'owned', revision: 1, previewRef: 'sha256:old' }))
      .toThrow('版本不一致')
    expect(queue.getReference()).toMatchObject({ revision: 2, previewRef: null })
  })
})
