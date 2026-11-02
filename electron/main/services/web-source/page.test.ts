import { sharedTexture, type WebFrameMain } from 'electron'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WebSourcePage } from './page'
import { WebCacheSubmissions } from './submissions'
vi.mock('./session', () => ({ webSourceSession: () => ({ partition: 'test', observe: async () => undefined, release: () => undefined }) }))
import { WEB_TEXT_SAMPLER_VERSION } from '../../../../src/core/videoEdit/webTextGeometry'

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

function snapshotText(result: unknown): void {
  boundary.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, [{ code }]) => {
    if (code.includes('const paint =')) {
      const paint = boundary.contents.on.mock.calls.find(([event]) => event === 'paint')![1]
      paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 } } } })
      return result
    }
    return null
  })
}

it('主进程交付同幅文本身份和同步原因，空声明保持原快照脚本', async () => {
  snapshotText({ boxes: {}, text: { samplerVersion: WEB_TEXT_SAMPLER_VERSION, sampleMs: 1, serializationMs: 0, bytes: 0, results: { '#title': { status: 'unavailable', reason: 'unsynchronized', details: ['font-error'] } } } })
  const captured = await page.capture(2, 'text', undefined, { text: ['#title'] })
  expect(captured.text).toMatchObject({ ticket: 'text', time: 2, contentHash: 'hash', results: { '#title': { details: ['font-error'] } } })
  expect(page.capturePath.captureMode).toBe('html-in-canvas')
  boundary.contents.executeJavaScriptInIsolatedWorld.mockClear()
  await page.capture(3, 'plain', undefined, { text: [] })
  expect(boundary.contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledOnce()
  expect(boundary.contents.executeJavaScriptInIsolatedWorld.mock.calls[0][1][0].code).not.toContain('textSelectors')
})

it.each(['timeout', 'prepare', 'sample'] as const)('文本 %s 失败只拒绝当次，保留快照路径供无声明帧与重试使用', async failure => {
  if (failure === 'sample') snapshotText({ boxes: {}, textError: { code: 'sampling-failed', message: 'bad selector' } })
  else if (failure === 'timeout') boundary.contents.executeJavaScriptInIsolatedWorld.mockReturnValueOnce(new Promise(() => undefined))
  else boundary.contents.executeJavaScriptInIsolatedWorld.mockRejectedValueOnce(new Error('任意脚本错误，没有分类前缀'))
  const rejected = expect(page.capture(1, 'failed-text', undefined, { text: ['#title'] })).rejects.toMatchObject({
    name: 'WebTextCaptureError', code: failure === 'timeout' ? 'font-timeout' : failure === 'prepare' ? 'prepare-failed' : 'sampling-failed',
  })
  await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 30_000 : 0)
  await rejected
  expect(page.capturePath.captureMode).toBe('html-in-canvas')
  expect(boundary.fallback).not.toHaveBeenCalled()
  expect(boundary.contents.forcefullyCrashRenderer).not.toHaveBeenCalled()
  snapshotText({ boxes: {}, text: { samplerVersion: WEB_TEXT_SAMPLER_VERSION, sampleMs: 0, serializationMs: 0, bytes: 0, results: { '#title': { status: 'not-found' } } } })
  await page.capture(2, 'plain', undefined)
  expect((await page.capture(3, 'recovered-text', undefined, { text: ['#title'] })).text?.results).toEqual({ '#title': { status: 'not-found' } })
})

it('compositor 继续交付画面但明确没有精确文本，不把独立测量冒充同刻结果', async () => {
  page.capturePath = { captureMode: 'compositor', fallbackReason: 'missing-stage' }
  const captured = await page.capture(2, 'compositor-text', undefined, { text: ['#title'] })
  expect(captured.text?.results).toEqual({ '#title': { status: 'unavailable', reason: 'capture-path' } })
  expect(boundary.contents.executeJavaScriptInIsolatedWorld.mock.calls.every(([, scripts]) => !scripts[0].code.includes('textSelectors'))).toBe(true)
})

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

it.each([true, false])('清理完成后才切换普通绘制并告警，自动舞台 %s 决定是否重新定位', async automatic => {
  let finishCleanup!: (value: { automatic: boolean; pageChanged: boolean }) => void
  const cleanup = new Promise<{ automatic: boolean; pageChanged: boolean }>(resolve => { finishCleanup = resolve })
  boundary.contents.executeJavaScriptInIsolatedWorld
    .mockRejectedValueOnce(new Error('快照失败'))
    .mockReturnValueOnce(cleanup)
  const captured = page.capture(1, 'ticket', undefined)
  await vi.advanceTimersByTimeAsync(0)
  expect(boundary.fallback).not.toHaveBeenCalled()
  expect(page.capturePath.captureMode).toBe('html-in-canvas')
  finishCleanup({ automatic, pageChanged: false })
  await captured
  expect(page.capturePath.captureMode).toBe('compositor')
  expect(boundary.fallback).toHaveBeenCalledOnce()
  expect(boundary.fallback).toHaveBeenCalledWith('快照失败')
  expect(boundary.contents.executeJavaScript.mock.calls.filter(([code]) => code.includes('page.seek(1)'))).toHaveLength(automatic ? 2 : 1)
  expect(boundary.release).toHaveBeenCalledOnce()
})

it.each([false, true])('自动舞台 seek 异常当帧退回并重新定位，损坏 DOM %s 决定是否重载', async reloadRequired => {
  page.capturePath.automatic = true
  const loads = boundary.contents.loadURL.mock.calls.length
  boundary.contents.executeJavaScript.mockRejectedValueOnce(new Error('NotFoundError'))
  boundary.contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce({ automatic: true, pageChanged: false, reloadRequired })
  expect((await page.capture(1, 'failed-seek', undefined)).dropped).not.toBe(true)
  expect(page.capturePath.captureMode).toBe('compositor')
  expect(boundary.contents.executeJavaScript.mock.calls.filter(([code]) => code.includes('page.seek(1)'))).toHaveLength(2)
  expect(boundary.contents.loadURL.mock.calls.length - loads).toBe(reloadRequired ? 1 : 0)
  expect(boundary.fallback).toHaveBeenCalledOnce()
  expect(boundary.fallback).toHaveBeenCalledWith('NotFoundError')
  await page.capture(2, 'next', undefined)
  expect(boundary.fallback).toHaveBeenCalledOnce()
})

it('损坏 DOM 的恢复重载失败后保留重试状态，不在错误页面继续 seek', async () => {
  page.capturePath.automatic = true
  boundary.contents.executeJavaScript.mockRejectedValueOnce(new Error('NotFoundError'))
  boundary.contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce({ automatic: true, reloadRequired: true })
  boundary.contents.loadURL.mockRejectedValueOnce(new Error('恢复加载失败'))
  await expect(page.capture(1, 'failed-reload', undefined)).rejects.toThrow('恢复加载失败')
  expect(boundary.fallback).toHaveBeenCalledOnce()
  expect(boundary.fallback).toHaveBeenCalledWith('NotFoundError')
  await expect(page.capture(2, 'throttled', undefined)).rejects.toThrow('恢复加载失败')
  expect(boundary.contents.executeJavaScript.mock.calls.some(([code]) => code.includes('page.seek(2)'))).toBe(false)
  await vi.advanceTimersByTimeAsync(2000)
  expect((await page.capture(2, 'recovered', undefined)).dropped).not.toBe(true)
  expect(page.capturePath.captureMode).toBe('compositor')
  expect(boundary.fallback).toHaveBeenCalledOnce()
})

it.each(['seek', 'paint'])('录制页自动舞台 %s 失败后在原 DOM 重定位，再以身份快照继续同帧与后续帧', async failure => {
  page.close()
  page = new WebSourcePage('recording', { id: 1, mainFrame: {} as WebFrameMain, isDestroyed: () => false, send: vi.fn(), onGone: () => () => undefined },
    'route', { root: 'site' }, { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, 'hash', vi.fn(), boundary.fallback, new WebCacheSubmissions({ info: vi.fn() }))
  await page.open()
  page.capturePath = { captureMode: 'html-in-canvas', fallbackReason: null, automatic: true }
  const seeks: string[] = []
  boundary.contents.executeJavaScript.mockImplementation(async code => {
    if (code.includes('page.seek(')) {
      seeks.push(page.capturePath.captureMode)
      if (failure === 'seek' && seeks.length === 1) throw new Error('NotFoundError')
    }
    return {}
  })
  let paints = 0
  boundary.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, [{ code }]) => {
    if (code.includes('state?.dispose()')) return { automatic: true }
    if (code.includes('requestAdapter')) return { captureMode: 'html-in-canvas', fallbackReason: null, automatic: true }
    if (code.includes('const paint =')) {
      if (failure === 'paint' && paints++ === 0) throw new Error('NotFoundError')
      const paint = boundary.contents.on.mock.calls.filter(([event]) => event === 'paint').at(-1)![1]
      paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 } } } })
      return { boxes: {}, restore: Array(1024).fill(0) }
    }
    return true
  })
  const readSnapshot = vi.fn(async (texture: { release(): void }, guard: { identity: string; restore: number[] }) => {
    expect(guard.identity).toHaveLength(32)
    expect(guard.restore).toHaveLength(1024)
    texture.release()
    return { width: 100, height: 100, format: 'yuv444p' as const, changed: true, dirty: { x: 0, y: 0, width: 100, height: 100 }, bitmap: () => Buffer.alloc(30000), previewJpeg: () => '' }
  })
  const first = page.captureReliable(1, 'retry-frame', { readSnapshot })
  await vi.advanceTimersByTimeAsync(200)
  expect((await first).isCurrent()).toBe(true)
  const next = page.captureReliable(2, 'next-frame', { readSnapshot })
  await vi.advanceTimersByTimeAsync(200)
  const frame = await next
  expect(await frame.validate()).toBe(true)
  expect(seeks).toEqual(['html-in-canvas', 'compositor', 'compositor'])
  expect(readSnapshot).toHaveBeenCalledTimes(2)
  expect(boundary.fallback).toHaveBeenCalledOnce()
  expect(boundary.fallback).toHaveBeenCalledWith('NotFoundError')
})

it('舞台恢复重载沿用任务取消信号，不等待加载超时或继续 seek', async () => {
  page.close()
  page = new WebSourcePage('recording', { id: 1, mainFrame: {} as WebFrameMain, isDestroyed: () => false, send: vi.fn(), onGone: () => () => undefined },
    'route', { root: 'site' }, { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, 'hash', vi.fn(), boundary.fallback, new WebCacheSubmissions({ info: vi.fn() }))
  await page.open()
  page.capturePath = { captureMode: 'html-in-canvas', fallbackReason: null, automatic: true }
  boundary.contents.executeJavaScript.mockRejectedValueOnce(new Error('NotFoundError'))
  boundary.contents.executeJavaScriptInIsolatedWorld.mockResolvedValueOnce({ automatic: true, reloadRequired: true })
  boundary.contents.loadURL.mockReturnValueOnce(new Promise(() => undefined))
  const controller = new AbortController()
  const captured = expect(page.captureReliable(1, 'cancel-reload', { readSnapshot: vi.fn() }, undefined, controller.signal)).rejects.toThrow('取消恢复')
  await vi.advanceTimersByTimeAsync(0)
  controller.abort(new Error('取消恢复'))
  await captured
  await vi.advanceTimersByTimeAsync(0)
  expect(boundary.fallback).toHaveBeenCalledOnce()
  expect(boundary.fallback).toHaveBeenCalledWith('NotFoundError')
  expect(boundary.contents.executeJavaScript.mock.calls.filter(([code]) => code.includes('page.seek(1)'))).toHaveLength(1)
  const loads = boundary.contents.loadURL.mock.calls.length
  const retry = expect(page.captureReliable(2, 'after-cancel', { readSnapshot: vi.fn() })).rejects.toThrow('html-in-canvas')
  await vi.advanceTimersByTimeAsync(0)
  await retry
  expect(boundary.contents.loadURL).toHaveBeenCalledTimes(loads + 1)
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

it('可靠快照只允许快照路径，身份不符作废并拒绝倒退；关闭或重载使已交付帧失效', async () => {
  page.close()
  page = new WebSourcePage('recording', { id: 1, mainFrame: {} as WebFrameMain, isDestroyed: () => false, send: vi.fn(), onGone: () => () => undefined },
    'route', { root: 'site' }, { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, 'hash', vi.fn(), boundary.fallback, new WebCacheSubmissions({ info: vi.fn() }))
  await page.open()
  const readSnapshot = vi.fn(async (texture: { release: () => void }) => {
    texture.release()
    return { width: 100, height: 100, format: 'yuv444p' as const, changed: true, dirty: { x: 0, y: 0, width: 100, height: 100 }, bitmap: () => Buffer.alloc(30000), previewJpeg: () => '' }
  })
  await expect(page.captureReliable(0, 'fallback', { readSnapshot })).rejects.toThrow('html-in-canvas')
  // 失败后的完整重载以正式生命周期完成，再安排可用的快照边界。
  await page.reload('hash')
  page.capturePath = { captureMode: 'html-in-canvas', fallbackReason: null }
  const paint = boundary.contents.on.mock.calls.filter(([event]) => event === 'paint').at(-1)![1]
  boundary.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, [{ code }]) => {
    if (code.includes('const paint =')) {
      paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 } } } })
      return { boxes: null, restore: Array(1024).fill(0) }
    }
    return true
  })
  const first = await page.captureReliable(0, 'accepted', { readSnapshot })
  expect(first.isCurrent()).toBe(true)
  expect(await first.validate()).toBe(true)
  expect(readSnapshot).toHaveBeenCalledOnce()
  const stale = expect(page.captureReliable(1, 'stale', { readSnapshot: async texture => { texture.release(); return null } })).rejects.toThrow('身份校验')
  await stale
  expect(first.isCurrent()).toBe(false)
  expect(await first.validate()).toBe(false)
  expect(sharedTexture.sendSharedTexture).not.toHaveBeenCalled()
})

it('取消正在读回的可靠快照，迟到结果不能取得发布资格', async () => {
  page.close()
  page = new WebSourcePage('recording', { id: 1, mainFrame: {} as WebFrameMain, isDestroyed: () => false, send: vi.fn(), onGone: () => () => undefined },
    'route', { root: 'site' }, { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, 'hash', vi.fn(), boundary.fallback, new WebCacheSubmissions({ info: vi.fn() }))
  await page.open()
  page.capturePath = { captureMode: 'html-in-canvas', fallbackReason: null }
  const paint = boundary.contents.on.mock.calls.filter(([event]) => event === 'paint').at(-1)![1]
  boundary.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async () => {
    paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 } } } })
    return { boxes: null, restore: Array(1024).fill(0) }
  })
  let finish!: () => void
  const captured = expect(page.captureReliable(0, 'cancelled', { readSnapshot: async texture => {
    texture.release()
    await new Promise<void>(resolve => { finish = resolve })
    return null
  } })).rejects.toThrow('已取消')
  await vi.advanceTimersByTimeAsync(0)
  expect(page.cancel('cancelled')).toBe(true)
  finish()
  await captured
  expect(boundary.release).toHaveBeenCalledOnce()
})

it('精确导出只seek一次，先交付附原始像素的同一纹理再后台读回，两位消费者都结束才归还', async () => {
  const paint = boundary.contents.on.mock.calls.filter(([event]) => event === 'paint').at(-1)![1]
  const restore = Array.from({ length: 1024 }, (_, index) => index % 256)
  boundary.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async (_world, [{ code }]) => {
    if (code.includes('const paint =')) {
      paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 101, height: 101 } } } })
      return { boxes: null, restore }
    }
    return true
  })
  const readSnapshot = vi.fn(async (texture: { release(): void; textureInfo: { codedSize: { width: number; height: number }; visibleRect: { x: number; y: number; width: number; height: number } } }) => {
    expect(texture.textureInfo.codedSize).toEqual({ width: 101, height: 101 })
    expect(texture.textureInfo.visibleRect).toEqual({ x: 0, y: 0, width: 100, height: 100 })
    expect(sharedTexture.sendSharedTexture).toHaveBeenCalledOnce()
    texture.release()
    return { width: 100, height: 100, format: 'yuv444p' as const, changed: true, dirty: { x: 0, y: 0, width: 100, height: 100 }, bitmap: () => Buffer.alloc(30000), previewJpeg: () => '' }
  })
  const exported = await page.captureExport(0, 'export', { readSnapshot }, undefined, undefined, undefined, () => true)
  expect((await exported.reliable)!.isCurrent()).toBe(true)
  expect(boundary.contents.executeJavaScript.mock.calls.filter(([code]) => code.includes('page.seek(0)'))).toHaveLength(1)
  expect(vi.mocked(sharedTexture.sendSharedTexture).mock.calls[0][1]).toMatchObject({ webRestore: restore, displaySize: { width: 100, height: 100 }, request: { id: 'export' } })
  expect(boundary.release).toHaveBeenCalledOnce()
  // 缓存不要这一幅：只交付，不读回。
  const skipped = await page.captureExport(1, 'export-only', { readSnapshot }, undefined, undefined, undefined, () => false)
  expect(skipped.reliable).toBeUndefined()
  expect(readSnapshot).toHaveBeenCalledOnce()
  expect(sharedTexture.sendSharedTexture).toHaveBeenCalledTimes(2)
  expect(boundary.release).toHaveBeenCalledTimes(2)
})

it('快照提交后抢占阻止读回，恢复不重复seek；暂停时取消归还尚未交出的纹理', async () => {
  page.close()
  const submissions = new WebCacheSubmissions({ info: vi.fn() })
  page = new WebSourcePage('recording', { id: 1, mainFrame: {} as WebFrameMain, isDestroyed: () => false, send: vi.fn(), onGone: () => () => undefined },
    'route', { root: 'site' }, { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, 'hash', vi.fn(), boundary.fallback, submissions)
  await page.open()
  page.capturePath = { captureMode: 'html-in-canvas', fallbackReason: null }
  const paint = boundary.contents.on.mock.calls.filter(([event]) => event === 'paint').at(-1)![1]
  let hold!: ReturnType<WebCacheSubmissions['hold']>
  boundary.contents.executeJavaScriptInIsolatedWorld.mockImplementation(async () => {
    paint({ texture: { release: boundary.release, textureInfo: { codedSize: { width: 100, height: 100 } } } })
    hold = submissions.hold('playing')
    return { boxes: null, restore: Array(1024).fill(0) }
  })
  const readSnapshot = vi.fn(async (texture: { release: () => void }) => {
    texture.release()
    return { width: 100, height: 100, format: 'yuv444p' as const, changed: true, dirty: { x: 0, y: 0, width: 100, height: 100 }, bitmap: () => Buffer.alloc(30000), previewJpeg: () => '' }
  })
  const first = page.captureReliable(0, 'resume', { readSnapshot })
  await vi.advanceTimersByTimeAsync(0); await hold.drained
  expect(readSnapshot).not.toHaveBeenCalled()
  const controller = new AbortController()
  const queued = expect(page.captureReliable(1, 'queued', { readSnapshot }, undefined, controller.signal)).rejects.toThrow('取消排队')
  controller.abort(new Error('取消排队'))
  await queued
  expect(readSnapshot).not.toHaveBeenCalled()
  const seeks = boundary.contents.executeJavaScript.mock.calls.length, windows = boundary.create.mock.calls.length
  hold.resume()
  const firstFrame = await first
  await vi.advanceTimersByTimeAsync(0)
  expect(firstFrame.isCurrent()).toBe(true)
  expect(boundary.contents.executeJavaScript).toHaveBeenCalledTimes(seeks)
  expect(boundary.create).toHaveBeenCalledTimes(windows)
  const cancelled = expect(page.captureReliable(1, 'cancel-paused', { readSnapshot })).rejects.toThrow('已取消')
  await vi.advanceTimersByTimeAsync(0); await hold.drained
  expect(page.cancel('cancel-paused')).toBe(true)
  await cancelled
  expect(readSnapshot).toHaveBeenCalledOnce()
  expect(boundary.release).toHaveBeenCalledTimes(2)
  hold.resume()
})

it('开页在实际提交点等待抢占，任务取消无需恢复且不进入后续快照准备', async () => {
  page.close()
  const submissions = new WebCacheSubmissions({ info: vi.fn() })
  page = new WebSourcePage('recording', { id: 1, mainFrame: {} as WebFrameMain, isDestroyed: () => false, send: vi.fn(), onGone: () => () => undefined },
    'route', { root: 'site' }, { width: 100, height: 100, region: [0, 0, 100, 100], scale: 1 }, 'hash', vi.fn(), boundary.fallback, submissions)
  const hold = submissions.hold('playing'), controller = new AbortController()
  const windows = boundary.create.mock.calls.length
  const cancelled = expect(page.open(controller.signal)).rejects.toThrow('取消开页')
  await vi.advanceTimersByTimeAsync(0)
  controller.abort(new Error('取消开页'))
  await cancelled
  expect(boundary.create).toHaveBeenCalledTimes(windows)
  hold.resume()
  let readyHold!: ReturnType<WebCacheSubmissions['hold']>
  boundary.contents.executeJavaScript.mockImplementationOnce(async () => {
    readyHold = submissions.hold('dragging')
    return {}
  })
  const prepareCalls = boundary.contents.executeJavaScriptInIsolatedWorld.mock.calls.length
  const next = new AbortController()
  const opened = expect(page.open(next.signal)).rejects.toThrow('取消准备')
  await vi.advanceTimersByTimeAsync(0); await readyHold.drained
  expect(boundary.contents.executeJavaScriptInIsolatedWorld).toHaveBeenCalledTimes(prepareCalls)
  next.abort(new Error('取消准备'))
  await opened
  expect(boundary.fallback).not.toHaveBeenCalled()
  readyHold.resume()
})
