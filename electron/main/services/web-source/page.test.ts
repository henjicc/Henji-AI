import { sharedTexture, type WebFrameMain } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WebSourcePage } from './page'

const boundary = vi.hoisted(() => {
  const contents = {
    setWindowOpenHandler: vi.fn(), on: vi.fn(), setFrameRate: vi.fn(),
    isDestroyed: () => false, isPainting: () => true, startPainting: vi.fn(), stopPainting: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    debugger: { isAttached: () => true, sendCommand: vi.fn(async () => undefined) },
    executeJavaScript: vi.fn(async (_code: string) => ({})),
    executeJavaScriptInIsolatedWorld: vi.fn(async (_world: number, _scripts: Array<{ code: string }>): Promise<unknown> => null),
    forcefullyCrashRenderer: vi.fn(),
  }
  return { contents, fallback: vi.fn(), release: vi.fn(), resize: vi.fn(), create: vi.fn(), destroy: vi.fn() }
})

vi.mock('./site', () => ({ WEB_SOURCE_ENTRY_URL: 'https://web-source.henji.invalid/', WEB_SOURCE_ORIGIN: 'https://web-source.henji.invalid', serveWebSourceFile: vi.fn() }))
vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(options: unknown) { boundary.create(options) }
    webContents = boundary.contents
    isDestroyed() { return false }
    destroy() { boundary.destroy() }
    setContentSize = boundary.resize
  },
  session: { fromPartition: () => ({ protocol: { isProtocolHandled: () => true, unhandle: vi.fn(), handle: vi.fn() }, setPermissionRequestHandler: vi.fn() }) },
  sharedTexture: { importSharedTexture: ({ allReferencesReleased }: { allReferencesReleased: () => void }) => ({ release: allReferencesReleased }), sendSharedTexture: vi.fn(async () => undefined) },
}))

let page: WebSourcePage
beforeEach(async () => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  boundary.contents.executeJavaScript.mockImplementation(async () => ({}))
  boundary.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, [{ code }]) => {
    if (code.includes('requestAdapter')) return { captureMode: 'compositor', fallbackReason: 'missing-stage' }
    if (code.includes('__henjiWebSourceMark')) {
      const paint = boundary.contents.on.mock.calls.filter(([event]) => event === 'paint').at(-1)?.[1]
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

it('丢弃排队的旧目标与取消票据，seek 返回后不再为取消任务画快照', async () => {
  let finish!: () => void
  boundary.contents.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}) }))
  const first = page.capture(1, 'first', undefined)
  await vi.advanceTimersByTimeAsync(0)
  const outdated = page.capture(2, 'outdated', undefined, { latest: true })
  const newest = page.capture(3, 'newest', undefined, { latest: true })
  expect(page.cancel('first')).toBe(true)
  page.capturePath = { captureMode: 'compositor', fallbackReason: null }
  finish()
  expect((await first).dropped).toBe(true)
  expect((await outdated).dropped).toBe(true)
  expect((await newest).dropped).not.toBe(true)
  const scripts = boundary.contents.executeJavaScript.mock.calls.map(([code]) => code)
  expect(scripts.some(code => code.includes('page.seek(2)'))).toBe(false)
  expect(boundary.release).toHaveBeenCalledOnce()
})

it('前一幅传输未结束就取下一幅，元数据按票据对号，换倍率不重载', async () => {
  page.capturePath = { captureMode: 'compositor', fallbackReason: null }
  let sent!: () => void
  vi.mocked(sharedTexture.sendSharedTexture).mockImplementationOnce(() => new Promise(resolve => { sent = resolve }))
  const first = page.capture(1, 'first', undefined)
  await vi.advanceTimersByTimeAsync(0)
  const second = page.capture(2, 'second', undefined, { scale: 0.125 })
  await vi.advanceTimersByTimeAsync(120)
  expect((await second).pixelWidth).toBe(12)
  expect(sharedTexture.sendSharedTexture).toHaveBeenCalledTimes(2)
  expect(vi.mocked(sharedTexture.sendSharedTexture).mock.calls.map(call => (call[1] as { request: { id: string } }).request.id)).toEqual(['first', 'second'])
  expect(boundary.contents.loadURL).toHaveBeenCalledTimes(1)
  expect(boundary.resize).toHaveBeenLastCalledWith(13, 13)
  sent(); await first
})

it('快照提交后立即推进下一次 seek，但上一幅未到时不覆盖输出画布', async () => {
  const paint = boundary.contents.on.mock.calls.find(([event]) => event === 'paint')![1]
  const before = boundary.contents.executeJavaScriptInIsolatedWorld.mock.calls.length
  const first = page.capture(1, 'first', undefined)
  const second = page.capture(2, 'second', undefined)
  await vi.advanceTimersByTimeAsync(0)
  expect(boundary.contents.executeJavaScript.mock.calls.some(([code]) => code.includes('page.seek(2)'))).toBe(true)
  expect(boundary.contents.executeJavaScriptInIsolatedWorld.mock.calls.length - before).toBe(1)
  const sendPaint = (): void => paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 }, metadata: { captureUpdateRect: { x: 0, y: 0, width: 100, height: 100 } } } } })
  sendPaint(); await first; await vi.advanceTimersByTimeAsync(0)
  expect(boundary.contents.executeJavaScriptInIsolatedWorld.mock.calls.length - before).toBe(2)
  sendPaint(); await second
  expect(boundary.release).toHaveBeenCalledTimes(2)
})

it('流水线送回超时使已推进的后帧一起失效，恢复走普通绘制而不串用页面状态', async () => {
  boundary.contents.executeJavaScript.mockImplementation(async code => {
    if (code.includes('page.seek(2)')) return new Promise(() => undefined)
    return {}
  })
  const first = expect(page.capture(1, 'first', undefined)).rejects.toThrow('完整快照')
  const second = expect(page.capture(2, 'second', undefined)).rejects.toThrow('链路已失效')
  await vi.advanceTimersByTimeAsync(3000)
  await first; await second
  expect(boundary.contents.forcefullyCrashRenderer).toHaveBeenCalledOnce()
  expect(boundary.fallback).toHaveBeenCalledOnce()
  expect((await page.capture(3, 'recovered', undefined)).dropped).not.toBe(true)
  expect(page.capturePath.captureMode).toBe('compositor')
})

it('尚未开始的取消任务继续传递绘制屏障，不越过在途快照', async () => {
  const paint = boundary.contents.on.mock.calls.find(([event]) => event === 'paint')![1]
  const first = page.capture(1, 'first', undefined)
  const cancelled = page.capture(2, 'cancelled', undefined)
  page.cancel('cancelled')
  let completed = false
  const next = page.capture(3, 'next', undefined)
  void next.then(() => { completed = true })
  await vi.advanceTimersByTimeAsync(0)
  expect(completed).toBe(false)
  expect(boundary.contents.loadURL).toHaveBeenCalledTimes(1)
  expect(boundary.contents.executeJavaScriptInIsolatedWorld.mock.calls.filter(([, scripts]) => scripts[0].code.includes('const paint ='))).toHaveLength(1)
    paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 } } } })
    await first; await cancelled; await vi.advanceTimersByTimeAsync(0)
    paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 } } } })
  await next
})

it('取消队列空洞后重载等待已提交的快照领取，精确任务不被 latest 覆盖', async () => {
  const paint = boundary.contents.on.mock.calls.find(([event]) => event === 'paint')![1]
  const first = page.capture(1, 'first', undefined)
  const exact = page.capture(2, 'exact', undefined)
  const latest = page.capture(3, 'latest', undefined, { latest: true })
  await vi.advanceTimersByTimeAsync(0)
  page.cancel('exact'); page.cancel('latest')
  const reload = page.reload('updated')
  await vi.advanceTimersByTimeAsync(0)
  expect(boundary.contents.loadURL).toHaveBeenCalledTimes(1)
  paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 } } } })
  await Promise.all([first, exact, latest, reload])
  expect(boundary.contents.loadURL).toHaveBeenCalledTimes(2)
})

it('精确排队任务不被 latest 预览取消，调整倍率期间取消不再 seek', async () => {
  page.capturePath = { captureMode: 'compositor', fallbackReason: null }
  let finish!: () => void
  boundary.contents.executeJavaScript.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve({}) }))
  const first = page.capture(1, 'first', undefined)
  const exact = page.capture(2, 'exact', undefined)
  const latest = page.capture(3, 'latest', undefined, { latest: true })
  await vi.advanceTimersByTimeAsync(0); finish()
  await Promise.all([first, exact, latest])
  expect(boundary.contents.executeJavaScript.mock.calls.some(([code]) => code.includes('page.seek(2)'))).toBe(true)
  const resizing = page.capture(4, 'resize', undefined, { scale: .5 })
  await vi.advanceTimersByTimeAsync(0); page.cancel('resize')
  await vi.advanceTimersByTimeAsync(120)
  expect((await resizing).dropped).toBe(true)
  expect(boundary.contents.executeJavaScript.mock.calls.some(([code]) => code.includes('page.seek(4)'))).toBe(false)
})

it('普通绘制低倍率时取帧标记仍覆盖输出像素，不会等待到超时', async () => {
  page.capturePath = { captureMode: 'compositor', fallbackReason: null }
  const execute = boundary.contents.executeJavaScriptInIsolatedWorld.getMockImplementation()!
  boundary.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (world, scripts) => {
    if (scripts[0].code.includes('__henjiWebSourceMark')) {
      const side = Number(/width:(\d+)px/.exec(scripts[0].code)?.[1])
      if (side * .125 < 1) return null
    }
    return execute(world, scripts)
  })
  const captured = expect(page.capture(1, 'small', undefined, { scale: .125 })).resolves.toMatchObject({ pixelWidth: 12, pixelHeight: 12 })
  await vi.advanceTimersByTimeAsync(3200)
  await captured
})

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


it('超过设备倍率才重建页面，之后降倍率保留页面并继续取帧', async () => {
  page.capturePath = { captureMode: 'compositor', fallbackReason: null }
  const raised = page.capture(1, 'raised', undefined, { scale: 2 })
  await vi.advanceTimersByTimeAsync(150)
  expect(await raised).toMatchObject({ pixelWidth: 200, pixelHeight: 200 })
  expect(boundary.destroy).toHaveBeenCalledOnce()
  expect(boundary.create).toHaveBeenLastCalledWith(expect.objectContaining({ webPreferences: expect.objectContaining({ contextIsolation: true, sandbox: true, nodeIntegration: false, offscreen: { useSharedTexture: true, deviceScaleFactor: 2 } }) }))
  const creations = boundary.create.mock.calls.length
  const lowered = page.capture(2, 'lowered', undefined, { scale: .5 })
  await vi.advanceTimersByTimeAsync(150)
  expect(await lowered).toMatchObject({ pixelWidth: 50, pixelHeight: 50 })
  expect(boundary.create).toHaveBeenCalledTimes(creations)
  expect(boundary.contents.debugger.sendCommand).toHaveBeenLastCalledWith('Emulation.setDeviceMetricsOverride', expect.objectContaining({ deviceScaleFactor: 2 }))
})
