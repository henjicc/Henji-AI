import { describe, expect, it, vi } from 'vitest'
import { MediaRecycleLifecycle } from './lifecycle'

describe('quiescent media recycle windows', () => {
  it('启动扫描超时后取消扫描并允许打开窗口', async () => {
    vi.useFakeTimers()
    try {
      const lifecycle = new MediaRecycleLifecycle()
      let signal: AbortSignal | undefined
      let finished = false
      const startup = lifecycle.startup(async value => { signal = value; await new Promise(() => undefined) }).then(() => { finished = true })
      await vi.advanceTimersByTimeAsync(3_001)
      expect(signal?.aborted).toBe(true)
      expect(finished).toBe(true)
      await startup
      expect(() => lifecycle.opened(1)).not.toThrow()
    } finally { vi.useRealTimers() }
  })
  it('skips exit while a document remains unsaved, or the window was force-closed', async () => {
    const lifecycle = new MediaRecycleLifecycle()
    const sweep = vi.fn(async () => undefined)
    lifecycle.opened(1)
    expect(await lifecycle.exit(sweep)).toBe('skipped')
    lifecycle.closed(1)
    expect(await lifecycle.exit(sweep)).toBe('skipped')
    expect(sweep).not.toHaveBeenCalled()
  })

  it('waits for startup before allowing windows; runs exit only after saved windows close and cancels at deadline', async () => {
    const lifecycle = new MediaRecycleLifecycle()
    let finish!: () => void
    const starting = lifecycle.startup(() => new Promise(resolve => { finish = resolve }))
    expect(() => lifecycle.opened(1)).toThrow('during media reclamation')
    finish(); await starting
    lifecycle.opened(1); lifecycle.saved(1)
    const sweep = vi.fn(async () => undefined)
    expect(await lifecycle.exit(sweep)).toBe('skipped')
    lifecycle.closed(1)
    let signal: AbortSignal | undefined
    expect(await lifecycle.exit(async value => { signal = value; await new Promise(() => undefined) }, 10)).toBe('timeout')
    expect(signal?.aborted).toBe(true)
    expect(() => lifecycle.opened(2)).toThrow('during media reclamation')
  })
})
