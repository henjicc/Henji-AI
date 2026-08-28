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

const logger = createLogger('commands.llmRuntime')

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
  onEvent: (event: LlmStreamEvent) => void
): Promise<void> {
  ensureDesktopRuntime()
  // 流内 Error 事件对应的失败事实已由主进程 `llm/runtime.ts` 直接记录为
  // `llm_runtime.chat_stream.failed`（含完整脱敏请求/错误信息），这里不再重复记录同一事实，
  // 只保留 IPC 调用本身失败（`invoke_failed`）这一前端独有视角。
  try {
    await getPlatform().llmRuntime.chatStream(request, onEvent)
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
  }
}

export async function llmModelStep(
  input: ModelStepInput,
  onEvent: (event: ModelStepEvent) => void
): Promise<ModelStepResult> {
  ensureDesktopRuntime()
  try {
    return await getPlatform().llmRuntime.modelStep(input, onEvent)
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
  return await getPlatform().llmRuntime.verifyModelCapabilities(request)
}

export async function llmCancelTask(taskId: string): Promise<void> {
  ensureDesktopRuntime()
  await getPlatform().llmRuntime.cancelTask(taskId)
}
