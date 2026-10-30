import type { WebFrameMain } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WebSourcePage } from './page'

const boundary = vi.hoisted(() => {
  const contents = {
    setWindowOpenHandler: vi.fn(), on: vi.fn(), setFrameRate: vi.fn(),
    isDestroyed: () => false, isPainting: () => true, startPainting: vi.fn(), stopPainting: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    debugger: { isAttached: () => true, sendCommand: vi.fn(async () => undefined) },
    executeJavaScript: vi.fn(async () => ({})),
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, _scripts: Array<{ code: string }>): Promise<unknown> => null),
    forcefullyCrashRenderer: vi.fn(),
  }
  return { contents, fallback: vi.fn(), release: vi.fn() }
})

vi.mock('./site', () => ({ WEB_SOURCE_ENTRY_URL: 'https://web-source.henji.invalid/', WEB_SOURCE_ORIGIN: 'https://web-source.henji.invalid', serveWebSourceFile: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = boundary.contents
    isDestroyed() { return false }
    destroy() {}
  },
  session: { fromPartition: () => ({ protocol: { isProtocolHandled: () => true, unhandle: vi.fn(), handle: vi.fn() }, setPermissionRequestHandler: vi.fn() }) },
  sharedTexture: { importSharedTexture: ({ allReferencesReleased }: { allReferencesReleased: () => void }) => ({ release: allReferencesReleased }), sendSharedTexture: vi.fn(async () => undefined) },
}))

let page: WebSourcePage
beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  boundary.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, [{ code }]) => {
    if (code.includes('requestAdapter')) return { captureMode: 'compositor', fallbackReason: 'missing-stage' }
    if (code.includes('__henjiWebSourceMark')) {
      const paint = boundary.contents.on.mock.calls.find(([event]) => event === 'paint')?.[1]
      paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 }, metadata: { captureUpdateRect: { x: 0, y: 0, width: 1, height: 1 } } } } })
    }
    return null
  })
  page = new WebSourcePage('stream', { id: 1, mainFrame: {} as WebFrameMain, isDestroyed: () => false, send: vi.fn(), onGone: () => () => undefined },
    'route', { root: 'site' }, { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, 'hash', vi.fn(), boundary.fallback)
  await page.open()
  page.capturePath = { captureMode: 'html-in-canvas', fallbackReason: null }
})
afterEach(() => { page.close(); vi.useRealTimers() })

it('清理完成后才切换普通绘制并告警，当帧继续取图', async () => {
  let finishCleanup!: (value: boolean) => void
  const cleanup = new Promise<boolean>(resolve => { finishCleanup = resolve })
  boundary.contents.executeJavaScriptInIsolatedWorld
    .mockRejectedValueOnce(new Error('快照失败'))
    .mockReturnValueOnce(cleanup)
  const captured = page.capture(1, 'ticket', undefined)
  await vi.advanceTimersByTimeAsync(0)
  expect(boundary.fallback).not.toHaveBeenCalled()
  expect(page.capturePath.captureMode).toBe('html-in-canvas')
  finishCleanup(false)
  await captured
  expect(page.capturePath.captureMode).toBe('compositor')
  expect(boundary.fallback).toHaveBeenCalledOnce()
  expect(boundary.fallback).toHaveBeenCalledWith('快照失败')
  expect(boundary.release).toHaveBeenCalledOnce()
})

it('清理失败保留 cause、不告警，下一次取帧重新载入', async () => {
  const cleanupError = new Error('清理失败')
  boundary.contents.executeJavaScriptInIsolatedWorld
    .mockRejectedValueOnce(new Error('快照失败'))
    .mockRejectedValueOnce(cleanupError)
  await expect(page.capture(1, 'failed', undefined)).rejects.toMatchObject({ message: '快照失败', cause: cleanupError })
  expect(boundary.fallback).not.toHaveBeenCalled()
  const loads = boundary.contents.loadURL.mock.calls.length
  await page.capture(2, 'recovered', undefined)
  expect(boundary.contents.loadURL.mock.calls.length).toBeGreaterThan(loads)
})

it('宿主等待快照脚本超时结束页面进程，不尝试清理或降级，下次取帧重新载入', async () => {
  boundary.contents.executeJavaScriptInIsolatedWorld.mockReturnValueOnce(new Promise(() => undefined))
  const calls = boundary.contents.executeJavaScriptInIsolatedWorld.mock.calls.length
  const captured = expect(page.capture(1, 'timeout', undefined)).rejects.toThrow('网页没有响应快照取帧')
  await vi.advanceTimersByTimeAsync(30_000)
  await captured
  expect(boundary.contents.forcefullyCrashRenderer).toHaveBeenCalledOnce()
  expect(boundary.contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(calls + 1)
  expect(boundary.fallback).not.toHaveBeenCalled()
  const loads = boundary.contents.loadURL.mock.calls.length
  await page.capture(2, 'recovered', undefined)
  expect(boundary.contents.loadURL.mock.calls.length).toBeGreaterThan(loads)
})
