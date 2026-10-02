import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElectronVideoDecoder } from './videoDecoder'

afterEach(() => { vi.unstubAllGlobals() })

describe('electron videoDecoder adapter', () => {
  it('中止探测立即拒绝并按同一请求标识通知主进程取消', async () => {
    let finish!: (value: unknown) => void
    const probe = vi.fn((_requestId: string, _path: string) => new Promise(resolve => { finish = resolve }))
    const cancelProbe = vi.fn(async (_requestId: string) => true)
    vi.stubGlobal('window', { henjiNative: { videoDecoder: { probe, cancelProbe, status: vi.fn() } } })
    const controller = new AbortController()
    const pending = createElectronVideoDecoder().probe('D:/a.mxf', controller.signal)
    controller.abort()
    await expect(pending).rejects.toBeDefined()
    expect(cancelProbe).toHaveBeenCalledWith(probe.mock.calls[0][0])
    finish({ status: 'unavailable' })
    await expect(createElectronVideoDecoder().probe('D:/a.mxf', controller.signal)).rejects.toBeDefined()
    expect(probe).toHaveBeenCalledOnce()
  })

  it('未中止时原样返回主进程结果', async () => {
    const outcome = { status: 'unreadable', message: '打不开' }
    vi.stubGlobal('window', { henjiNative: { videoDecoder: { probe: vi.fn(async () => outcome), cancelProbe: vi.fn(), status: vi.fn() } } })
    await expect(createElectronVideoDecoder().probe('D:/a.mxf', new AbortController().signal)).resolves.toBe(outcome)
  })
})
