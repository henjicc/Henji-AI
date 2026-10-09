import type { ImageEditLayersMoveCommandV3 } from '@/core/imageEdit/v3/commandTypes'
import type { ImageEditLayerTreeRowV3 } from '../../editor/layerTreeV3'
import { isImageEditLayerLocationEditableV3 } from '../../editor/layerTreeV3'

/** 只把已有拖拽组件的行命中适配为领域位置；不实现另一套拖拽手势。 */
export function resolveImageEditLayerMovesV3(rows: readonly ImageEditLayerTreeRowV3[], from: number, to: number, selectedIds: readonly string[], allRows = rows): ImageEditLayersMoveCommandV3['moves'] | null {
  const source = rows[from], target = rows[to]
  if (!source || !target || from === to) return null
  const selected = new Set(selectedIds.includes(source.layer.id) ? selectedIds : [source.layer.id])
  const sources = allRows.filter(row => selected.has(row.layer.id) && !row.ancestors.some(parent => selected.has(parent.id)))
  const ids = new Set(sources.map(row => row.layer.id))
  if (!sources.length || sources.some(row => !isImageEditLayerLocationEditableV3(row))
    || ids.has(target.layer.id) || target.ancestors.some(parent => ids.has(parent.id) || parent.locked)) return null
  const intoGroup = target.layer.type === 'group'
  if (intoGroup && target.layer.locked) return null
  const parentId = intoGroup ? target.layer.id : target.parentId
  const boundary = intoGroup && target.layer.type === 'group' ? target.layer.children.length
    : target.index + (from > to ? 1 : 0)
  const index = boundary - sources.filter(row => row.parentId === parentId && row.index < boundary).length
  // 视觉顺序反向对应文档自下而上顺序；同一组移动不会反转剪贴基底。
  return sources.slice().reverse().map((row, offset) => ({ layerId: row.layer.id, parentId, index: index + offset }))
}
