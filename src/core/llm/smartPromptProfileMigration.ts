import type { PromptOptimizationProfile } from '@henjicc/ai-sdk'

import { DEFAULT_PROMPT_PROFILE_ID, SMART_PROMPT_PROFILE_ID, createSmartPromptProfile } from './smartPromptProfile'

interface PromptProfileContainer {
  promptProfiles?: PromptOptimizationProfile[]
  selectedPromptProfileId?: string
}

/**
 * llm-config 1 → 2：加入内置智能优化并设为默认。原有方案全部保留（包括原来内置的通用优化，
 * 用户改过的内容不动），只是不再是默认；原来选的是旧内置方案或没选时改为选智能优化，
 * 选的是自建方案则保持。时间戳取已有方案的创建时间，迁移保持纯函数。
 */
export function migrateLlmConfigSmartPromptProfile(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const config = structuredClone(value) as PromptProfileContainer & Record<string, unknown>
  const profiles = Array.isArray(config.promptProfiles) ? config.promptProfiles : []
  if (profiles.some(profile => profile.id === SMART_PROMPT_PROFILE_ID)) return config
  const timestamp = profiles[0]?.createdAt ?? new Date(0).toISOString()
  config.promptProfiles = [
    createSmartPromptProfile(timestamp),
    ...profiles.map(profile => ({ ...profile, isDefault: false })),
  ]
  if (!config.selectedPromptProfileId || config.selectedPromptProfileId === DEFAULT_PROMPT_PROFILE_ID) {
    config.selectedPromptProfileId = SMART_PROMPT_PROFILE_ID
  }
  return config
}
