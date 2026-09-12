// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { GenerationTask } from '../types'
import type { HistoryRecord } from '@/services/database/types'

const storage = vi.hoisted(() => ({ rows: new Map<string, unknown>(), beforeWrite: undefined as undefined | ((id: string) => Promise<void>), writes: [] as string[] }))
vi.mock('@/services/database/DatabaseService', () => ({ databaseService: {
  getHistoryById: vi.fn(async (id: string) => storage.rows.get(id)),
  getHistory: vi.fn(() => { throw new Error('禁止整表读取') }),
  insertHistory: vi.fn(async (record: { id: string }) => { await storage.beforeWrite?.(record.id); storage.writes.push(record.id); storage.rows.set(record.id, structuredClone(record)) }),
  updateHistory: vi.fn(async (id: string, record: unknown) => { await storage.beforeWrite?.(id); storage.writes.push(id); storage.rows.set(id, structuredClone(record)) }),
  deleteHistory: vi.fn(async (id: string) => { storage.rows.delete(id) }),
} }))
vi.mock('@/utils/save', () => ({ isDesktop: () => true }))
vi.mock('@/utils/dataPath', () => ({ getDataRoot: async () => '/data', convertPathArray: async (value: string[]) => value, convertPathString: async (value: string) => value }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }))
vi.mock('@/utils/historyThumbnail', () => ({ getOrCreateHistoryThumbnail: vi.fn(async () => '') }))
import { databaseService } from '@/services/database/DatabaseService'
import { useTaskState } from './useTaskState'
import { awaitGenerationTaskPersistence, createPersistedGenerationTask, deletePersistedGenerationTask, persistGenerationTask, useSaveTaskHistory } from './useTaskHistory'
import { applicationGenerationTaskId } from '@/core/application-control/operationIdentity'

function gate() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve }); return { promise, release } }
function task(id = crypto.randomUUID()): GenerationTask { return { id, createdAt: new Date(), type: 'image', prompt: '保存测试', model: 'model', status: 'queued', options: { size: 'small' } } }
function saved(id: string) { return storage.rows.get(id) as HistoryRecord | undefined }
afterEach(() => { cleanup(); storage.beforeWrite = undefined; vi.useRealTimers(); vi.clearAllMocks(); storage.rows.clear(); storage.writes.length = 0 })

it('跨任务延迟和旧防抖快照不覆盖后来的成功状态，数据库只按主键读取', async () => {
  vi.useFakeTimers()
  const a = task(); const b = task(); const started = gate(); const blocked = gate()
  storage.beforeWrite = async (id) => { if (id === a.id) { started.release(); await blocked.promise } }
  const { result } = renderHook(() => {
    const state = useTaskState()
    useSaveTaskHistory({ tasks: state.tasks, isTasksLoaded: true, isInitialLoadRef: { current: false } })
    return state
  })
  act(() => result.current.setTasks([a, b]))
  await started.promise
  act(() => { vi.advanceTimersByTime(1000); result.current.updateTask(b.id, { status: 'success', result: { id: b.id, type: 'image', prompt: b.prompt, createdAt: new Date(), url: '/result.png', filePath: '/result.png' } }) })
  blocked.release()
  await act(async () => { await awaitGenerationTaskPersistence(b.id); vi.advanceTimersByTime(1000) })
  expect(saved(b.id)).toMatchObject({ status: 'success', filePath: '/result.png', params: { __resultUrl: '/result.png' } })
  expect(databaseService.getHistory).not.toHaveBeenCalled()
})

it('删除与在途保存串行，墓碑使后到旧快照不能复活任务', async () => {
  const value = task(); const started = gate(); const blocked = gate()
  storage.beforeWrite = async () => { started.release(); await blocked.promise }
  const initial = persistGenerationTask(value)
  await started.promise
  const removal = deletePersistedGenerationTask(value.id)
  const stale = persistGenerationTask({ ...value, status: 'success' })
  blocked.release()
  await Promise.all([initial, removal, stale, awaitGenerationTaskPersistence(value.id)])
  expect(saved(value.id)).toBeUndefined()
  expect(storage.writes).toEqual([value.id])
})

it('同一渲染批次的尺寸、选项和状态更新合并后等待最新落盘', async () => {
  const value = task(); const { result } = renderHook(() => useTaskState())
  act(() => result.current.hydrateTasks([value]))
  act(() => {
    result.current.rememberResultImageDimensions(value.id, 0, { width: 640, height: 480 })
    result.current.updateTask(value.id, { status: 'success', dimensions: '640x480' })
    result.current.rememberResultImageDimensions(value.id, 1, { width: 320, height: 240 })
  })
  await awaitGenerationTaskPersistence(value.id)
  expect(saved(value.id)).toMatchObject({ status: 'success', params: { size: 'small', __dimensions: '640x480', resultImageDimensions: [{ width: 640, height: 480 }, { width: 320, height: 240 }] } })
  expect(result.current.tasks[0].status).toBe('success')
})

it('等待保存不会在最新状态仍被存储阻塞时提前完成', async () => {
  const value = task(); await persistGenerationTask(value)
  const started = gate(); const blocked = gate()
  storage.beforeWrite = async () => { started.release(); await blocked.promise }
  const { result } = renderHook(() => useTaskState())
  act(() => result.current.hydrateTasks([value]))
  act(() => result.current.updateTask(value.id, { status: 'success' }))
  await started.promise
  let completed = false
  const waiting = awaitGenerationTaskPersistence(value.id).then(() => { completed = true })
  await Promise.resolve()
  expect(completed).toBe(false)
  expect(saved(value.id)?.status).toBe('queued')
  blocked.release(); await waiting
  expect(saved(value.id)?.status).toBe('success')
})

it('创建遇已存在主键只拒绝，不更新原历史；新标识正常创建', async () => {
  const existing = task()
  await persistGenerationTask({ ...existing, status: 'success', prompt: '原历史保持不变', options: { size: 'large' } })
  const before = structuredClone(saved(existing.id))
  vi.mocked(databaseService.updateHistory).mockClear()
  vi.mocked(databaseService.insertHistory).mockClear()
  await expect(createPersistedGenerationTask(existing)).rejects.toMatchObject({ name: 'ApplicationPreflightFailure' })
  expect(databaseService.updateHistory).not.toHaveBeenCalled()
  expect(databaseService.insertHistory).not.toHaveBeenCalled()
  expect(saved(existing.id)).toEqual(before)
  const fresh = task()
  await createPersistedGenerationTask(fresh)
  expect(saved(fresh.id)).toMatchObject({ id: fresh.id, prompt: fresh.prompt, status: 'queued' })
  expect(databaseService.insertHistory).toHaveBeenCalledTimes(1)
})

it('操作身份派生的任务主键可重用且隔离客户端原始标识', () => {
  const operationId = crypto.randomUUID()
  const taskId = applicationGenerationTaskId(operationId)
  expect(applicationGenerationTaskId(operationId)).toBe(taskId)
  expect(taskId).not.toBe(operationId)
  expect(applicationGenerationTaskId(crypto.randomUUID())).not.toBe(taskId)
})
