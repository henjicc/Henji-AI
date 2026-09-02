import type {
  ImageEditorV3PyramidDescriptor,
  ImageEditorV3ResourceRef,
  ImageEditorV3SourceTile,
} from '@/platform/contracts/imageEditorV3'
import type {
  ImageEditorViewportTileCacheOptionsV3,
  ImageEditorViewportTileLeaseV3,
  ImageEditorViewportTileReadReservationV3,
  ImageEditorViewportTileCacheV3,
} from './viewportTileCacheV3'
import type {
  ImageEditorViewportTileRequestV3,
} from './viewportTilePlannerV3'
import type {
  ImageEditorViewportFrameV3,
  ImageEditorViewportRenderRequestV3,
} from './viewportTileSchedulerV3'

export type ImageEditorViewportPyramidReaderV3 = (
  request: { requestId: string; resourceRef: ImageEditorV3ResourceRef },
  signal?: AbortSignal,
) => Promise<ImageEditorV3PyramidDescriptor>

export type ImageEditorViewportSourceTileReaderV3 = (
  request: {
    requestId: string
    resourceRef: ImageEditorV3ResourceRef
    mip: number
    tileX: number
    tileY: number
    halo: number
    bitDepth: 8 | 16 | 32
  },
  signal?: AbortSignal,
) => Promise<ImageEditorV3SourceTile>

export type ImageEditorViewportSourceTileBatchReaderV3 = (
  request: {
    requestId: string
    tiles: Array<{
      resourceRef: ImageEditorV3ResourceRef
      mip: number
      tileX: number
      tileY: number
      halo: number
      bitDepth: 8 | 16 | 32
      priority: number
    }>
    onTile?(progress: { index: number; tile: ImageEditorV3SourceTile }): void
  },
  signal?: AbortSignal,
) => Promise<{ tiles: ImageEditorV3SourceTile[] }>

export interface ImageEditorViewportTileSchedulerOptionsV3 {
  sessionId: string
  describePyramid?: ImageEditorViewportPyramidReaderV3
  readSourceTile?: ImageEditorViewportSourceTileReaderV3
  readSourceTiles?: ImageEditorViewportSourceTileBatchReaderV3
  cache?: ImageEditorViewportTileCacheV3
  cacheOptions?: ImageEditorViewportTileCacheOptionsV3
  /** 多调度通道共享 cache 时由外层统一释放；默认仍由当前调度器拥有。 */
  disposeCache?: boolean
  /** 每个 session 最多并行解码数；全进程仍受 8 路共享闸门约束。 */
  decodeConcurrency?: number
}

export interface ScheduledViewportJobV3 {
  request: ImageEditorViewportRenderRequestV3
  sequence: number
  controller: AbortController
  resolve: (frame: ImageEditorViewportFrameV3) => void
  reject: (error: Error) => void
  tileLeases: Map<string, ImageEditorViewportTileLeaseV3>
  readReservations: Map<string, ImageEditorViewportTileReadReservationV3>
  preparedFrame: ImageEditorViewportFrameV3 | null
}

export type ImageEditorViewportTileRequestListV3 = readonly ImageEditorViewportTileRequestV3[]
