import { networkRequestContext } from './network-transport'
import { claimGenerationSubmission, completeGenerationSubmission, readGenerationSubmission, readGenerationSubmissionStage } from './generation-submissions'
import {
  AiRuntimeError,
  type AIClientGenerationRequestInfo,
  type AiContinuePollingRequestDto,
  type AiGenerateRequestDto,
  type AiGetProgressEstimateRequestDto,
  type AiProgressEstimateDto,
  type AiRecordProgressSampleRequestDto,
  type AiRecordProgressSampleResponseDto,
  type JsonObject,
  type ProviderKeyStatusDto,
} from '@henjicc/ai-sdk'

import { getAiProviderApiKey, getAiProviderKeyStatus } from '../keystore'
import { createMainLogger, sanitizeJsonValue } from '../logging'
import { releaseSavedMediaFileLease, saveMediaFromUrlTracked, type MediaDownloadContext } from './media-store'
import { getProgressEstimate, recordProgressSample } from './progress'
import { savePendingResult } from './pending-results'
import { materializeStructuredOutput } from './structured-output'
import { toHostGenerateResponse, type HostGenerateResponse } from './host-response'
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
    ...(error instanceof AiRuntimeError && error.details ? { details: error.details } : {}),
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

const activeGenerationSubmissions = new Set<string>()
/** 正在轮询（之后会把结果保存进作品目录）的任务数。 */
let activePolls = 0

/** 还有生成结果正在取回或保存（会往作品目录写文件）；更换作品目录前据此拒绝（任务 4.2）。 */
export function hasActiveGenerationWork(): boolean {
  return activeGenerationSubmissions.size > 0 || activePolls > 0
}

/** 结果文件的落点（宿主决定，不进 SDK 请求与提交摘要）：省略时为作品目录“生成结果”。 */
export interface GenerationOutputOptions {
  outputDirectory?: string
}

/** 只完成已收到供应商结果的媒体保存，不会再次调用 SDK 生成。 */
export async function recoverSavedGenerationResult(requestId: string, output: GenerationOutputOptions = {}): Promise<HostGenerateResponse | null> {
  const response = readGenerationSubmission(requestId)
  if (!response) return null
  const stage = readGenerationSubmissionStage(requestId)
  if (stage?.phase === 'completed') return response
  if (activeGenerationSubmissions.has(requestId)) throw new Error('GENERATION_IN_PROGRESS:原生成还在保存，请稍后查询')
  if (!stage?.modelId) throw new Error('GENERATION_RECOVERY_REQUIRED:旧回执缺少精确保存信息，请核对原任务')
  activeGenerationSubmissions.add(requestId)
  try {
    const media = response.filePaths.length > 0 ? { filePaths: response.filePaths, createdFilePaths: response.createdFilePaths ?? [] }
      : response.status === 'completed' ? await saveMediaPaths(response.urls, { requestId, modelId: stage.modelId, taskId: response.taskId }, output.outputDirectory)
      : { filePaths: [], createdFilePaths: [] }
    const saved = { ...response, ...media }
    completeGenerationSubmission(requestId, saved, 'media')
    const completed = { ...saved, structuredOutput: materializeStructuredOutput(saved.structuredOutput, saved.filePaths) }
    completeGenerationSubmission(requestId, completed)
    return completed
  } finally { activeGenerationSubmissions.delete(requestId) }
}

export async function generate(
  request: AiGenerateRequestDto,
  output: GenerationOutputOptions = {},
): Promise<HostGenerateResponse> {
  const requestId = resolveRequestId(request)
  const previous = claimGenerationSubmission(requestId, request)
  if (previous) return await recoverSavedGenerationResult(requestId, output) ?? previous
  activeGenerationSubmissions.add(requestId)
  let ownedMediaPaths: string[] = []
  logger.info('后端开始生成', {
    event: 'ai_runtime.generate.start',
    requestId,
    modelId: request.modelId,
  })

  try {
    let requestInfo: AIClientGenerationRequestInfo | undefined
    const sdkResult = await networkRequestContext.run({ requestId, modelId: request.modelId }, () => sdkAIClient.generate({ ...request, requestId }, {
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
    }))
    const providerResult = toHostGenerateResponse(sdkResult)
    // 先封存供应商真实回执；媒体转换或日志后续失败不抹去已提交结果。
    completeGenerationSubmission(requestId, providerResult, 'provider')
    const info = requireRequestInfo(requestInfo)
    const trace = buildGenerateTrace(
      request.modelId,
      info.providerId,
      requestId,
      info.route,
      info.method,
      info.requestBody,
      sdkResult.metadata
    )
    const persistedMedia = providerResult.status === 'completed'
      ? await saveMediaPaths(providerResult.urls, { requestId, modelId: request.modelId, taskId: providerResult.taskId }, output.outputDirectory)
      : { filePaths: [], createdFilePaths: [] }
    const { filePaths, createdFilePaths } = persistedMedia
    ownedMediaPaths = createdFilePaths
    completeGenerationSubmission(requestId, { ...providerResult, filePaths, createdFilePaths }, 'media')
    const structuredOutput = materializeStructuredOutput(providerResult.structuredOutput, filePaths)

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

    const response: HostGenerateResponse = {
      status: providerResult.status,
      urls: providerResult.urls,
      filePaths,
      createdFilePaths,
      taskId: providerResult.taskId,
      metadata: providerResult.metadata,
      structuredOutput,
      trace,
    }
    completeGenerationSubmission(requestId, response)
    return response
  } catch (error) {
    // 已产生媒体属于原提交；不删除已经落盘的真实供应商结果。
    logger.warn('生成收尾失败，保留原提交结果', { event: 'ai_runtime.generate.recovery_required', requestId, context: { retainedMediaCount: ownedMediaPaths.length } })
    logger.error('后端生成失败', {
      event: 'ai_runtime.generate.failed',
      requestId,
      modelId: request.modelId,
      error: toLogError(error),
    })
    throw error
  } finally { activeGenerationSubmissions.delete(requestId) }
}

export async function continuePolling(
  request: AiContinuePollingRequestDto,
  output: GenerationOutputOptions = {},
): Promise<HostGenerateResponse> {
  const requestId = request.requestId?.trim() || `continue-${request.modelId}-${Date.now()}`
  const taskId = request.taskId.trim()
  let ownedMediaPaths: string[] = []
  activePolls += 1
  logger.info('后端开始轮询', {
    event: 'ai_runtime.poll.start',
    requestId,
    taskId,
    modelId: request.modelId,
  })

  try {
    let requestInfo: AIClientGenerationRequestInfo | undefined
    const sdkResult = await networkRequestContext.run({ requestId, modelId: request.modelId }, () => sdkAIClient.continuePolling({ ...request, requestId }, {
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
    }))
    const providerResult = toHostGenerateResponse(sdkResult)
    const info = requireRequestInfo(requestInfo)
    const trace = buildContinuePollingTrace(
      request.modelId,
      info.providerId,
      requestId,
      info.route,
      taskId,
      sdkResult.metadata
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
    const { filePaths, createdFilePaths } = await saveMediaPaths(providerResult.urls, { requestId, modelId: request.modelId, taskId }, output.outputDirectory)
    ownedMediaPaths = createdFilePaths
    const structuredOutput = materializeStructuredOutput(providerResult.structuredOutput, filePaths)
    const responseResult: HostGenerateResponse = {
      status: providerResult.status,
      urls: providerResult.urls,
      filePaths,
      createdFilePaths,
      taskId: providerResult.taskId,
      metadata: providerResult.metadata,
      structuredOutput,
      trace,
    }
    savePendingResult(taskId, {
      urls: providerResult.urls,
      filePaths,
      createdFilePaths,
      metadata: providerResult.metadata,
      structuredOutput,
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
    await rollbackCreatedMedia(ownedMediaPaths)
    logger.error('后端轮询失败', {
      event: 'ai_runtime.poll.failed',
      requestId,
      taskId,
      modelId: request.modelId,
      error: toLogError(error),
    })
    throw error
  } finally {
    activePolls -= 1
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

async function saveMediaPaths(urls: readonly string[], context: MediaDownloadContext, directory?: string): Promise<{
  filePaths: string[]
  createdFilePaths: string[]
}> {
  const savedPaths: string[] = []
  const createdFilePaths: string[] = []
  const createdPathSet = new Set<string>()
  try {
    for (const [outputIndex, url] of urls.entries()) {
      const saved = await saveMediaFromUrlTracked(url, { ...context, outputIndex }, directory)
      if (saved) {
        savedPaths.push(saved.filePath)
        if (saved.created && createdPathSet.has(saved.filePath)) {
          await releaseSavedMediaFileLease(saved.filePath)
        } else if (saved.created) {
          createdPathSet.add(saved.filePath)
          createdFilePaths.push(saved.filePath)
        }
      }
    }
  } catch (error) {
    await rollbackCreatedMedia(createdFilePaths)
    throw error
  }
  return {
    filePaths: savedPaths,
    createdFilePaths,
  }
}

async function rollbackCreatedMedia(filePaths: readonly string[]): Promise<void> {
  const uniquePaths = [...new Set(filePaths)]
  if (uniquePaths.length === 0) return
  const releases = await Promise.allSettled(
    uniquePaths.map((filePath) => releaseSavedMediaFileLease(filePath)),
  )
  const failedCount = releases.filter((result) => result.status === 'rejected').length
  if (failedCount > 0) {
    logger.error('后端生成媒体回滚失败', {
      event: 'ai_runtime.media_rollback.failed',
      context: { fileCount: uniquePaths.length, failedCount },
    })
  }
}

export function parseJsonObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as JsonObject
}
