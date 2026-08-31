import type {
  ImageEditBrushTileChangeV3,
  PersistedImageEditBrushTileV3,
} from '@/core/imageEdit/v3/brush/contracts'

const DEFAULT_MAX_ENTRY_COUNT = 64
const DEFAULT_MAX_BYTE_SIZE = 64 * 1024 * 1024

interface CommittedRasterOverlayEntryV3 {
  byteSize: number
  change: ImageEditBrushTileChangeV3
  documentId: string
  layerId: string
  resourceId: string
  revision: number
}

function entryKey(documentId: string, layerId: string, tileKey: string): string {
  return `${documentId}\u0000${layerId}\u0000${tileKey}`
}

/**
 * 只保留基础预览尚未接管的已提交瓦片。缓存按图层 tileKey 去重，并同时受
 * 条目数和字节数约束；内容寻址 resourceId 只用于核对文档引用，不能充当坐标键。
 */
export class RasterBrushCommittedOverlayCacheV3 {
  private readonly entries = new Map<string, CommittedRasterOverlayEntryV3>()
  private byteSize = 0

  constructor(
    private readonly maxEntryCount = DEFAULT_MAX_ENTRY_COUNT,
    private readonly maxByteSize = DEFAULT_MAX_BYTE_SIZE,
  ) {}

  get size(): number {
    return this.entries.size
  }

  get retainedByteSize(): number {
    return this.byteSize
  }

  commit(input: {
    documentId: string
    layerId: string
    revision: number
    changes: readonly ImageEditBrushTileChangeV3[]
    persisted: readonly PersistedImageEditBrushTileV3[]
  }): void {
    const changesByKey = new Map(input.changes.map((change) => [change.tileKey, change]))
    for (const resource of input.persisted) {
      const change = changesByKey.get(resource.tileKey)
      if (!change) continue
      const key = entryKey(input.documentId, input.layerId, resource.tileKey)
      const previous = this.entries.get(key)
      if (previous) {
        this.entries.delete(key)
        this.byteSize -= previous.byteSize
      }
      const byteSize = change.tile.data.byteLength
      this.entries.set(key, {
        byteSize,
        change,
        documentId: input.documentId,
        layerId: input.layerId,
        resourceId: resource.resourceId,
        revision: input.revision,
      })
      this.byteSize += byteSize
    }
    this.trim()
  }

  discardOtherDocuments(documentId: string): void {
    this.deleteWhere((entry) => entry.documentId !== documentId)
  }

  releaseThrough(documentId: string, revision: number): void {
    this.deleteWhere((entry) => entry.documentId === documentId && entry.revision <= revision)
  }

  tilesForLayer(input: {
    documentId: string
    layerId: string
    tileResources?: Readonly<Record<string, string>>
  }): ReadonlyMap<string, ImageEditBrushTileChangeV3> {
    const tiles = new Map<string, ImageEditBrushTileChangeV3>()
    for (const [key, entry] of this.entries) {
      if (entry.documentId !== input.documentId || entry.layerId !== input.layerId) continue
      if (input.tileResources && input.tileResources[entry.change.tileKey] !== entry.resourceId) {
        this.delete(key, entry)
        continue
      }
      tiles.set(entry.change.tileKey, entry.change)
    }
    return tiles
  }

  clear(): void {
    this.entries.clear()
    this.byteSize = 0
  }

  private trim(): void {
    while (
      this.entries.size > this.maxEntryCount
      || this.byteSize > this.maxByteSize
    ) {
      const oldest = this.entries.entries().next().value as
        | [string, CommittedRasterOverlayEntryV3]
        | undefined
      if (!oldest) return
      this.delete(oldest[0], oldest[1])
    }
  }

  private deleteWhere(predicate: (entry: CommittedRasterOverlayEntryV3) => boolean): void {
    for (const [key, entry] of this.entries) {
      if (predicate(entry)) this.delete(key, entry)
    }
  }

  private delete(key: string, entry: CommittedRasterOverlayEntryV3): void {
    this.entries.delete(key)
    this.byteSize -= entry.byteSize
  }
}
