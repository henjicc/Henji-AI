import { ImageEditCommandValidationErrorV3 } from './commandErrors'
import type {
  ImageEditCommandV3,
  ImageEditHistoryResourceReferenceV3,
} from './commandTypes'
import {
  collectImageEditCommandResourceReferencesV3,
  mergeImageEditHistoryResourceReferencesV3,
} from './commandTypes'

export interface ImageEditHistoryResourceTotalsV3 {
  knownBytes: number
  unknownResourceCount: number
}

export function calculateImageEditHistorySnapshotResourceTotalsV3(
  entries: readonly {
    metadataBytes: number
    resources: readonly ImageEditHistoryResourceReferenceV3[]
  }[],
): ImageEditHistoryResourceTotalsV3 {
  let knownBytes = 0
  for (const entry of entries) {
    knownBytes += entry.metadataBytes
    if (!Number.isSafeInteger(knownBytes)) throw new RangeError('历史保留字节数溢出')
  }
  const resources = mergeImageEditHistoryResourceReferencesV3(
    entries.flatMap((entry) => entry.resources),
  )
  let unknownResourceCount = 0
  for (const resource of resources) {
    if (resource.byteSize === null) unknownResourceCount += 1
    else knownBytes += resource.byteSize
    if (!Number.isSafeInteger(knownBytes)) throw new RangeError('历史保留字节数溢出')
  }
  return { knownBytes, unknownResourceCount }
}

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
