import {
  ipcMain,
  type IpcMainEvent,
  type MessagePortMain,
} from 'electron'
import type {
  ImageEditorV3SourceTileStreamCredit,
  ImageEditorV3SourceTileStreamEvent,
} from '../../../src/platform/contracts/imageEditorV3'
import type { SharpSourceProvider } from '../services/image-editor-v3'
import { estimateImageEditorV3TileBatchRequestBytes } from './image-editor-v3-request-admission'
import { parseImageEditorV3TileBatchPayload } from './image-editor-v3-tile-payloads'

const TILE_STREAM_CHANNEL = 'imageEditorV3:source:tilesStream'
const MAX_STREAM_CREDITS = 4

type TileBatchPayload = ReturnType<typeof parseImageEditorV3TileBatchPayload>
type RunRequestV3 = <T>(
  operation: string,
  requestId: string,
  senderId: number,
  handler: (signal: AbortSignal) => Promise<T>,
  estimatedBytes?: number,
) => Promise<T>

export interface ImageEditorV3TileStreamDependencies {
  sources: SharpSourceProvider
  guard(event: IpcMainEvent): void
  runRequest: RunRequestV3
  cancelRequest(senderId: number, requestId: string): boolean
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error('Image editor V3 tile stream aborted')
  error.name = 'AbortError'
  return error
}

function normalizeCredit(value: unknown): number {
  const message = value as Partial<ImageEditorV3SourceTileStreamCredit> | null
  if (!message || message.type !== 'credit'
    || !Number.isSafeInteger(message.count)
    || (message.count ?? 0) < 1
    || (message.count ?? 0) > MAX_STREAM_CREDITS) {
    throw new Error('Invalid image editor tile stream credit')
  }
  return message.count as number
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

/** 每个 credit 只准一个未确认瓦片；解码并发和端口积压都硬限制为 4。 */
export function streamImageEditorV3TilesWithCredits(
  sources: SharpSourceProvider,
  payload: TileBatchPayload,
  port: MessagePortMain,
  signal: AbortSignal,
): Promise<void> {
  const ordered = payload.tiles
    .map((tile, index) => ({ tile, index }))
    .sort((left, right) => left.tile.priority - right.tile.priority || left.index - right.index)
  return new Promise((resolve, reject) => {
    let cursor = 0
    let running = 0
    let completed = 0
    let credits = 0
    let unacknowledged = 0
    let finished = false
    const cleanup = (): void => {
      port.off('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }
    const settle = (complete: () => void): void => {
      if (finished) return
      finished = true
      cleanup()
      complete()
    }
    const onAbort = (): void => settle(() => reject(abortError(signal)))
    const pump = (): void => {
      if (finished) return
      if (signal.aborted) {
        onAbort()
        return
      }
      if (completed === ordered.length) {
        settle(resolve)
        return
      }
      while (credits > 0 && running < MAX_STREAM_CREDITS && cursor < ordered.length) {
        const next = ordered[cursor]
        cursor += 1
        credits -= 1
        running += 1
        if (!next) continue
        void sources.readTile({
          resourceId: next.tile.resourceRef,
          mip: next.tile.mip,
          tileX: next.tile.tileX,
          tileY: next.tile.tileY,
          halo: next.tile.halo,
          bitDepth: next.tile.bitDepth,
          signal,
        }).then((tile) => {
          if (finished || signal.aborted) return
          const { resourceId, pixels, ...metadata } = tile
          const transferred = toArrayBuffer(pixels)
          const event: ImageEditorV3SourceTileStreamEvent = {
            type: 'tile',
            index: next.index,
            tile: { ...metadata, resourceRef: resourceId, pixels: transferred },
          }
          unacknowledged += 1
          port.postMessage(event, [transferred])
          completed += 1
        }).catch((error: unknown) => {
          settle(() => reject(error instanceof Error ? error : new Error(String(error))))
        }).finally(() => {
          running -= 1
          pump()
        })
      }
    }
    const onMessage = (event: Electron.MessageEvent): void => {
      try {
        const count = normalizeCredit(event.data)
        unacknowledged -= Math.min(unacknowledged, count)
        const capacity = MAX_STREAM_CREDITS - running - unacknowledged - credits
        credits += Math.min(count, Math.max(0, capacity))
        pump()
      } catch (error) {
        settle(() => reject(error instanceof Error ? error : new Error(String(error))))
      }
    }
    port.on('message', onMessage)
    signal.addEventListener('abort', onAbort, { once: true })
    port.start()
  })
}

function postError(port: MessagePortMain, error: unknown): void {
  const normalized = error instanceof Error ? error : new Error(String(error))
  const event: ImageEditorV3SourceTileStreamEvent = {
    type: 'error',
    name: normalized.name,
    message: normalized.message,
  }
  try { port.postMessage(event) } catch { /* 已断开的端口无需再次报告。 */ }
}

export function registerImageEditorV3TileStreamIpc(
  dependencies: ImageEditorV3TileStreamDependencies,
): void {
  ipcMain.on(TILE_STREAM_CHANNEL, (event, rawPayload) => {
    const port = event.ports[0]
    if (!port || event.ports.length !== 1) return
    let payload: TileBatchPayload
    try {
      dependencies.guard(event)
      payload = parseImageEditorV3TileBatchPayload(rawPayload)
    } catch (error) {
      postError(port, error)
      port.close()
      return
    }
    let settled = false
    port.once('close', () => {
      if (!settled) dependencies.cancelRequest(event.sender.id, payload.requestId)
    })
    void dependencies.runRequest(
      'source.tile_stream',
      payload.requestId,
      event.sender.id,
      (signal) => streamImageEditorV3TilesWithCredits(dependencies.sources, payload, port, signal),
      estimateImageEditorV3TileBatchRequestBytes(payload.tiles),
    ).then(() => {
      settled = true
      const complete: ImageEditorV3SourceTileStreamEvent = {
        type: 'complete', tileCount: payload.tiles.length,
      }
      port.postMessage(complete)
    }).catch((error: unknown) => {
      settled = true
      postError(port, error)
    }).finally(() => port.close())
  })
}
