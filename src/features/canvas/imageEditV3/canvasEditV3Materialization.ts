import { materializeImageEditSnapshotV3 } from '@/features/imageEdit'
import { loadCanvasImageEditExportRenderer } from './loadCanvasImageEditExportRenderer'
import type { ImageEditorV3DocumentSnapshot } from '@/platform/contracts/imageEditorV3'
export { ImageEditMaterializationContractErrorV3 as CanvasEditV3MaterializationContractError } from '@/features/imageEdit'
export type { ImageEditMaterializationResultV3 as CanvasEditV3MaterializationResult } from '@/features/imageEdit'

export async function materializeCanvasEditV3Snapshot(snapshot: ImageEditorV3DocumentSnapshot, sourceName: string, signal?: AbortSignal): Promise<import('@/features/imageEdit').ImageEditMaterializationResultV3> {
  return materializeImageEditSnapshotV3(snapshot, sourceName, signal, loadCanvasImageEditExportRenderer)
}
