import {
  cancelRuntimeTask,
  getEstimate,
  getProviderKeyStatus,
  parseJsonObject,
  recordSample,
} from '../services/ai-runtime/runtime'
import { consumePendingResult } from '../services/ai-runtime/pending-results'
import type { PendingResultPayload } from '../services/ai-runtime/pending-results'
import {
  testProviderConnection,
  type AiContinuePollingRequestDto,
  type AiGenerateRequestDto,
  type AiGenerateResponseDto,
  type AiGetProgressEstimateRequestDto,
  type AiProgressEstimateDto,
  type AiRecordProgressSampleRequestDto,
  type AiRecordProgressSampleResponseDto,
  type ProviderKeyStatusDto,
  type ProviderConnectionTestResultDto,
} from '@henjicc/ai-sdk'
import { sdkRuntimeContext } from '../services/ai-runtime/sdk-runtime'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'
import { executeGenerationOperation, continueGenerationOperation } from '../services/assistant/generation-operation'

type CorrelatedPollingRequest = AiContinuePollingRequestDto & { operationId?: string }

type CorrelatedGenerateRequest = AiGenerateRequestDto & { operationId?: string }

function parseGenerateRequest(input: unknown): CorrelatedGenerateRequest {
  const record = parseRecord(input)
  return {
    modelId: readString(record, 'modelId'),
    params: parseJsonObject(record.params ?? {}, 'params'),
    requestId: readOptionalString(record, 'requestId'),
    operationId: readOptionalString(record, 'operationId'),
  }
}

function parseContinuePollingRequest(input: unknown): CorrelatedPollingRequest {
  const record = parseRecord(input)
  return {
    modelId: readString(record, 'modelId'),
    taskId: readString(record, 'taskId'),
    operationId: readOptionalString(record, 'operationId'),
    params: record.params === undefined ? undefined : parseJsonObject(record.params, 'params'),
    requestId: readOptionalString(record, 'requestId'),
  }
}

function parseEstimateRequest(input: unknown): AiGetProgressEstimateRequestDto {
  const record = parseRecord(input)
  return {
    modelId: readString(record, 'modelId'),
    params: record.params === undefined ? undefined : parseJsonObject(record.params, 'params'),
  }
}

function parseRecordSampleRequest(input: unknown): AiRecordProgressSampleRequestDto {
  const record = parseRecord(input)
  const source = record.source
  if (source !== 'generation' && source !== 'canvas') {
    throw new Error('source must be generation or canvas')
  }
  return {
    modelId: readString(record, 'modelId'),
    params: record.params === undefined ? undefined : parseJsonObject(record.params, 'params'),
    startedAtMs: readNumber(record, 'startedAtMs'),
    finishedAtMs: readNumber(record, 'finishedAtMs'),
    source,
  }
}

export function registerAiRuntimeIpc(): void {
  registerIpcHandler<string, ProviderConnectionTestResultDto>(
    'ai:testProviderConnection',
    (input) => parseStringField(input, 'providerId'),
    (providerId) => testProviderConnection(providerId, sdkRuntimeContext)
  )

  registerIpcHandler<CorrelatedGenerateRequest, AiGenerateResponseDto>('ai:generate', parseGenerateRequest, async ({ operationId, ...request }, event) => {
    return await executeGenerationOperation(request, operationId, event.sender.id)
  })

  registerIpcHandler<CorrelatedPollingRequest, AiGenerateResponseDto>('ai:continuePolling', parseContinuePollingRequest, async ({ operationId, ...request }, event) => {
    return await continueGenerationOperation(request, operationId, event.sender.id)
  })

  registerIpcHandler<string, void>('ai:cancelTask', (input) => parseStringField(input, 'taskId'), (taskId) => {
    cancelRuntimeTask(taskId)
  })

  registerIpcHandler<AiGetProgressEstimateRequestDto, AiProgressEstimateDto>('ai:getProgressEstimate', parseEstimateRequest, (request) => {
    return getEstimate(request)
  })

  registerIpcHandler<AiRecordProgressSampleRequestDto, AiRecordProgressSampleResponseDto>('ai:recordProgressSample', parseRecordSampleRequest, (request) => {
    return recordSample(request)
  })

  registerIpcHandler<void, ProviderKeyStatusDto[]>('ai:getRuntimeProviderKeyStatus', parseVoid, () => {
    return getProviderKeyStatus()
  })

  registerIpcHandler<string, PendingResultPayload | null>(
    'ai:consumePendingResult',
    (input) => parseStringField(input, 'serverTaskId'),
    (serverTaskId) => consumePendingResult(serverTaskId)
  )
}

function readString(record: Record<string, unknown>, field: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field "${field}"`)
  }
  return value
}

function readOptionalString(record: Record<string, unknown>, field: string): string | undefined {
  const value = record[field]
  if (value === undefined) {
    return undefined
  }
  if (typeof value !== 'string') {
    throw new Error(`Expected string field "${field}"`)
  }
  return value
}

function readNumber(record: Record<string, unknown>, field: string): number {
  const value = record[field]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Expected finite number field "${field}"`)
  }
  return value
}
