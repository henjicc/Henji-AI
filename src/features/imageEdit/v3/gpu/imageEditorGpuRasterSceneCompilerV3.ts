import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditTransformV3 } from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorGpuSceneTileKeyV3 } from './imageEditorGpuSceneProtocolV3'

export interface ImageEditorGpuRasterLayerV3 {
  layerId: string
  resourceKey: ImageEditorGpuSceneTileKeyV3
  visible: boolean
  opacity: number
  transform: ImageEditTransformV3
}

export interface ImageEditorGpuRasterSceneV3 {
  width: number
  height: number
  layers: readonly ImageEditorGpuRasterLayerV3[]
  requiredResourceKeys: readonly ImageEditorGpuSceneTileKeyV3[]
}

export type ImageEditorGpuRasterSceneCompilationV3 =
  | { supported: true; scene: ImageEditorGpuRasterSceneV3 }
  | { supported: false; reason: string }

/**
 * 2.1 只接收可由一次 source-over pass 精确表达的根级 8-bit sRGB 栅格栈。
 * 组、蒙版、稀疏覆盖、非 normal 混合及颜色扩展留给 3.1/4.1。
 */
export function compileImageEditorGpuRasterSceneV3(
  document: ImageEditDocumentV3,
  resourceDescriptors: readonly ImageEditorV3ResourceDescriptor[],
): ImageEditorGpuRasterSceneCompilationV3 {
  if (document.geometry.width > 512 || document.geometry.height > 512) {
    return { supported: false, reason: '基础 GPU 合成只接管单瓦片文档，大图由 4.1 接入' }
  }
  if (document.color.workingSpace !== 'srgb'
    || document.color.bitDepth !== 8
    || document.color.transferFunction !== 'srgb'
    || document.color.hdrMetadata !== null
    || document.color.iccProfileResourceId !== null) {
    return { supported: false, reason: '基础 GPU 合成仅支持无 ICC/HDR 的 8-bit sRGB 文档' }
  }
  const descriptors = new Map(resourceDescriptors.map((entry) => [entry.resourceRef, entry]))
  const layers: ImageEditorGpuRasterLayerV3[] = []
  for (const layer of document.layers) {
    if (layer.type !== 'raster'
      || layer.source.kind !== 'resource'
      || layer.mask !== null
      || layer.blendMode !== 'normal'
      || Object.keys(layer.tiles).length > 0) {
      return { supported: false, reason: `图层 ${layer.id} 超出基础 GPU 栅格语义` }
    }
    const resourceRef = layer.source.resourceId
    if (!isResourceRef(resourceRef) || !descriptors.has(resourceRef)) {
      return { supported: false, reason: `图层 ${layer.id} 缺少受管资源描述` }
    }
    const descriptor = descriptors.get(resourceRef)!
    layers.push({
      layerId: layer.id,
      resourceKey: {
        resourceRef,
        mip: 0,
        tileX: 0,
        tileY: 0,
        contentVersion: `${resourceRef}:${descriptor.byteLength}`,
      },
      visible: layer.visible,
      opacity: layer.opacity,
      transform: [...layer.transform],
    })
  }
  const unique = new Map<string, ImageEditorGpuSceneTileKeyV3>()
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue
    const key = layer.resourceKey
    unique.set(`${key.resourceRef}:${key.mip}:${key.tileX}:${key.tileY}:${key.contentVersion}`, key)
  }
  return {
    supported: true,
    scene: {
      width: document.geometry.width,
      height: document.geometry.height,
      layers,
      requiredResourceKeys: [...unique.values()],
    },
  }
}

function isResourceRef(value: string): value is `sha256:${string}` {
  return /^sha256:[a-f0-9]{64}$/.test(value)
}
