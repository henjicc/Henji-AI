import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ history: { status: 'queued' }, read: vi.fn(), listeners: new Set<() => void>() }))
vi.mock('@/services/database', () => ({ databaseService: { getHistoryById: () => state.read() } }))
vi.mock('./generationApplicationService', () => ({ generationApplicationService: { getTask: () => ({ status: 'success', resultAvailable: true, progress: 100 }) } }))
vi.mock('@/workspaces/GenerationWorkspace/application/visibleGenerationTaskCommand', () => ({ subscribeVisibleGenerationTaskChanges: (listener: () => void) => { state.listeners.add(listener); return () => state.listeners.delete(listener) } }))
import { waitForGenerationCompletion } from './waitForGenerationCompletion'
afterEach(() => { vi.useRealTimers(); state.listeners.clear() })
it('内存成功先于历史落盘时不提前回填，持久回执完成后释放观察', async () => {
  vi.useFakeTimers(); state.history = { status: 'queued' }; state.read.mockImplementation(async () => state.history)
  const done = vi.fn(), pending = waitForGenerationCompletion('original', new AbortController().signal).then(done)
  await vi.advanceTimersByTimeAsync(2000); expect(done).not.toHaveBeenCalled()
  state.history = { status: 'success' }; await vi.advanceTimersByTimeAsync(2000); await pending
  expect(done).toHaveBeenCalledWith({ ok: true }); expect(state.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0)
})
it('取消等待持久回执，不接受随后返回的历史成功', async () => {
  vi.useFakeTimers(); let release!: (record: { status: string }) => void
  state.read.mockImplementation(() => new Promise(resolve => { release = resolve }))
  const controller = new AbortController(), pending = waitForGenerationCompletion('original', controller.signal)
  const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); release({ status: 'success' }); await assertion
  expect(state.listeners.size).toBe(0); expect(vi.getTimerCount()).toBe(0)
})
