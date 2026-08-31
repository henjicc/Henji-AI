import {
  ImageEditorV3CommandRepository,
  createImageEditorV3RequestId,
  persistImageEditorV3BrushTiles,
} from '@/commands/imageEditorV3'
import type {
  ImageEditBrushTileV3,
  PersistedImageEditBrushTileV3,
} from '@/core/imageEdit/v3/brush/contracts'
import type { ImageEditMaskResourceDescriptorV3 } from '@/core/imageEdit/v3/commandTypes'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import {
  collectImageEditMaskResourceIdsV3,
  createImageEditSparseMaskReferenceV3,
  isImageEditSparseMaskReferenceV3,
  type ImageEditLayerV3,
  type ImageEditSparseMaskReferenceV3,
} from '@/core/imageEdit/v3/layerTypes'
import { collectImageEditJsonResourceIdsV3 } from '@/core/imageEdit/v3/resourceReferences'
import {
  materializeImageEditSelectionMaskDeltaV3,
  planImageEditSelectionMaskV3,
  rasterizeImageEditSelectionMaskTilesV3,
  type ImageEditSelectionCombineModeV3,
  type ImageEditSelectionExistingMaskTileV3,
  type ImageEditSelectionMaskTileChangeV3,
  type ImageEditSelectionShapeV3,
  type PersistedImageEditSelectionMaskTileChangeV3,
} from '@/core/imageEdit/v3/selection'
import { createLogger } from '@/core/logging'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import { createImageEditorMaskBrushTileLoaderV3 } from './maskBrushTilesV3'

const logger = createLogger('features.image_edit_v3.selection_mask')

export const IMAGE_EDITOR_SELECTION_PERSIST_BATCH_SIZE_V3 = 12
const RESOURCE_ID_PATTERN = /^sha256:[a-f0-9]{64}$/

type PersistTilesV3 = (
  tiles: ReadonlyArray<{ tileKey: string; tile: ImageEditBrushTileV3 }>,
  signal: AbortSignal,
) => Promise<readonly PersistedImageEditBrushTileV3[]>

type CollectGarbageV3 = (
  documentId: string,
  retainedResourceIds: readonly string[],
) => Promise<void>

export interface ImageEditorSelectionMaskCommitOptionsV3 {
  bus: ImageEditCommandBusV3
  document: ImageEditDocumentV3
  layer: ImageEditLayerV3
  shape: ImageEditSelectionShapeV3
  combineMode: ImageEditSelectionCombineModeV3
  resourceByteSizes: Map<string, number>
  persistTiles?: PersistTilesV3
  collectGarbage?: CollectGarbageV3
}

type CommitStateV3 = 'idle' | 'running' | 'completed' | 'cancelled' | 'failed'

async function defaultPersistTiles(
  tiles: ReadonlyArray<{ tileKey: string; tile: ImageEditBrushTileV3 }>,
  signal: AbortSignal,
): Promise<readonly PersistedImageEditBrushTileV3[]> {
  const result = await persistImageEditorV3BrushTiles({
    requestId: createImageEditorV3RequestId('selection-mask-persist'),
    tiles,
  }, signal)
  return result.tiles
}

function defaultCollectGarbage(
  documentId: string,
  retainedResourceIds: readonly string[],
): Promise<void> {
  return new ImageEditorV3CommandRepository().collectGarbage(documentId, retainedResourceIds)
}

function resourceDescriptors(
  mask: ImageEditLayerV3['mask'],
  byteSizes: ReadonlyMap<string, number>,
): ImageEditMaskResourceDescriptorV3[] {
  if (!mask) return []
  return collectImageEditMaskResourceIdsV3(mask).sort().map((resourceId) => {
    const byteSize = byteSizes.get(resourceId)
    if (typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize <= 0) {
      throw new Error(`蒙版资源缺少有效实际字节数：${resourceId}`)
    }
    return { resourceId, byteSize }
  })
}

function existingTiles(
  mask: ImageEditSparseMaskReferenceV3,
  byteSizes: ReadonlyMap<string, number>,
): ImageEditSelectionExistingMaskTileV3[] {
  return Object.entries(mask.tiles).sort(([left], [right]) => left.localeCompare(right)).map(([
    tileKey,
    resourceId,
  ]) => {
    const byteSize = byteSizes.get(resourceId)
    if (typeof byteSize !== 'number' || !Number.isSafeInteger(byteSize) || byteSize <= 0) {
      throw new Error(`蒙版瓦片缺少有效实际字节数：${tileKey}`)
    }
    return { tileKey, resource: { resourceId, byteSize } }
  })
}

function persistedByTileKey(
  requested: readonly ImageEditSelectionMaskTileChangeV3[],
  persisted: readonly PersistedImageEditBrushTileV3[],
): Map<string, PersistedImageEditBrushTileV3> {
  const expected = new Set(requested.map((change) => change.tileKey))
  const output = new Map<string, PersistedImageEditBrushTileV3>()
  for (const entry of persisted) {
    if (!expected.has(entry.tileKey) || output.has(entry.tileKey)
      || !RESOURCE_ID_PATTERN.test(entry.resourceId)
      || !Number.isSafeInteger(entry.byteSize) || entry.byteSize <= 0) {
      throw new Error('选区蒙版瓦片持久化结果无效')
    }
    output.set(entry.tileKey, entry)
  }
  if (output.size !== expected.size) throw new Error('选区蒙版瓦片持久化结果不完整')
  return output
}

/** pointer-up 后分块栅格化并原子提交；无论涉及多少瓦片，历史始终只有一条命令。 */
export class ImageEditorSelectionMaskCommitV3 {
  private readonly abortController = new AbortController()
  private readonly persistTiles: PersistTilesV3
  private readonly collectGarbage: CollectGarbageV3
  private readonly commandId = createImageEditIdV3('selection-mask')
  private state: CommitStateV3 = 'idle'
  private persistenceAttempted = false

  constructor(private readonly options: ImageEditorSelectionMaskCommitOptionsV3) {
    this.persistTiles = options.persistTiles ?? defaultPersistTiles
    this.collectGarbage = options.collectGarbage ?? defaultCollectGarbage
  }

  async commit(): Promise<boolean> {
    if (this.state !== 'idle') throw new Error(`选区蒙版提交状态无效：${this.state}`)
    this.assertFresh()
    this.state = 'running'
    logger.info('选区转蒙版开始', {
      event: 'image_editor_v3.selection_mask.commit.start',
      context: {
        commandId: this.commandId,
        documentId: this.options.document.id,
        layerId: this.options.layer.id,
        combineMode: this.options.combineMode,
      },
    })
    try {
      const mask = this.options.layer.mask
      const editableMask = mask
        && isImageEditSparseMaskReferenceV3(mask)
        && mask.defaultValue === 0
        ? mask
        : null
      if (!editableMask && this.options.combineMode !== 'replace') {
        throw new Error('当前蒙版只能使用替换选区')
      }
      const plan = planImageEditSelectionMaskV3({
        canvas: this.options.document.geometry,
        shape: this.options.shape,
        combineMode: this.options.combineMode,
        existingTiles: editableMask
          ? existingTiles(editableMask, this.options.resourceByteSizes)
          : [],
      })
      const loader = editableMask
        ? createImageEditorMaskBrushTileLoaderV3({
            document: this.options.document,
            mask: editableMask,
            resourceByteSizes: this.options.resourceByteSizes,
          })
        : null
      const changes: PersistedImageEditSelectionMaskTileChangeV3[] = []
      let batch: ImageEditSelectionMaskTileChangeV3[] = []
      const flush = async (): Promise<void> => {
        if (batch.length === 0) return
        this.assertFresh()
        const writing = batch.filter((change) => change.newTile !== null)
        if (writing.length > 0) this.persistenceAttempted = true
        const persisted = writing.length > 0
          ? await this.persistTiles(writing.map((change) => ({
              tileKey: change.tileKey,
              tile: change.newTile!,
            })), this.abortController.signal)
          : []
        this.assertFresh()
        const byKey = persistedByTileKey(writing, persisted)
        for (const change of batch) {
          const written = byKey.get(change.tileKey)
          const newResource = written
            ? { resourceId: written.resourceId, byteSize: written.byteSize }
            : null
          if (change.oldResource && newResource
            && change.oldResource.resourceId === newResource.resourceId) {
            if (change.oldResource.byteSize !== newResource.byteSize) {
              throw new Error('相同蒙版资源声明了不同字节数')
            }
            continue
          }
          changes.push({ tileKey: change.tileKey, oldResource: change.oldResource, newResource })
        }
        batch = []
      }
      for await (const change of rasterizeImageEditSelectionMaskTilesV3({
        plan,
        loadExistingTile: async (coordinate, existing, signal) => {
          if (!loader) throw new Error('替换选区不应读取旧蒙版瓦片')
          const loaded = await loader(coordinate, signal ?? this.abortController.signal)
          if (loaded.resource?.resourceId !== existing.resource.resourceId
            || loaded.tile.storage !== 'mask-float32') {
            throw new Error(`蒙版瓦片读取结果不匹配：${existing.tileKey}`)
          }
          return loaded.tile
        },
        signal: this.abortController.signal,
      })) {
        batch.push(change)
        if (batch.length >= IMAGE_EDITOR_SELECTION_PERSIST_BATCH_SIZE_V3) await flush()
      }
      await flush()
      this.assertFresh()
      if (changes.length === 0 && (editableMask || !mask)) {
        this.state = 'completed'
        return false
      }
      if (editableMask) this.commitDelta(editableMask, changes)
      else this.commitReplacement(changes)
      this.state = 'completed'
      logger.info('选区转蒙版完成', {
        event: 'image_editor_v3.selection_mask.commit.completed',
        context: { commandId: this.commandId, changedTileCount: changes.length },
      })
      return true
    } catch (error) {
      const cancelled = this.abortController.signal.aborted
        || (error instanceof Error && error.name === 'AbortError')
      this.state = cancelled ? 'cancelled' : 'failed'
      if (this.persistenceAttempted) await this.collectOrphans()
      logger[cancelled ? 'info' : 'error'](
        cancelled ? '选区转蒙版已取消' : '选区转蒙版失败',
        {
          event: cancelled
            ? 'image_editor_v3.selection_mask.commit.cancelled'
            : 'image_editor_v3.selection_mask.commit.failed',
          error: cancelled ? undefined : error,
          context: { commandId: this.commandId, layerId: this.options.layer.id },
        },
      )
      if (cancelled) return false
      throw error
    }
  }

  cancel(): void {
    if (this.state === 'completed' || this.state === 'cancelled') return
    this.state = 'cancelled'
    this.abortController.abort()
  }

  private commitDelta(
    mask: ImageEditSparseMaskReferenceV3,
    changes: readonly PersistedImageEditSelectionMaskTileChangeV3[],
  ): void {
    const command = materializeImageEditSelectionMaskDeltaV3({
      commandId: this.commandId,
      expectedRevision: this.options.document.revision,
      layerId: this.options.layer.id,
      maskId: mask.maskId,
      changes,
    })
    this.options.bus.dispatch(command)
    for (const change of changes) {
      if (change.newResource) {
        this.options.resourceByteSizes.set(change.newResource.resourceId, change.newResource.byteSize)
      }
    }
  }

  private commitReplacement(
    changes: readonly PersistedImageEditSelectionMaskTileChangeV3[],
  ): void {
    const currentMask = this.options.layer.mask
    const nextMask = createImageEditSparseMaskReferenceV3(
      currentMask && isImageEditSparseMaskReferenceV3(currentMask)
        ? currentMask.maskId
        : createImageEditIdV3('mask'),
      currentMask?.inverted ?? false,
      0,
    )
    for (const change of changes) {
      if (change.newResource) nextMask.tiles[change.tileKey] = change.newResource.resourceId
    }
    const nextSizes = new Map(this.options.resourceByteSizes)
    for (const change of changes) {
      if (change.newResource) nextSizes.set(change.newResource.resourceId, change.newResource.byteSize)
    }
    this.options.bus.dispatch({
      type: 'layer.set-mask',
      commandId: this.commandId,
      expectedRevision: this.options.document.revision,
      layerId: this.options.layer.id,
      mask: nextMask,
      maskResources: resourceDescriptors(nextMask, nextSizes),
      previousMaskResources: resourceDescriptors(currentMask, this.options.resourceByteSizes),
    })
    for (const change of changes) {
      if (change.newResource) {
        this.options.resourceByteSizes.set(change.newResource.resourceId, change.newResource.byteSize)
      }
    }
  }

  private assertFresh(): void {
    if (this.abortController.signal.aborted) {
      const error = new Error('选区转蒙版已取消')
      error.name = 'AbortError'
      throw error
    }
    const current = this.options.bus.getSnapshot().document
    if (current.id !== this.options.document.id
      || current.revision !== this.options.document.revision) {
      throw new Error('选区起始文档已变化，请重新选择')
    }
  }

  private async collectOrphans(): Promise<void> {
    const snapshot = this.options.bus.getPersistenceSnapshot()
    const retained = collectImageEditJsonResourceIdsV3(
      snapshot.document,
      snapshot.retainedResources.map((resource) => resource.resourceId),
    )
    try {
      await this.collectGarbage(snapshot.document.id, retained)
    } catch (error) {
      logger.warn('选区临时蒙版资源回收调度失败', {
        event: 'image_editor_v3.selection_mask.gc.failed',
        error,
        context: { commandId: this.commandId },
      })
    }
  }
}
