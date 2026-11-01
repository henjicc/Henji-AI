import { expect, it, vi } from 'vitest'
const protocol = vi.hoisted(() => ({ handle: vi.fn(), unhandle: vi.fn() }))

const reader = vi.hoisted(() => ({ listeners: new Map<string, (...args: unknown[]) => void>(), ipc: new Map<string, (...args: unknown[]) => void>(), popup: vi.fn(), destroy: vi.fn(), fail: true, result: {} as Record<string, unknown> }))
vi.mock('electron', () => ({
  BrowserWindow: class {
    webContents = { id: 301, on: (name: string, listener: (...args: unknown[]) => void) => reader.listeners.set(name, listener), setWindowOpenHandler: reader.popup }
    async loadURL(): Promise<void> {
      const boot = { sender: { id: 301 }, returnValue: undefined as unknown }
      reader.ipc.get('web-replay:boot')?.(boot, 'https://web-replay-reader.henji.invalid/')
      expect(boot.returnValue).toEqual({ phase: 'reader' })
      if (reader.fail) reader.listeners.get('preload-error')?.({}, 'preload', new Error('fixture failure'))
      else reader.ipc.get('web-replay:reader-ready')?.({ sender: { id: 301 } }, { ok: true })
    }
    isDestroyed(): boolean { return false }
    destroy = reader.destroy
  },
  ipcMain: { on: (name: string, callback: (...args: unknown[]) => void) => reader.ipc.set(name, callback) }, nativeImage: {},
  session: { fromPartition: () => ({ protocol, clearStorageData: async () => {} }) },
  sharedTexture: {
    importSharedTexture: ({ allReferencesReleased }: { allReferencesReleased: () => void }) => ({ release: allReferencesReleased }),
    sendSharedTexture: async (_target: unknown, request: { id: number }) => {
      reader.ipc.get('web-replay:reader-result')?.({ sender: { id: 301 } }, { id: request.id, ok: true, token: 0, ...reader.result })
    },
  },
}))
import { sharedTexture, type WebContents } from 'electron'
import { coverTokenNv12, GpuCaptureError, GpuFrameCapture } from './gpuCapture'

it('未打开的捕获器取消及重复释放只清理自己已登记的协议', async () => {
  protocol.unhandle.mockClear()
  const unopened = new GpuFrameCapture(0)
  await unopened.dispose(); await unopened.dispose()
  expect(protocol.unhandle).not.toHaveBeenCalled()
  const failed = new GpuFrameCapture(0)
  await expect(failed.open()).rejects.toThrow('fixture failure')
  await failed.dispose(); await failed.dispose()
  expect(protocol.unhandle).toHaveBeenCalledOnce()
})

it('纹理导入和发送失败仍归还离屏池引用，后续取帧可以继续', async () => {
  reader.fail = false
  const capture = new GpuFrameCapture(0, 'yuv444p')
  let paint: ((event: unknown) => void) | undefined
  capture.attach({ on: (_name: string, listener: typeof paint) => { paint = listener } } as unknown as WebContents)
  const released = vi.fn()
  try {
    await capture.open()
    const importing = vi.spyOn(sharedTexture, 'importSharedTexture').mockImplementationOnce(() => { throw new Error('import failed') })
    paint!({ texture: { textureInfo: {}, release: released } })
    await expect(capture.take(0, 100)).rejects.toThrow('import failed')
    expect(released).toHaveBeenCalledTimes(1)
    importing.mockRestore()
    const sending = vi.spyOn(sharedTexture, 'sendSharedTexture').mockRejectedValueOnce(new Error('send failed'))
    paint!({ texture: { textureInfo: {}, release: released } })
    await expect(capture.take(0, 100)).rejects.toThrow('send failed')
    expect(released).toHaveBeenCalledTimes(2)
    sending.mockRestore()
    reader.result = { width: 64, height: 64, tiles: new Uint32Array([0]), pixels: new Uint8Array(64 * 64 * 3).fill(128) }
    paint!({ texture: { textureInfo: {}, release: released } })
    expect((await capture.take(0, 100))?.width).toBe(64)
    expect(released).toHaveBeenCalledTimes(3)
  } finally { vi.restoreAllMocks(); await capture.dispose(); reader.fail = true }
})

it('取帧 preload 失败立即拒绝供播放器回退 CPU，且窗口拒绝弹窗', async () => {
  const capture = new GpuFrameCapture(3)
  try {
    await expect(capture.open()).rejects.toThrow('重演取帧运行时注入失败：fixture failure')
    expect(reader.popup.mock.calls[0][0]()).toEqual({ action: 'deny' })
  } finally { await capture.dispose() }
  expect(reader.destroy).toHaveBeenCalled()
}, 2000)

it('NV12 画面里用右边相邻的像素盖掉左上角帧标记（亮度与色度两个平面），其余不动', () => {
  const width = 16, height = 8, side = 3
  const picture = Buffer.alloc(width * height * 3 / 2)
  for (let i = 0; i < picture.length; i += 1) picture[i] = i % 251
  const before = Buffer.from(picture)
  coverTokenNv12(picture, width, height, side)
  for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) expect(picture[y * width + x]).toBe(before[y * width + x + side])
  // 色度：标记覆盖 ceil(3/2)=2 对 U、V（4 个字节）、2 行
  const chroma = width * height
  for (let y = 0; y < 2; y += 1) for (let b = 0; b < 4; b += 1) expect(picture[chroma + y * width + b]).toBe(before[chroma + y * width + b + 4])
  expect(picture.subarray(side * width, chroma)).toEqual(before.subarray(side * width, chroma))
  expect(picture.subarray(chroma + 2 * width)).toEqual(before.subarray(chroma + 2 * width))
})

it('画面不带共享纹理时取帧立刻报 GpuCaptureError，交给 CPU 采集重来，不等满超时', async () => {
  let paint: ((event: { texture?: unknown }) => void) | undefined
  const contents = { on: (name: string, listener: typeof paint) => { if (name === 'paint') paint = listener } } as unknown as WebContents
  const capture = new GpuFrameCapture(3)
  capture.attach(contents)
  const waiting = capture.take(0, 60_000)
  paint!({})
  await expect(waiting).rejects.toBeInstanceOf(GpuCaptureError)
  await expect(capture.takeLatest()).rejects.toBeInstanceOf(GpuCaptureError)
})

it('平面444拼回奇数边缘与增量瓦片，保留独立色度和已交付快照', async () => {
  reader.fail = false
  const capture = new GpuFrameCapture(0, 'yuv444p')
  const width = 65, height = 67, tileBytes = 64 * 64 * 3
  let paint: ((event: unknown) => void) | undefined
  capture.attach({ on: (_name: string, listener: typeof paint) => { paint = listener } } as unknown as WebContents)
  const pixels = new Uint8Array(4 * tileBytes)
  for (let tile = 0; tile < 4; tile++) for (let plane = 0; plane < 3; plane++) {
    pixels.fill(20 + tile + plane * 40, tile * tileBytes + plane * 4096, tile * tileBytes + (plane + 1) * 4096)
  }
  try {
    await capture.open()
    reader.result = { width, height, tiles: new Uint32Array([0, 1, 2, 3]), pixels }
    paint!({ texture: { textureInfo: {}, release: vi.fn() } })
    const first = await capture.take(0, 100)
    expect(first?.format).toBe('yuv444p')
    expect([first?.width, first?.height]).toEqual([65, 67])
    const bytes = first!.bitmap()
    expect(bytes.length).toBe(width * height * 3)
    for (let plane = 0; plane < 3; plane++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      expect(bytes[plane * width * height + y * width + x]).toBe(20 + Math.floor(x / 64) + Math.floor(y / 64) * 2 + plane * 40)
    }
    reader.result = { width, height, tiles: new Uint32Array([3]), pixels: new Uint8Array(tileBytes).fill(200) }
    paint!({ texture: { textureInfo: {}, release: vi.fn() } })
    const next = (await capture.take(0, 100))!.bitmap()
    expect(next[width * height - 1]).toBe(200)
    expect(next[0]).toBe(bytes[0])
    expect(bytes[width * height - 1]).toBe(23)
    expect(next[width * height * 3 - 1]).toBe(200)
  } finally { await capture.dispose(); reader.fail = true }
})

it('可靠快照身份校验失败不发布，已交付像素不被后续读回覆盖', async () => {
  reader.fail = false
  const capture = new GpuFrameCapture(0, 'yuv444p')
  const release = vi.fn()
  const texture = (): Electron.OffscreenSharedTexture => ({ release, textureInfo: {} } as unknown as Electron.OffscreenSharedTexture)
  const guard = { identity: 'a'.repeat(32), width: 8, height: 4, restore: Array(1024).fill(0) }
  try {
    await capture.open()
    reader.result = { guardMatched: false, width: 8, height: 4, tiles: null, pixels: null }
    expect(await capture.readSnapshot(texture(), guard)).toBeNull()
    reader.result = { guardMatched: true, width: 8, height: 4, tiles: new Uint32Array([0]), pixels: new Uint8Array(64 * 64 * 3).fill(30) }
    const first = await capture.readSnapshot(texture(), guard)
    reader.result = { ...reader.result, pixels: new Uint8Array(64 * 64 * 3).fill(200) }
    const second = await capture.readSnapshot(texture(), { ...guard, identity: 'b'.repeat(32) })
    expect([...first!.bitmap()]).toEqual(Array(8 * 4 * 3).fill(30))
    expect([...second!.bitmap()]).toEqual(Array(8 * 4 * 3).fill(200))
    expect(release).toHaveBeenCalledTimes(3)
  } finally { await capture.dispose(); reader.fail = true }
})
