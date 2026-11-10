import { expect, it, vi } from 'vitest'
import { MediaRecycleLifecycle, MediaRecycleStopped } from './lifecycle'

it('一次运行只跑一轮，到总时限中止', async () => {
  vi.useFakeTimers()
  try {
    const lifecycle = new MediaRecycleLifecycle()
    let signal: AbortSignal | undefined
    const sweep = vi.fn(async (value: AbortSignal) => { signal = value; await new Promise(resolve => value.addEventListener('abort', resolve)) })
    const running = lifecycle.runInBackground(sweep, 1_000)
    await vi.advanceTimersByTimeAsync(1_001)
    await running
    expect(signal?.reason).toBeInstanceOf(MediaRecycleStopped)
    await lifecycle.runInBackground(sweep)
    expect(sweep).toHaveBeenCalledOnce()
  } finally { vi.useRealTimers() }
})

it('退出时立即中止后台轮，退出后不再开始', async () => {
  const lifecycle = new MediaRecycleLifecycle()
  let signal: AbortSignal | undefined
  void lifecycle.runInBackground(async value => { signal = value; await new Promise(() => undefined) })
  lifecycle.stop()
  expect(signal?.aborted).toBe(true)
  const late = new MediaRecycleLifecycle()
  late.stop()
  const sweep = vi.fn(async () => undefined)
  await late.runInBackground(sweep)
  expect(sweep).not.toHaveBeenCalled()
})
