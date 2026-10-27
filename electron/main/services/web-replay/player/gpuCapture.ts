import crypto from 'node:crypto'
import { BrowserWindow, ipcMain, nativeImage, session as electronSession, sharedTexture, type OffscreenSharedTexture, type Rectangle, type WebContents } from 'electron'
import path from 'node:path'
import { READER_TILE, type ReaderRequest, type ReaderResult } from '../../../../../packages/web-replay-probe/src/replay/types'
import { unionRect } from './capture'
import type { FrameSource, TakenFrame } from './frameSource'

/** Requests to the reader window answer within this; longer means the reader is gone. */
const READ_TIMEOUT_MS = 5_000
/** The browser lends a small pool of textures; hold no more than this many. */
const HELD_TEXTURES = 3

/** The GPU way broke down mid-replay (reader gone, WebGPU error): the replay can be redone the CPU way. */
export class GpuCaptureError extends Error {
  constructor(message: string) { super(message); this.name = 'GpuCaptureError' }
}

const readers = new Map<number, GpuFrameCapture>()
let ipcInstalled = false
function installReaderIpc(): void {
  if (ipcInstalled) return
  ipcInstalled = true
  ipcMain.on('web-replay:reader-ready', (event, state: { ok: boolean; error?: string }) => readers.get(event.sender.id)?.onReady(state))
  ipcMain.on('web-replay:reader-result', (event, result: ReaderResult) => readers.get(event.sender.id)?.onResult(result))
}

/** The boot answer the replay preload gets in a reader window. */
export function isReplayReader(contentsId: number): boolean { return readers.has(contentsId) }

const READER_ORIGIN = 'https://web-replay-reader.henji.invalid'
const READER_PAGE = '<!doctype html><meta charset="utf-8"><title>reader</title>'

/**
 * Captures the offscreen replay window through GPU shared textures: each paint is a texture, a hidden
 * reader window checks its capture token and, with WebGPU, copies back only the tiles that changed since
 * the last accepted frame (compared by content, not by the browser's damage); the whole picture is kept
 * here, patched tile by tile. A 4K frame is in hand within a few milliseconds
 * of its paint, where the CPU paint path takes about sixty.
 */
export class GpuFrameCapture implements FrameSource {
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
  received = 0
  /** Pictures read that turned out to show an earlier frame; tiles copied back. */
  stale = 0
  tilesRead = 0

  constructor(private readonly side: number) {}

  /** Opens the reader window; rejects when WebGPU or shared textures cannot be used here. */
  async open(): Promise<void> {
    installReaderIpc()
    const ses = electronSession.fromPartition(this.partition)
    ses.protocol.handle('https', () => new Response(READER_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } }))
    const reader = new BrowserWindow({
      show: false, width: 64, height: 64, frame: false,
      webPreferences: { partition: this.partition, preload: path.join(__dirname, '../preload/web-replay.cjs'), contextIsolation: false, sandbox: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
    })
    this.reader = reader
    readers.set(reader.webContents.id, this)
    this.readyState = new Promise<void>((resolve, reject) => {
      this.resolveReady = state => (state.ok ? resolve() : reject(new Error(`重演取帧窗口不能用 WebGPU：${state.error ?? ''}`)))
    })
    this.readyState.catch(() => undefined)
    await withTimeout(reader.loadURL(`${READER_ORIGIN}/`), 15_000, '重演取帧窗口启动超时')
    await withTimeout(this.readyState, 15_000, '重演取帧窗口没有准备好 WebGPU')
  }

  onReady(state: { ok: boolean; error?: string }): void { this.resolveReady?.(state) }

  onResult(result: ReaderResult): void {
    const resolve = this.pending.get(result.id)
    if (!resolve) return
    this.pending.delete(result.id)
    resolve(result)
  }

  attach(contents: WebContents): void {
    contents.on('paint', event => {
      const texture = event.texture
      if (!texture) return
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
  private async read(texture: OffscreenSharedTexture, token: number | null): Promise<Extract<ReaderResult, { ok: true }>> {
    const reader = this.reader
    if (!reader || reader.isDestroyed()) throw new GpuCaptureError('重演取帧窗口已关闭')
    const id = this.nextId++
    const answer = new Promise<ReaderResult>(resolve => { this.pending.set(id, resolve) })
    const imported = sharedTexture.importSharedTexture({ textureInfo: texture.textureInfo as unknown as Parameters<typeof sharedTexture.importSharedTexture>[0]['textureInfo'], allReferencesReleased: () => texture.release() })
    try {
      const request: ReaderRequest = { id, token, full: !this.picture, guard: this.side }
      await sharedTexture.sendSharedTexture({ frame: reader.webContents.mainFrame, importedSharedTexture: imported }, request)
    } catch (error) {
      throw new GpuCaptureError(`重演取帧窗口收不到画面：${String(error)}`)
    } finally {
      imported.release()
    }
    const result = await withTimeout(answer, READ_TIMEOUT_MS, '重演取帧窗口没有回应').catch(error => { throw new GpuCaptureError(String(error)) }).finally(() => this.pending.delete(id))
    if (!result.ok) throw new GpuCaptureError(`重演取帧失败：${result.error}`)
    return result
  }

  /** The newest texture showing `token`; older ones are let go. null after the timeout. */
  async take(token: number, timeoutMs: number): Promise<TakenFrame | null> {
    const deadline = Date.now() + timeoutMs
    for (;;) {
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

  async takeLatest(): Promise<TakenFrame | null> {
    const entry = this.textures.pop()
    if (!entry) return null
    for (const older of this.textures.splice(0)) older.release()
    return this.accept(await this.read(entry, null))
  }

  stats(): Record<string, number> { return { paints: this.received, stale: this.stale, tiles: this.tilesRead } }

  discard(): void {
    for (const texture of this.textures.splice(0)) texture.release()
  }

  /** Patches the changed tiles into the whole NV12 picture kept here (even width and height). */
  private accept(result: Extract<ReaderResult, { ok: true }>): TakenFrame {
    const width = result.width & ~1, height = result.height & ~1
    const tiles = result.tiles ?? new Uint32Array(0)
    const first = !this.picture || this.width !== width || this.height !== height
    if (first) {
      this.picture = Buffer.alloc(width * height * 3 / 2)
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
        const base = k * T * T * 3 / 2
        for (let y = 0; y < rows; y += 1) picture.set(pixels.subarray(base + y * T, base + y * T + cols), (y0 + y) * width + x0)
        for (let y = 0; y < rows / 2; y += 1) picture.set(pixels.subarray(base + T * T + y * T, base + T * T + y * T + cols), chromaPlane + (y0 / 2 + y) * width + x0)
        dirty = unionRect(dirty, { x: x0, y: y0, width: cols, height: rows })
      }
      coverTokenNv12(picture, width, height, this.side)
    }
    this.tilesRead += tiles.length
    const changed = first || tiles.length > 0
    return {
      dirty: dirty ?? { x: 0, y: 0, width: 0, height: 0 }, changed, width, height, format: 'nv12',
      bitmap: () => Buffer.from(picture),
      previewJpeg: () => nv12PreviewJpeg(picture, width, height),
    }
  }

  async dispose(): Promise<void> {
    this.disposed = true
    this.discard()
    for (const resolve of this.pending.values()) resolve({ id: 0, ok: false, error: '已关闭' })
    this.pending.clear()
    const reader = this.reader
    this.reader = null
    if (reader) {
      readers.delete(reader.webContents.id)
      if (!reader.isDestroyed()) reader.destroy()
    }
    const ses = electronSession.fromPartition(this.partition)
    ses.protocol.unhandle('https')
    await ses.clearStorageData().catch(() => undefined)
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

/** A small JPEG of an NV12 picture for the live preview (every few pixels, BT.601 limited range back to RGB). */
function nv12PreviewJpeg(picture: Buffer, width: number, height: number): string {
  const step = Math.max(1, Math.ceil(width / 1280))
  const w = Math.floor(width / step), h = Math.floor(height / step)
  const out = Buffer.alloc(w * h * 4)
  const chroma = width * height
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const sx = x * step, sy = y * step
      const Y = 1.164 * (picture[sy * width + sx] - 16)
      const c = chroma + (sy >> 1) * width + (sx & ~1)
      const U = picture[c] - 128, V = picture[c + 1] - 128
      const o = (y * w + x) * 4
      out[o] = Math.max(0, Math.min(255, Y + 2.018 * U))
      out[o + 1] = Math.max(0, Math.min(255, Y - 0.391 * U - 0.813 * V))
      out[o + 2] = Math.max(0, Math.min(255, Y + 1.596 * V))
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
