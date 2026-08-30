import type { RegistrationQuality } from './quality-profiles'
import type { RegistrationFrame, RegistrationResult } from './types'

export const REGISTRATION_WORKER_PROTOCOL_VERSION = 1

export interface RegistrationWorkerRequest {
  type: 'registration.run'
  protocolVersion: typeof REGISTRATION_WORKER_PROTOCOL_VERSION
  requestId: string
  referenceFrame: RegistrationFrame
  movingFrame: RegistrationFrame
  quality: RegistrationQuality
  forceApplyResult: boolean
}

export interface RegistrationWorkerSuccess {
  type: 'registration.result'
  protocolVersion: typeof REGISTRATION_WORKER_PROTOCOL_VERSION
  requestId: string
  ok: true
  result: RegistrationResult
  movingData: Uint8Array
}

export interface RegistrationWorkerFailure {
  type: 'registration.result'
  protocolVersion: typeof REGISTRATION_WORKER_PROTOCOL_VERSION
  requestId: string
  ok: false
  error: {
    name: string
    message: string
  }
  movingData: Uint8Array
}

export type RegistrationWorkerResponse = RegistrationWorkerSuccess | RegistrationWorkerFailure

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteTransform(value: unknown): boolean {
  if (!isRecord(value)) return false
  return ['a', 'b', 'tx', 'ty'].every((key) => typeof value[key] === 'number')
    && (value.c === undefined || typeof value.c === 'number')
    && (value.d === undefined || typeof value.d === 'number')
}

function isRegistrationResult(value: unknown): value is RegistrationResult {
  if (!isRecord(value)) return false
  return typeof value.success === 'boolean'
    && ['identity', 'translation', 'similarity', 'anisotropic'].includes(String(value.model))
    && typeof value.confidence === 'number'
    && isFiniteTransform(value.transform)
    && isRecord(value.diagnostics)
}

export function isRegistrationWorkerRequest(value: unknown): value is RegistrationWorkerRequest {
  if (!isRecord(value)) return false
  const referenceFrame = value.referenceFrame
  const movingFrame = value.movingFrame
  const isFrame = (frame: unknown): frame is RegistrationFrame => isRecord(frame)
    && Number.isInteger(frame.width)
    && Number.isInteger(frame.height)
    && Number.isInteger(frame.components)
    && frame.data instanceof Uint8Array
    && (frame.validMask === undefined || frame.validMask instanceof Uint8Array)

  return value.type === 'registration.run'
    && value.protocolVersion === REGISTRATION_WORKER_PROTOCOL_VERSION
    && typeof value.requestId === 'string'
    && isFrame(referenceFrame)
    && isFrame(movingFrame)
    && ['fast', 'precise', 'extreme'].includes(String(value.quality))
    && typeof value.forceApplyResult === 'boolean'
}

export function isRegistrationWorkerResponse(value: unknown): value is RegistrationWorkerResponse {
  if (!isRecord(value)) return false
  const common = value.type === 'registration.result'
    && value.protocolVersion === REGISTRATION_WORKER_PROTOCOL_VERSION
    && typeof value.requestId === 'string'
    && value.movingData instanceof Uint8Array
  if (!common || typeof value.ok !== 'boolean') return false
  if (value.ok) return isRegistrationResult(value.result)
  return isRecord(value.error)
    && typeof value.error.name === 'string'
    && typeof value.error.message === 'string'
}
