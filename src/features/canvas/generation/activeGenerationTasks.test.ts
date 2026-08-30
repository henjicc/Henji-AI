import { beforeEach, describe, expect, it, vi } from 'vitest'

const cancelTask = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/core/services/GenerationService', () => ({
  GenerationService: { getInstance: () => ({ cancelTask }) },
}))

import {
  acquireCanvasGenerationResumeLease,
  clearActiveCanvasGenerationTasksForTest,
  createCanvasGenerationTaskLifecycle,
  isCanvasGenerationTaskActive,
  isCanvasGenerationResumeLeaseCurrent,
  releaseCanvasGenerationResumeLease,
  releaseCanvasGenerationResumeLeasesForProject,
} from './activeGenerationTasks'

describe('createCanvasGenerationTaskLifecycle', () => {
  beforeEach(() => {
    cancelTask.mockClear()
    clearActiveCanvasGenerationTasksForTest()
  })

  it('持久化当前任务并阻止恢复续查重复接管', async () => {
    const persistTask = vi.fn()
    const lifecycle = createCanvasGenerationTaskLifecycle(() => true, persistTask)

    lifecycle.onTaskId('task-current')
    expect(persistTask).toHaveBeenCalledWith('task-current')
    expect(isCanvasGenerationTaskActive('task-current')).toBe(true)

    await lifecycle.cancelLatest()
    expect(cancelTask).toHaveBeenCalledWith('task-current')
    lifecycle.release()
    expect(isCanvasGenerationTaskActive('task-current')).toBe(false)
  })

  it('任务 ID 到达时项目已切换则取消且不持久化', async () => {
    const persistTask = vi.fn()
    const lifecycle = createCanvasGenerationTaskLifecycle(() => false, persistTask)

    lifecycle.onTaskId('task-stale')
    await vi.waitFor(() => expect(cancelTask).toHaveBeenCalledWith('task-stale'))
    expect(persistTask).not.toHaveBeenCalled()
    expect(isCanvasGenerationTaskActive('task-stale')).toBe(false)
  })

  it('恢复租约按项目与任务隔离，并且只有持有者可以释放', () => {
    const projectALease = acquireCanvasGenerationResumeLease('project-a', 'shared-task')
    const projectBLease = acquireCanvasGenerationResumeLease('project-b', 'shared-task')

    expect(projectALease).not.toBeNull()
    expect(projectBLease).not.toBeNull()
    expect(acquireCanvasGenerationResumeLease('project-a', 'shared-task')).toBeNull()

    releaseCanvasGenerationResumeLease('project-a', 'shared-task', Symbol('not-owner'))
    expect(isCanvasGenerationResumeLeaseCurrent(
      'project-a',
      'shared-task',
      projectALease as symbol,
    )).toBe(true)

    releaseCanvasGenerationResumeLease('project-a', 'shared-task', projectALease as symbol)
    expect(isCanvasGenerationResumeLeaseCurrent(
      'project-a',
      'shared-task',
      projectALease as symbol,
    )).toBe(false)
    expect(isCanvasGenerationResumeLeaseCurrent(
      'project-b',
      'shared-task',
      projectBLease as symbol,
    )).toBe(true)
  })

  it('项目切换只撤销旧项目的恢复租约', () => {
    const projectALease = acquireCanvasGenerationResumeLease('project-a', 'task-a') as symbol
    const projectBLease = acquireCanvasGenerationResumeLease('project-b', 'task-b') as symbol

    releaseCanvasGenerationResumeLeasesForProject('project-a')

    expect(isCanvasGenerationResumeLeaseCurrent('project-a', 'task-a', projectALease)).toBe(false)
    expect(isCanvasGenerationResumeLeaseCurrent('project-b', 'task-b', projectBLease)).toBe(true)
  })
})
