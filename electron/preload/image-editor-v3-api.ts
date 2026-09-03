import type {
  ImageEditorV3Platform,
  ImageEditorV3SourceTile,
  ImageEditorV3SourceTileStreamEvent,
} from '../../src/platform/contracts/imageEditorV3'

type NativeInvoke = <T>(channel: string, payload?: unknown) => Promise<T>
type NativePostMessage = (channel: string, message: unknown, transfer?: unknown[]) => void

interface PreloadMessagePortV3 {
  onmessage: ((event: { data: ImageEditorV3SourceTileStreamEvent }) => void) | null
  onmessageerror: (() => void) | null
  postMessage(message: unknown): void
  start(): void
  close(): void
}

interface PreloadMessageChannelV3 {
  port1: PreloadMessagePortV3
  port2: unknown
}

const TILE_STREAM_CHANNEL = 'imageEditorV3:source:tilesStream'
const TILE_STREAM_CREDITS = 4

function readSourceTilesStream(
  request: Parameters<NonNullable<ImageEditorV3Platform['readSourceTiles']>>[0],
  postMessage: NativePostMessage,
): Promise<{ tiles: ImageEditorV3SourceTile[] }> {
  const { onTile, ...payload } = request
  return new Promise((resolve, reject) => {
    const MessageChannelConstructor = (globalThis as unknown as {
      MessageChannel: new () => PreloadMessageChannelV3
    }).MessageChannel
    const channel = new MessageChannelConstructor()
    const tiles = new Array<ImageEditorV3SourceTile>(request.tiles.length)
    let settled = false
    const finish = (complete: () => void): void => {
      if (settled) return
      settled = true
      channel.port1.close()
      complete()
    }
    channel.port1.onmessage = (event) => {
      const message = event.data
      if (message.type === 'tile') {
        if (!Number.isSafeInteger(message.index)
          || message.index < 0
          || message.index >= tiles.length
          || tiles[message.index]) {
          finish(() => reject(new Error('图片编辑瓦片流返回了非法序号')))
          return
        }
        tiles[message.index] = message.tile
        try {
          onTile?.({ index: message.index, tile: message.tile })
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))))
          return
        }
        channel.port1.postMessage({ type: 'credit', count: 1 })
        return
      }
      if (message.type === 'error') {
        const error = new Error(message.message)
        error.name = message.name
        finish(() => reject(error))
        return
      }
      if (message.tileCount !== tiles.length || tiles.some((tile) => !tile)) {
        finish(() => reject(new Error('图片编辑瓦片流未完整返回请求结果')))
        return
      }
      finish(() => resolve({ tiles }))
    }
    channel.port1.onmessageerror = () => finish(() => reject(new Error('图片编辑瓦片流消息损坏')))
    channel.port1.start()
    try {
      postMessage(TILE_STREAM_CHANNEL, payload, [channel.port2])
      channel.port1.postMessage({ type: 'credit', count: TILE_STREAM_CREDITS })
    } catch (error) {
      finish(() => reject(error instanceof Error ? error : new Error(String(error))))
    }
  })
}

/**
 * 图片编辑 V3 使用独立命名空间，避免继续膨胀旧 image IPC。所有本地路径都留在主进程；
 * 这里仅往返文档、内容寻址资源和输出引用，以及有明确尺寸上限的 ArrayBuffer。
 */
export function createImageEditorV3Api(
  nativeInvoke: NativeInvoke,
  nativePostMessage?: NativePostMessage,
): ImageEditorV3Platform {
  return {
    loadDocument: (request) => nativeInvoke('imageEditorV3:document:load', request),
    saveDocument: (request) => nativeInvoke('imageEditorV3:document:save', request),
    deleteDocumentIfRevision: (request) => nativeInvoke(
      'imageEditorV3:document:deleteIfRevision',
      request,
    ),
    forkDocument: (request) => nativeInvoke('imageEditorV3:document:fork', request),
    importSource: (request) => nativeInvoke('imageEditorV3:source:import', request),
    ingestSource: (request) => nativeInvoke('imageEditorV3:source:ingest', request),
    readSourceMetadata: (request) => nativeInvoke('imageEditorV3:source:metadata', request),
    describeSourcePyramid: (request) => nativeInvoke('imageEditorV3:source:pyramid', request),
    prewarmSourcePyramid: (request) => nativeInvoke('imageEditorV3:source:pyramidPrewarm', request),
    readFastProxy: (request) => nativeInvoke('imageEditorV3:source:fastProxy', request),
    readSourceTile: (request) => nativeInvoke('imageEditorV3:source:tile', request),
    readSourceTiles: (request) => {
      if (nativePostMessage) return readSourceTilesStream(request, nativePostMessage)
      const { onTile, ...payload } = request
      const result = nativeInvoke<{ tiles: ImageEditorV3SourceTile[] }>(
        'imageEditorV3:source:tiles', payload,
      )
      if (!onTile) return result
      return result.then((completed) => {
        completed.tiles.forEach((tile, index) => onTile({ index, tile }))
        return completed
      })
    },
    persistBrushTiles: (request) => nativeInvoke('imageEditorV3:brushTiles:persist', request),
    readBrushTiles: (request) => nativeInvoke('imageEditorV3:brushTiles:read', request),
    openPackage: (request) => nativeInvoke('imageEditorV3:package:open', request),
    relinkPackageExternalSource: (request) => nativeInvoke(
      'imageEditorV3:package:relinkExternalSource',
      request,
    ),
    savePackageAs: (request) => nativeInvoke('imageEditorV3:package:saveAs', request),
    startRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:start', request),
    startManagedRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:startManaged', request),
    writeRasterExportTile: (request) => nativeInvoke('imageEditorV3:rasterExport:writeTile', request),
    completeRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:complete', request),
    completeManagedRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:completeManaged', request),
    cancelRasterExport: (request) => nativeInvoke('imageEditorV3:rasterExport:cancel', request),
    collectGarbage: (request) => nativeInvoke('imageEditorV3:resource:collectGarbage', request),
    cancelRequest: (requestId) => nativeInvoke('imageEditorV3:request:cancel', { requestId }),
  }
}

export type HenjiImageEditorV3Api = ImageEditorV3Platform
