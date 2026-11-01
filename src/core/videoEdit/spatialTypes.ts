import type { VideoEditComposition, VideoEditClip } from './document'
import type { VideoEditKeyframes } from './keyframeSchema'
import type { EffectQuality } from '../imaging/effects/descriptor'

export interface SpatialClipFields {
  depth?: number; rotationX?: number; rotationY?: number; anchorDepth?: number;
  spatial?: { enabled: boolean };
}

export type SpatialKey = 'depth' | 'rotationX' | 'rotationY' | 'anchorDepth';
export type SpatialVec2 = readonly [number, number];
export type SpatialVec3 = readonly [number, number, number];
export type SpatialMat4 = readonly [
  number, number, number, number, number, number, number, number,
  number, number, number, number, number, number, number, number
];
export interface SpatialRect { x: number; y: number; width: number; height: number }
export interface SpatialBounds { min: SpatialVec3; max: SpatialVec3 }
export type SpatialTarget =
  | { kind: 'clip'; clipId: string }
  | { kind: 'point'; point: SpatialVec3 }
  | { kind: 'bounds'; bounds: SpatialBounds };
export type SpatialFocus = SpatialTarget | { kind: 'distance'; distance: number };
export type SpatialHold<T> = readonly { time: number; value: T; interpolation: 'hold' }[];
export type SpatialCameraNumericKey =
  | 'offsetX' | 'offsetY' | 'offsetZ'
  | 'rotationX' | 'rotationY' | 'rotationZ' | 'perspective'
  | 'framingHeightFraction' | 'defocus' | 'fStop' | 'focusDistance'
  | `${'framing' | 'aim' | 'focus'}${'X' | 'Y' | 'Z'}`
  | `${'framing' | 'aim' | 'focus'}${'Min' | 'Max'}${'X' | 'Y' | 'Z'}`;
export interface SpatialCamera {
  offsetX?: number; offsetY?: number; offsetZ?: number;
  rotationX?: number; rotationY?: number; rotationZ?: number;
  perspective?: number; defocus?: number; fStop?: number;
  framing?: { target: SpatialTarget; heightFraction: number };
  aim?: SpatialTarget;
  focus?: SpatialFocus;
  curves?: Partial<Record<SpatialCameraNumericKey, VideoEditKeyframes>>;
  bindings?: {
    framing?: SpatialHold<SpatialTarget | null>;
    aim?: SpatialHold<SpatialTarget | null>;
    focus?: SpatialHold<SpatialFocus | null>;
  };
}
export interface SpatialOutput {
  width: number; height: number; // 实际栅格像素
  displayWidth: number; displayHeight: number; // 含 PAR 的逻辑画幅
}
export interface SpatialCameraFrame {
  position: SpatialVec3; target: SpatialVec3; up: SpatialVec3;
  focalLengthMm: number; sensorWidthMm: number;
  focusDistance: number; fStop: number; defocus: number;
  near: number; far: number; fovYRadians: number;
  view: SpatialMat4; projectionWebGpu: SpatialMat4; projectionWebGl: SpatialMat4;
  canonicalIdentity: boolean;
  resolvedAim: SpatialVec3; resolvedFocus: SpatialVec3;
  targetActive: boolean;
}
export interface SpatialCardGeometry {
  clipId: string; ordinal: number; compoundGroup?: string;
  uvToWorld: SpatialMat4; clipFromUv: SpatialMat4;
  logicalBounds: SpatialRect;
  effectPadding: readonly [number, number, number, number]; // 左上右下，逻辑像素
  anchorWorld: SpatialVec3; centerWorld: SpatialVec3;
  originalQuad: readonly [SpatialVec3, SpatialVec3, SpatialVec3, SpatialVec3];
  visiblePolygon: readonly SpatialVec3[];
  screenPolygon: readonly SpatialVec2[]; // 归一化显示坐标
  screenBounds: SpatialRect;
  centerViewDepth: number; viewDepthRange: readonly [number, number];
  cocRadiusPx: number; cocRangePx: readonly [number, number];
  behindCamera: boolean; clipped: boolean; ambiguousDepth: boolean;
}
export interface SpatialFact {
  code: 'missing-target' | 'invalid-optics' | 'singular-aim'
    | 'clipped' | 'ambiguous-depth' | 'projection-residual' | 'unknown-scene';
  clipIds: readonly string[];
  sequenceFrame: number;
  message: string;
  values: Readonly<Record<string, number | string | boolean>>;
}
export interface SpatialFrame {
  sequenceFrame: number; sequenceTime: number; output: SpatialOutput;
  camera: SpatialCameraFrame; cards: readonly SpatialCardGeometry[];
  flatIdentity: boolean; facts: readonly SpatialFact[];
}
export interface SpatialSnapshot {
  composition: Readonly<VideoEditComposition>;
  sequenceId: string;
  revision: VideoEditComposition['revision'];
}
export interface SpatialClipEdit {
  clipId: string;
  values: Partial<Pick<VideoEditClip & SpatialClipFields,
    'x' | 'y' | 'scale' | 'scaleAspect' | 'rotation' | 'anchorX' | 'anchorY'
    | 'depth' | 'rotationX' | 'rotationY' | 'anchorDepth' | 'spatial'>>;
  curves?: VideoEditClip['curves'] & Partial<Record<SpatialKey, VideoEditKeyframes>>;
}
export interface SpatialPatch {
  sequenceId: string; expectedRevision: VideoEditComposition['revision'];
  clips: readonly SpatialClipEdit[];
  camera?: { value: SpatialCamera | null };
  achievedParallaxRatio: number;
  maxProjectionErrorPx: number;
  facts: readonly SpatialFact[];
}
export type SpatialLayoutIntent =
  | { kind: 'arrange'; clipIds: readonly string[]; referenceFrame: number;
      parallaxRatio: number; focusClipId: string; range?: readonly [number, number] }
  | { kind: 'expand'; clipIds: readonly string[]; range: readonly [number, number];
      parallaxRatio: number; focusClipId: string; perspective: number }
  | { kind: 'flatten'; clipIds: readonly string[]; range: readonly [number, number];
      focusClipId: string };
export interface SpatialInspection {
  frame: SpatialFrame;
  cards: readonly {
    clipId: string; drawOrder: number; visibleFraction: number | null;
    occludedBy: readonly string[];
    visibility: 'proven-visible' | 'proven-occluded' | 'estimated' | 'unknown';
    approximation: 'layer-center';
    sceneBoundsSource: 'render-observation' | 'none';
  }[];
}
export interface SpatialPropagationRequest {
  before: SpatialSnapshot;
  proposed: VideoEditComposition;
  operation: 'fields' | 'trim' | 'split' | 'retime' | 'move' | 'ripple'
    | 'frame-rate' | 'resize' | 'reframe' | 'copy' | 'paste' | 'nest'
    | 'unnest' | 'delete' | 'template';
  clipMap: readonly {
    fromSequenceId: string; fromClipId: string;
    sourceRange: readonly [number, number];
    toSequenceId: string; toClipId: string | null;
  }[];
  sequenceTimeMap: readonly {
    sequenceId: string;
    sourceRange: readonly [number, number];
    targetRange: readonly [number, number] | null;
  }[];
  output: SpatialOutput; quality: EffectQuality; signal: AbortSignal;
}
export type EvaluateSpatialFrame = (
  composition: Readonly<VideoEditComposition>, sequenceFrame: number,
  output: SpatialOutput, quality: EffectQuality
) => SpatialFrame;
export type PlanSpatialLayout = (
  snapshot: SpatialSnapshot, intent: SpatialLayoutIntent, output: SpatialOutput, signal: AbortSignal
) => Promise<SpatialPatch>;
export type InspectSpatialFrame = (snapshot: SpatialSnapshot, frame: SpatialFrame) => SpatialInspection;
export type ApplySpatialPatch = (snapshot: SpatialSnapshot, patch: SpatialPatch) => VideoEditComposition;
export type PlanSpatialPropagation = (
  request: SpatialPropagationRequest
) => Promise<{ composition: VideoEditComposition; facts: readonly SpatialFact[] }>;
