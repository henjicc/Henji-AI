export class AiRuntimeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'AiRuntimeError'
    this.code = code
  }
}

export function cancelledError(requestId: string): AiRuntimeError {
  return new AiRuntimeError('cancelled', `Task cancelled: ${requestId}`)
}
