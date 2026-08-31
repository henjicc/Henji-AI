import { ImageEditCommandValidationErrorV3 } from './commandErrors'
import { findImageEditCommandLayerLocationV3 } from './commandLayerLocation'
import {
  collectImageEditLayerResourceIdsForCommandV3,
  type ImageEditCommandResourceDescriptorV3,
  type ImageEditCommandV3,
} from './commandTypes'
import type { ImageEditDocumentV3 } from './documentTypes'
import { collectImageEditMaskResourceIdsV3 } from './layerTypes'

type StructuralCommandV3 = Extract<ImageEditCommandV3, {
  type: 'layer.add' | 'layer.delete' | 'layer.duplicate' | 'layer.group' | 'layer.ungroup'
}>

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort()
}

function structuralResourceIds(
  document: ImageEditDocumentV3,
  command: StructuralCommandV3,
): string[] {
  if (command.type === 'layer.add') {
    return collectImageEditLayerResourceIdsForCommandV3(command.layer)
  }
  if (command.type === 'layer.delete' || command.type === 'layer.duplicate') {
    const location = findImageEditCommandLayerLocationV3(document.layers, command.layerId)
    if (!location) throw new ImageEditCommandValidationErrorV3(`图层不存在：${command.layerId}`)
    return collectImageEditLayerResourceIdsForCommandV3(location.layer)
  }
  if (command.type === 'layer.ungroup') {
    const location = findImageEditCommandLayerLocationV3(document.layers, command.groupId)
    if (!location || location.layer.type !== 'group') {
      throw new ImageEditCommandValidationErrorV3('待解散的组不存在')
    }
    return collectImageEditLayerResourceIdsForCommandV3(location.layer)
  }
  const output = collectImageEditLayerResourceIdsForCommandV3(command.group)
  for (const layerId of command.layerIds) {
    const location = findImageEditCommandLayerLocationV3(document.layers, layerId)
    if (!location) throw new ImageEditCommandValidationErrorV3(`待分组图层不存在：${layerId}`)
    output.push(...collectImageEditLayerResourceIdsForCommandV3(location.layer))
  }
  return sortedUnique(output)
}

function assertDescriptors(
  value: readonly ImageEditCommandResourceDescriptorV3[] | undefined,
  expectedIds: readonly string[],
  label: string,
): ImageEditCommandResourceDescriptorV3[] {
  if (!value || value.length !== expectedIds.length) {
    throw new ImageEditCommandValidationErrorV3(`${label}缺失或与图层资源不一致`)
  }
  const output = value.map((entry, index) => {
    if (!entry
      || typeof entry.resourceId !== 'string'
      || entry.resourceId !== expectedIds[index]
      || !Number.isSafeInteger(entry.byteSize)
      || entry.byteSize <= 0) {
      throw new ImageEditCommandValidationErrorV3(`${label}必须按资源 ID 唯一排序并保存正数字节数`)
    }
    return { resourceId: entry.resourceId, byteSize: entry.byteSize }
  })
  return output
}

export function assertImageEditStructuralCommandResourcesV3(
  document: ImageEditDocumentV3,
  command: ImageEditCommandV3,
  allowLegacyMissing = false,
): void {
  if (command.type !== 'layer.add'
    && command.type !== 'layer.delete'
    && command.type !== 'layer.duplicate'
    && command.type !== 'layer.group'
    && command.type !== 'layer.ungroup') return
  if (allowLegacyMissing && command.resources === undefined) return
  assertDescriptors(command.resources, structuralResourceIds(document, command), '图层命令资源元数据')
}

function descriptorsFromIds(
  ids: readonly string[],
  byteSizes: ReadonlyMap<string, number>,
  label: string,
): ImageEditCommandResourceDescriptorV3[] {
  return ids.map((resourceId) => {
    const byteSize = byteSizes.get(resourceId)
    if (!Number.isSafeInteger(byteSize) || Number(byteSize) <= 0) {
      throw new ImageEditCommandValidationErrorV3(`${label}缺少权威字节数：${resourceId}`)
    }
    return { resourceId, byteSize: Number(byteSize) }
  })
}

/** 命令总线的新写入收口：调用方不手抄资源列表，统一从权威 descriptor 表补齐。 */
export function prepareImageEditCommandResourceMetadataV3(
  document: ImageEditDocumentV3,
  command: ImageEditCommandV3,
  byteSizes: ReadonlyMap<string, number>,
): ImageEditCommandV3 {
  if (command.type === 'layer.add'
    || command.type === 'layer.delete'
    || command.type === 'layer.duplicate'
    || command.type === 'layer.group'
    || command.type === 'layer.ungroup') {
    const expectedIds = structuralResourceIds(document, command)
    const resources = command.resources
      ? assertDescriptors(command.resources, expectedIds, '图层命令资源元数据')
      : descriptorsFromIds(expectedIds, byteSizes, '图层命令')
    return { ...command, resources }
  }
  if (command.type !== 'layer.set-mask') return command
  const location = findImageEditCommandLayerLocationV3(document.layers, command.layerId)
  if (!location) throw new ImageEditCommandValidationErrorV3(`图层不存在：${command.layerId}`)
  const maskIds = command.mask ? sortedUnique(collectImageEditMaskResourceIdsV3(command.mask)) : []
  const previousIds = location.layer.mask
    ? sortedUnique(collectImageEditMaskResourceIdsV3(location.layer.mask))
    : []
  return {
    ...command,
    maskResources: command.maskResources
      ?? descriptorsFromIds(maskIds, byteSizes, '新蒙版'),
    previousMaskResources: command.previousMaskResources
      ?? descriptorsFromIds(previousIds, byteSizes, '原蒙版'),
  }
}

export function collectPositiveImageEditCommandResourceBytesV3(
  command: ImageEditCommandV3,
): ImageEditCommandResourceDescriptorV3[] {
  const candidates: ImageEditCommandResourceDescriptorV3[] = []
  if (command.type === 'raster.apply-tile-delta' || command.type === 'mask.apply-tile-delta') {
    for (const change of command.changes) {
      if (change.previousResourceId) candidates.push({ resourceId: change.previousResourceId, byteSize: change.previousByteSize })
      if (change.resourceId) candidates.push({ resourceId: change.resourceId, byteSize: change.byteSize })
    }
  } else if (command.type === 'layer.set-mask') {
    candidates.push(...(command.maskResources ?? []), ...(command.previousMaskResources ?? []))
  } else if ('resources' in command && command.resources) {
    candidates.push(...command.resources)
  }
  const byId = new Map<string, number>()
  for (const resource of candidates) {
    if (!Number.isSafeInteger(resource.byteSize) || resource.byteSize <= 0) {
      throw new ImageEditCommandValidationErrorV3('命令资源字节数必须为正数')
    }
    const previous = byId.get(resource.resourceId)
    if (previous !== undefined && previous !== resource.byteSize) {
      throw new ImageEditCommandValidationErrorV3(`命令资源字节数冲突：${resource.resourceId}`)
    }
    byId.set(resource.resourceId, resource.byteSize)
  }
  return [...byId.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([resourceId, byteSize]) => ({ resourceId, byteSize }))
}
