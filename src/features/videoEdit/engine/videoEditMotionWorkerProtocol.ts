import type { SpatialFrame, SpatialOutput, SpatialPropagationRequest, PlanSpatialPropagation, SpatialSnapshot, SpatialLayoutIntent, SpatialPatch } from '@/core/videoEdit/spatialTypes'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import type { OptimizeMotionInput, MotionCandidate, MotionCandidateResult } from '@/core/creativeIntent/candidates'
import type { MotionSample } from '@/core/creativeIntent/contracts'
export type MotionWorkerRequest = { kind: 'begin'; input: OptimizeMotionInput } | { kind: 'page'; entries: MotionSample[] } | { kind: 'compile' }
  | { kind: 'spatial-evaluate'; composition: VideoEditComposition; frame: number; output: SpatialOutput; quality: EffectQuality }
  | { kind: 'spatial-propagate'; request: Omit<SpatialPropagationRequest, 'signal'> }
  | { kind: 'spatial-layout'; snapshot: SpatialSnapshot; intent: SpatialLayoutIntent; output: SpatialOutput }
export type MotionOptimizationResponse = { kind: 'received' } | { result: MotionCandidateResult; original?: MotionCandidate } | { error: string; code?: string; refs: readonly string[] }

export type SpatialWorkerResponse = { kind: 'spatial-frame'; frame: SpatialFrame } | { kind: 'spatial-propagation'; result: Awaited<ReturnType<PlanSpatialPropagation>> } | { kind: 'spatial-layout'; patch: SpatialPatch } | { error: string; code?: string; refs: readonly string[]; facts?: SpatialFrame['facts'] }
export type MotionWorkerResponse = MotionOptimizationResponse | SpatialWorkerResponse
