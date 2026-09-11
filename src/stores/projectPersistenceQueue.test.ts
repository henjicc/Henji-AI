import { describe, expect, it, vi } from 'vitest'

import { createProjectPersistenceQueue } from './projectPersistenceQueue'

interface Snapshot {
  id: string
  version: number
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe('projectPersistenceQueue', () => {
  it('保存关联保留自己的快照，自动保存合并不能改写关联目标', async () => {
    const writes: Array<{ version: number; receipt?: string }> = []
    const queue = createProjectPersistenceQueue<Snapshot, string>({
      getProjectId: (project) => project.id,
      upsertProject: async (project, receipt) => { writes.push({ version: project.version, receipt }) },
      updateViewport: vi.fn(), deleteProject: vi.fn(), onBackgroundError: vi.fn(),
    })
    const release = queue.pauseProject('p1')
    const first = queue.flushProject({ id: 'p1', version: 1 }, 'operation-A')
    queue.queueProject({ id: 'p1', version: 2 })
    const second = queue.flushProject({ id: 'p1', version: 3 }, 'operation-B')
    queue.queueProject({ id: 'p1', version: 4 })
    release()
    await Promise.all([first, second])
    await vi.waitFor(() => expect(writes).toEqual([
      { version: 1, receipt: 'operation-A' }, { version: 3, receipt: 'operation-B' }, { version: 4, receipt: undefined },
    ]))
  })
  it('显式 flush 等待旧自动保存后写入最终快照', async () => {
    const first = deferred()
    const writes: number[] = []
    const upsertProject = vi.fn(async (project: Snapshot) => {
      writes.push(project.version)
      if (project.version === 1) await first.promise
    })
    const queue = createProjectPersistenceQueue<Snapshot>({
      getProjectId: (project) => project.id,
      upsertProject,
      updateViewport: vi.fn(),
      deleteProject: vi.fn(),
      onBackgroundError: vi.fn(),
    })

    queue.queueProject({ id: 'p1', version: 1 }, { immediate: true })
    const flushed = queue.flushProject({ id: 'p1', version: 2 })
    await Promise.resolve()
    expect(writes).toEqual([1])

    first.resolve()
    await flushed
    expect(writes).toEqual([1, 2])
  })

  it('flush 期间产生的更新排在显式快照之后，不会被旧写入覆盖', async () => {
    const explicit = deferred()
    const writes: number[] = []
    const queue = createProjectPersistenceQueue<Snapshot>({
      getProjectId: (project) => project.id,
      upsertProject: vi.fn(async (project: Snapshot) => {
        writes.push(project.version)
        if (project.version === 2) await explicit.promise
      }),
      updateViewport: vi.fn(),
      deleteProject: vi.fn(),
      onBackgroundError: vi.fn(),
    })

    const flushed = queue.flushProject({ id: 'p1', version: 2 })
    await Promise.resolve()
    queue.queueProject({ id: 'p1', version: 3 }, { immediate: true })
    explicit.resolve()
    await flushed
    // 屏障只确认它捕获的代次；后续用户编辑仍按序写，不延长已完成操作的等待。
    await vi.waitFor(() => expect(writes).toEqual([2, 3]))
  })

  it('删除等待进行中的保存，并丢弃排队中的旧快照', async () => {
    const first = deferred()
    const upsertProject = vi.fn(async (project: Snapshot) => {
      if (project.version === 1) await first.promise
    })
    const deleteProject = vi.fn(async () => undefined)
    const queue = createProjectPersistenceQueue<Snapshot>({
      getProjectId: (project) => project.id,
      upsertProject,
      updateViewport: vi.fn(),
      deleteProject,
      onBackgroundError: vi.fn(),
    })

    queue.queueProject({ id: 'p1', version: 1 }, { immediate: true })
    queue.queueProject({ id: 'p1', version: 2 })
    const deleting = queue.deleteProject('p1')
    await Promise.resolve()
    expect(deleteProject).not.toHaveBeenCalled()

    first.resolve()
    await deleting
    expect(upsertProject).toHaveBeenCalledTimes(1)
    expect(deleteProject).toHaveBeenCalledWith('p1', undefined)
  })

  it('显式写入失败会向调用方抛出，不能伪装成功', async () => {
    const failure = new Error('disk full')
    const queue = createProjectPersistenceQueue<Snapshot>({
      getProjectId: (project) => project.id,
      upsertProject: vi.fn().mockRejectedValue(failure),
      updateViewport: vi.fn(),
      deleteProject: vi.fn(),
      onBackgroundError: vi.fn(),
    })

    await expect(queue.flushProject({ id: 'p1', version: 1 })).rejects.toBe(failure)
  })
})
