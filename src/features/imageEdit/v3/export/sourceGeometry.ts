import { createImageEditorV3RequestId } from '@/commands/imageEditorV3'
import { mipSize, type ImageEditCpuSamplingContextV3, type ImageEditRenderPlan, type ImageEditSize } from '@/core/imageEdit/v3'
import { resolveImageEditRasterSourceExtentV3 } from '@/core/imageEdit/v3/execution/rasterSourceGeometry'
import type { ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import { readSharedImageEditorSourcePyramidV3 } from '../execution/imageEditorSourcePyramidsV3'
import type { ImageEditorV3ExportRenderDependencies } from './contracts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export async function readImageEditorExportSourcePyramidV3(
  resourceRef: string,
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
): Promise<ImageEditorV3PyramidDescriptor> {
  signal.throwIfAborted()
  if (!/^sha256:[a-f0-9]{64}$/.test(resourceRef)) throw new Error('图片编辑资源引用无效')
  const ref = resourceRef as `sha256:${string}`
  const result = await (dependencies.readSourcePyramid
    ? dependencies.readSourcePyramid(ref, signal)
    : readSharedImageEditorSourcePyramidV3({
        requestId: createImageEditorV3RequestId('export-source-pyramid'), resourceRef: ref,
      }, signal))
  signal.throwIfAborted()
  return result
}

/** 源几何来自主进程金字塔，不使用文档画布大小替代某张图片。 */
export async function readImageEditorRenderSourceSizesV3(
  plan: ImageEditRenderPlan,
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
): Promise<ReadonlyMap<string, ImageEditSize>> {
  const sizes = new Map<string, ImageEditSize>()
  const resourceRefs = new Set<string>()
  for (const node of plan.nodes) {
    const source = node.parameters.source
    if (node.definitionId === 'source.raster' && isRecord(source)
      && source.kind === 'resource' && typeof source.resourceId === 'string') resourceRefs.add(source.resourceId)
    if (node.mask && 'resourceId' in node.mask) resourceRefs.add(node.mask.resourceId)
  }
  for (const resourceRef of resourceRefs) {
    const pyramid = await readImageEditorExportSourcePyramidV3(resourceRef, signal, dependencies)
    const base = pyramid.levels.find((level) => level.mip === 0)
    if (!base) throw new Error('图片源金字塔缺少原始尺寸')
    sizes.set(resourceRef, { width: base.width, height: base.height })
  }
  return sizes
}

export async function prepareImageEditorExportSourceGeometryV3(
  plan: ImageEditRenderPlan,
  canvasSize: ImageEditSize,
  mip: number,
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
): Promise<NonNullable<ImageEditCpuSamplingContextV3['resolveSamplingGrid']>> {
  const sizes = await readImageEditorRenderSourceSizesV3(plan, signal, dependencies)
  return (target) => {
    let size = canvasSize
    if (target.kind === 'mask') {
      if ('resourceId' in target.reference) size = sizes.get(target.reference.resourceId) ?? canvasSize
    } else if (target.node.definitionId === 'source.raster') {
      const source = target.node.parameters.source
      const resourceId = isRecord(source) && source.kind === 'resource' && typeof source.resourceId === 'string'
        ? source.resourceId : null
      size = resolveImageEditRasterSourceExtentV3(resourceId ? sizes.get(resourceId) ?? null : null,
        canvasSize, isRecord(target.node.parameters.tiles) ? Object.keys(target.node.parameters.tiles) : [])
    }
    // 现有导出/效果分析载入器直接返回请求的求值 mip，不做第二次网格缩放。
    return { size: mipSize(size, mip), toEvaluation: [1, 0, 0, 1, 0, 0] }
  }
}
