import type { AiGenerateRequestDto, AiGenerateResponseDto, AiContinuePollingRequestDto } from '@henjicc/ai-sdk'
import { AgentOperationStore } from '../agent-runtime/persistence/operation-store'
import { digestJson } from '../agent-runtime/tools/security'
import { getDb } from '../db'
import { generate, continuePolling, persistGeneratedResponse } from '../ai-runtime/runtime'

const inFlight = new Map<string, Promise<AiGenerateResponseDto>>()

/** 仅协调宿主执行事实，供应商请求和媒体保存仍由正式 AI 运行时负责。 */
export async function executeGenerationOperation(request: AiGenerateRequestDto, operationId: string | undefined, senderId: number): Promise<AiGenerateResponseDto> {
  if (!operationId) return generate(request)
  if (!request.requestId) throw new Error('OPERATION_EXTERNAL_REQUEST_ID_REQUIRED')
  const key = request.requestId
  const cacheKey = `${operationId}\0${key}`
  const operations = new AgentOperationStore(getDb())
  const registration = operations.beginExternalCall(operationId, { key, source: 'generation',
    modelId: request.modelId,
    inputDigest: digestJson({ modelId: request.modelId, params: request.params }),
    target: { kind: 'generation.task', id: key } }, senderId)
  if (registration.existing) {
    const pending = inFlight.get(cacheKey)
    if (pending) return pending
    if (registration.call.state === 'completed') return registration.call.response as AiGenerateResponseDto
    if (registration.call.state !== 'submitted') throw new Error('原生成请求已经派发，结果尚待核对，不能重复生成')
    if ((registration.call.response as AiGenerateResponseDto)?.status === 'pending') return registration.call.response as AiGenerateResponseDto
  }
  const execution = Promise.resolve().then(async () => {
    try {
      const result = registration.existing
        ? await persistGeneratedResponse({ ...request, requestId: key }, registration.call.response as AiGenerateResponseDto)
        : await generate(request, { onProviderResponse: (response) => {
          operations.recordExternalCall(operationId, key, { state: 'submitted', response, serverTaskId: response.taskId })
        } })
      operations.recordExternalCall(operationId, key, { state: result.status === 'pending' ? 'submitted' : 'completed',
        response: result, serverTaskId: result.taskId })
      return result
    } catch (error) {
      operations.recordExternalCall(operationId, key, { state: 'unknown', error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) })
      throw error
    }
  })
  inFlight.set(cacheKey, execution)
  try { return await execution }
  finally { if (inFlight.get(cacheKey) === execution) inFlight.delete(cacheKey) }
}

/** 只查原供应商任务或重试保存已返回结果；不存在已提交关联时拒绝，绝不回退生成。 */
export async function continueGenerationOperation(request: AiContinuePollingRequestDto, operationId: string | undefined,
  senderId: number): Promise<AiGenerateResponseDto> {
  if (!operationId) return continuePolling(request)
  const operations = new AgentOperationStore(getDb())
  operations.assertPersistenceOwner(operationId, senderId)
  const original = operations.get(operationId)?.externalCalls.find((call) => call.key === request.requestId)
  if (!original || original.source !== 'generation' || original.modelId !== request.modelId
    || !original.serverTaskId || original.serverTaskId !== request.taskId) {
    throw new Error('OPERATION_EXTERNAL_CONFLICT:续查必须匹配原生成操作、模型和供应商任务')
  }
  const response = original.response as AiGenerateResponseDto | undefined
  if (original.state === 'completed') return response!
  if (!response || original.state !== 'submitted') throw new Error('OPERATION_EXTERNAL_UNRESOLVED:原任务缺少可查询的提交回执')
  const key = original.key
  const cacheKey = `${operationId}\0${key}`
  const pending = inFlight.get(cacheKey)
  if (pending) return pending
  const execution = Promise.resolve().then(async () => {
    try {
      const result = response.status === 'completed'
        ? await persistGeneratedResponse({ modelId: request.modelId, requestId: key }, response)
        : await continuePolling(request, { onProviderResponse: (value) => {
          operations.recordExternalCall(operationId, key, { state: 'submitted', response: value,
            serverTaskId: value.taskId ?? original.serverTaskId })
        } })
      operations.recordExternalCall(operationId, key, { state: result.status === 'pending' ? 'submitted' : 'completed',
        response: result, serverTaskId: result.taskId ?? original.serverTaskId })
      return result
    } catch (error) {
      operations.recordExternalCall(operationId, key, { state: 'unknown', error: (error instanceof Error ? error.message : String(error)).slice(0, 2000) })
      throw error
    }
  })
  inFlight.set(cacheKey, execution)
  try { return await execution }
  finally { if (inFlight.get(cacheKey) === execution) inFlight.delete(cacheKey) }
}
