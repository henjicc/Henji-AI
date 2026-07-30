import type { LanguageModel } from 'ai'

import type { AgentTraceHttpRequest, AgentTraceHttpResponse } from '../../../../../src/core/assistant/trace'
import type { LlmApiProtocol } from '../../../../../src/core/llm/providerProtocol'
import type { ModelStepInput } from '../../../../../src/core/llm/modelStep'

export interface ModelStepHttpTrace {
  captureHttp?: boolean
  request?: AgentTraceHttpRequest
  response?: AgentTraceHttpResponse
  deepSeekUsage?: {
    prompt_cache_hit_tokens?: unknown
    prompt_cache_miss_tokens?: unknown
    prompt_tokens?: unknown
  }
  usageCapture?: Promise<void>
}

export interface ModelStepProviderAdapter {
  protocol: LlmApiProtocol
  createLanguageModel: (
    input: ModelStepInput,
    apiKey: string,
    httpTrace?: ModelStepHttpTrace
  ) => LanguageModel
}

export class ModelStepProviderAdapterRegistry {
  private readonly adapters = new Map<LlmApiProtocol, ModelStepProviderAdapter>()

  register(adapter: ModelStepProviderAdapter): void {
    if (this.adapters.has(adapter.protocol)) {
      throw new Error(`[MODEL_PROTOCOL_DUPLICATE] 模型协议已注册：${adapter.protocol}`)
    }
    this.adapters.set(adapter.protocol, adapter)
  }

  resolve(protocol: LlmApiProtocol): ModelStepProviderAdapter {
    const adapter = this.adapters.get(protocol)
    if (!adapter) throw new Error(`[MODEL_PROTOCOL_UNSUPPORTED] 不支持的模型协议：${protocol}`)
    return adapter
  }
}

export const modelStepProviderAdapters = new ModelStepProviderAdapterRegistry()
