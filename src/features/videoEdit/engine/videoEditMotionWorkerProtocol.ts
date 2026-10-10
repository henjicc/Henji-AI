import type { OptimizeMotionInput, MotionCandidate, MotionCandidateResult } from '@/core/creativeIntent/candidates'
import type { MotionSample } from '@/core/creativeIntent/contracts'
export type MotionWorkerRequest = { kind: 'begin'; input: OptimizeMotionInput } | { kind: 'page'; entries: MotionSample[] } | { kind: 'compile' }
export type MotionWorkerResponse = { kind: 'received' } | { result: MotionCandidateResult; original?: MotionCandidate } | { error: string; code?: string; refs: readonly string[] }
