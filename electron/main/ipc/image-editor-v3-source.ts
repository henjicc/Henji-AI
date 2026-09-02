import { BrowserWindow, dialog, type IpcMainInvokeEvent } from 'electron'
import type {
  ImageEditorV3ManagedSource,
  ImageEditorV3SourceMetadata,
} from '../../../src/platform/contracts/imageEditorV3'
import {
  createImageEditorV3ResourceMediaUrl,
  type ImageEditorV3SourceIngestor,
  type SharpSourceProvider,
  type SourceImageMetadata,
} from '../services/image-editor-v3'
import { createMainLogger } from '../services/logging'
import {
  parseImageEditorV3BasePayload,
  parseImageEditorV3FastProxyPayload,
  parseImageEditorV3IngestSourcePayload,
  parseImageEditorV3ResourcePayload,
  parseImageEditorV3TilePayload,
} from './image-editor-v3-payloads'
import {
  parseImageEditorV3PyramidPrewarmPayload,
  parseImageEditorV3TileBatchPayload,
} from './image-editor-v3-tile-payloads'
import {
  estimateImageEditorV3ProxyRequestBytes,
  estimateImageEditorV3PyramidPrewarmBytes,
  estimateImageEditorV3TileBatchRequestBytes,
  estimateImageEditorV3TileRequestBytes,
} from './image-editor-v3-request-admission'
import { registerIpcHandler } from './registry'

const logger = createMainLogger('main.image_editor_v3.source_ipc')

type RunRequestV3 = <T>(
  operation: string,
  requestId: string,
  senderId: number,
  handler: (signal: AbortSignal) => Promise<T>,
  estimatedBytes?: number,
) => Promise<T>

export interface ImageEditorV3SourceIpcDependencies {
  sources: SharpSourceProvider
  sourceIngestor: ImageEditorV3SourceIngestor
  guard(event: IpcMainInvokeEvent): void
  runRequest: RunRequestV3
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function toMetadata(metadata: SourceImageMetadata): ImageEditorV3SourceMetadata {
  return {
    resourceRef: metadata.resourceId,
    width: metadata.width,
    height: metadata.height,
    encodedWidth: metadata.encodedWidth,
    encodedHeight: metadata.encodedHeight,
    format: metadata.format ?? null,
    channels: metadata.channels ?? null,
    depth: metadata.depth ?? null,
    bitsPerSample: metadata.bitsPerSample,
    colorSpace: metadata.colorSpace ?? null,
    orientation: metadata.orientation,
    orientationApplied: metadata.orientationApplied,
    density: metadata.density ?? null,
    pages: metadata.pages ?? null,
    hasAlpha: metadata.hasAlpha,
    hasIccProfile: metadata.hasIccProfile,
    iccProfileResourceRef: metadata.iccProfileResourceId ?? null,
    cicp: metadata.cicp,
    hdr: metadata.hdr,
  }
}

function toManagedSource(imported: Awaited<ReturnType<ImageEditorV3SourceIngestor['ingest']>>): ImageEditorV3ManagedSource {
  return {
    resource: {
      resourceRef: imported.resource.id,
      byteLength: imported.resource.byteLength,
      mediaType: imported.resource.mediaType ?? null,
    },
    metadata: toMetadata(imported.metadata),
    mediaUrl: createImageEditorV3ResourceMediaUrl(imported.resource.id),
  }
}

function ownerFor(event: IpcMainInvokeEvent): BrowserWindow {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) throw new Error('Image editor window is unavailable')
  return owner
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('Image editor V3 request aborted')
  error.name = 'AbortError'
  throw error
}

async function readTileBatch(
  sources: SharpSourceProvider,
  tiles: ReturnType<typeof parseImageEditorV3TileBatchPayload>['tiles'],
  signal: AbortSignal,
): Promise<{ tiles: Array<Record<string, unknown>> }> {
  const ordered = tiles
    .map((tile, index) => ({ tile, index }))
    .sort((left, right) => left.tile.priority - right.tile.priority || left.index - right.index)
  const results = new Array<Awaited<ReturnType<SharpSourceProvider['readTile']>>>(ordered.length)
  let cursor = 0
  const decode = async (): Promise<void> => {
    while (cursor < ordered.length) {
      throwIfAborted(signal)
      const next = ordered[cursor]
      cursor += 1
      if (!next) return
      results[next.index] = await sources.readTile({
        resourceId: next.tile.resourceRef,
        mip: next.tile.mip,
        tileX: next.tile.tileX,
        tileY: next.tile.tileY,
        halo: next.tile.halo,
        bitDepth: next.tile.bitDepth,
        signal,
      })
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, ordered.length) }, () => decode()))
  throwIfAborted(signal)
  return {
    tiles: results.map((tile) => {
      const { resourceId, pixels, ...metadata } = tile
      return { ...metadata, resourceRef: resourceId, pixels: toArrayBuffer(pixels) }
    }),
  }
}

export function registerImageEditorV3SourceIpc(dependencies: ImageEditorV3SourceIpcDependencies): void {
  const { guard, runRequest, sources, sourceIngestor } = dependencies
  registerIpcHandler('imageEditorV3:source:import', parseImageEditorV3BasePayload, (payload, event) => (
    runRequest('source.import', payload.requestId, event.sender.id, async (signal) => {
      const selection = await dialog.showOpenDialog(ownerFor(event), {
        properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
      })
      if (selection.canceled || !selection.filePaths[0]) {
        logger.info('用户取消导入图片源', {
          event: 'image_editor_v3.source.import.dialog_cancelled', requestId: payload.requestId,
        })
        return { status: 'cancelled' as const }
      }
      throwIfAborted(signal)
      const imported = await sourceIngestor.ingest({
        kind: 'local-path', filePath: selection.filePaths[0],
      }, signal)
      return { status: 'completed' as const, value: toManagedSource(imported) }
    })
  ), guard)
  registerIpcHandler('imageEditorV3:source:ingest', parseImageEditorV3IngestSourcePayload, (payload, event) => (
    runRequest('source.ingest', payload.requestId, event.sender.id, async (signal) => (
      toManagedSource(await sourceIngestor.ingest(payload.source, signal))
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:source:metadata', parseImageEditorV3ResourcePayload, (payload, event) => (
    runRequest('source.metadata', payload.requestId, event.sender.id, async (signal) => (
      toMetadata(await sources.readMetadata(payload.resourceRef, signal))
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:source:pyramid', parseImageEditorV3ResourcePayload, (payload, event) => (
    runRequest('source.pyramid', payload.requestId, event.sender.id, (signal) => (
      sources.describePyramid(payload.resourceRef, signal)
    ))
  ), guard)
  registerIpcHandler('imageEditorV3:source:pyramidPrewarm', parseImageEditorV3PyramidPrewarmPayload, (payload, event) => (
    runRequest('source.pyramid_prewarm', payload.requestId, event.sender.id, (signal) => sources.prewarmPyramid({
      resourceId: payload.resourceRef, minimumMip: payload.minimumMip,
      maximumMip: payload.maximumMip, tileBudget: payload.tileBudget,
      bitDepth: payload.bitDepth, signal,
    }), estimateImageEditorV3PyramidPrewarmBytes(payload.bitDepth))
  ), guard)
  registerIpcHandler('imageEditorV3:source:fastProxy', parseImageEditorV3FastProxyPayload, (payload, event) => (
    runRequest('source.fast_proxy', payload.requestId, event.sender.id, async (signal) => {
      const proxy = await sources.readFastProxy(payload.resourceRef, payload.maxDimension, signal)
      return { resourceRef: proxy.resourceId, width: proxy.width, height: proxy.height, mediaType: 'image/webp' as const, bytes: toArrayBuffer(proxy.bytes) }
    }, estimateImageEditorV3ProxyRequestBytes(payload.maxDimension))
  ), guard)
  registerIpcHandler('imageEditorV3:source:tile', parseImageEditorV3TilePayload, (payload, event) => (
    runRequest('source.tile', payload.requestId, event.sender.id, async (signal) => {
      const tile = await sources.readTile({
        resourceId: payload.resourceRef, mip: payload.mip, tileX: payload.tileX,
        tileY: payload.tileY, halo: payload.halo, bitDepth: payload.bitDepth, signal,
      })
      const { resourceId, pixels, ...metadata } = tile
      return { ...metadata, resourceRef: resourceId, pixels: toArrayBuffer(pixels) }
    }, estimateImageEditorV3TileRequestBytes(payload))
  ), guard)
  registerIpcHandler('imageEditorV3:source:tiles', parseImageEditorV3TileBatchPayload, (payload, event) => (
    runRequest('source.tile_batch', payload.requestId, event.sender.id, (signal) => (
      readTileBatch(sources, payload.tiles, signal)
    ), estimateImageEditorV3TileBatchRequestBytes(payload.tiles))
  ), guard)
}
