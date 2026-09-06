import { mipSize, type ImageEditDocumentV3, type ImageEditRenderPlanNode } from '@/core/imageEdit/v3'
import { createImageEditorV3RequestId, readImageEditorV3BrushTiles, readImageEditorV3SourceTile } from '@/commands/imageEditorV3'
import type { ImageEditorV3ResourceDescriptor, ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { readImageEditorGpuBrushTilesV3 } from './imageEditorGpuBrushTileReaderV3'
import { rasterizeImageEditorViewportAnnotationsV3 } from './viewportCompositePixelsV3'
import { floatPremultipliedTileToGpuSource } from './imageEditorGpuTileSourceV3'

export interface ImageEditorGpuSceneTileLoaderContextV3 {
  document: ImageEditDocumentV3 | null
  resourceDescriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>
  annotationNodes: ReadonlyMap<string, ImageEditRenderPlanNode>
  sourceBitDepth: 8 | 16 | 32
  readBrushTiles: typeof readImageEditorV3BrushTiles
}

/** 只读取一次明确资源；重试、取消与场景归属由会话桥管理。 */
export async function loadImageEditorGpuSceneTileV3(
  key: Extract<ImageEditorGpuSceneWorkerEventV3, { type: 'tiles-needed' }>['keys'][number],
  signal: AbortSignal,
  context: ImageEditorGpuSceneTileLoaderContextV3,
): Promise<ImageEditorV3SourceTile> {
  const descriptor = context.resourceDescriptors.get(key.resourceRef)
  const annotation = context.annotationNodes.get(key.resourceRef)
  if (key.resourceKind === 'generated-annotation' && annotation) {
    const document = context.document
    if (!document) throw new Error('GPU Scene 标注光栅化缺少文档快照')
    const dimensions = mipSize(document.geometry, key.mip)
    const x = key.tileX * 512
    const y = key.tileY * 512
    const width = Math.min(512, dimensions.width - x)
    const height = Math.min(512, dimensions.height - y)
    if (width < 1 || height < 1) throw new Error('GPU Scene 标注瓦片超出文档范围')
    const tile = rasterizeImageEditorViewportAnnotationsV3(
      annotation, document, { x, y, width, height }, key.mip, signal,
    )
    return floatPremultipliedTileToGpuSource(key, tile.data, width, height)
  }
  if (key.resourceKind === 'sparse-mask') {
    const byteSize = key.resourceByteLength ?? descriptor?.byteLength
    if (byteSize === undefined) throw new Error('GPU Scene 蒙版瓦片缺少受管字节数')
    const loaded = await readImageEditorGpuBrushTilesV3(context.readBrushTiles, {
      requestId: createImageEditorV3RequestId('gpu-scene-mask-tile'),
      tiles: [{
        tileKey: `${key.mip}/${key.tileX}/${key.tileY}`,
        resource: { resourceId: key.resourceRef, byteSize },
      }],
    }, signal)
    const mask = loaded.tiles[0]?.tile
    if (!mask || mask.storage !== 'mask-float32') throw new Error('GPU Scene 蒙版资源不是 Float32 单通道瓦片')
    const rgba = new Uint8Array(mask.width * mask.height * 4)
    for (let pixel = 0; pixel < mask.data.length; pixel += 1) {
      const value = Math.round(Math.max(0, Math.min(1, mask.data[pixel])) * 255)
      const offset = pixel * 4
      rgba[offset] = value
      rgba[offset + 1] = value
      rgba[offset + 2] = value
      rgba[offset + 3] = 255
    }
    return {
      resourceRef: key.resourceRef, mip: key.mip, tileX: key.tileX, tileY: key.tileY,
      halo: 0, width: mask.width, height: mask.height, channels: 4, bitDepth: 8,
      sampleFormat: 'uint', numericRange: 'unorm8', byteOrder: 'little-endian',
      rowStride: mask.width * 4, colorSpace: 'srgb', transferFunction: 'srgb',
      alphaMode: 'straight', orientationApplied: true,
      originX: key.tileX * 512, originY: key.tileY * 512, pixels: rgba.buffer,
    }
  }
  if (key.resourceKind === 'brush-tile') {
    const byteSize = key.resourceByteLength ?? descriptor?.byteLength
    if (byteSize === undefined) throw new Error('GPU Scene 画笔瓦片缺少受管字节数')
    const loaded = await readImageEditorGpuBrushTilesV3(context.readBrushTiles, {
      requestId: createImageEditorV3RequestId('gpu-scene-brush-tile'),
      tiles: [{
        tileKey: `${key.mip}/${key.tileX}/${key.tileY}`,
        resource: { resourceId: key.resourceRef, byteSize },
      }],
    }, signal)
    const brush = loaded.tiles[0]?.tile
    if (!brush || brush.storage !== 'rgba-float32') {
      throw new Error('GPU Scene 画笔资源不是 Float32 RGBA 瓦片')
    }
    return floatPremultipliedTileToGpuSource(key, brush.data, brush.width, brush.height)
  }
  return await readImageEditorV3SourceTile({
    requestId: createImageEditorV3RequestId('gpu-scene-tile'),
    resourceRef: key.resourceRef,
    mip: key.mip,
    tileX: key.tileX,
    tileY: key.tileY,
    halo: 1,
    bitDepth: context.sourceBitDepth,
  }, signal)
}
