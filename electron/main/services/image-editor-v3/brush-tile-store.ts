import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'

import type {
  ImageEditBrushResourceReferenceV3,
  ImageEditBrushTileV3,
} from '../../../../src/core/imageEdit/v3/brush/contracts'
import { createMainLogger } from '../logging'
import {
  decodeImageEditBrushTileV3,
  encodeImageEditBrushTileV3,
  IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3,
  IMAGE_EDIT_BRUSH_TILE_MEDIA_TYPE_V3,
} from './brush-tile-codec'
import type { ResourceId } from './contracts'
import { ContentAddressedResourceStore, parseResourceId } from './resource-store'

const logger = createMainLogger('main.image_editor_v3.brush_tiles')

function abortError(): Error {
  const error = new Error('Image editor brush tile operation was cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

function validateReference(reference: ImageEditBrushResourceReferenceV3): ResourceId {
  parseResourceId(reference.resourceId)
  if (!Number.isSafeInteger(reference.byteSize)
    || reference.byteSize < 80
    || reference.byteSize > IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3) {
    throw new Error('Invalid brush tile resource byte length')
  }
  return reference.resourceId as ResourceId
}

async function readHashedResource(
  resources: ContentAddressedResourceStore,
  resourceId: ResourceId,
  expectedBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  throwIfAborted(signal)
  let handle: fsp.FileHandle | undefined
  let stream: fs.ReadStream | undefined
  const onAbort = (): void => {
    stream?.destroy(abortError())
  }
  try {
    handle = await fsp.open(
      resources.getFilesystemPath(resourceId),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    )
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size !== expectedBytes) {
      throw new Error('Brush tile resource byte length does not match its reference')
    }
    if (stats.size > IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3) {
      throw new Error('Brush tile resource exceeds the byte limit')
    }
    stream = handle.createReadStream({ autoClose: false })
    signal?.addEventListener('abort', onAbort, { once: true })
    const chunks: Buffer[] = []
    const hash = crypto.createHash('sha256')
    let byteLength = 0
    for await (const value of stream) {
      throwIfAborted(signal)
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      if (chunk.byteLength > expectedBytes - byteLength) {
        throw new Error('Brush tile resource changed while it was being read')
      }
      byteLength += chunk.byteLength
      hash.update(chunk)
      chunks.push(chunk)
    }
    if (byteLength !== expectedBytes) throw new Error('Brush tile resource is truncated')
    const actualHash = hash.digest('hex')
    if (actualHash !== parseResourceId(resourceId)) throw new Error('Brush tile resource hash mismatch')
    return Buffer.concat(chunks, byteLength)
  } catch (error) {
    if (signal?.aborted) throw abortError()
    throw error
  } finally {
    signal?.removeEventListener('abort', onAbort)
    stream?.destroy()
    await handle?.close().catch(() => undefined)
  }
}

/**
 * 权威画笔/蒙版瓦片的唯一主进程持久化入口。内容寻址资源只保存编码结果，
 * 读取时租约覆盖完整的哈希校验和解压过程，避免 GC 与撤销/重做竞态。
 */
export class ImageEditBrushTileStoreV3 {
  constructor(private readonly resources: ContentAddressedResourceStore) {}

  async persistTile(
    tile: ImageEditBrushTileV3,
    signal?: AbortSignal,
  ): Promise<ImageEditBrushResourceReferenceV3> {
    logger.debug('开始持久化图片编辑画笔瓦片', {
      event: 'image_editor_v3.brush_tile.persist.start',
      context: { storage: tile.storage, width: tile.width, height: tile.height },
    })
    try {
      const encoded = await encodeImageEditBrushTileV3(tile, signal)
      const result = await this.resources.putBuffer(encoded, {
        mediaType: IMAGE_EDIT_BRUSH_TILE_MEDIA_TYPE_V3,
        maxBytes: IMAGE_EDIT_BRUSH_TILE_MAX_RESOURCE_BYTES_V3,
        signal,
      })
      logger.debug('图片编辑画笔瓦片持久化完成', {
        event: 'image_editor_v3.brush_tile.persist.completed',
        context: {
          resourceId: result.id,
          byteLength: result.byteLength,
          created: result.created,
          storage: tile.storage,
          width: tile.width,
          height: tile.height,
        },
      })
      return { resourceId: result.id, byteSize: result.byteLength }
    } catch (error) {
      if (isAbortError(error, signal)) {
        logger.info('图片编辑画笔瓦片持久化已取消', {
          event: 'image_editor_v3.brush_tile.persist.cancelled',
        })
      } else {
        logger.error('图片编辑画笔瓦片持久化失败', {
          event: 'image_editor_v3.brush_tile.persist.failed',
          error,
          context: { storage: tile.storage, width: tile.width, height: tile.height },
        })
      }
      throw error
    }
  }

  async readTile(
    reference: ImageEditBrushResourceReferenceV3,
    signal?: AbortSignal,
  ): Promise<ImageEditBrushTileV3> {
    const resourceId = validateReference(reference)
    logger.debug('开始读取图片编辑画笔瓦片', {
      event: 'image_editor_v3.brush_tile.read.start',
      context: { resourceId, byteLength: reference.byteSize },
    })
    let lease: Awaited<ReturnType<ContentAddressedResourceStore['acquireLease']>> | undefined
    try {
      throwIfAborted(signal)
      lease = await this.resources.acquireLease([resourceId])
      throwIfAborted(signal)
      const encoded = await readHashedResource(this.resources, resourceId, reference.byteSize, signal)
      const tile = await decodeImageEditBrushTileV3(encoded, signal)
      logger.debug('图片编辑画笔瓦片读取完成', {
        event: 'image_editor_v3.brush_tile.read.completed',
        context: {
          resourceId,
          byteLength: reference.byteSize,
          storage: tile.storage,
          width: tile.width,
          height: tile.height,
        },
      })
      return tile
    } catch (error) {
      if (isAbortError(error, signal)) {
        logger.info('图片编辑画笔瓦片读取已取消', {
          event: 'image_editor_v3.brush_tile.read.cancelled',
          context: { resourceId },
        })
      } else {
        logger.error('图片编辑画笔瓦片读取失败', {
          event: 'image_editor_v3.brush_tile.read.failed',
          error,
          context: { resourceId },
        })
      }
      throw error
    } finally {
      await lease?.release()
    }
  }
}
