import { describe, expect, it, vi } from 'vitest'

import {
  registerApplicationCloseGuard,
  runApplicationCloseGuards,
} from './applicationCloseGuards'

describe('applicationCloseGuards', () => {
  it('等待已注册事务并允许注销', async () => {
    const first = vi.fn(async () => undefined)
    const second = vi.fn(async () => undefined)
    const unregisterFirst = registerApplicationCloseGuard(first)
    const unregisterSecond = registerApplicationCloseGuard(second)

    unregisterFirst()
    await runApplicationCloseGuards()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
    unregisterSecond()
  })

  it('任一守卫失败时停止确认关闭链路', async () => {
    const failure = new Error('save failed')
    const first = vi.fn(async () => { throw failure })
    const second = vi.fn(async () => undefined)
    const unregisterFirst = registerApplicationCloseGuard(first)
    const unregisterSecond = registerApplicationCloseGuard(second)

    await expect(runApplicationCloseGuards()).rejects.toBe(failure)
    expect(second).not.toHaveBeenCalled()
    unregisterFirst()
    unregisterSecond()
  })
})
