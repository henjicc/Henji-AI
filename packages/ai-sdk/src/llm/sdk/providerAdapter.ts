import type { LanguageModel } from 'ai'

import type { Transport } from '../../runtime'
import type { LlmApiProtocol } from '../providerProtocol'
import {
  detectModelStepInputModalities,
  type ModelInputModality,
  type ModelStepInput,
} from '../modelStep'

/**
 * 任务 4.2 从应用侧 LLM 执行层迁入 SDK。
 *
 * 唯一的实质改动：`ModelStepHttpTrace.request`/`.response` 原来直接复用痕迹AI 助手侧
 * `src/core/assistant/trace.ts` 的 `AgentTraceHttpRequest`/`AgentTraceHttpResponse` 类型。
 * SDK 不能反向依赖应用侧模块（`check:sdk` 会拒绝任何 `@/` 引用），这里改成结构完全等价的
 * 本地类型 {@link ModelStepHttpCaptureRequest}/{@link ModelStepHttpCaptureResponse}——
 * 字段名与可选性逐一对齐，TypeScript 结构化类型系统保证调用方（痕迹AI
 * `electron/main/agent-utility.ts` 与 `electron/main/services/llm/sdk/trace.ts`）拿到的
 * 捕获对象可以直接赋值给它们自己那份 `AgentTraceHttpRequest`/`AgentTraceHttpResponse`
 * 类型的参数，不需要任何转换代码。
 *
 * 追踪归属的完整决策记录见 docs/task/模型SDK抽离/重要记录.md 记录 014。
 */

export interface ModelStepHttpCaptureRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

export interface ModelStepHttpCaptureResponse {
  status?: number
  statusText?: string
  headers?: Record<string, string>
  errorBody?: unknown
}

export interface ModelStepHttpTrace {
  captureHttp?: boolean
  request?: ModelStepHttpCaptureRequest
  response?: ModelStepHttpCaptureResponse
  deepSeekUsage?: {
    prompt_cache_hit_tokens?: unknown
    prompt_cache_miss_tokens?: unknown
    prompt_tokens?: unknown
  }
  usageCapture?: Promise<void>
}

export interface ModelStepProviderAdapter {
  protocol: LlmApiProtocol
  supportedInputModalities: readonly ModelInputModality[]
  createLanguageModel: (
    input: ModelStepInput,
    apiKey: string,
    httpTrace?: ModelStepHttpTrace,
    transport?: Transport
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

  assertInputModalities(protocol: LlmApiProtocol, input: Pick<ModelStepInput, 'messages'>): void {
    const adapter = this.resolve(protocol)
    const supported = new Set(adapter.supportedInputModalities)
    for (const modality of detectModelStepInputModalities(input.messages)) {
      if (!supported.has(modality)) {
        throw new Error(`[unsupported_provider_modality] ${protocol} 协议当前无法安全表达 ${modality} 输入`)
      }
    }
  }
}

export const modelStepProviderAdapters = new ModelStepProviderAdapterRegistry()
