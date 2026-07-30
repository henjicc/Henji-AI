import { createMainLogger } from '../../logging'
import {
  modelStepInputSchema,
  type ModelStepEvent,
  type ModelStepInput,
  type ModelStepResult,
} from '../../../../../src/core/llm/modelStep'
import { clearLlmTask, isLlmTaskCancelled, registerLlmTask } from '../task-registry'
import { executeModelStepWithModel } from './model-step'
import { createModelStepLanguageModel } from './provider'
import { dynamicModelCredentialResolver } from './credentials'
import {
  createCancelledError,
  createCredentialError,
  normalizeProviderError,
  ProviderModelStepError,
} from './provider-error'
import { executeModelStepWithRetry } from './retry-policy'

const logger = createMainLogger('main.llm_model_step')

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
  if (isLlmTaskCancelled(taskId) || isAbortError(error)) {
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
  emit: (event: ModelStepEvent) => void
): Promise<ModelStepResult> {
  const input = modelStepInputSchema.parse(rawInput)
  const controller = new AbortController()
  const startedAt = Date.now()
  registerLlmTask(input.requestId, controller)

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
    const apiKey = dynamicModelCredentialResolver.resolveApiKey(input.providerId)
    if (!apiKey) {
      throw createCredentialError(input)
    }
    const result = await executeModelStepWithRetry({
      input,
      signal: controller.signal,
      emit,
      operation: (attemptEmit) => executeModelStepWithModel(
        input,
        createModelStepLanguageModel(input, apiKey),
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
    return result
  } catch (error) {
    const classified = classifyModelStepError(input.requestId, error, input)
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
    clearLlmTask(input.requestId)
  }
}
