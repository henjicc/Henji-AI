import type { HostErrorCode } from '@/core/application-control/hostContracts'

export class CanvasApplicationError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
    readonly recoverable = true,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'CanvasApplicationError'
  }
}

