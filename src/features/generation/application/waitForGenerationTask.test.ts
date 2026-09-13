import { afterEach, describe, expect, it, vi } from 'vitest'
import { waitForGenerationTask } from './waitForGenerationTask'

afterEach(() => { vi.useRealTimers() })
describe('宿主等待生成任务', () => {
  it.each(['completed', 'succeeded', 'failed', 'cancelled', 'timeout'])('只在 %s 后返回，并释放计时器', async status => {
    vi.useFakeTimers()
    const read = vi.fn().mockResolvedValue({ status: 'generating' })
    const done = vi.fn()
    const pending = waitForGenerationTask(read, new AbortController().signal).then(done)
    await vi.advanceTimersByTimeAsync(5000)
    expect(done).not.toHaveBeenCalled()
    read.mockResolvedValue({ status, taskRef: { kind: 'generation.task', id: 'original' } })
    await vi.advanceTimersByTimeAsync(1000)
    await pending
    expect(done).toHaveBeenCalledWith({ task: { status, taskRef: { kind: 'generation.task', id: 'original' } }, waitReason: 'terminal' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('取消只结束观察，正在读取的结果不得重新启动等待', async () => {
    vi.useFakeTimers()
    let release!: (task: Record<string, unknown>) => void
    const read = vi.fn(() => new Promise<Record<string, unknown>>(resolve => { release = resolve }))
    const controller = new AbortController()
    const pending = waitForGenerationTask(read, controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    release({ status: 'generating' })
    await assertion
    await vi.advanceTimersByTimeAsync(5000)
    expect(read).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('长任务保留原状态，需要恢复的任务立即交回助手', async () => {
    vi.useFakeTimers()
    const signal = new AbortController().signal
    const pending = waitForGenerationTask(async () => ({ status: 'generating' }), signal, 2000)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toEqual({ task: { status: 'generating' }, waitReason: 'still_running' })
    expect((await waitForGenerationTask(async () => ({ status: 'pending', waitingExternal: false, resumeInput: { taskId: 'original' } }), signal)).waitReason).toBe('recovery_required')
  })
  it('无效引用的读取错误保留，不冒充任务失败', async () => {
    await expect(waitForGenerationTask(async () => { throw new Error('TASK_NOT_FOUND') }, new AbortController().signal)).rejects.toThrow('TASK_NOT_FOUND')
  })
})
