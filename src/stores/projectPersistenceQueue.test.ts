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

    expect(writes).toEqual([2, 3])
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
    expect(deleteProject).toHaveBeenCalledWith('p1')
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
