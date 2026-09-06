import { createImageEditorV3RequestId } from '@/commands/imageEditorV3'
import { mipSize, type ImageEditRenderPlan, type ImageEditRenderPlanNode, type ImageEditSize } from '@/core/imageEdit/v3'
import type { ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import { readSharedImageEditorSourcePyramidV3 } from '../execution/imageEditorSourcePyramidsV3'
import { createImageEditorViewportSourceSizeResolverV3 } from '../execution/viewportCompositeDocumentV3'
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
  for (const node of plan.nodes) {
    if (node.definitionId !== 'source.raster') continue
    const source = node.parameters.source
    if (!isRecord(source)
      || source.kind !== 'resource' || typeof source.resourceId !== 'string'
      || sizes.has(source.resourceId)) continue
    const pyramid = await readImageEditorExportSourcePyramidV3(source.resourceId, signal, dependencies)
    const base = pyramid.levels.find((level) => level.mip === 0)
    if (!base) throw new Error('图片源金字塔缺少原始尺寸')
    sizes.set(source.resourceId, { width: base.width, height: base.height })
  }
  return sizes
}

export async function prepareImageEditorExportSourceGeometryV3(
  plan: ImageEditRenderPlan,
  canvasSize: ImageEditSize,
  mip: number,
  signal: AbortSignal,
  dependencies: ImageEditorV3ExportRenderDependencies,
): Promise<(node: ImageEditRenderPlanNode) => ImageEditSize> {
  const sizes = await readImageEditorRenderSourceSizesV3(plan, signal, dependencies)
  return createImageEditorViewportSourceSizeResolverV3(plan, sizes, mipSize(canvasSize, mip), mip, canvasSize)
}
