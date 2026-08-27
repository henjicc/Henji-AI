import { noopLogger, type RuntimeContext } from '../../runtime'
import { cancelTask, clearCancelFlag, isCancelled, registerAbortController } from '../../runtime'
import {
  modelStepInputSchema,
  type ModelStepEvent,
  type ModelStepInput,
  type ModelStepResult,
} from '../modelStep'
import { executeModelStepWithModel } from './modelStep'
import { createModelStepLanguageModel } from './provider'
import {
  createCancelledError,
  createCredentialError,
  normalizeProviderError,
  ProviderModelStepError,
} from '../../runtime'
import { executeModelStepWithRetry } from './retryPolicy'

/**
 * 任务 4.2 从 `electron/main/services/llm/sdk/runtime.ts` 迁入。
 *
 * 唯一的实质改动：密钥读取从 `dynamicModelCredentialResolver`（内部包一层
 * `getLlmProviderApiKey`，Electron keystore）改为 `RuntimeContext.credentials.get('llm', ...)`；
 * 结构化日志从 `createMainLogger('main.llm_model_step')` 改为 `RuntimeContext.logger`
 * （缺省 `noopLogger`），事件名/字段与迁移前逐字段一致。
 */

export function cancelModelStepTask(taskId: string): void {
  cancelTask('llm', taskId)
}

function toLogError(error: unknown): unknown {
  return error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('[task_cancelled]'))
}

export function classifyModelStepError(
  taskId: string,
  error: unknown,
  input?: ModelStepInput
): Error {
  if (isCancelled('llm', taskId) || isAbortError(error)) {
    if (input) return createCancelledError(input)
    return new Error(`[task_cancelled] LLM model step cancelled: ${taskId}`)
  }
  if (error instanceof ProviderModelStepError) return error
  if (input) return normalizeProviderError(input, error)
  if (error instanceof Error && error.message.startsWith('[')) return error
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`[model_step_failed] ${message}`)
}

export async function runModelStep(
  rawInput: ModelStepInput,
  emit: (event: ModelStepEvent) => void,
  runtime: RuntimeContext
): Promise<ModelStepResult> {
  const input = modelStepInputSchema.parse(rawInput)
  const logger = runtime.logger ?? noopLogger
  const controller = new AbortController()
  const startedAt = Date.now()
  const span = runtime.tracer?.startSpan('llm.model-step', {
    requestId: input.requestId,
    runId: input.runId,
    providerId: input.providerId,
    modelId: input.modelId,
  })
  registerAbortController('llm', input.requestId, controller)

  logger.info('模型单步调用开始', {
    event: 'llm_model_step.run.start',
    requestId: input.runId,
    taskId: input.stepId,
    modelId: input.modelId,
    providerId: input.providerId,
    context: {
      toolCount: input.capabilities.toolCall ? (input.tools?.length ?? 0) : 0,
      outputMode: input.output.mode,
      reasoningEnabled: input.reasoning?.enabled === true,
    },
  })

  try {
    const apiKey = await runtime.credentials.get('llm', input.providerId)
    if (!apiKey) {
      throw createCredentialError(input)
    }
    const result = await executeModelStepWithRetry({
      input,
      signal: controller.signal,
      emit,
      operation: (attemptEmit) => executeModelStepWithModel(
        input,
        createModelStepLanguageModel(input, apiKey, undefined, runtime.transport),
        attemptEmit,
        controller.signal
      ),
    })
    logger.info('模型单步调用完成', {
      event: 'llm_model_step.run.completed',
      requestId: input.runId,
      taskId: input.stepId,
      modelId: input.modelId,
      providerId: input.providerId,
      context: {
        finishReason: result.finishReason,
        elapsedMs: result.elapsedMs,
        usage: result.usage,
        toolCallCount: result.toolCalls.length,
      },
    })
    span?.end()
    return result
  } catch (error) {
    const classified = classifyModelStepError(input.requestId, error, input)
    span?.end(classified)
    logger.error('模型单步调用失败', {
      event: 'llm_model_step.run.failed',
      requestId: input.runId,
      taskId: input.stepId,
      modelId: input.modelId,
      providerId: input.providerId,
      context: {
        elapsedMs: Date.now() - startedAt,
        code: classified instanceof ProviderModelStepError
          ? classified.details.code
          : classified.message.match(/^\[([^\]]+)]/)?.[1],
        category: classified instanceof ProviderModelStepError
          ? classified.details.category
          : undefined,
      },
      error: toLogError(classified),
    })
    throw classified
  } finally {
    clearCancelFlag('llm', input.requestId)
  }
}
