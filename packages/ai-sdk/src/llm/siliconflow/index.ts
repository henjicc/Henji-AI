import type { RuntimeContext } from '../../runtime/RuntimeContext'
import { createLlmCapabilitiesForModel } from '../defaults'
import { runLlmChatStream, type LlmChatExecutionOptions, type LlmChatStreamHooks } from '../chat'
import type { LlmChatRequestDto, LlmStreamEmitter } from '../chatTypes'
import { discoverModels, type DiscoverModelsOptions } from '../discovery'
import { SILICONFLOW_BASE_URL, SILICONFLOW_DEFAULT_MODEL_ID, SILICONFLOW_PROVIDER_PRESET } from './preset'

export * from './preset'

export type SiliconflowChatRequest = Omit<LlmChatRequestDto, 'providerId' | 'providerFamilyId' | 'modelId' | 'adapter' | 'baseUrl'> & {
  providerId?: string
  modelId?: string
  baseUrl?: string
}

/** 未知动态模型仍可调用；能力不按名字猜测，可由宿主显式提供。 */
export function createSiliconflowChatRequest(request: SiliconflowChatRequest): LlmChatRequestDto {
  const modelId = request.modelId?.trim() || SILICONFLOW_DEFAULT_MODEL_ID
  const known = SILICONFLOW_PROVIDER_PRESET.modelIds.includes(modelId)
  return {
    ...request,
    providerId: request.providerId ?? 'siliconflow',
    providerFamilyId: 'siliconflow',
    modelId,
    adapter: 'openai',
    baseUrl: request.baseUrl?.trim() || SILICONFLOW_BASE_URL,
    capabilities: request.capabilities ?? (known ? {
      ...createLlmCapabilitiesForModel(modelId),
      ...SILICONFLOW_PROVIDER_PRESET.modelCapabilities?.[modelId],
    } : undefined),
    reasoning: request.reasoning ?? (known ? { ...SILICONFLOW_PROVIDER_PRESET.reasoning } : undefined),
  }
}

export async function runSiliconflowChatStream(
  request: SiliconflowChatRequest,
  taskId: string,
  emit: LlmStreamEmitter,
  runtime: RuntimeContext,
  options: LlmChatExecutionOptions & { hooks?: LlmChatStreamHooks } = {}
) {
  const { hooks = {}, ...execution } = options
  return runLlmChatStream(createSiliconflowChatRequest(request), taskId, emit, runtime, hooks, execution)
}

/** 分类在服务器端完成；保留不在内置预设中的新模型，不自动注册或发起推理。 */
export async function discoverSiliconflowModels(
  runtime: RuntimeContext,
  options: Omit<DiscoverModelsOptions, 'providerFamilyId' | 'endpointProfile' | 'requireCredential'> & { baseUrl?: string; providerId?: string } = {}
) {
  const { baseUrl = SILICONFLOW_BASE_URL, providerId = 'siliconflow', ...discovery } = options
  return discoverModels(providerId, baseUrl, runtime, { ...discovery, providerFamilyId: 'siliconflow', requireCredential: true })
}

export type { RuntimeContext, LlmStreamEmitter, LlmChatExecutionOptions, LlmChatStreamHooks }
