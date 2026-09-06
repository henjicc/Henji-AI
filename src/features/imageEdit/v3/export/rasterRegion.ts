import type { Float32PremultipliedRgbaTile, ImageEditDocumentV3, ImageEditRenderPlanNode, ImageEditResourceBudget } from '@/core/imageEdit/v3'
import { applyImageEditorV3SparseRasterRegion, type ImageEditorV3SparseRasterPlan } from './brushRegion'
import type { ImageEditorV3ExportRenderDependencies, ImageEditorV3ExportRenderRegion } from './contracts'
import { transparentRegion } from './renderExportResourcesV3'
import { resolveImageEditorV3ExportReferenceWhiteNits } from './capabilities'

/** 所有 CPU 栅格消费方使用同一读取顺序；缓存只属于未修改底图，覆盖按节点隔离。 */
export async function loadImageEditorRasterRegionV3(options: {
  node: ImageEditRenderPlanNode
  region: ImageEditorV3ExportRenderRegion
  mip: number
  document: ImageEditDocumentV3
  sparsePlan: ImageEditorV3SparseRasterPlan
  signal: AbortSignal
  dependencies: ImageEditorV3ExportRenderDependencies
  budget: ImageEditResourceBudget
  loadSource(resourceId: string, region: ImageEditorV3ExportRenderRegion, mip: number): Promise<Float32PremultipliedRgbaTile>
}): Promise<Float32PremultipliedRgbaTile> {
  const { node, region, mip, document, sparsePlan, signal, dependencies, budget, loadSource } = options
  signal.throwIfAborted()
  const value = node.parameters.source
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  const resourceId = source?.kind === 'resource' && typeof source.resourceId === 'string' ? source.resourceId : null
  const referenceWhiteNits = resolveImageEditorV3ExportReferenceWhiteNits(document)
  const base = resourceId ? await loadSource(resourceId, region, mip)
    : transparentRegion(region, document.color.workingSpace, document.color.transferFunction, referenceWhiteNits)
  return applyImageEditorV3SparseRasterRegion(node, base, region, document.geometry, sparsePlan,
    { workingSpace: document.color.workingSpace, transferFunction: document.color.transferFunction, referenceWhiteNits },
    signal, dependencies, budget, mip, async (x, y) => resourceId
      ? (await loadSource(resourceId, { x, y, width: 1, height: 1 }, 0)).data : new Float32Array(4))
}
