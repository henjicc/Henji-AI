import type { Float32MaskTile, Float32PremultipliedRgbaTile } from '../effects/contracts'
import type { ImageEditRenderPlan } from '../renderPlan'
import type { ImageEditRect, ImageEditSize } from '../tileGeometry'
import type { ImageEditCpuSamplingGridV3 } from './cpuSamplingGrid'
import type { ImageEditCpuOutputDescriptionV3, ImageEditCpuOutputTileV3 } from './cpuOutputTile'
import type { ImageEditOutputGeometryV3 } from '../outputGeometry'
import type { CubeLut } from '../../../imaging/lut/cube'

export interface CpuRegionWorkerOutputV3 {
  rect: ImageEditRect
  geometry: ImageEditOutputGeometryV3
  description: ImageEditCpuOutputDescriptionV3
}
export type CpuRegionWorkerCallbackV3 =
  | { kind: 'raster'; nodeId: string; region: ImageEditRect }
  | { kind: 'annotation'; nodeId: string; region: ImageEditRect }
  | { kind: 'mask'; nodeId: string; region: ImageEditRect }
  | { kind: 'lut'; ref: string }
  | { kind: 'effect'; nodeId: string; region: ImageEditRect; source: Float32PremultipliedRgbaTile; mask?: Float32MaskTile }
export type CpuRegionWorkerValueV3 = Float32PremultipliedRgbaTile | Float32MaskTile | CubeLut
export type CpuRegionWorkerRequestV3 =
  | { type: 'render'; jobId: number; plan: ImageEditRenderPlan; region: ImageEditRect;
      size: ImageEditSize; scaleX?: number; scaleY?: number;
      grids: ReadonlyArray<readonly [string, ImageEditCpuSamplingGridV3]>;
      color: Pick<Float32PremultipliedRgbaTile, 'workingSpace' | 'transferFunction' | 'referenceWhiteNits'>;
      customEffects: boolean; output: CpuRegionWorkerOutputV3 }
  | { type: 'reply'; jobId: number; callbackId: number; value?: CpuRegionWorkerValueV3; error?: string }
export type CpuRegionWorkerEventV3 =
  | { type: 'callback'; jobId: number; callbackId: number; request: CpuRegionWorkerCallbackV3 }
  | { type: 'completed'; jobId: number; tile: ImageEditCpuOutputTileV3; stages: Readonly<Record<string, number>> }
  | { type: 'failed'; jobId: number; message: string }

export interface CpuRegionWorkerPortV3 {
  postMessage(message: CpuRegionWorkerRequestV3): void
  subscribe(receive: (event: CpuRegionWorkerEventV3) => void, fail: (error: Error) => void): void
  terminate(): void
}
