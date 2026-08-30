import { ImageEditCommandValidationErrorV3 } from './commandErrors'
import type {
  ImageEditCommandV3,
  ImageEditHistoryResourceReferenceV3,
} from './commandTypes'
import {
  collectImageEditCommandResourceReferencesV3,
  mergeImageEditHistoryResourceReferencesV3,
} from './commandTypes'

function sumKnownResourceBytes(
  resources: readonly ImageEditHistoryResourceReferenceV3[],
): number {
  let total = 0
  for (const resource of resources) {
    if (resource.byteSize === null) continue
    total += resource.byteSize
    if (!Number.isSafeInteger(total)) {
      throw new ImageEditCommandValidationErrorV3('栅格瓦片历史字节数溢出')
    }
  }
  return total
}

export function calculateImageEditCommandHistoryResourcesV3(
  command: ImageEditCommandV3,
  inverse: ImageEditCommandV3,
): { resources: ImageEditHistoryResourceReferenceV3[]; bytes: number } {
  let resources: ImageEditHistoryResourceReferenceV3[]
  try {
    resources = mergeImageEditHistoryResourceReferencesV3([
      ...collectImageEditCommandResourceReferencesV3(command),
      ...collectImageEditCommandResourceReferencesV3(inverse),
    ])
  } catch (error) {
    throw new ImageEditCommandValidationErrorV3(
      error instanceof Error ? error.message : '图片编辑历史资源引用无效',
    )
  }
  return { resources, bytes: sumKnownResourceBytes(resources) }
}
