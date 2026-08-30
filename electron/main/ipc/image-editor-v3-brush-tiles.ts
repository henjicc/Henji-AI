import type { IpcMainInvokeEvent } from 'electron'

import type { ImageEditBrushTileV3 } from '../../../src/core/imageEdit/v3/brush/contracts'
import type { ImageEditBrushTileStoreV3 } from '../services/image-editor-v3'
import {
  parseImageEditorV3PersistBrushTilesPayload,
  parseImageEditorV3ReadBrushTilesPayload,
  type PersistBrushTilesPayload,
  type ReadBrushTilesPayload,
} from './image-editor-v3-payloads'
import {
  estimateImageEditorV3BrushPersistBytes,
  estimateImageEditorV3BrushReadBytes,
} from './image-editor-v3-request-admission'
import { registerIpcHandler, type IpcSenderGuard } from './registry'

type RunRequest = <T>(
  operation: string,
  requestId: string,
  senderId: number,
  work: (signal: AbortSignal) => Promise<T>,
  estimatedBytes?: number,
) => Promise<T>

export interface ImageEditorV3BrushTileIpcDependencies {
  store: ImageEditBrushTileStoreV3
  guard: IpcSenderGuard
  runRequest: RunRequest
}

type SerializedBrushTile =
  | {
    storage: 'mask-float32'; width: number; height: number; data: ArrayBuffer
  }
  | {
    storage: 'rgba-float32'; width: number; height: number; data: ArrayBuffer
    colorDomain: 'source-encoded' | 'linear-light' | 'perceptual-working'
    workingSpace: 'srgb' | 'display-p3' | 'rec2020'
    transferFunction: 'srgb' | 'linear' | 'pq' | 'hlg'
    referenceWhiteNits: number; alpha: 'premultiplied'
  }

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('Image editor brush tile request cancelled')
  error.name = 'AbortError'
  throw error
}

function toExactArrayBuffer(values: Float32Array): ArrayBuffer {
  const copy = new Float32Array(values)
  return copy.buffer
}

function serializeTile(tile: ImageEditBrushTileV3): SerializedBrushTile {
  if (tile.storage === 'mask-float32') {
    return {
      storage: tile.storage,
      width: tile.width,
      height: tile.height,
      data: toExactArrayBuffer(tile.data),
    }
  }
  return {
    storage: tile.storage,
    width: tile.width,
    height: tile.height,
    data: toExactArrayBuffer(tile.data),
    colorDomain: tile.colorDomain,
    workingSpace: tile.workingSpace,
    transferFunction: tile.transferFunction,
    referenceWhiteNits: tile.referenceWhiteNits,
    alpha: tile.alpha,
  }
}

export async function persistImageEditorV3BrushTileBatch(
  store: ImageEditBrushTileStoreV3,
  payload: PersistBrushTilesPayload,
  signal: AbortSignal,
): Promise<{
  tiles: Array<{ tileKey: string; resource: { resourceRef: string; byteSize: number } }>
}> {
  const tiles: Array<{
    tileKey: string; resource: { resourceRef: string; byteSize: number }
  }> = []
  for (const item of payload.tiles) {
    throwIfAborted(signal)
    const resource = await store.persistTile(item.tile, signal)
    tiles.push({
      tileKey: item.tileKey,
      resource: { resourceRef: resource.resourceId, byteSize: resource.byteSize },
    })
  }
  return { tiles }
}

export async function readImageEditorV3BrushTileBatch(
  store: ImageEditBrushTileStoreV3,
  payload: ReadBrushTilesPayload,
  signal: AbortSignal,
): Promise<{ tiles: Array<{ tileKey: string; tile: SerializedBrushTile }> }> {
  const tiles: Array<{ tileKey: string; tile: SerializedBrushTile }> = []
  for (const item of payload.tiles) {
    throwIfAborted(signal)
    const tile = await store.readTile(item.resource, signal)
    tiles.push({ tileKey: item.tileKey, tile: serializeTile(tile) })
  }
  return { tiles }
}

export function registerImageEditorV3BrushTileIpc(
  dependencies: ImageEditorV3BrushTileIpcDependencies,
): void {
  registerIpcHandler(
    'imageEditorV3:brushTiles:persist',
    parseImageEditorV3PersistBrushTilesPayload,
    (payload, event: IpcMainInvokeEvent) => dependencies.runRequest(
      'brush_tiles.persist',
      payload.requestId,
      event.sender.id,
      (signal) => persistImageEditorV3BrushTileBatch(dependencies.store, payload, signal),
      estimateImageEditorV3BrushPersistBytes(payload.rawByteLength),
    ),
    dependencies.guard,
  )
  registerIpcHandler(
    'imageEditorV3:brushTiles:read',
    parseImageEditorV3ReadBrushTilesPayload,
    (payload, event: IpcMainInvokeEvent) => dependencies.runRequest(
      'brush_tiles.read',
      payload.requestId,
      event.sender.id,
      (signal) => readImageEditorV3BrushTileBatch(dependencies.store, payload, signal),
      estimateImageEditorV3BrushReadBytes(
        payload.resourceByteLength,
        payload.maximumDecodedByteLength,
      ),
    ),
    dependencies.guard,
  )
}
