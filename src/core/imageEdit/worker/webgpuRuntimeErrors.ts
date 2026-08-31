import { ImageEditWebGpuRecoveryCooldownError } from '../webgpu/deviceManager'
import type {
  ImageEditWorkerInitializationFailure,
  ImageEditWorkerInitializationFailureCode,
} from './protocol'

export class WorkerWebGpuInitializationError extends Error {
  constructor(readonly failure: ImageEditWorkerInitializationFailure) {
    super(failure.detail)
    this.name = 'WorkerWebGpuInitializationError'
  }
}

export function describeInitializationFailure(
  error: unknown
): ImageEditWorkerInitializationFailure {
  if (error instanceof WorkerWebGpuInitializationError) return error.failure
  return {
    code: 'webgpu-initialization-unknown',
    detail: sanitizeInitializationDetail(getErrorDetail(error)),
  }
}

export function createInitializationError(
  code: ImageEditWorkerInitializationFailureCode,
  error: unknown
): WorkerWebGpuInitializationError {
  return new WorkerWebGpuInitializationError({
    code,
    detail: sanitizeInitializationDetail(getErrorDetail(error)),
  })
}

export function classifyDeviceAcquisitionFailure(
  error: unknown
): ImageEditWorkerInitializationFailureCode {
  if (error instanceof ImageEditWebGpuRecoveryCooldownError) {
    return 'webgpu-device-recovery-cooldown'
  }
  const detail = getErrorDetail(error)
  if (detail.includes('navigator.gpu')) return 'webgpu-api-unavailable'
  if (detail.includes('GPU adapter')) return 'webgpu-adapter-unavailable'
  return 'webgpu-device-request-failed'
}

export function getErrorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function sanitizeInitializationDetail(value: string): string {
  const withoutPaths = value
    .replace(/[A-Za-z]:[\\/][^\s)\],]+/g, '<path>')
    .replace(/(?:https?|file):\/\/[^\s)\],]+/g, '<url>')
    .replace(/\s+/g, ' ')
    .trim()
  // WGSL 诊断带行列号和源码片段，过短会只留下无定位价值的前缀。
  return (withoutPaths || 'unknown-initialization-error').slice(0, 400)
}
