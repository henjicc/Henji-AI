// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationTask } from '../types'
import type { HistoryRecord } from '@/services/database/types'

const mocks = vi.hoisted(() => ({ getHistory: vi.fn(), insertHistory: vi.fn(), updateHistory: vi.fn(), deleteHistory: vi.fn() }))
vi.mock('@/services/database/DatabaseService', () => ({ databaseService: mocks }))
vi.mock('@/utils/save', () => ({ isDesktop: () => true }))
vi.mock('@/utils/dataPath', () => ({ getDataRoot: async () => 'D:/fixture', convertPathArray: async (value: string[]) => value,
  convertPathString: async (value: string) => value }))
vi.mock('@/platform/desktopApi', () => ({ exists: async () => false, toDisplaySrc: (value: string) => value }))
vi.mock('@/services/largeUploadPolicy', () => ({ grantMediaAccessForReference: async () => undefined }))
import { useLoadTaskHistory, useSaveTaskHistory } from './useTaskHistory'

const record: HistoryRecord = { id: 'task-operation', providerId: 'provider', modelId: 'model', type: 'image', prompt: '图像',
  params: { __operationId: 'operation', prompt: '图像' }, filePath: null, taskId: 'provider-task', status: 'pending',
  errorMessage: null, cost: null, duration: null, createdAt: '2026-09-12T00:00:00.000Z', updatedAt: '2026-09-12T00:00:00.000Z' }

describe('生成历史恢复的原操作关联', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.getHistory.mockResolvedValue([record]) })
  afterEach(() => { vi.useRealTimers() })

  it('加载历史保留原操作和供应商任务，关联字段不会混入模型参数', async () => {
    const setTasks = vi.fn()
    const hook = renderHook(() => useLoadTaskHistory({ setTasks, setIsTasksLoaded: vi.fn(), isInitialLoadRef: { current: true } }))
    await waitFor(() => expect(setTasks).toHaveBeenCalled())
    const tasks = setTasks.mock.calls[0][0] as GenerationTask[]
    expect(tasks[0]).toMatchObject({ id: record.id, operationId: 'operation', serverTaskId: 'provider-task', status: 'pending' })
    expect(tasks[0].options).not.toHaveProperty('__operationId')
    expect(mocks.insertHistory).not.toHaveBeenCalled()
    expect(mocks.deleteHistory).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('正式历史保存保留执行关联，不能用业务 options 覆盖原操作', async () => {
    vi.useFakeTimers()
    const tasks: GenerationTask[] = [{ id: record.id, createdAt: new Date(record.createdAt), model: record.modelId,
      prompt: '图像', type: 'image', status: 'pending', serverTaskId: 'provider-task', operationId: 'operation',
      options: { __operationId: 'untrusted-option', prompt: '图像' } }]
    const initial = { current: false }
    const hook = renderHook(() => useSaveTaskHistory({ tasks, isTasksLoaded: true, isInitialLoadRef: initial }))
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    expect(mocks.updateHistory).toHaveBeenCalledWith(record.id, expect.objectContaining({
      taskId: 'provider-task', params: expect.objectContaining({ __operationId: 'operation' }),
    }))
    expect(mocks.deleteHistory).not.toHaveBeenCalled()
    hook.unmount()
  })
})
