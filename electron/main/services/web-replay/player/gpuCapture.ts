import crypto from 'node:crypto'
import { BrowserWindow, ipcMain, nativeImage, session as electronSession, sharedTexture, type OffscreenSharedTexture, type Rectangle, type SharedTextureImported, type WebContents } from 'electron'
import path from 'node:path'
import { READER_TILE, type ReaderPixelFormat, type ReaderRequest, type ReaderResult, type ReaderSnapshotGuard } from '../../../../../packages/web-replay-probe/src/replay/types'
import { unionRect } from './capture'
import type { FrameSource, TakenFrame } from './frameSource'
import { registerReplayBoot } from './boot'

/** Requests to the reader window answer within this; longer means the reader is gone. */
const READ_TIMEOUT_MS = 5_000
/** The browser lends a small pool of textures; hold no more than this many. */
const HELD_TEXTURES = 3

/** The GPU way broke down mid-replay (reader gone, WebGPU error): the replay can be redone the CPU way. */
export class GpuCaptureError extends Error {
  constructor(message: string) { super(message); this.name = 'GpuCaptureError' }
}

const readers = new Map<number, GpuFrameCapture<ReaderPixelFormat>>()
let ipcInstalled = false
function installReaderIpc(): void {
  if (ipcInstalled) return
  ipcInstalled = true
  ipcMain.on('web-replay:reader-ready', (event, state: { ok: boolean; error?: string }) => readers.get(event.sender.id)?.onReady(state))
  ipcMain.on('web-replay:reader-result', (event, result: ReaderResult) => readers.get(event.sender.id)?.onResult(result))
}

const READER_ORIGIN = 'https://web-replay-reader.henji.invalid'
const READER_PAGE = '<!doctype html><meta charset="utf-8"><title>reader</title>'

/**
 * Captures the offscreen replay window through GPU shared textures: each paint is a texture, a hidden
 * reader window checks its capture token and, with WebGPU, copies back only the tiles that changed since
 * the last accepted frame (compared by content, not by the browser's damage); the whole picture is kept
 * here, patched tile by tile. A 4K frame is in hand within a few milliseconds
 * of its paint, where the CPU paint path takes about sixty.
 */
export class GpuFrameCapture<Format extends ReaderPixelFormat = 'nv12'> implements FrameSource<Format> {
  private reader: BrowserWindow | null = null
  private readonly partition = `web-replay-reader-${crypto.randomUUID()}`
  private textures: OffscreenSharedTexture[] = []
  private wake: (() => void) | null = null
  private readyState: Promise<void> | null = null
  private resolveReady: ((state: { ok: boolean; error?: string }) => void) | null = null
  private pending = new Map<number, (result: ReaderResult) => void>()
  private nextId = 1
  private picture: Buffer | null = null
  private width = 0
  private height = 0
  private disposed = false
  private protocolInstalled = false
  private stopBoot?: () => void
  /** 画面不带共享纹理（这台机器的共享纹理接口不可用）：GPU 路线走不通，取帧时交给 CPU 采集重来。 */
  private failure: GpuCaptureError | null = null
  received = 0
  /** Pictures read that turned out to show an earlier frame; tiles copied back. */
  stale = 0
  tilesRead = 0

  lastTimings: { guardMs: number; pixelsMs: number } | undefined

  constructor(private readonly side: number, readonly format: Format = 'nv12' as Format) {}

  /** Opens the reader window; rejects when WebGPU or shared textures cannot be used here. */
  async open(): Promise<void> {
    installReaderIpc()
    const ses = electronSession.fromPartition(this.partition)
    ses.protocol.handle('https', () => new Response(READER_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    this.protocolInstalled = true
    const reader = new BrowserWindow({
      show: false, width: 64, height: 64, frame: false,
      webPreferences: { partition: this.partition, preload: path.join(__dirname, '../preload/web-replay.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
    })
    this.reader = reader
    reader.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    reader.webContents.on('preload-error', (_event, _preloadPath, error) => this.onReady({ ok: false, error: `重演取帧运行时注入失败：${error.message}` }))
    readers.set(reader.webContents.id, this)
    this.stopBoot = registerReplayBoot(reader.webContents.id, () => ({ phase: 'reader' }))
    this.readyState = new Promise<void>((resolve, reject) => {
      this.resolveReady = state => (state.ok ? resolve() : reject(new Error(`重演取帧窗口不能用 WebGPU：${state.error ?? ''}`)))
    })
    this.readyState.catch(() => undefined)
    await Promise.all([
      withTimeout(reader.loadURL(`${READER_ORIGIN}/`), 15_000, '重演取帧窗口启动超时'),
      withTimeout(this.readyState, 15_000, '重演取帧窗口没有准备好 WebGPU'),
    ])
  }

  onReady(state: { ok: boolean; error?: string }): void { this.resolveReady?.(state) }

  onResult(result: ReaderResult): void {
    const resolve = this.pending.get(result.id)
    if (!resolve) return
    this.pending.delete(result.id)
    resolve(result)
  }

  get targetContents(): WebContents {
    if (!this.reader || this.reader.isDestroyed()) throw new GpuCaptureError('取帧窗口已关闭')
    return this.reader.webContents
  }

  /** 原生解码桥与离屏捕获共用同一个 reader；导入纹理的引用仍由调用方归还。 */
  async readImported(importedSharedTexture: SharedTextureImported): Promise<TakenFrame<Format>> {
    return this.accept(await this.readShared(importedSharedTexture, null))
  }

  /** 只接受身份区匹配的不可变快照；接管离屏引用，拒绝帧也必须归还。 */
  async readSnapshot(texture: OffscreenSharedTexture, snapshot: ReaderSnapshotGuard): Promise<TakenFrame<Format> | null> {
    const result = await this.read(texture, null, snapshot)
    this.lastTimings = result.timings
    if (result.guardMatched !== true || !result.tiles) { this.stale++; return null }
    const frame = this.accept(result), pixels = frame.bitmap()
    // 编码可能排队到下一次读回之后，帧身份与其像素必须共同持有。
    return { ...frame, bitmap: () => Buffer.from(pixels), previewJpeg: () => yuvPreviewJpeg(pixels, frame.width, frame.height, this.format === 'yuv444p') }
  }

  attach(contents: WebContents): void {
    contents.on('paint', event => {
      const texture = event.texture
      if (!texture) {
        this.failure ??= new GpuCaptureError('重演窗口的画面不带共享纹理')
        this.wake?.()
        return
      }
      if (this.disposed) { texture.release(); return }
      try {
        this.received += 1
        // Changes are found by comparing pictures, not from the browser's damage: only the newest few textures are kept.
        this.textures.push(texture)
        while (this.textures.length > HELD_TEXTURES) this.textures.shift()!.release()
        this.wake?.()
      } catch {
        // A texture that cannot be used must still go back to the browser's small pool.
        texture.release()
      }
    })
  }

  /** Has the reader check one texture for `token` (null: any) and copy back the tiles that changed. */
  private async read(texture: OffscreenSharedTexture, token: number | null, snapshot?: ReaderSnapshotGuard): Promise<Extract<ReaderResult, { ok: true }>> {
    let imported: SharedTextureImported
    try {
      imported = sharedTexture.importSharedTexture({ textureInfo: texture.textureInfo as unknown as Parameters<typeof sharedTexture.importSharedTexture>[0]['textureInfo'], allReferencesReleased: () => texture.release() })
    } catch (error) { texture.release(); throw error }
    try { return await this.readShared(imported, token, snapshot) } finally { imported.release() }
  }

  private async readShared(importedSharedTexture: SharedTextureImported, token: number | null, snapshot?: ReaderSnapshotGuard): Promise<Extract<ReaderResult, { ok: true }>> {
    const reader = this.reader
    if (!reader || reader.isDestroyed()) throw new GpuCaptureError('重演取帧窗口已关闭')
    const id = this.nextId++
    const answer = new Promise<ReaderResult>(resolve => { this.pending.set(id, resolve) })
    try {
      const request: ReaderRequest = { id, token, full: !!snapshot || !this.picture, guard: this.side, format: this.format, snapshot }
      await sharedTexture.sendSharedTexture({ frame: reader.webContents.mainFrame, importedSharedTexture }, request)
      const result = await withTimeout(answer, READ_TIMEOUT_MS, '重演取帧窗口没有回应')
      if (!result.ok) throw new GpuCaptureError(`重演取帧失败：${result.error}`)
      return result
    } catch (error) {
      throw new GpuCaptureError(`重演取帧窗口收不到画面：${String(error)}`)
    } finally {
      this.pending.delete(id)
    }
  }

  /** The newest texture showing `token`; older ones are let go. null after the timeout. */
  async take(token: number, timeoutMs: number): Promise<TakenFrame<Format> | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      if (this.failure) throw this.failure
      const entry = this.textures.pop()
      if (entry) {
        for (const older of this.textures.splice(0)) older.release()
        const result = await this.read(entry, token)
        if (result.tiles) return this.accept(result)
        // An earlier picture (the frame's own is still on its way).
        this.stale += 1
        continue
      }
      const left = deadline - Date.now()
      if (left <= 0) return null
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => { this.wake = null; resolve() }, left)
        this.wake = () => { clearTimeout(timer); this.wake = null; resolve() }
      })
    }
  }

  async takeLatest(): Promise<TakenFrame<Format> | null> {
    if (this.failure) throw this.failure
    const entry = this.textures.pop()
    if (!entry) return null
    for (const older of this.textures.splice(0)) older.release()
    return this.accept(await this.read(entry, null))
  }

  stats(): Record<string, number> { return { paints: this.received, stale: this.stale, tiles: this.tilesRead } }

  discard(): void {
    for (const texture of this.textures.splice(0)) texture.release()
  }

  /** NV12 维持偶数尺寸；平面 444 保留全部边缘像素，由编码入口决定是否 padding。 */
  private accept(result: Extract<ReaderResult, { ok: true }>): TakenFrame<Format> {
    const planar = this.format === 'yuv444p'
    const width = planar ? result.width : result.width & ~1, height = planar ? result.height : result.height & ~1
    this.lastTimings = result.timings
    const tiles = result.tiles ?? new Uint32Array(0)
    const first = !this.picture || this.width !== width || this.height !== height
    if (first) {
      this.picture = Buffer.alloc(width * height * (planar ? 3 : 1.5))
      this.width = width
      this.height = height
    }
    const picture = this.picture!
    const pixels = result.pixels
    const T = READER_TILE
    const tilesX = Math.ceil(result.width / T)
    const chromaPlane = width * height
    let dirty: Rectangle | null = null
    if (pixels) {
      for (let k = 0; k < tiles.length; k += 1) {
        const x0 = (tiles[k] % tilesX) * T, y0 = Math.floor(tiles[k] / tilesX) * T
        if (x0 >= width || y0 >= height) continue
        const cols = Math.min(T, width - x0), rows = Math.min(T, height - y0)
        const base = k * T * T * (planar ? 3 : 1.5)
        if (planar) {
          for (let plane = 0; plane < 3; plane++) for (let y = 0; y < rows; y++) {
            const offset = base + plane * T * T + y * T
            picture.set(pixels.subarray(offset, offset + cols), plane * chromaPlane + (y0 + y) * width + x0)
          }
        } else {
          for (let y = 0; y < rows; y += 1) picture.set(pixels.subarray(base + y * T, base + y * T + cols), (y0 + y) * width + x0)
          for (let y = 0; y < rows / 2; y += 1) picture.set(pixels.subarray(base + T * T + y * T, base + T * T + y * T + cols), chromaPlane + (y0 / 2 + y) * width + x0)
        }
        dirty = unionRect(dirty, { x: x0, y: y0, width: cols, height: rows })
      }
      if (planar) {
        for (let plane = 0; plane < 3; plane++) for (let y = 0; y < Math.min(this.side, height); y++) {
          const row = plane * chromaPlane + y * width
          picture.copy(picture, row, row + this.side, row + Math.min(this.side * 2, width))
        }
      } else coverTokenNv12(picture, width, height, this.side)
    }
    this.tilesRead += tiles.length
    const changed = first || tiles.length > 0
    return {
      dirty: dirty ?? { x: 0, y: 0, width: 0, height: 0 }, changed, width, height, format: this.format,
      bitmap: () => Buffer.from(picture),
      previewJpeg: () => yuvPreviewJpeg(picture, width, height, planar),
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.discard()
    for (const resolve of this.pending.values()) resolve({ id: 0, ok: false, error: '已关闭' })
    this.pending.clear()
    this.stopBoot?.(); this.stopBoot = undefined
    const reader = this.reader
    this.reader = null
    if (reader) {
      readers.delete(reader.webContents.id)
      if (!reader.isDestroyed()) reader.destroy()
    }
    if (this.protocolInstalled) {
      const ses = electronSession.fromPartition(this.partition)
      ses.protocol.unhandle('https')
      this.protocolInstalled = false
      await ses.clearStorageData().catch(() => undefined)
    }
  }
}

/** Paints over the token square in both NV12 planes with the pixels right of it. */
export function coverTokenNv12(picture: Buffer, width: number, height: number, side: number): void {
  const rows = Math.min(side, height)
  for (let y = 0; y < rows; y += 1) picture.copy(picture, y * width, y * width + side, y * width + side * 2)
  const chroma = width * height
  const pairs = Math.ceil(side / 2)
  for (let y = 0; y < Math.min(pairs, height / 2); y += 1) {
    const row = chroma + y * width
    picture.copy(picture, row, row + pairs * 2, row + pairs * 4)
  }
}

/** 预览沿各自输入矩阵反变换；不会把 444 的色度降采样后再显示。 */
function yuvPreviewJpeg(picture: Buffer, width: number, height: number, planar: boolean): string {
  const step = Math.max(1, Math.ceil(width / 1280))
  const w = Math.floor(width / step), h = Math.floor(height / step)
  const out = Buffer.alloc(w * h * 4)
  const chroma = width * height
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = x * step, sy = y * step
      const Y = (planar ? 255 / 219 : 1.164) * (picture[sy * width + sx] - 16)
      const c = chroma + (sy >> 1) * width + (sx & ~1)
      const U = picture[planar ? chroma + sy * width + sx : c] - 128, V = picture[planar ? chroma * 2 + sy * width + sx : c + 1] - 128
      const o = (y * w + x) * 4
      out[o] = Math.max(0, Math.min(255, Y + (planar ? 2 * .9278 * 255 / 224 : 2.018) * U))
      out[o + 1] = Math.max(0, Math.min(255, Y - (planar ? .0722 / .7152 * 2 * .9278 * 255 / 224 : .391) * U - (planar ? .2126 / .7152 * 2 * .7874 * 255 / 224 : .813) * V))
      out[o + 2] = Math.max(0, Math.min(255, Y + (planar ? 2 * .7874 * 255 / 224 : 1.596) * V))
      out[o + 3] = 255
    }
  }
  return `data:image/jpeg;base64,${nativeImage.createFromBitmap(out, { width: w, height: h }).toJPEG(80).toString('base64')}`
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(v => { clearTimeout(timer); resolve(v) }, e => { clearTimeout(timer); reject(e) })
  })
}
