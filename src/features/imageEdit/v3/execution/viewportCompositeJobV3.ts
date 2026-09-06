import type { ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditMemoryLease } from '@/core/imageEdit/v3/resourceBudget'
import type { ImageEditorViewportCompositeRequestV3, ImageEditorManagedViewportCompositeV3 } from './viewportCompositeTypesV3'
import type { ImageEditorViewportCompositeProgressV3 } from './viewportCompositeResultOwnerV3'
import type { ImageEditorWorkerCompletionV3 } from './imageEditorWorkerCompletionV3'
import type { ImageEditorViewportCompositeWorkerEventV3 } from './viewportCompositeProtocolV3'
import type { PreparedImageEditorViewportCompositeV3 } from './viewportCompositeDocumentV3'
import type { ImageEditorViewportFrameV3 } from './viewportTileSchedulerV3'
import type { ImageEditorViewportTilePlanV3 } from './viewportTilePlannerV3'

export function imageEditorViewportResourceSizesV3(
  descriptors: ReadonlyMap<ImageEditorV3ResourceRef, ImageEditorV3PyramidDescriptor>,
): ReadonlyMap<ImageEditorV3ResourceRef, { width: number; height: number }> {
  return new Map([...descriptors].map(([resourceRef, descriptor]) => {
    const level = descriptor.levels.find(({ mip }) => mip === 0)
    if (!level) throw new Error('视口图片资源缺少 mip 0 几何')
    return [resourceRef, { width: level.width, height: level.height }]
  }))
}

export interface ActiveViewportJobV3 extends ImageEditorViewportCompositeRequestV3 {
  sequence: number
  requestId: string
  controller: AbortController
  prepared: PreparedImageEditorViewportCompositeV3 | null
  frame: ImageEditorViewportFrameV3 | null
  tilePlan: ImageEditorViewportTilePlanV3 | null
  progress: ImageEditorViewportCompositeProgressV3 | null
  transferLease: ImageEditMemoryLease | null
  workingLease: ImageEditMemoryLease | null
  outputLease: ImageEditMemoryLease | null
  posted: boolean
  renderTaskId: string
  workerCompletion: ImageEditorWorkerCompletionV3<ImageEditorViewportCompositeWorkerEventV3>
  settled: boolean
  startedAt: number
  sourceReadyAt: number | null
  workerStartedAt: number | null
  resolve: (result: ImageEditorManagedViewportCompositeV3) => void
  reject: (error: Error) => void
}
