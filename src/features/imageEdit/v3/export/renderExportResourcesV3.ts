import { createFloat32PremultipliedRgbaTile, type Float32PremultipliedRgbaTile, type ImageEditMemoryLease, type ImageEditResourceBudget } from '@/core/imageEdit/v3'
import { ImageEditorV3ExportCapabilityError, type ImageEditorV3ExportRenderRegion } from './contracts'
import type { ImageEditCpuRegionRequirementsV3 } from '@/core/imageEdit/v3/execution/cpuRenderRegionExecutor'

export function transparentRegion(
  region: ImageEditorV3ExportRenderRegion,
  workingSpace: 'srgb' | 'display-p3' | 'rec2020',
  transferFunction: 'srgb' | 'linear' | 'pq' | 'hlg',
  referenceWhiteNits: number,
): Float32PremultipliedRgbaTile {
  return createFloat32PremultipliedRgbaTile(
    region.width,
    region.height,
    'linear-light',
    new Float32Array(region.width * region.height * 4),
    workingSpace,
    transferFunction,
    referenceWhiteNits,
  )
}

export function safeWorkingSetBytes(
  requirements: ImageEditCpuRegionRequirementsV3,
  outputRegion: ImageEditorV3ExportRenderRegion,
): number {
  const regions = [...requirements.nodeRegions.values()].flat()
  const pixels = regions.map((region) => region.width * region.height)
  const maximumPixels = Math.max(outputRegion.width * outputRegion.height, ...pixels)
  const retainedPixels = pixels.reduce((total, value) => total + value, 0)
  const maskPixels = [...requirements.maskRegions.values()].flat().reduce(
    (total, region) => total + region.width * region.height, 0,
  )
  // memo 只保留各节点自己的 ROI；某个缩小图层的大逆变换区域不能乘到所有节点。
  // 另外保留一个原子步骤的仿射/颜色/合成临时副本，以及单个512源瓦片解码暂存。
  // 蒙版同时涵盖缓存RGBA、单通道转换和反相副本。
  const decodeScratchPixels = requirements.rasterRegions.size > 0 || requirements.maskRegions.size > 0
    ? 512 * 512 * 3 : 0
  const bytes = (retainedPixels + maximumPixels * 3 + decodeScratchPixels) * 16
    + maskPixels * 24
  if (!Number.isSafeInteger(bytes)) {
    throw new ImageEditorV3ExportCapabilityError(
      'WORKING_SET_EXCEEDED',
      '单个导出瓦片的工作集超出安全整数范围',
    )
  }
  return bytes
}

export function acquireOrThrow(
  budget: ImageEditResourceBudget,
  category: 'in-flight' | 'transfer',
  bytes: number,
): ImageEditMemoryLease {
  const lease = budget.acquire(category, bytes)
  if (lease) return lease
  const snapshot = budget.snapshot()
  throw new ImageEditorV3ExportCapabilityError(
    'WORKING_SET_EXCEEDED',
    `图片导出资源账本拒绝 ${Math.ceil(bytes / 1024 / 1024)}MiB ${category} 工作集；当前已使用 ${Math.ceil(snapshot.totalBytes / 1024 / 1024)}MiB`,
  )
}
