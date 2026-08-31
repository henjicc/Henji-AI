import {
  createImageEditorV3RequestId,
  persistImageEditorV3BrushTiles,
} from '@/commands/imageEditorV3'
import { ImageEditBrushStrokeSessionV3 } from '@/core/imageEdit/v3/brush/strokeSession'
import { materializeImageEditBrushTileDeltaV3 } from '@/core/imageEdit/v3/brush/tileDelta'
import type {
  ImageEditBrushPointV3,
  ImageEditBrushShapeV3,
  ImageEditBrushStrokeResultV3,
  ImageEditBrushTargetV3,
  ImageEditBrushTileChangeV3,
  ImageEditBrushTileLoaderV3,
  ImageEditBrushToolV3,
  PersistedImageEditBrushTileV3,
} from '@/core/imageEdit/v3/brush/contracts'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createLogger } from '@/core/logging'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'

const logger = createLogger('features.image_edit_v3.raster_brush')

export interface ImageEditorRasterBrushStrokeOptionsV3 {
  bus: ImageEditCommandBusV3
  document: ImageEditDocumentV3
  layerId: string
  tool: ImageEditBrushToolV3
  shape: ImageEditBrushShapeV3
  target: ImageEditBrushTargetV3
  loadTile: ImageEditBrushTileLoaderV3
  resourceByteSizes: Map<string, number>
  onPreviewTiles: (changes: readonly ImageEditBrushTileChangeV3[]) => void
  onCommittedTiles?: (
    changes: readonly ImageEditBrushTileChangeV3[],
    persisted: readonly PersistedImageEditBrushTileV3[],
  ) => void
  persistTiles?: (
    tiles: ReadonlyArray<{ tileKey: string; tile: ImageEditBrushTileChangeV3['tile'] }>,
    signal: AbortSignal,
  ) => Promise<readonly PersistedImageEditBrushTileV3[]>
}

type RasterBrushStrokeStateV3 = 'idle' | 'active' | 'finishing' | 'completed' | 'cancelled' | 'failed'

async function defaultPersistTiles(
  tiles: ReadonlyArray<{ tileKey: string; tile: ImageEditBrushTileChangeV3['tile'] }>,
  signal: AbortSignal,
): Promise<readonly PersistedImageEditBrushTileV3[]> {
  const result = await persistImageEditorV3BrushTiles({
    requestId: createImageEditorV3RequestId('brush-tiles-persist'),
    tiles,
  }, signal)
  return result.tiles
}

/** 一个 pointer 手势对应一个 session、一个 PreviewOverride 和一个历史命令。 */
export class ImageEditorRasterBrushStrokeV3 {
  private readonly session: ImageEditBrushStrokeSessionV3
  private readonly previewId = createImageEditIdV3('brush-preview')
  private readonly commandId = createImageEditIdV3('brush-stroke')
  private readonly abortController = new AbortController()
  private readonly persistTiles: NonNullable<ImageEditorRasterBrushStrokeOptionsV3['persistTiles']>
  private state: RasterBrushStrokeStateV3 = 'idle'
  private baseRevision: number | null = null

  constructor(private readonly options: ImageEditorRasterBrushStrokeOptionsV3) {
    this.persistTiles = options.persistTiles ?? defaultPersistTiles
    this.session = new ImageEditBrushStrokeSessionV3({
      canvas: {
        width: options.document.geometry.width,
        height: options.document.geometry.height,
      },
      tool: options.tool,
      shape: options.shape,
      target: options.target,
      loadTile: options.loadTile,
      minScreenDistance: 0.75,
      simplifyScreenTolerance: 0.75,
      simplifyPressureTolerance: 0.02,
    })
  }

  begin(): void {
    if (this.state !== 'idle') throw new Error(`当前栅格笔画不能开始：${this.state}`)
    const currentDocument = this.options.bus.getSnapshot().document
    if (
      currentDocument.id !== this.options.document.id
      || currentDocument.revision !== this.options.document.revision
    ) {
      throw new Error('栅格笔画起始文档已变化，请重新落笔')
    }
    const baseRevision = currentDocument.revision
    this.baseRevision = baseRevision
    this.options.bus.setPreview({
      id: this.previewId,
      kind: 'brush',
      targetId: this.options.layerId,
      baseRevision,
      value: { dirtyTileKeys: [] },
    })
    this.state = 'active'
    logger.info('栅格笔画手势开始', {
      event: 'image_editor_v3.raster_brush.stroke.start',
      context: {
        commandId: this.commandId,
        documentId: this.options.document.id,
        layerId: this.options.layerId,
        tool: this.options.tool,
      },
    })
  }

  async append(points: readonly ImageEditBrushPointV3[]): Promise<void> {
    this.assertState('active')
    if (points.length === 0) return
    this.session.appendCoalescedPoints(points)
    const dirty = await this.session.renderPending()
    if (this.state !== 'active') return
    if (dirty.length > 0) this.options.onPreviewTiles(dirty)
  }

  async finish(): Promise<ImageEditBrushStrokeResultV3 | null> {
    this.assertState('active')
    this.state = 'finishing'
    try {
      const stroke = await this.session.finish()
      if (this.isCancelled()) return null
      if (!stroke) {
        this.options.bus.clearPreview(this.previewId)
        this.state = 'completed'
        return null
      }
      this.options.onPreviewTiles(stroke.changes)
      const persisted = await this.persistTiles(
        stroke.changes.map(({ tileKey, tile }) => ({ tileKey, tile })),
        this.abortController.signal,
      )
      if (this.isCancelled()) return null
      if (this.baseRevision === null) throw new Error('栅格笔画缺少起始 revision')
      const delta = materializeImageEditBrushTileDeltaV3(stroke, {
        commandId: this.commandId,
        expectedRevision: this.baseRevision,
        layerId: this.options.layerId,
        persistedTiles: persisted,
      })
      for (const resource of delta.history.newResources) {
        this.options.resourceByteSizes.set(resource.resourceId, resource.byteSize)
      }
      this.options.bus.commitPreview(this.previewId, delta.command)
      this.options.onCommittedTiles?.(stroke.changes, persisted)
      this.state = 'completed'
      logger.info('栅格笔画手势完成', {
        event: 'image_editor_v3.raster_brush.stroke.completed',
        context: {
          commandId: this.commandId,
          layerId: this.options.layerId,
          inputPointCount: stroke.metrics.inputPointCount,
          changedTileCount: stroke.metrics.changedTileCount,
        },
      })
      return stroke
    } catch (error) {
      if (this.isCancelled()) return null
      this.state = 'failed'
      this.options.bus.clearPreview(this.previewId)
      logger.error('栅格笔画手势失败', {
        event: 'image_editor_v3.raster_brush.stroke.failed',
        error,
        context: { commandId: this.commandId, layerId: this.options.layerId },
      })
      throw error
    }
  }

  cancel(): void {
    if (this.state === 'completed' || this.state === 'cancelled') return
    this.state = 'cancelled'
    this.abortController.abort()
    this.session.cancel()
    this.options.bus.clearPreview(this.previewId)
  }

  private isCancelled(): boolean {
    return this.state === 'cancelled'
  }

  private assertState(expected: RasterBrushStrokeStateV3): void {
    if (this.state !== expected) throw new Error(`当前栅格笔画状态无效：${this.state}`)
  }
}
