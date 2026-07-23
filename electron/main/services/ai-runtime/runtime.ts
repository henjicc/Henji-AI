import { getAiProviderApiKey, getAiProviderKeyStatus } from '../keystore'
import { createMainLogger, sanitizeJsonValue } from '../logging'
import { AiRuntimeError } from './errors'
import { getManifestStore, reloadManifestStore } from './manifest'
import { saveMediaFromUrl } from './media-store'
import { getProgressEstimate, recordProgressSample } from './progress'
import { savePendingResult } from './pending-results'
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
  ModelManifestItem,
  ProviderKeyStatusDto,
} from './types'

// 主进程直接落盘 henji-*.log（source: 'backend'）；日志窗口（2.1）通过 henji://log-event
// 实时订阅同一份事件，不再需要 henji://runtime-request-preview 这条给旧查看器用的预览通道。
const logger = createMainLogger('ai-runtime')

function toLogError(error: unknown): unknown {
  if (!(error instanceof Error)) return error
  const cause = (error as Error & { cause?: unknown }).cause
  const causeSummary = cause && typeof cause === 'object'
    ? {
        name: typeof (cause as Record<string, unknown>).name === 'string'
          ? (cause as Record<string, unknown>).name
          : undefined,
        code: typeof (cause as Record<string, unknown>).code === 'string'
          ? (cause as Record<string, unknown>).code
          : undefined,
        message: typeof (cause as Record<string, unknown>).message === 'string'
          ? (cause as Record<string, unknown>).message
          : undefined,
      }
    : undefined
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error instanceof AiRuntimeError ? error.code : undefined,
    cause: causeSummary,
  }
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
  request: AiGenerateRequestDto
): Promise<AiGenerateResponseDto> {
  const requestId = resolveRequestId(request)
  clearCancelFlag(requestId)
  const abortController = new AbortController()
  registerAbortController(requestId, abortController)

  logger.info('后端开始生成', {
    event: 'ai_runtime.generate.start',
    requestId,
    modelId: request.modelId,
  })

  try {
    const model = resolveModel(request.modelId)
    const providerId = model.providerId
    const apiKey = requireApiKey(providerId)
    const builtRequest = buildRequest(request.params, model)
    const normalizedBody = normalizeRequestBody(builtRequest.body, model.runtimeConstraints)
    if (!builtRequest.route.trim()) {
      throw new AiRuntimeError('invalid_route', 'Request route is empty')
    }

    const preprocessedBody = await preprocessRequestBody(providerId, builtRequest.route, normalizedBody, request.params)
    logger.info('后端发起生成请求', {
      event: 'generation.runtime.request_json',
      requestId,
      modelId: request.modelId,
      providerId,
      context: {
        method: builtRequest.method,
        route: builtRequest.route,
        requestBody: sanitizeJsonValue(preprocessedBody),
      },
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

    logger.info('后端生成响应', {
      event: 'generation.runtime.response_json',
      requestId,
      modelId: request.modelId,
      providerId,
      context: {
        phase: trace.phase,
        route: trace.route,
        method: trace.method,
        responseBody: trace.responseBody,
      },
    })
    logger.info('后端生成结果', {
      event: 'ai_runtime.generate.result',
      requestId,
      modelId: request.modelId,
      providerId,
      context: { status: providerResult.status, taskId: providerResult.taskId },
    })

    return {
      status: providerResult.status,
      url: providerResult.url,
      filePath,
      taskId: providerResult.taskId,
      metadata: providerResult.metadata,
      trace,
    }
  } catch (error) {
    logger.error('后端生成失败', {
      event: 'ai_runtime.generate.failed',
      requestId,
      modelId: request.modelId,
      error: toLogError(error),
    })
    throw error
  } finally {
    clearCancelFlag(requestId)
  }
}

export async function continuePolling(
  request: AiContinuePollingRequestDto
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

    logger.info('后端发起轮询请求', {
      event: 'generation.runtime.request_json',
      requestId,
      taskId: request.taskId.trim(),
      modelId: request.modelId,
      providerId,
      context: {
        method: 'GET',
        route: builtRequest.route,
        requestBody: sanitizeJsonValue(builtRequest.body),
      },
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
    logger.info('后端轮询响应', {
      event: 'generation.runtime.response_json',
      requestId,
      taskId: request.taskId.trim(),
      modelId: request.modelId,
      providerId,
      context: {
        phase: trace.phase,
        route: trace.route,
        method: trace.method,
        responseBody: trace.responseBody,
      },
    })
    const filePath = await saveMediaPaths(providerResult.url)
    const responseResult = {
      status: providerResult.status,
      url: providerResult.url,
      filePath,
      taskId: providerResult.taskId,
      metadata: providerResult.metadata,
      trace,
    }
    savePendingResult(request.taskId.trim(), {
      url: providerResult.url,
      filePath,
      metadata: providerResult.metadata,
    })
    return responseResult
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

export function parseJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonObject
}
