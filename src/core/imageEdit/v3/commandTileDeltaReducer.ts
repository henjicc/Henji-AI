import type { ImageEditRasterTileChangeV3 } from './commandTypes'
import {
  ImageEditCommandValidationErrorV3,
  ImageEditRevisionConflictErrorV3,
} from './commandErrors'

const FORBIDDEN_TILE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function validateTileChange(change: ImageEditRasterTileChangeV3, label: string): void {
  if (!change.tileKey || FORBIDDEN_TILE_KEYS.has(change.tileKey)
    || change.tileKey.length > 128
    || !Number.isSafeInteger(change.byteSize) || change.byteSize < 0
    || !Number.isSafeInteger(change.previousByteSize) || change.previousByteSize < 0
    || (change.resourceId === null
      ? change.byteSize !== 0
      : !change.resourceId || change.resourceId.length > 512)
    || (change.previousResourceId === null
      ? change.previousByteSize !== 0
      : !change.previousResourceId || change.previousResourceId.length > 512)) {
    throw new ImageEditCommandValidationErrorV3(`${label}瓦片增量无效`)
  }
  if (change.resourceId === change.previousResourceId) {
    throw new ImageEditCommandValidationErrorV3(
      change.byteSize === change.previousByteSize
        ? `${label}瓦片增量不能是空操作`
        : `同一${label}瓦片资源不能声明不同字节数`,
    )
  }
}

export function applyImageEditTileDeltaV3(
  currentTiles: Readonly<Record<string, string>>,
  changes: readonly ImageEditRasterTileChangeV3[],
  label: '栅格' | '蒙版',
): { tiles: Record<string, string>; inverseChanges: ImageEditRasterTileChangeV3[] } {
  if (changes.length === 0) {
    throw new ImageEditCommandValidationErrorV3(`${label}瓦片增量不能为空`)
  }
  const tiles = { ...currentTiles }
  const inverseChanges: ImageEditRasterTileChangeV3[] = []
  const keys = new Set<string>()
  for (const change of changes) {
    validateTileChange(change, label)
    if (keys.has(change.tileKey)) {
      throw new ImageEditCommandValidationErrorV3(`${label}瓦片键重复`)
    }
    const currentResourceId = tiles[change.tileKey] ?? null
    if (currentResourceId !== change.previousResourceId) {
      throw new ImageEditRevisionConflictErrorV3(
        `${label}瓦片 CAS 冲突：${change.tileKey} 期望 ${change.previousResourceId ?? 'empty'}，实际 ${currentResourceId ?? 'empty'}`,
      )
    }
    keys.add(change.tileKey)
    inverseChanges.push({
      tileKey: change.tileKey,
      previousResourceId: change.resourceId,
      previousByteSize: change.byteSize,
      resourceId: change.previousResourceId,
      byteSize: change.previousByteSize,
    })
    if (change.resourceId === null) delete tiles[change.tileKey]
    else tiles[change.tileKey] = change.resourceId
  }
  return { tiles, inverseChanges }
}
