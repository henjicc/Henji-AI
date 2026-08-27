import { applyLlmModelCatalogEntry, findLlmModelCatalogEntry } from './modelCatalog'
import type { LlmCapabilities, LlmReasoningConfig, LlmReasoningEffort } from './types'

/**
 * 供应商无关的默认值与能力查表工具。
 *
 * 这里只放"任何消费方都能直接复用"的部分：内置模型能力查表的默认基线、几个官方 Base URL /
 * 模型 ID 常量、思考强度的默认档位。痕迹AI 特有的默认配置（内置提示词模板、默认智能助手
 * 画像、内置供应商/模型清单的产品选择）属于应用侧业务决策，留在
 * `src/core/llm/defaults.ts`——那份文件通过重新导出这里的内容 + 自己的业务函数组合出完整的
 * `createDefaultLlmConfig()`，对外仍是同一个导入路径，不需要动所有消费方。
 */
export const DEFAULT_DEEPSEEK_PROVIDER_ID = 'deepseek'
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
export const DEFAULT_DEEPSEEK_MODEL_ID = 'deepseek-v4-flash'
export const DEFAULT_PPIO_PROVIDER_ID = 'ppio'
export const DEFAULT_PPIO_BASE_URL = 'https://api.ppio.com/openai'
export const DEFAULT_PPIO_MODEL_ID = 'deepseek/deepseek-v4-flash'
export const DEFAULT_LLM_REASONING_EFFORT: LlmReasoningEffort = 'high'
export const DEEPSEEK_V4_CONTEXT_WINDOW = 1_000_000
export const DEEPSEEK_V4_MAX_OUTPUT_TOKENS = 384_000

export const DEFAULT_LLM_CAPABILITIES: LlmCapabilities = {
  text: true,
  image: false,
  video: false,
  audio: false,
  streaming: true,
  toolCall: false,
  parallelTools: false,
  jsonOutput: false,
  structuredOutputMode: 'none',
  reasoning: false,
  sampling: true,
  contextWindow: null,
  maxOutputTokens: null,
  usage: true,
}

/**
 * 按内置模型能力目录生成一份能力声明；目录里没有的模型退回通用默认值（纯文本、能力项全关）。
 *
 * 添加模型的两个入口（手动添加、获取模型列表）和内置模型清单都走这里，保证"同一个模型 ID
 * 无论从哪个入口进来，标出来的能力一致"。
 */
export function createLlmCapabilitiesForModel(modelId: string): LlmCapabilities {
  const entry = findLlmModelCatalogEntry(modelId)
  return entry
    ? applyLlmModelCatalogEntry(DEFAULT_LLM_CAPABILITIES, entry)
    : { ...DEFAULT_LLM_CAPABILITIES }
}

/** DeepSeek 官方要求思考模式默认开启，其余供应商默认关闭；具体档位见 `DEFAULT_LLM_REASONING_EFFORT`。 */
export function createDefaultProviderReasoning(adapter = ''): LlmReasoningConfig {
  return {
    enabled: adapter.trim().toLowerCase() === DEFAULT_DEEPSEEK_PROVIDER_ID,
    effort: DEFAULT_LLM_REASONING_EFFORT,
  }
}
