import type { EmbeddedModel } from './contracts'
import { AGENT_MIN_OUTPUT_TOKENS } from '../../../../src/core/llm/agentProfiles'

/** 注册与请求预算共用同一解析；未知窗口用 128K 容纳创作工具与 32K 输出，已声明窗口不放大。 */
export function embeddedModelLimits(model: EmbeddedModel['model']): { contextWindow: number; maxOutputTokens: number } {
  return { contextWindow: model.capabilities.contextWindow ?? 128000,
    maxOutputTokens: Math.min(AGENT_MIN_OUTPUT_TOKENS, model.capabilities.maxOutputTokens ?? AGENT_MIN_OUTPUT_TOKENS) }
}

export function embeddedThinkingLevel(selected: EmbeddedModel): 'off' | 'low' | 'medium' | 'high' | 'xhigh' {
  if (!selected.model.capabilities.reasoning || selected.reasoning?.enabled === false) return 'off'
  // Pi 的最高档为 xhigh，供应商 max 映射到其最高档。
  return selected.reasoning?.effort === 'max' ? 'xhigh' : selected.reasoning?.effort ?? 'high'
}

