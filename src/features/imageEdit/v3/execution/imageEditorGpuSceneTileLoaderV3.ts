import {ensureVectorDocumentFonts} from '@/services/vectorContent/fonts'
import { enumerateTilesForRect, mipSize, type ImageEditDocumentV3, type ImageEditRenderPlanNode } from '@/core/imageEdit/v3'
import { createImageEditorV3RequestId, readImageEditorV3BrushTiles, readImageEditorV3SourceTile } from '@/commands/imageEditorV3'
import type { ImageEditorV3ResourceDescriptor, ImageEditorV3SourceTile } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import { readImageEditorGpuBrushTilesV3 } from './imageEditorGpuBrushTileReaderV3'
import { applyImageEditorViewportBrushTilesV3, createTransparentImageEditorViewportRegionV3,
  loadImageEditorViewportSourceRegionV3, rasterizeImageEditorViewportVectorContentV3,
  viewportCompositeSourceTileKeyV3 } from './viewportCompositePixelsV3'
import { floatPremultipliedTileToGpuSource } from './imageEditorGpuTileSourceV3'

export interface ImageEditorGpuSceneTileLoaderContextV3 {
  document: ImageEditDocumentV3 | null
  resourceDescriptors: ReadonlyMap<string, ImageEditorV3ResourceDescriptor>
  annotationNodes: ReadonlyMap<string, ImageEditRenderPlanNode>
  sourceBitDepth: 8 | 16 | 32
  readBrushTiles: typeof readImageEditorV3BrushTiles
}

/** 按冻结的瓦片引用读取有界采样邻域；重试、取消与场景归属由会话桥管理。 */
export async function loadImageEditorGpuSceneTileV3(
  key: Extract<ImageEditorGpuSceneWorkerEventV3, { type: 'tiles-needed' }>['keys'][number],
  signal: AbortSignal,
  context: ImageEditorGpuSceneTileLoaderContextV3,
): Promise<ImageEditorV3SourceTile> {
  if (key.rasterRegion) {
    const document = context.document
    if (!document) throw new Error('GPU 稀疏采样缺少文档快照')
    const sampling = key.rasterRegion
    const sources = new Map<string, ImageEditorV3SourceTile>()
    if (sampling.sourceRef && sampling.sourceSize) {
      for (const coordinate of enumerateTilesForRect(sampling.sourceSize, 0, sampling.rect)) {
        signal.throwIfAborted()
        const tile = await readImageEditorV3SourceTile({ requestId: createImageEditorV3RequestId('gpu-sparse-halo'),
          resourceRef: sampling.sourceRef, mip: 0, tileX: coordinate.x, tileY: coordinate.y,
          halo: 1, bitDepth: context.sourceBitDepth }, signal)
        sources.set(viewportCompositeSourceTileKeyV3(tile), tile)
      }
    }
    const base = sampling.sourceRef && sampling.sourceSize
      ? loadImageEditorViewportSourceRegionV3(sources, sampling.sourceRef, 0, sampling.rect, document, sampling.sourceSize)
      : createTransparentImageEditorViewportRegionV3(sampling.rect, document)
    const loaded = sampling.tiles.length ? await readImageEditorGpuBrushTilesV3(context.readBrushTiles, {
      requestId: createImageEditorV3RequestId('gpu-sparse-neighbors'),
      tiles: sampling.tiles.map(entry => ({ tileKey: entry.tileKey,
        resource: { resourceId: entry.resourceRef, byteSize: entry.byteLength } })),
    }, signal) : { tiles: [] }
    const node = { parameters: { tiles: Object.fromEntries(sampling.tiles.map(entry => [entry.tileKey, entry.resourceRef])) } }
    const brushTiles = new Map(loaded.tiles.map(entry => {
      const reference = sampling.tiles.find(item => item.tileKey === entry.tileKey)
      if (!reference || entry.tile.storage !== 'rgba-float32') throw new Error('GPU 邻接瓦片不是请求的 RGBA 资源')
      return [reference.resourceRef, { resourceId: reference.resourceRef, storage: entry.tile.storage,
        width: entry.tile.width, height: entry.tile.height, bytes: entry.tile.data.slice().buffer }] as const
    }))
    const pixels = applyImageEditorViewportBrushTilesV3(node, base, sampling.rect, 0,
      [...brushTiles.values()], signal, undefined, sampling.extent)
    return floatPremultipliedTileToGpuSource(key, pixels.data, pixels.width, pixels.height, sampling.rect)
  }
  if (key.format === 'r8unorm' && key.resourceKind === 'source-raster') throw new Error('GPU 蒙版仅接受稀疏受管瓦片')
  const descriptor = context.resourceDescriptors.get(key.resourceRef)
  const annotation = context.annotationNodes.get(key.resourceRef)
  if (key.resourceKind === 'generated-vector') {
    if (!annotation) throw new Error('当前文字或路径绘制请求已失效，请重试。')
    const document = context.document
    if (!document) throw new Error('GPU Scene 标注光栅化缺少文档快照')
    const dimensions = mipSize(document.geometry, key.mip)
    const x = Math.max(0, key.tileX * 512 - 1)
    const y = Math.max(0, key.tileY * 512 - 1)
    const width = Math.min(dimensions.width, key.tileX * 512 + 513) - x
    const height = Math.min(dimensions.height, key.tileY * 512 + 513) - y
    if (width < 1 || height < 1) throw new Error('GPU Scene 标注瓦片超出文档范围')
    await ensureVectorDocumentFonts(document)
    const tile = rasterizeImageEditorViewportVectorContentV3(
      annotation, document, { x, y, width, height }, key.mip, signal,
    )
    return floatPremultipliedTileToGpuSource(key, tile.data, width, height, { x, y })
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
