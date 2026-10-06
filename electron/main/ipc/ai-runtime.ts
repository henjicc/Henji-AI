import {
  cancelRuntimeTask,
  continuePolling,
  generate,
  getEstimate,
  getProviderKeyStatus,
  parseJsonObject,
  recordSample,
  recoverSavedGenerationResult,
} from '../services/ai-runtime/runtime'
import { consumePendingResult } from '../services/ai-runtime/pending-results'
import type { PendingResultPayload } from '../services/ai-runtime/pending-results'
import type { HostGenerateResponse } from '../services/ai-runtime/host-response'
import {
  testProviderConnection,
  listTtsVoices,
  type AiContinuePollingRequestDto,
  type AiGenerateRequestDto,
  type AiGetProgressEstimateRequestDto,
  type AiProgressEstimateDto,
  type AiRecordProgressSampleRequestDto,
  type AiRecordProgressSampleResponseDto,
  type ProviderKeyStatusDto,
  type ProviderConnectionTestResultDto,
} from '@henjicc/ai-sdk'
import { sdkRuntimeContext } from '../services/ai-runtime/sdk-runtime'
import { containerRefSchema } from '../../../src/core/documents/requests'
import type { DocumentContainerRef } from '../../../src/core/documents/types'
import { resolveContainerGeneratedFolder } from '../services/documents/runtime'
import { createMainLogger } from '../services/logging'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'

const logger = createMainLogger('main.ipc.ai_runtime')

/** 宿主自己的请求字段：结果放进哪个容器的“生成结果”（不进 SDK 请求）。 */
interface HostOutput { outputContainer?: DocumentContainerRef }

function parseOutputContainer(record: Record<string, unknown>): HostOutput {
  return record.outputContainer === undefined ? {} : { outputContainer: containerRefSchema.parse(record.outputContainer) }
}

function parseGenerateRequest(input: unknown): AiGenerateRequestDto & HostOutput {
  const record = parseRecord(input)
  return {
    modelId: readString(record, 'modelId'),
    params: parseJsonObject(record.params ?? {}, 'params'),
    requestId: readOptionalString(record, 'requestId'),
    ...parseOutputContainer(record),
  }
}

function parseContinuePollingRequest(input: unknown): AiContinuePollingRequestDto & HostOutput {
  const record = parseRecord(input)
  return {
    modelId: readString(record, 'modelId'),
    taskId: readString(record, 'taskId'),
    params: record.params === undefined ? undefined : parseJsonObject(record.params, 'params'),
    requestId: readOptionalString(record, 'requestId'),
    ...parseOutputContainer(record),
  }
}

/**
 * 画布里生成的结果放进画布所在容器的“生成结果”（3.4，独立画布 = 作品目录，项目里 = 项目）。
 * 找不到项目时退回作品目录“生成结果”，记 warn，不让一次生成因为位置失败。
 */
async function resolveOutput(container: DocumentContainerRef | undefined, requestId: string | undefined): Promise<{ outputDirectory?: string }> {
  if (!container || container.kind === 'user') return {}
  try {
    return { outputDirectory: await resolveContainerGeneratedFolder(container) }
  } catch (error) {
    logger.warn('生成结果的目标项目找不到，改放作品目录“生成结果”', { event: 'ai_runtime.output.resolve_failed', requestId, error })
    return {}
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

  registerIpcHandler<string, import('@henjicc/ai-sdk').TtsVoice[]>(
    'ai:listTtsVoices',
    (input) => parseStringField(input, 'modelId'),
    (modelId) => listTtsVoices(modelId, sdkRuntimeContext)
  )

  registerIpcHandler<AiGenerateRequestDto & HostOutput, HostGenerateResponse>('ai:generate', parseGenerateRequest, async ({ outputContainer, ...request }) => {
    return await generate(request, await resolveOutput(outputContainer, request.requestId))
  })

  registerIpcHandler<AiContinuePollingRequestDto & HostOutput, HostGenerateResponse>('ai:continuePolling', parseContinuePollingRequest, async ({ outputContainer, ...request }) => {
    return await continuePolling(request, await resolveOutput(outputContainer, request.requestId))
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
    async (serverTaskId) => await recoverSavedGenerationResult(serverTaskId) ?? consumePendingResult(serverTaskId)
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
