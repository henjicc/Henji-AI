import { networkRequestContext, type NetworkRequestScope } from './network-transport'
import { claimGenerationSubmission, completeGenerationSubmission, completePolledGenerationSubmission, readGenerationSubmission, readGenerationSubmissionStage } from './generation-submissions'
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
import { consumePendingResult, savePendingResult } from './pending-results'
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
const hostExecutions = new Set<{ ids: Set<string>; controller: AbortController }>()
function beginHostExecution(...ids: string[]) {
  const execution = { ids: new Set(ids), controller: new AbortController() }
  hostExecutions.add(execution)
  return execution
}

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
  const execution = beginHostExecution(requestId, response.taskId ?? requestId)
  try {
    const media = response.filePaths.length > 0 ? { filePaths: response.filePaths, createdFilePaths: response.createdFilePaths ?? [] }
      : response.status === 'completed' ? await saveMediaPaths(response.urls, { requestId, modelId: stage.modelId, taskId: response.taskId, signal: execution.controller.signal }, output.outputDirectory)
      : { filePaths: [], createdFilePaths: [] }
    const saved = { ...response, ...media }
    completeGenerationSubmission(requestId, saved, 'media')
    const completed = { ...saved, structuredOutput: materializeStructuredOutput(saved.structuredOutput, saved.filePaths) }
    completeGenerationSubmission(requestId, completed)
    return completed
  } finally { activeGenerationSubmissions.delete(requestId); hostExecutions.delete(execution) }
}

export async function generate(
  request: AiGenerateRequestDto,
  output: GenerationOutputOptions = {},
): Promise<HostGenerateResponse> {
  const requestId = resolveRequestId(request)
  const previous = claimGenerationSubmission(requestId, request)
  if (previous) return await recoverSavedGenerationResult(requestId, output) ?? previous
  activeGenerationSubmissions.add(requestId)
  const execution = beginHostExecution(requestId)
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
    if (providerResult.taskId) execution.ids.add(providerResult.taskId)
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
      ? await saveMediaPaths(providerResult.urls, { requestId, modelId: request.modelId, taskId: providerResult.taskId, signal: execution.controller.signal }, output.outputDirectory)
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
    if (execution.controller.signal.aborted) {
      logger.info('本地生成已停止，原结果可继续恢复', { event: 'ai_runtime.generate.cancelled', requestId })
      throw error
    }
    logger.warn('生成收尾失败，保留原提交结果', { event: 'ai_runtime.generate.recovery_required', requestId, context: { retainedMediaCount: ownedMediaPaths.length } })
    logger.error('后端生成失败', {
      event: 'ai_runtime.generate.failed',
      requestId,
      modelId: request.modelId,
      error: toLogError(error),
    })
    throw error
  } finally { activeGenerationSubmissions.delete(requestId); hostExecutions.delete(execution) }
}

export async function continuePolling(
  request: AiContinuePollingRequestDto,
  output: GenerationOutputOptions = {},
): Promise<HostGenerateResponse> {
  const requestId = request.requestId?.trim() || `continue-${request.modelId}-${Date.now()}`
  const taskId = request.taskId.trim()
  const pollScope: NetworkRequestScope = { requestId, modelId: request.modelId, taskId, phase: 'poll' }
  let ownedMediaPaths: string[] = []
  const execution = beginHostExecution(requestId, taskId)
  activePolls += 1
  logger.info('后端开始轮询', {
    event: 'ai_runtime.poll.start',
    requestId,
    taskId,
    modelId: request.modelId,
  })

  try {
    let requestInfo: AIClientGenerationRequestInfo | undefined
    const cached = consumePendingResult(taskId)
    const sdkResult = cached ? { ...cached, status: cached.status ?? 'completed', urls: cached.urls ?? [] } as Parameters<typeof toHostGenerateResponse>[0] : await networkRequestContext.run(pollScope, () => sdkAIClient.continuePolling({ ...request, requestId }, {
      onRequestBuilt: (info) => {
        requestInfo = info
        // 此回调携带模型创建端点；真实轮询请求日志由宿主 transport 记录。
        pollScope.providerId = info.providerId
      },
    }))
    const providerResult = cached ? { ...toHostGenerateResponse(sdkResult), filePaths: cached.filePaths ?? [], createdFilePaths: cached.createdFilePaths } : toHostGenerateResponse(sdkResult)
    // 供应商结果先留恢复回执，下载或取消不再迫使用户重查已过期的远端任务。
    savePendingResult(taskId, { ...providerResult, taskId })
    const info = cached ? { providerId: pollScope.providerId ?? '', route: '', method: 'GET', requestBody: {} } : requireRequestInfo(requestInfo)
    const trace = buildContinuePollingTrace(
      request.modelId,
      info.providerId,
      requestId,
      pollScope.lastRequest?.route ?? info.route,
      taskId,
      pollScope.lastResponse ?? sdkResult.metadata ?? null
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
    execution.controller.signal.throwIfAborted()
    const { filePaths, createdFilePaths } = providerResult.filePaths.length === providerResult.urls.length
      ? { filePaths: providerResult.filePaths, createdFilePaths: providerResult.createdFilePaths ?? [] }
      : await saveMediaPaths(providerResult.urls, { requestId, modelId: request.modelId, taskId, signal: execution.controller.signal }, output.outputDirectory)
    ownedMediaPaths = createdFilePaths
    savePendingResult(taskId, { ...providerResult, taskId, filePaths, createdFilePaths })
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
      status: providerResult.status,
      taskId,
      urls: providerResult.urls,
      filePaths,
      createdFilePaths,
      metadata: providerResult.metadata,
      structuredOutput,
    })
    try {
      completePolledGenerationSubmission(taskId, responseResult)
    } catch (cause) {
      throw new Error('结果已生成、保存未确认。请从原任务继续获取结果。', { cause })
    }
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
    if (execution.controller.signal.aborted) {
      logger.info('本地续查已停止，原结果可继续恢复', { event: 'ai_runtime.poll.cancelled', requestId, taskId })
      throw error
    }
    logger.warn('轮询收尾未确认，保留原任务结果', { event: 'ai_runtime.poll.recovery_required', taskId, context: { retainedMediaCount: ownedMediaPaths.length } })
    logger.error('后端轮询失败', {
      event: 'ai_runtime.poll.failed',
      requestId,
      taskId,
      modelId: request.modelId,
      error: toLogError(error),
      providerId: pollScope.providerId,
      context: { phase: 'poll', ...pollScope.lastRequest, responseBody: pollScope.lastResponse },
    })
    throw error
  } finally {
    activePolls -= 1
    hostExecutions.delete(execution)
  }
}

export function cancelRuntimeTask(taskId: string): void {
  for (const execution of hostExecutions) if (execution.ids.has(taskId)) execution.controller.abort()
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
      context.signal?.throwIfAborted()
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
