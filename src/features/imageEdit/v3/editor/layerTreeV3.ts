import { createImageEditOperationParametersV3 } from '@/core/imageEdit/v3/operationCatalog'
import {
  createImageEditAdjustmentLayerV3,
  createImageEditAnnotationLayerV3,
  createImageEditEffectLayerV3,
  createImageEditGroupLayerV3,
  createImageEditIdV3,
  createImageEditRasterLayerV3,
} from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditWorkingSpaceV3 } from '@/core/imageEdit/v3/colorTypes'
import type {
  ImageEditGroupLayerV3,
  ImageEditLayerV3,
} from '@/core/imageEdit/v3/layerTypes'
import type { ImageEditorLayerKindV3 } from '../application/imageEditorHostProfiles'

export interface ImageEditLayerLocationV3 {
  layer: ImageEditLayerV3
  parentId: string | null
  index: number
  depth: number
  ancestors: ImageEditGroupLayerV3[]
  container: readonly ImageEditLayerV3[]
}

export interface ImageEditLayerTreeRowV3 extends ImageEditLayerLocationV3 {
  ariaPosition: number
  ariaSetSize: number
}

export interface ImageEditLayerCreationChoiceV3 {
  kind: ImageEditorLayerKindV3
  subtype?: string
  name: string
}

export interface ImageEditLayerDropDestinationV3 {
  layerId: string
  parentId: string | null
  index: number
}

export function isImageEditLayerLocationEditableV3(
  location: Pick<ImageEditLayerLocationV3, 'layer' | 'ancestors'>,
): boolean {
  return !location.layer.locked && location.ancestors.every((ancestor) => !ancestor.locked)
}

export function canDragImageEditLayerRowV3(row: ImageEditLayerTreeRowV3): boolean {
  return isImageEditLayerLocationEditableV3(row)
}

/**
 * 把视觉树行命中转换为文档树位置。禁止从锁定组中拖出内容，也在命令进入
 * reducer 前过滤“组放入自身后代”的无效目标，避免延迟 drop 抛出未捕获异常。
 */
export function resolveImageEditLayerDropV3(
  rows: readonly ImageEditLayerTreeRowV3[],
  fromIndex: number,
  toIndex: number,
): ImageEditLayerDropDestinationV3 | null {
  const source = rows[fromIndex]
  const target = rows[toIndex]
  if (!source || !target || source.layer.id === target.layer.id || !canDragImageEditLayerRowV3(source)) {
    return null
  }
  if (target.ancestors.some((ancestor) => ancestor.id === source.layer.id)) return null
  if (target.ancestors.some((ancestor) => ancestor.locked)) return null
  return {
    layerId: source.layer.id,
    parentId: target.parentId,
    index: target.index,
  }
}

export function findImageEditLayerLocationV3(
  layers: readonly ImageEditLayerV3[],
  layerId: string,
  parentId: string | null = null,
  depth = 0,
  ancestors: ImageEditGroupLayerV3[] = [],
): ImageEditLayerLocationV3 | null {
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index]
    if (layer.id === layerId) {
      return { layer, parentId, index, depth, ancestors, container: layers }
    }
    if (layer.type === 'group') {
      const nested = findImageEditLayerLocationV3(
        layer.children,
        layerId,
        layer.id,
        depth + 1,
        [...ancestors, layer],
      )
      if (nested) return nested
    }
  }
  return null
}

export function flattenImageEditLayerTreeV3(
  layers: readonly ImageEditLayerV3[],
  expandedGroupIds: ReadonlySet<string>,
): ImageEditLayerTreeRowV3[] {
  const rows: ImageEditLayerTreeRowV3[] = []
  const visit = (
    entries: readonly ImageEditLayerV3[],
    parentId: string | null,
    depth: number,
    ancestors: ImageEditGroupLayerV3[],
  ): void => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const layer = entries[index]
      rows.push({
        layer,
        parentId,
        index,
        depth,
        ancestors,
        container: entries,
        ariaPosition: entries.length - index,
        ariaSetSize: entries.length,
      })
      if (layer.type === 'group' && expandedGroupIds.has(layer.id)) {
        visit(layer.children, layer.id, depth + 1, [...ancestors, layer])
      }
    }
  }
  visit(layers, null, 0, [])
  return rows
}

export function getImageEditLayerContainerV3(
  layers: readonly ImageEditLayerV3[],
  parentId: string | null,
): readonly ImageEditLayerV3[] | null {
  if (parentId === null) return layers
  const location = findImageEditLayerLocationV3(layers, parentId)
  return location?.layer.type === 'group' ? location.layer.children : null
}

export function canGroupImageEditLayersV3(
  layers: readonly ImageEditLayerV3[],
  layerIds: readonly string[],
): boolean {
  if (layerIds.length === 0) return false
  const locations = layerIds.map((id) => findImageEditLayerLocationV3(layers, id))
  if (locations.some((entry) => !entry)) return false
  const resolved = locations as ImageEditLayerLocationV3[]
  if (resolved.some((entry) => (
    !isImageEditLayerLocationEditableV3(entry)
    || entry.parentId !== resolved[0].parentId
  ))) return false
  const indices = resolved.map((entry) => entry.index).sort((left, right) => left - right)
  return indices.every((value, index) => index === 0 || value === indices[index - 1] + 1)
}

export function canDeleteImageEditLayersV3(
  layers: readonly ImageEditLayerV3[],
  layerIds: readonly string[],
): boolean {
  if (layerIds.length === 0) return false
  return layerIds.every((id) => {
    const location = findImageEditLayerLocationV3(layers, id)
    return Boolean(location && isImageEditLayerLocationEditableV3(location))
  })
}

export function canUngroupImageEditLayerV3(
  location: ImageEditLayerLocationV3 | null,
): boolean {
  return Boolean(
    location
    && location.layer.type === 'group'
    && isImageEditLayerLocationEditableV3(location)
    && location.layer.children.every((child) => !child.locked),
  )
}

export function createImageEditDuplicateIdMapV3(layer: ImageEditLayerV3): Record<string, string> {
  const idMap: Record<string, string> = {}
  const visit = (entry: ImageEditLayerV3): void => {
    idMap[entry.id] = createImageEditIdV3('layer')
    if (entry.type === 'group') entry.children.forEach(visit)
  }
  visit(layer)
  return idMap
}

export function createImageEditLayerFromChoiceV3(
  choice: ImageEditLayerCreationChoiceV3,
  workingSpace: ImageEditWorkingSpaceV3,
): ImageEditLayerV3 {
  const id = createImageEditIdV3('layer')
  if (choice.kind === 'raster') return createImageEditRasterLayerV3(id, choice.name)
  if (choice.kind === 'annotation') return createImageEditAnnotationLayerV3(id, choice.name)
  if (choice.kind === 'group') return createImageEditGroupLayerV3(id, choice.name)
  if (choice.kind === 'effect') {
    const effectId = choice.subtype ?? 'image.fast-blur-v3'
    return createImageEditEffectLayerV3(id, choice.name, effectId, createImageEditOperationParametersV3(effectId, workingSpace))
  }
  const adjustmentId = choice.subtype ?? 'exposure'
  return createImageEditAdjustmentLayerV3(
    id,
    choice.name,
    adjustmentId,
    createImageEditOperationParametersV3(adjustmentId, workingSpace),
  )
}
