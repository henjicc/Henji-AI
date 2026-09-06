import { describe, expect, it, vi } from 'vitest'
import { createProjectPersistenceQueue } from './projectPersistenceQueue'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}
function fixture(upsertProject = vi.fn(async (_project: { id: string; version: number }): Promise<void> => undefined)) {
  const deleteProject = vi.fn(async (_id: string) => undefined)
  const updateViewport = vi.fn(async (_id: string, _json: string) => undefined)
  const onBackgroundError = vi.fn()
  return { upsertProject, deleteProject, updateViewport, onBackgroundError,
    queue: createProjectPersistenceQueue({ getProjectId: (p: { id: string; version: number }) => p.id,
      upsertProject, deleteProject, updateViewport, onBackgroundError }) }
}

describe('项目持久化确认与恢复', () => {
  it('显式并发确认同项目不并发写；跨项目不相互阻塞', async () => {
    const blocked = deferred()
    const writes: string[] = []
    const f = fixture(vi.fn(async (p) => {
      writes.push(`${p.id}:${p.version}`)
      if (p.id === 'a' && p.version === 1) await blocked.promise
    }))
    const first = f.queue.flushProject({ id: 'a', version: 1 })
    const second = f.queue.flushProject({ id: 'a', version: 2 })
    await f.queue.flushProject({ id: 'b', version: 1 })
    expect(writes).toEqual(['a:1', 'b:1'])
    blocked.resolve()
    await Promise.all([first, second])
    expect(writes).toEqual(['a:1', 'b:1', 'a:2'])
  })

  it('失败后立即重试能够唤醒 writer，不丢失快照也不无限自动重试', async () => {
    const f = fixture()
    f.upsertProject.mockRejectedValueOnce(new Error('disk full'))
    await expect(f.queue.flushProject({ id: 'a', version: 1 })).rejects.toThrow('disk full')
    expect(f.upsertProject).toHaveBeenCalledTimes(1)
    await f.queue.flushProject({ id: 'a', version: 1 })
    expect(f.upsertProject).toHaveBeenCalledTimes(2)
  })

  it('删除失败后仍可保存最新内容；成功删除后迟到自动保存不复活工程', async () => {
    const f = fixture()
    f.queue.queueProject({ id: 'a', version: 2 })
    f.deleteProject.mockRejectedValueOnce(new Error('readonly'))
    await expect(f.queue.deleteProject('a')).rejects.toThrow('readonly')
    expect(f.queue.getUnsavedProject('a')).toEqual({ id: 'a', version: 2 })
    await f.queue.flushProject({ id: 'a', version: 3 })
    expect(f.upsertProject).toHaveBeenLastCalledWith({ id: 'a', version: 3 })
    await f.queue.deleteProject('a')
    f.queue.queueProject({ id: 'a', version: 1 }, { immediate: true })
    f.queue.queueViewport('a', 'old', { immediate: true })
    expect(f.upsertProject).toHaveBeenCalledTimes(1)
    expect(f.updateViewport).not.toHaveBeenCalled()
  })

  it('事务期间自动保存不能写中间结果，最终只写一次', async () => {
    const f = fixture()
    const release = f.queue.pauseProject('a')
    f.queue.queueProject({ id: 'a', version: 1 }, { immediate: true })
    f.queue.queueProject({ id: 'a', version: 2 }, { immediate: true })
    const confirmed = f.queue.flushProject({ id: 'a', version: 3 })
    expect(f.upsertProject).not.toHaveBeenCalled()
    release()
    await confirmed
    expect(f.upsertProject).toHaveBeenCalledTimes(1)
    expect(f.upsertProject).toHaveBeenCalledWith({ id: 'a', version: 3 })
  })

  it('删除期间的新编辑在删除拒绝后仍为最新待保存快照', async () => {
    const f = fixture()
    let refuse!: (error: Error) => void
    f.deleteProject.mockImplementationOnce(() => new Promise<undefined>((_resolve, reject) => { refuse = reject }))
    f.queue.queueProject({ id: 'a', version: 1 })
    const deletion = expect(f.queue.deleteProject('a')).rejects.toThrow('delete refused')
    f.queue.queueProject({ id: 'a', version: 2 }, { immediate: true })
    refuse(new Error('delete refused'))
    await deletion
    expect(f.queue.getUnsavedProject('a')).toEqual({ id: 'a', version: 2 })
    await f.queue.flushProject(f.queue.getUnsavedProject('a')!)
    expect(f.upsertProject).toHaveBeenCalledTimes(1)
    expect(f.upsertProject).toHaveBeenCalledWith({ id: 'a', version: 2 })
  })

  it('确认捕获的版本不等待随后持续编辑', async () => {
    const first = deferred(), later = deferred()
    const f = fixture(vi.fn(async (p) => { await (p.version === 1 ? first.promise : later.promise) }))
    const confirmed = f.queue.flushProject({ id: 'a', version: 1 })
    await Promise.resolve()
    f.queue.queueProject({ id: 'a', version: 2 }, { immediate: true })
    first.resolve()
    await confirmed
    later.resolve()
  })
})
