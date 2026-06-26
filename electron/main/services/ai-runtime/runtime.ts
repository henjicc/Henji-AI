import type { WebContents } from 'electron'
import { getAiProviderApiKey, getAiProviderKeyStatus } from '../keystore'
import { AiRuntimeError } from './errors'
import { getManifestStore, reloadManifestStore } from './manifest'
import { saveMediaFromUrl } from './media-store'
import { getProgressEstimate, recordProgressSample } from './progress'
import { executeContinuePolling, executeGenerate } from './providers'
import { buildRequest } from './request-builder-dsl'
import { normalizeRequestBody } from './request-normalizer'
import { clearCancelFlag, cancelTask, registerAbortController } from './task-registry'
import { buildContinuePollingTrace, buildGenerateTrace } from './trace'
import { preprocessRequestBody } from './upload'
import type {
  AiContinuePollingRequestDto,
  AiGenerateRequestDto,
  AiGenerateResponseDto,
  AiGetProgressEstimateRequestDto,
  AiProgressEstimateDto,
  AiRecordProgressSampleRequestDto,
  AiRecordProgressSampleResponseDto,
  JsonObject,
  JsonValue,
  ModelManifestItem,
  ProviderKeyStatusDto,
} from './types'

interface RuntimeRequestPreviewEvent {
  requestId: string
  taskId?: string
  modelId: string
  providerId: string
  method: string
  route: string
  requestBody: JsonValue
}

export function getProviderKeyStatus(): ProviderKeyStatusDto[] {
  const known = getAiProviderKeyStatus()
  const byProvider = new Map(known.map((item) => [item.providerId, item.configured]))
  for (const providerId of getManifestStore().providerIds()) {
    if (!byProvider.has(providerId)) {
      byProvider.set(providerId, getAiProviderApiKey(providerId) !== null)
    }
  }
  return Array.from(byProvider.entries()).map(([providerId, configured]) => ({ providerId, configured }))
}

export async function generate(
  request: AiGenerateRequestDto,
  webContents?: WebContents
): Promise<AiGenerateResponseDto> {
  const requestId = resolveRequestId(request)
  clearCancelFlag(requestId)
  const abortController = new AbortController()
  registerAbortController(requestId, abortController)

  try {
    const model = resolveModel(request.modelId)
    const providerId = model.providerId
    const apiKey = requireApiKey(providerId)
    const builtRequest = buildRequest(request.params, model)
    const normalizedBody = normalizeRequestBody(builtRequest.body, model.runtimeConstraints)
    if (!builtRequest.route.trim()) {
      throw new AiRuntimeError('invalid_route', 'Request route is empty')
    }

    const preprocessedBody = await preprocessRequestBody(providerId, builtRequest.route, normalizedBody)
    emitPreview(webContents, {
      requestId,
      modelId: request.modelId,
      providerId,
      method: builtRequest.method,
      route: builtRequest.route,
      requestBody: preprocessedBody,
    })

    const providerResult = await executeGenerate(providerId, {
      apiKey,
      route: builtRequest.route,
      method: builtRequest.method,
      body: preprocessedBody,
      requestId,
      polling: model.polling,
      signal: abortController.signal,
    })
    const trace = buildGenerateTrace(
      request.modelId,
      providerId,
      requestId,
      builtRequest.route,
      builtRequest.method,
      preprocessedBody,
      providerResult.metadata
    )
    const filePath = providerResult.status === 'completed'
      ? await saveMediaPaths(providerResult.url)
      : undefined
    return {
      status: providerResult.status,
      url: providerResult.url,
      filePath,
      taskId: providerResult.taskId,
      metadata: providerResult.metadata,
      trace,
    }
  } finally {
    clearCancelFlag(requestId)
  }
}

export async function continuePolling(
  request: AiContinuePollingRequestDto,
  webContents?: WebContents
): Promise<AiGenerateResponseDto> {
  const requestId = `continue-${request.modelId}-${Date.now()}`
  clearCancelFlag(requestId)
  const abortController = new AbortController()
  registerAbortController(requestId, abortController)

  try {
    const model = resolveModel(request.modelId)
    const providerId = model.providerId
    const apiKey = requireApiKey(providerId)
    const builtRequest = buildRequest(request.params ?? {}, model)

    emitPreview(webContents, {
      requestId,
      taskId: request.taskId.trim(),
      modelId: request.modelId,
      providerId,
      method: 'GET',
      route: builtRequest.route,
      requestBody: builtRequest.body,
    })

    const providerResult = await executeContinuePolling(providerId, {
      apiKey,
      route: builtRequest.route,
      taskId: request.taskId.trim(),
      requestId,
      polling: model.polling,
      signal: abortController.signal,
    })
    const trace = buildContinuePollingTrace(
      request.modelId,
      providerId,
      requestId,
      builtRequest.route,
      request.taskId.trim(),
      providerResult.metadata
    )
    const filePath = await saveMediaPaths(providerResult.url)
    return {
      status: providerResult.status,
      url: providerResult.url,
      filePath,
      taskId: providerResult.taskId,
      metadata: providerResult.metadata,
      trace,
    }
  } finally {
    clearCancelFlag(requestId)
  }
}

export function cancelRuntimeTask(taskId: string): void {
  cancelTask(taskId)
}

export function reloadModelManifest(): number {
  return reloadManifestStore()
}

export function getEstimate(request: AiGetProgressEstimateRequestDto): AiProgressEstimateDto {
  return getProgressEstimate(request.modelId, request.params ?? {})
}

export function recordSample(
  request: AiRecordProgressSampleRequestDto
): AiRecordProgressSampleResponseDto {
  return recordProgressSample(
    request.modelId,
    request.params ?? {},
    request.startedAtMs,
    request.finishedAtMs,
    request.source
  )
}

function resolveRequestId(request: AiGenerateRequestDto): string {
  return request.requestId?.trim() || `${request.modelId}-${Date.now()}`
}

function resolveModel(modelId: string): ModelManifestItem {
  const model = getManifestStore().get(modelId)
  if (!model) {
    throw new AiRuntimeError('provider_not_found', `Unable to resolve provider for model: ${modelId}`)
  }
  return model
}

function requireApiKey(providerId: string): string {
  const apiKey = getAiProviderApiKey(providerId)
  if (!apiKey) {
    throw new AiRuntimeError('api_key_missing', `API key not configured for provider: ${providerId}`)
  }
  return apiKey
}

async function saveMediaPaths(joinedUrls: string): Promise<string | undefined> {
  const savedPaths: string[] = []
  for (const url of joinedUrls.split('|||').map((item) => item.trim()).filter(Boolean)) {
    const saved = await saveMediaFromUrl(url)
    if (saved) {
      savedPaths.push(saved)
    }
  }
  return savedPaths.length > 0 ? savedPaths.join('|||') : undefined
}

function emitPreview(webContents: WebContents | undefined, payload: RuntimeRequestPreviewEvent): void {
  webContents?.send('henji://runtime-request-preview', payload)
}

export function parseJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonObject
}
