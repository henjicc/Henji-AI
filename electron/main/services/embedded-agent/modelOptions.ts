import { applyProviderReasoningRequestBody, findLlmProviderPreset, hasProviderReasoningRule } from '@henjicc/ai-sdk'
import type { EmbeddedModel } from './contracts'
import { AGENT_MIN_OUTPUT_TOKENS } from '../../../../src/core/llm/agentProfiles'

/** 注册与请求预算共用同一解析；未知窗口用 128K 容纳创作工具与 32K 输出，已声明窗口不放大。 */
export function embeddedModelLimits(model: EmbeddedModel['model']): { contextWindow: number; maxOutputTokens: number } {
  return { contextWindow: model.capabilities.contextWindow ?? 128000,
    maxOutputTokens: Math.min(AGENT_MIN_OUTPUT_TOKENS, model.capabilities.maxOutputTokens ?? AGENT_MIN_OUTPUT_TOKENS) }
}

/**
 * Pi 按这份单价算每轮费用，进用量日志供回归比较。用户自填的价格优先；否则用供应商预设的刊例价顶层
 * （分时计价时是高峰价），所以日志里的费用是参考上限，不是账单。
 */
export function embeddedModelPricing(selected: EmbeddedModel): { cost: { input: number; output: number; cacheRead: number; cacheWrite: number }; currency: 'CNY' | 'USD' | null } {
  const own = selected.model.pricing
  if (own) return { currency: own.currency, cost: { input: own.inputPerMillionTokens, output: own.outputPerMillionTokens,
    cacheRead: own.cacheReadPerMillionTokens ?? own.inputPerMillionTokens, cacheWrite: own.cacheWritePerMillionTokens ?? own.inputPerMillionTokens } }
  const listed = findLlmProviderPreset(selected.providerId)?.modelPricing?.[selected.model.modelId]
  if (!listed) return { currency: null, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
  return { currency: listed.currency, cost: { input: listed.inputPerMillionTokens, output: listed.outputPerMillionTokens,
    cacheRead: listed.cacheReadPerMillionTokens ?? listed.inputPerMillionTokens, cacheWrite: listed.inputPerMillionTokens } }
}

type PiThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export function embeddedThinkingLevel(selected: EmbeddedModel): PiThinkingLevel {
  if (!selected.model.capabilities.reasoning || selected.reasoning?.enabled === false) return 'off'
  return selected.reasoning?.effort ?? 'high'
}

/**
 * Pi 只在模型声明了 xhigh / max 的取值时才发这两档，否则静默降到 high（用户选“最高”实际只发 high）。
 * 只声明这两档，取值按 SDK 登记的供应商思考写法换算（与画布、提示词优化的原生请求同一份规则）；
 * 低、中、高仍由 Pi 原样发送。没有登记写法、写法不是 reasoning_effort（布尔开关一类），
 * 或该模型落到 SDK 的通用兜底（原样透传、没有依据说明支持这两档）时不声明，保持降到 high。
 */
export function embeddedThinkingLevelMap(selected: EmbeddedModel, providerFamilyId: string): { xhigh: string; max: string } | undefined {
  const { model } = selected
  if (!model.capabilities.reasoning || !hasProviderReasoningRule(providerFamilyId, model.adapter)) return undefined
  const effortFor = (effort: string): unknown => applyProviderReasoningRequestBody(providerFamilyId, model.adapter, { model: model.modelId },
    { enabled: true, effort: effort as 'high' }).reasoning_effort
  // 登记过的写法都会把不认识的档位换成自己的某一档；原样回声说明这个模型走的是通用兜底
  if (effortFor('henji-probe') === 'henji-probe') return undefined
  const xhigh = effortFor('xhigh')
  const max = effortFor('max')
  return typeof xhigh === 'string' && typeof max === 'string' ? { xhigh, max } : undefined
}

