import { registerLocalRedrawFrames } from './register'
import {
  REGISTRATION_WORKER_PROTOCOL_VERSION,
  type RegistrationWorkerRequest,
  type RegistrationWorkerResponse,
} from './worker-contracts'

function describeError(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: 'Error', message: String(error) }
}

export function executeRegistrationWorkerTask(
  request: RegistrationWorkerRequest,
): RegistrationWorkerResponse {
  try {
    return {
      type: 'registration.result',
      protocolVersion: REGISTRATION_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: registerLocalRedrawFrames(
        request.referenceFrame,
        request.movingFrame,
        request.quality,
        request.forceApplyResult,
      ),
      movingData: request.movingFrame.data,
    }
  } catch (error) {
    return {
      type: 'registration.result',
      protocolVersion: REGISTRATION_WORKER_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: false,
      error: describeError(error),
      movingData: request.movingFrame.data,
    }
  }
}
