import { describe, expect, it, vi } from 'vitest'
import { MediaRecycleLifecycle } from './lifecycle'

describe('quiescent media recycle windows', () => {
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
