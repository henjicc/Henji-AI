import { afterEach, describe, expect, it, vi } from 'vitest'

import { ImageEditorGpuSceneRecoveryV3 } from './imageEditorGpuSceneRecoveryV3'

describe('ImageEditorGpuSceneRecoveryV3', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('成功帧夹在中间时按 2 秒窗口累计：窗口内第 3 次才回退，滑出窗口的失败不算', () => {
    const recovery = new ImageEditorGpuSceneRecoveryV3()
    expect(recovery.recordFailure(0)).toBe(false)
    recovery.recordFrame(100)
    expect(recovery.recordFailure(1_500)).toBe(false)
    recovery.recordFrame(1_600)
    // 第一次失败已滑出 2 秒窗口。
    expect(recovery.recordFailure(2_100)).toBe(false)
    recovery.recordFrame(2_200)
    expect(recovery.recordFailure(2_300)).toBe(true)
  })

  it('连续 3 帧失败就回退，与时间间隔无关', () => {
    const recovery = new ImageEditorGpuSceneRecoveryV3()
    expect(recovery.recordFailure(0)).toBe(false)
    expect(recovery.recordFailure(5_000)).toBe(false)
    expect(recovery.recordFailure(10_000)).toBe(true)
  })

  it('回退重试 10 秒起翻倍、最长 5 分钟；重试后头几帧成功不清零，持续 10 秒且 30 帧无错误才从头计', async () => {
    vi.useFakeTimers()
    const recovery = new ImageEditorGpuSceneRecoveryV3()
    const recover = vi.fn()
    const delays: Array<number | null> = []
    for (let attempt = 0; attempt < 7; attempt += 1) {
      const delay = recovery.scheduleFallbackRetry(recover)
      delays.push(delay)
      await vi.advanceTimersByTimeAsync(delay ?? 0)
    }
    expect(delays).toEqual([10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000])
    expect(recover).toHaveBeenCalledTimes(7)

    // 重试后很快出了几帧又出错：退避不清零。
    for (let frame = 0; frame < 5; frame += 1) recovery.recordFrame(frame * 16)
    recovery.noteError()
    const keepsBackoff = recovery.scheduleFallbackRetry(recover)
    expect(keepsBackoff).toBe(300_000)
    await vi.advanceTimersByTimeAsync(300_000)

    // 帧数够了但时间不够，不清零。
    for (let frame = 0; frame < 30; frame += 1) recovery.recordFrame(1_000 + frame * 16)
    expect(recovery.scheduleFallbackRetry(recover)).toBe(300_000)
    await vi.advanceTimersByTimeAsync(300_000)
    // 持续 15 秒、31 帧没有新错误才从头计。
    for (let frame = 0; frame <= 30; frame += 1) recovery.recordFrame(400_000 + frame * 500)
    expect(recovery.scheduleFallbackRetry(recover)).toBe(10_000)
    recovery.dispose()
  })
})
