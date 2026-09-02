import { createLogger } from '@/core/logging'
import type { ImageEditorV3Platform } from '@/platform/contracts/imageEditorV3'
import { getPlatform } from '@/platform/runtime'
import { readImageEditorV3SourceTile } from './imageEditorV3'

const logger = createLogger('commands.image_editor_v3_tiles')

export function readImageEditorV3SourceTiles(
  request: {
    requestId: string
    tiles: Parameters<NonNullable<ImageEditorV3Platform['readSourceTiles']>>[0]['tiles']
    onTile?: Parameters<NonNullable<ImageEditorV3Platform['readSourceTiles']>>[0]['onTile']
  },
  signal?: AbortSignal,
): Promise<{ tiles: Awaited<ReturnType<ImageEditorV3Platform['readSourceTile']>>[] }> {
  const platform = getPlatform().imageEditorV3
  if (platform.readSourceTiles) {
    if (signal?.aborted) return Promise.reject(signal.reason)
    const cancel = (): void => {
      void platform.cancelRequest(request.requestId).catch((error: unknown) => {
        logger.warn('图片编辑批量瓦片取消请求发送失败', {
          event: 'image_editor_v3.tiles.cancel_failed',
          requestId: request.requestId,
          context: { error: error instanceof Error ? error.message : String(error) },
        })
      })
    }
    signal?.addEventListener('abort', cancel, { once: true })
    return platform.readSourceTiles(request).finally(() => {
      signal?.removeEventListener('abort', cancel)
    })
  }
  const tiles = new Array<Awaited<ReturnType<ImageEditorV3Platform['readSourceTile']>>>(request.tiles.length)
  let cursor = 0
  const read = async (): Promise<void> => {
    while (cursor < request.tiles.length) {
      const index = cursor
      cursor += 1
      const tile = request.tiles[index]
      if (!tile) return
      tiles[index] = await readImageEditorV3SourceTile({
        requestId: `${request.requestId}:${index}`,
        resourceRef: tile.resourceRef,
        mip: tile.mip,
        tileX: tile.tileX,
        tileY: tile.tileY,
        halo: tile.halo,
        bitDepth: tile.bitDepth,
      }, signal)
      request.onTile?.({ index, tile: tiles[index] })
    }
  }
  return Promise.all(Array.from(
    { length: Math.min(4, request.tiles.length) },
    () => read(),
  )).then(() => ({ tiles }))
}
