import { createLogger } from '@/core/logging'
import type { LlmChatRequest, LlmConfigState, LlmStreamEvent } from '@henjicc/ai-sdk'
import type { ModelStepEvent, ModelStepInput, ModelStepResult } from '@henjicc/ai-sdk'
import type { ModelCapabilitySmokeRequest, ModelCapabilitySmokeResult } from '@/core/llm/capabilitySmoke'
import type {
  CommitLlmProviderSettingsDto,
  DeleteLlmProviderSettingsDto,
  LlmProviderSettingsResultDto,
} from '@/platform/contracts/llmRuntime'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { withPaidOperation, type PaidOperationOptions } from '@/services/paidApproval'

const logger = createLogger('commands.llmRuntime')
const paidRequests = new Map<string, { controller: AbortController; started: boolean }>()

export interface LlmProviderKeyStatusDto {
  credentialId: string
  configured: boolean
}

function ensureDesktopRuntime(): void {
  if (!isDesktopRuntime()) {
    throw new Error('LLM Runtime only available in desktop mode')
  }
}

export async function llmGetProviderApiKey(credentialId: string): Promise<string | null> {
  ensureDesktopRuntime()
  return await getPlatform().llmRuntime.getProviderApiKey(credentialId)
}

export async function llmGetProviderKeyStatus(credentialIds: string[]): Promise<LlmProviderKeyStatusDto[]> {
  ensureDesktopRuntime()
  return await getPlatform().llmRuntime.getProviderKeyStatus(credentialIds)
}

export async function llmReadConfig(): Promise<LlmConfigState | null> {
  ensureDesktopRuntime()
  return await getPlatform().llmRuntime.readConfig()
}

export async function llmWriteConfig(config: LlmConfigState): Promise<void> {
  ensureDesktopRuntime()
  await getPlatform().llmRuntime.writeConfig(config)
}

export async function llmCommitProviderSettings(
  request: CommitLlmProviderSettingsDto
): Promise<LlmProviderSettingsResultDto> {
  ensureDesktopRuntime()
  return await getPlatform().llmRuntime.commitProviderSettings(request)
}

export async function llmDeleteProviderSettings(
  request: DeleteLlmProviderSettingsDto
): Promise<LlmProviderSettingsResultDto> {
  ensureDesktopRuntime()
  return await getPlatform().llmRuntime.deleteProviderSettings(request)
}

export async function llmChatStream(
  request: LlmChatRequest,
  onEvent: (event: LlmStreamEvent) => void,
  paidContext: PaidOperationOptions & { signal?: AbortSignal } = { category: 'generation', titleKey: 'paidApproval.generateText' },
): Promise<void> {
  ensureDesktopRuntime()
  const requestId = request.requestId ?? crypto.randomUUID()
  request = { ...request, requestId }
  // 主进程记录供应商失败；此处记录授权、调用与流终止的调用方结果。
  const pending = { controller: new AbortController(), started: false }
  const abort = (): void => pending.controller.abort(paidContext.signal?.reason)
  paidContext.signal?.addEventListener('abort', abort, { once: true })
  if (paidContext.signal?.aborted) abort()
  paidRequests.set(requestId, pending)
  try {
    await withPaidOperation(paidContext, async signal => {
      signal.throwIfAborted()
      let completed = false, failure: string | undefined
      pending.started = true
      await getPlatform().llmRuntime.chatStream(request, event => {
        if (event.type === 'Done') completed = true
        if (event.type === 'Error') failure = event.data
        onEvent(event)
      })
      if (failure || !completed) throw new Error(failure || '文本生成未完整返回。')
    }, paidContext.signal ?? pending.controller.signal)
  } catch (error) {
    logger.error('[LlmRuntimeCmd] LLM 请求调用失败', error, {
      event: 'llm_runtime.chat_stream.invoke_failed',
      requestId: request.requestId,
      providerId: request.providerId,
      modelId: request.modelId,
      context: {
        request,
      },
    })
    throw error
  } finally {
    paidContext.signal?.removeEventListener('abort', abort)
    if (paidRequests.get(requestId) === pending) paidRequests.delete(requestId)
  }
}

export async function llmModelStep(
  input: ModelStepInput,
  onEvent: (event: ModelStepEvent) => void
): Promise<ModelStepResult> {
  ensureDesktopRuntime()
  try {
    return await withPaidOperation({ category: 'generation', titleKey: 'paidApproval.generateReply' }, () => getPlatform().llmRuntime.modelStep(input, onEvent))
  } catch (error) {
    logger.error('模型单步 IPC 调用失败', error, {
      event: 'llm_model_step.invoke.failed',
      requestId: input.runId,
      taskId: input.stepId,
      providerId: input.providerId,
      modelId: input.modelId,
    })
    throw error
  }
}

export async function llmVerifyModelCapabilities(
  request: ModelCapabilitySmokeRequest
): Promise<ModelCapabilitySmokeResult> {
  ensureDesktopRuntime()
  return await withPaidOperation({ category: 'generation', titleKey: 'paidApproval.verifyModel', capabilityId: 'ui_verify_model', messageKey: 'paidApproval.verifyModelContent' }, () => getPlatform().llmRuntime.verifyModelCapabilities(request))
}

export async function llmCancelTask(taskId: string): Promise<void> {
  ensureDesktopRuntime()
  const pending = paidRequests.get(taskId)
  if (pending) {
    pending.controller.abort()
    if (!pending.started) return
  }
  await getPlatform().llmRuntime.cancelTask(taskId)
}
