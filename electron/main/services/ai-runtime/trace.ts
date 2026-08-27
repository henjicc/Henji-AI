import type { AiRuntimeTrace, JsonValue } from '@henjicc/ai-sdk'

import { sanitizeJsonValue } from '../logging'

export function buildGenerateTrace(
  modelId: string,
  providerId: string,
  requestId: string,
  route: string,
  method: string,
  requestBody: JsonValue,
  responseBody: JsonValue
): AiRuntimeTrace {
  return {
    modelId,
    providerId,
    requestId,
    phase: 'generate',
    route,
    method: method.toUpperCase(),
    requestBody: sanitizeJsonValue(requestBody),
    responseBody: sanitizeJsonValue(responseBody),
  }
}

export function buildContinuePollingTrace(
  modelId: string,
  providerId: string,
  requestId: string,
  route: string,
  taskId: string,
  responseBody: JsonValue
): AiRuntimeTrace {
  return {
    modelId,
    providerId,
    requestId,
    phase: 'continuePolling',
    route,
    method: 'GET',
    taskId: taskId.trim() || undefined,
    responseBody: sanitizeJsonValue(responseBody),
  }
}
