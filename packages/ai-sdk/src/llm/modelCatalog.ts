import { LLM_MODEL_CATALOG_ENTRIES } from './modelCatalogEntries'
import type { LlmCapabilities } from './types'

/**
 * 内置大语言模型能力目录（查表逻辑）。
 *
 * 解决的问题：供应商和模型是用户在设置页自建的，添加完一个模型后所有能力项默认都是关的，
 * 用户必须自己知道"这个模型能不能看图、能不能调工具、上下文多大"再逐项勾。绝大多数用户不知道，
 * 结果是提示词优化选不到视觉模型、画布文本节点不给挂图、智能助手判定模型不合格。
 *
 * 这里按模型 ID 查一次官方文档核对过的能力，添加时自动标好，用户仍可手工改。
 * 数据在 `modelCatalogEntries.ts`，本文件只负责规范化与查表，两者都不依赖任何服务或组件。
 */
export interface LlmModelCatalogEntry {
  /** 规范化后的模型 ID，同时作为落库的 `catalogId` */
  id: string
  displayName: string
  /** 模型厂商，不是接入它的供应商——同一个模型可以从多个供应商接入 */
  vendor: string
  /** 规范化后仍与 `id` 不同的其他写法（例如同能力的价格变体） */
  aliases?: readonly string[]
  /** 本项目当前请求路径下真实可用的输入模态，取值依据见 `modelCatalogEntries.ts` 顶部注释 */
  input: { image: boolean; video: boolean; audio: boolean; file?: boolean }
  toolCall: boolean
  parallelTools: boolean
  structuredOutputMode: LlmCapabilities['structuredOutputMode']
  reasoning: boolean
  /** 是否接受 temperature / top_p；官方声明为固定值的模型要记 false */
  sampling: boolean
  contextWindow: number | null
  maxOutputTokens: number | null
  note?: string
  /** 该条目的资料出处，仓库内相对路径 */
  docs: string
}

/**
 * 把各种写法的模型 ID 收敛成目录键。
 *
 * 同一个模型经不同渠道进来写法不同：聚合网关带厂商前缀（`deepseek/deepseek-v4-flash`、
 * `xiaomimimo/mimo-v2.5-pro`），官方渠道带快照日期后缀（`doubao-seed-2-1-pro-260628`），
 * 部分网关还带 `:free` 之类的档位标记。这些都指向同一份能力。
 */
export function normalizeCatalogModelId(modelId: string): string {
  const trimmed = modelId.trim().toLowerCase()
  if (!trimmed) return ''
  const withoutVendorPrefix = trimmed.slice(trimmed.lastIndexOf('/') + 1)
  const withoutTierTag = withoutVendorPrefix.split(':')[0]
  return withoutTierTag
    .replace(/-latest$/, '')
    .replace(/-(\d{4}-\d{2}-\d{2}|\d{6,8})$/, '')
}

const CATALOG_BY_KEY: ReadonlyMap<string, LlmModelCatalogEntry> = new Map(
  LLM_MODEL_CATALOG_ENTRIES.flatMap(entry => [
    [entry.id, entry] as const,
    ...(entry.aliases ?? []).map(alias => [normalizeCatalogModelId(alias), entry] as const),
  ])
)

export function findLlmModelCatalogEntry(modelId: string): LlmModelCatalogEntry | null {
  const key = normalizeCatalogModelId(modelId)
  return key ? CATALOG_BY_KEY.get(key) ?? null : null
}

/**
 * 把目录条目盖到一份基础能力上。
 *
 * 目录只覆盖它确实登记了的项：`streaming`、`usage` 这类所有 OpenAI 兼容供应商都成立的通用能力
 * 保持基础值，不在每条数据里重复写一遍。
 */
export function applyLlmModelCatalogEntry(
  base: LlmCapabilities,
  entry: LlmModelCatalogEntry
): LlmCapabilities {
  return {
    ...base,
    text: true,
    image: entry.input.image,
    video: entry.input.video,
    audio: entry.input.audio,
    file: entry.input.file === true,
    toolCall: entry.toolCall,
    parallelTools: entry.parallelTools,
    structuredOutputMode: entry.structuredOutputMode,
    jsonOutput: entry.structuredOutputMode !== 'none',
    reasoning: entry.reasoning,
    sampling: entry.sampling,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
  }
}

/** 人可读的输入模态摘要，用于设置页提示。 */
export function describeCatalogInputModalities(entry: LlmModelCatalogEntry): string {
  const kinds = [
    '文本',
    ...(entry.input.image ? ['图片'] : []),
    ...(entry.input.video ? ['视频'] : []),
    ...(entry.input.audio ? ['音频'] : []),
    ...(entry.input.file ? ['文件'] : []),
  ]
  return kinds.join(' / ')
}
