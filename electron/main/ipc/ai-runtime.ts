import {
  cancelRuntimeTask,
  continuePolling,
  generate,
  getEstimate,
  getProviderKeyStatus,
  parseJsonObject,
  recordSample,
  reloadModelManifest,
} from '../services/ai-runtime/runtime'
import { consumePendingResult } from '../services/ai-runtime/pending-results'
import type { PendingResultPayload } from '../services/ai-runtime/pending-results'
import type {
  AiContinuePollingRequestDto,
  AiGenerateRequestDto,
  AiGenerateResponseDto,
  AiGetProgressEstimateRequestDto,
  AiProgressEstimateDto,
  AiRecordProgressSampleRequestDto,
  AiRecordProgressSampleResponseDto,
  ProviderKeyStatusDto,
} from '../services/ai-runtime/types'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'

function parseGenerateRequest(input: unknown): AiGenerateRequestDto {
  const record = parseRecord(input)
  return {
    modelId: readString(record, 'modelId'),
    params: parseJsonObject(record.params ?? {}, 'params'),
    requestId: readOptionalString(record, 'requestId'),
  }
}

function parseContinuePollingRequest(input: unknown): AiContinuePollingRequestDto {
  const record = parseRecord(input)
  return {
    modelId: readString(record, 'modelId'),
    taskId: readString(record, 'taskId'),
    params: record.params === undefined ? undefined : parseJsonObject(record.params, 'params'),
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
  registerIpcHandler<AiGenerateRequestDto, AiGenerateResponseDto>('ai:generate', parseGenerateRequest, async (request, event) => {
    return await generate(request, event.sender)
  })

  registerIpcHandler<AiContinuePollingRequestDto, AiGenerateResponseDto>('ai:continuePolling', parseContinuePollingRequest, async (request, event) => {
    return await continuePolling(request, event.sender)
  })

  registerIpcHandler<string, void>('ai:cancelTask', (input) => parseStringField(input, 'taskId'), (taskId) => {
    cancelRuntimeTask(taskId)
  })

  registerIpcHandler<void, number>('ai:reloadModelManifest', parseVoid, () => reloadModelManifest())

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
