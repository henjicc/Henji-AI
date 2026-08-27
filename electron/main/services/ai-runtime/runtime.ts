import {
  AiRuntimeError,
  type AIClientGenerationRequestInfo,
  type AiContinuePollingRequestDto,
  type AiGenerateRequestDto,
  type AiGenerateResponseDto,
  type AiGetProgressEstimateRequestDto,
  type AiProgressEstimateDto,
  type AiRecordProgressSampleRequestDto,
  type AiRecordProgressSampleResponseDto,
  type JsonObject,
  type ProviderKeyStatusDto,
} from '@henjicc/ai-sdk'

import { getAiProviderApiKey, getAiProviderKeyStatus } from '../keystore'
import { createMainLogger, sanitizeJsonValue } from '../logging'
import { saveMediaFromUrl } from './media-store'
import { getProgressEstimate, recordProgressSample } from './progress'
import { savePendingResult } from './pending-results'
import { sdkAIClient } from './sdk-runtime'
import { buildContinuePollingTrace, buildGenerateTrace } from './trace'

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
  for (const model of sdkAIClient.catalog.list()) {
    const providerId = model.meta.provider
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
  logger.info('后端开始生成', {
    event: 'ai_runtime.generate.start',
    requestId,
    modelId: request.modelId,
  })

  try {
    let requestInfo: AIClientGenerationRequestInfo | undefined
    const providerResult = await sdkAIClient.generate({ ...request, requestId }, {
      onRequestBuilt: (info) => {
        requestInfo = info
        logger.info('后端发起生成请求', {
          event: 'generation.runtime.request_json',
          requestId,
          modelId: request.modelId,
          providerId: info.providerId,
          context: {
            method: info.method,
            route: info.route,
            requestBody: sanitizeJsonValue(info.requestBody),
          },
        })
      },
    })
    const info = requireRequestInfo(requestInfo)
    const trace = buildGenerateTrace(
      request.modelId,
      info.providerId,
      requestId,
      info.route,
      info.method,
      info.requestBody,
      providerResult.metadata
    )
    const filePath = providerResult.status === 'completed'
      ? await saveMediaPaths(providerResult.url)
      : undefined

    logger.info('后端生成响应', {
      event: 'generation.runtime.response_json',
      requestId,
      modelId: request.modelId,
      providerId: info.providerId,
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
      providerId: info.providerId,
      context: { status: providerResult.status, taskId: providerResult.taskId },
    })

    const response = {
      status: providerResult.status,
      url: providerResult.url,
      filePath,
      taskId: providerResult.taskId,
      metadata: providerResult.metadata,
      trace,
    }
    return response
  } catch (error) {
    logger.error('后端生成失败', {
      event: 'ai_runtime.generate.failed',
      requestId,
      modelId: request.modelId,
      error: toLogError(error),
    })
    throw error
  }
}

export async function continuePolling(
  request: AiContinuePollingRequestDto
): Promise<AiGenerateResponseDto> {
  const requestId = `continue-${request.modelId}-${Date.now()}`
  const taskId = request.taskId.trim()
  logger.info('后端开始轮询', {
    event: 'ai_runtime.poll.start',
    requestId,
    taskId,
    modelId: request.modelId,
  })

  try {
    let requestInfo: AIClientGenerationRequestInfo | undefined
    const providerResult = await sdkAIClient.continuePolling({ ...request, requestId }, {
      onRequestBuilt: (info) => {
        requestInfo = info
        logger.info('后端发起轮询请求', {
          event: 'generation.runtime.request_json',
          requestId,
          taskId,
          modelId: request.modelId,
          providerId: info.providerId,
          context: {
            method: info.method,
            route: info.route,
            requestBody: sanitizeJsonValue(info.requestBody),
          },
        })
      },
    })
    const info = requireRequestInfo(requestInfo)
    const trace = buildContinuePollingTrace(
      request.modelId,
      info.providerId,
      requestId,
      info.route,
      taskId,
      providerResult.metadata
    )
    logger.info('后端轮询响应', {
      event: 'generation.runtime.response_json',
      requestId,
      taskId,
      modelId: request.modelId,
      providerId: info.providerId,
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
    savePendingResult(taskId, {
      url: providerResult.url,
      filePath,
      metadata: providerResult.metadata,
    })
    logger.info('后端轮询结果', {
      event: 'ai_runtime.poll.result',
      requestId,
      taskId,
      modelId: request.modelId,
      providerId: info.providerId,
      context: { status: providerResult.status },
    })
    return responseResult
  } catch (error) {
    logger.error('后端轮询失败', {
      event: 'ai_runtime.poll.failed',
      requestId,
      taskId,
      modelId: request.modelId,
      error: toLogError(error),
    })
    throw error
  }
}

export function cancelRuntimeTask(taskId: string): void {
  sdkAIClient.cancel({ namespace: 'generation', taskId })
}

export function getEstimate(request: AiGetProgressEstimateRequestDto): AiProgressEstimateDto {
  return getProgressEstimate(
    request.modelId,
    sdkAIClient.catalog.resolveParams(request.modelId, request.params)
  )
}

export function recordSample(
  request: AiRecordProgressSampleRequestDto
): AiRecordProgressSampleResponseDto {
  return recordProgressSample(
    request.modelId,
    sdkAIClient.catalog.resolveParams(request.modelId, request.params),
    request.startedAtMs,
    request.finishedAtMs,
    request.source
  )
}

function resolveRequestId(request: AiGenerateRequestDto): string {
  return request.requestId?.trim() || `${request.modelId}-${Date.now()}`
}

function requireRequestInfo(
  info: AIClientGenerationRequestInfo | undefined
): AIClientGenerationRequestInfo {
  if (!info) {
    throw new AiRuntimeError('invalid_response', 'SDK client did not report request context')
  }
  return info
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
