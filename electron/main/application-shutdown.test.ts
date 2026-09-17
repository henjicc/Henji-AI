import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { bindApplicationShutdown } from './application-shutdown'

describe('application shutdown', () => {
  it('同步清理完成后也等到下一轮事件循环再退出，避免重入 Electron 的退出事件', async () => {
    const events = new EventEmitter()
    const app = Object.assign(events, { quit: vi.fn() })
    bindApplicationShutdown(app, [() => undefined], vi.fn())
    events.emit('will-quit', { preventDefault: vi.fn() })
    // Electron 要先处理 preventDefault 并退出当前原生事件栈；微任务仍可能重入。
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
    expect(app.quit).not.toHaveBeenCalled()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(app.quit).toHaveBeenCalledOnce()
  })

  it('关闭窗口被保存守卫阻止时不释放服务，批准退出后等待清理且只执行一次', async () => {
    const events = new EventEmitter()
    const quit = vi.fn(() => { events.emit('will-quit', { preventDefault: vi.fn() }) })
    const app = Object.assign(events, { quit })
    let finish!: () => void
    const close = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
    bindApplicationShutdown(app, [close], vi.fn())
    events.emit('before-quit', { preventDefault: vi.fn() })
    expect(close).not.toHaveBeenCalled()
    const preventDefault = vi.fn()
    events.emit('will-quit', { preventDefault })
    events.emit('will-quit', { preventDefault })
    expect(preventDefault).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
    expect(quit).not.toHaveBeenCalled()
    finish()
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
    expect(close).toHaveBeenCalledOnce()
  })

  it('单个清理失败仍等待其他服务，并记录失败', async () => {
    const events = new EventEmitter()
    const app = Object.assign(events, { quit: vi.fn() })
    const failure = new Error('cleanup failed')
    const report = vi.fn()
    const other = vi.fn(async () => undefined)
    bindApplicationShutdown(app, [() => { throw failure }, other], report)
    events.emit('will-quit', { preventDefault: vi.fn() })
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce())
    expect(other).toHaveBeenCalledOnce()
    expect(report).toHaveBeenCalledWith(failure)
  })
})
