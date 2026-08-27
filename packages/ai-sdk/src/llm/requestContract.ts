import type { LlmReasoningConfig, LlmReasoningEffort } from './reasoning'

/**
 * 任务 4.2 从 `electron/main/services/llm/request-contract.ts` 迁入，逻辑不变。
 * 文件名不叫 `request-contract.ts` 是为了避免与仓库既有的 kebab-case/camelCase 混用习惯
 * 冲突——本目录下 4.1 迁入的文件（`providerProtocol.ts`、`modelCatalog.ts` 等）统一用
 * camelCase，这里保持一致。
 */

const REASONING_EFFORTS: readonly LlmReasoningEffort[] = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]

function isReasoningEffort(value: unknown): value is LlmReasoningEffort {
  return typeof value === 'string' && REASONING_EFFORTS.includes(value as LlmReasoningEffort)
}

/**
 * 统一解析 renderer → main 的推理配置。
 * 新契约保留 enabled/effort；旧版布尔值继续兼容，避免升级中的在途调用被拒绝。
 */
export function parseLlmReasoningConfig(value: unknown): LlmReasoningConfig | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'boolean') {
    return { enabled: value, effort: 'high' }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected reasoning to be a boolean or an object with enabled and effort fields')
  }

  const record = value as Record<string, unknown>
  if (typeof record.enabled !== 'boolean' || !isReasoningEffort(record.effort)) {
    throw new Error('Expected reasoning.enabled to be boolean and reasoning.effort to be low, medium, high, xhigh, or max')
  }
  return { enabled: record.enabled, effort: record.effort }
}
