import {
  resolveLlmTaskId,
  type LlmChatRequestDto,
  type LlmStreamEmitter,
  type ModelStepEvent,
  type ModelStepInput,
  type ModelStepResult,
} from '@henjicc/ai-sdk'

import { sdkAIClient } from '../ai-runtime/sdk-runtime'
import { createMainLogger, sanitizeJsonValue } from '../logging'

/**
 * 原生 SSE 流式聊天路径（`llm:chatStream`）的主进程薄壳。
 *
 * 任务 4.2 把取密钥、预处理、endpoint 解析、payload 构建、发流式请求这些编排逻辑迁到
 * `@henjicc/ai-sdk` 的 `runLlmChatStream`（`packages/ai-sdk/src/llm/chat.ts`）；本文件只剩
 * 三件事：结构化日志落盘（`henji-*.log`，`source: 'backend'`）、`Done`/`Error` 两个 IPC
 * 事件的发射、任务取消转发。日志事件名/字段与迁移前逐字段一致，通过
 * `runLlmChatStream` 的 `hooks`（请求已构建 / 请求已完成两个节点）拿到记日志所需的数据，
 * 不需要在这里重复 endpoint 解析或 payload 构建逻辑。
 */
const logger = createMainLogger('llm-runtime')

function toLogError(error: unknown): unknown {
  return error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error
}

export async function llmChatStream(
  request: LlmChatRequestDto,
  emit: LlmStreamEmitter
): Promise<void> {
  const taskId = resolveLlmTaskId(request)

  try {
    const outcome = await sdkAIClient.chat.stream({ ...request, requestId: taskId }, emit, {
      onRequestBuilt: ({ endpoint, requestPayload, processedRequest }) => {
        logger.info('后端发起 LLM 请求', {
          event: 'llm_runtime.chat_stream.request_json',
          requestId: taskId,
          modelId: processedRequest.modelId,
          providerId: processedRequest.providerId,
          context: {
            method: 'POST',
            route: endpoint,
            requestBody: sanitizeJsonValue(requestPayload),
          },
        })
      },
      onCompleted: ({ processedRequest, startedAtMs, elapsedMs, inputChars, outputChars, output, reasoningOutput }) => {
        logger.info('后端 LLM 响应完成', {
          event: 'llm_runtime.chat_stream.response_json',
          requestId: taskId,
          modelId: processedRequest.modelId,
          providerId: processedRequest.providerId,
          context: {
            startedAtMs,
            elapsedMs,
            inputChars,
            outputChars,
            output: sanitizeJsonValue(output),
            reasoningOutput: sanitizeJsonValue(reasoningOutput),
          },
        })
      },
    })

    emit({
      type: 'Done',
      data: {
        providerId: outcome.providerId,
        modelId: outcome.modelId,
        startedAtMs: outcome.startedAtMs,
        elapsedMs: outcome.elapsedMs,
        inputChars: outcome.inputChars,
        outputChars: outcome.outputChars,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('后端 LLM 请求失败', {
      event: 'llm_runtime.chat_stream.failed',
      requestId: taskId,
      modelId: request.modelId,
      providerId: request.providerId,
      context: { normalizedMessage: message },
      error: toLogError(error),
    })
    emit({ type: 'Error', data: message })
    throw new Error(message)
  }
}

export async function llmModelStep(
  input: ModelStepInput,
  emit: (event: ModelStepEvent) => void
): Promise<ModelStepResult> {
  return await sdkAIClient.chat.modelStep(input, emit)
}

export function cancelLlmRuntimeTask(taskId: string): void {
  sdkAIClient.cancel({ namespace: 'llm', taskId })
}
