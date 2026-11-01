import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { GpuTexture as GPUTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import type { SpatialBounds, SpatialCardGeometry, SpatialFrame, SpatialMat4, SpatialOutput, SpatialRect, SpatialVec2 } from '@/core/videoEdit/spatialTypes'
import type { VideoEditGpuColorFormat } from './videoEditGpuFrame'

// 宿主以结构类型借用原生纹理，避免 WebGPU 全局声明改变既有 Canvas 重载。
type GPUTextureUsageFlags = number

export type SpatialContentKind = 'card' | 'worldScene';
export interface SpatialSourceDescriptor {
  clipId: string; kind: SpatialContentKind; spaceDependency: boolean;
}
export interface SpatialSample {
  index: number; sequenceFrame: number; weight: number;
  frame: SpatialFrame;
  clips: readonly {
    clipId: string; sequenceFrame: number; sourceTime: number;
    centerSourceTime: number; motionBlur: boolean;
  }[];
}
export interface SpatialTargetSpec {
  key: string; width: number; height: number;
  format: VideoEditGpuColorFormat; usage: GPUTextureUsageFlags;
}
export interface SpatialMaterialPlan {
  clipId: string; kind: SpatialContentKind;
  contentTime: 'center' | 'sample';
  centerFrame: number; centerSourceTime: number;
  referenceSize: { width: number; height: number };
  logicalBounds: SpatialRect;
  uvToReference: SpatialMat4;
  rasterScale: SpatialVec2; // 每逻辑像素的材料面纹素数
  supportBoundsPx: SpatialRect; // 材料面纹理内、含发光的支持域
  defocus: {
    centerCocRadiusPx: number; materialRadiusPx: SpatialVec2;
    workBoundsPx: SpatialRect; downsample: number; bypass: boolean;
    stage: 'center-material' | 'after-layer-accumulation' | 'per-scene-sample';
  };
  target: SpatialTargetSpec;
  highPrecision: boolean; carriesLight: boolean;
}
export interface SpatialFrameRequest {
  composition: Readonly<VideoEditComposition>; sequenceFrame: number;
  output: SpatialOutput; quality: EffectQuality;
  sessionKind: 'preview' | 'prerender' | 'export' | 'observe';
  sources: readonly SpatialSourceDescriptor[];
  requestId: string; signal: AbortSignal; assertCurrent(): void;
}
export interface SpatialGroupPlan {
  id: string; mode: 'single' | 'transform' | 'group';
  clipIds: readonly string[]; itemIds: readonly string[];
  orderBySample: readonly (readonly string[])[];
}
export interface SpatialExposurePlan {
  centerFrame: SpatialFrame; samples: readonly SpatialSample[];
  shotRange: readonly [number, number];
  groups: readonly SpatialGroupPlan[];
  materials: readonly SpatialMaterialPlan[];
  workingSetBytes: number;
  /** 推近升档被工作集预算压低的材料：wantedTier 是按投影密度请求的档位，tier 是实际档位。 */
  rasterLimits?: readonly { clipId: string; wantedTier: number; tier: number }[];
}
export const preparedSpatialBrand: unique symbol = Symbol('preparedSpatialFrame');
export interface PreparedSpatialFrame {
  readonly [preparedSpatialBrand]: true;
}
export interface SpatialPrepareRequest {
  frame: SpatialFrameRequest; plan: SpatialExposurePlan;
}
export interface SpatialSceneSample {
  clipId: string; sampleIndex: number; sequenceFrame: number;
  worldBounds: SpatialBounds | null; // null 是空场景
}
export interface SpatialSampleRequest {
  prepared: PreparedSpatialFrame;
  clipId: string; sampleIndex: number; sequenceFrame: number;
  sourceTime: number; centerSourceTime: number;
  spatialFrame: SpatialFrame;
  target: SpatialTargetSpec;
  materialPlan: SpatialMaterialPlan;
}
export interface SpatialPictureLease {
  readonly texture: GPUTexture;
  readonly owner: 'code-sources' | 'composite-host';
  readonly width: number; readonly height: number;
  readonly format: VideoEditGpuColorFormat;
  readonly highPrecision: boolean; readonly carriesLight: boolean;
  readonly completion: Promise<void>;
  readonly worldBounds?: SpatialBounds | null;
  release(afterUse: Promise<void>): Promise<void>;
}
export interface SpatialCodeSources {
  describeSpatialSources(
    composition: Readonly<VideoEditComposition>, signal: AbortSignal
  ): Promise<readonly SpatialSourceDescriptor[]>;
  prepareSpatialFrame(request: SpatialPrepareRequest): Promise<PreparedSpatialFrame>;
  inspectSpatialSceneSamples(
    prepared: PreparedSpatialFrame
  ): Promise<readonly SpatialSceneSample[]>;
  renderSpatialSample(request: SpatialSampleRequest): Promise<SpatialPictureLease>;
  generatorTargetCapacity(width: number, height: number, format: VideoEditGpuColorFormat): number;
  releaseSpatialFrame(prepared: PreparedSpatialFrame): Promise<void>;
}
export interface SpatialDrawItem {
  itemId: string; sourceKey: string; clipId: string;
  kind: SpatialContentKind | 'transition';
  picture: SpatialPictureLease; geometry: SpatialCardGeometry;
  opacity: number; groupId: string; ordinal: number;
  projection: 'material' | 'screen';
}
export const spatialAccumulatorBrand: unique symbol = Symbol('spatialAccumulator');
export interface SpatialAccumulator {
  readonly [spatialAccumulatorBrand]: true;
}
export interface SpatialSubmission { readonly completion: Promise<void> }
export interface SpatialCompositeHost {
  generatorTargetCapacity(width: number, height: number, format: VideoEditGpuColorFormat): number;
  reserveWorkingSet(plan: SpatialExposurePlan, signal: AbortSignal): Promise<void>;
  prepareCardMaterial(
    request: SpatialFrameRequest, materialPlan: SpatialMaterialPlan
  ): Promise<SpatialPictureLease>;
  consumePicture(
    picture: SpatialPictureLease, target: SpatialTargetSpec
  ): Promise<SpatialPictureLease>;
  applyCenterDefocus(
    picture: SpatialPictureLease, materialPlan: SpatialMaterialPlan,
    sampleSupportBoundsPx: SpatialRect
  ): Promise<SpatialPictureLease>;
  beginAccumulation(target: SpatialTargetSpec): Promise<SpatialAccumulator>;
  accumulateLayerSample(
    accumulator: SpatialAccumulator, item: SpatialDrawItem, weight: number
  ): Promise<SpatialSubmission>;
  finishLayer(accumulator: SpatialAccumulator): Promise<SpatialPictureLease>;
  compositeGroup(
    group: SpatialGroupPlan, sample: SpatialSample,
    orderedItems: readonly SpatialDrawItem[]
  ): Promise<SpatialPictureLease>;
  accumulate(
    accumulator: SpatialAccumulator, groupPicture: SpatialPictureLease, weight: number
  ): Promise<SpatialSubmission>;
  finish(accumulator: SpatialAccumulator): Promise<SpatialPictureLease>;
  compositeFrame(
    request: SpatialFrameRequest,
    groups: readonly { groupId: string; picture: SpatialPictureLease }[]
  ): Promise<SpatialPictureLease>;
  releaseAccumulation(accumulator: SpatialAccumulator): Promise<void>;
  releaseWorkingSet(): Promise<void>;
}
export type SpatialExposurePicture = SpatialPictureLease;
export type PlanSpatialExposure = (request: SpatialFrameRequest, sceneSamples?: readonly SpatialSceneSample[]) => SpatialExposurePlan;
export type RenderSpatialExposure = (
  request: SpatialFrameRequest, plan: SpatialExposurePlan, sources: SpatialCodeSources, host: SpatialCompositeHost
) => Promise<SpatialExposurePicture>;
