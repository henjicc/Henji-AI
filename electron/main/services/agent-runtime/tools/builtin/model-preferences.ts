import { z } from 'zod'

import {
  assistantModelPreferencesSchema,
  assistantModelPreferencesUpdateSchema,
} from '../../../../../../src/core/assistant/modelPreferences'
import {
  getAssistantModelPreferences,
  updateAssistantModelPreferences,
} from '../../../assistant/model-preferences'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'

function eraseToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
}

const mediaPreferenceJsonSchema = {
  type: 'object',
  properties: {
    image: { type: 'array', items: { type: 'string' }, maxItems: 100 },
    video: { type: 'array', items: { type: 'string' }, maxItems: 100 },
    audio: { type: 'array', items: { type: 'string' }, maxItems: 100 },
  },
  additionalProperties: false,
} as const

export function createModelPreferenceTools(): AgentToolDefinition[] {
  const getPreferences = defineAgentTool({
    name: 'get_model_preferences',
    version: 1,
    title: '读取生成模型偏好',
    description: '读取用户持久化的生成模型选择策略、偏好/回避供应商与通用模型标识。',
    category: 'model_preferences',
    side: 'backend',
    risk: 'R0',
    permission: 'assistant_model_preferences:read',
    readOnly: true,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 1, baseDelayMs: 50 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({}).strict(),
    outputSchema: assistantModelPreferencesSchema,
    aiInputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: () => getAssistantModelPreferences(),
    concurrencyKey: () => 'assistant_model_preferences',
    targetIds: () => ({}),
    dataClasses: () => ['C1'],
    summarize: (output) => `已读取生成模型偏好，当前策略为 ${output.strategy}。`,
  })

  const updatePreferences = defineAgentTool({
    name: 'update_model_preferences',
    version: 1,
    title: '更新生成模型偏好',
    description: '按用户明确要求更新持久化的生成模型偏好。模型列表使用跨供应商通用模型标识，而不是供应商模型 ID。',
    category: 'model_preferences',
    side: 'backend',
    risk: 'R2',
    permission: 'assistant_model_preferences:write',
    readOnly: false,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: true,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: assistantModelPreferencesUpdateSchema,
    outputSchema: assistantModelPreferencesSchema,
    aiInputSchema: {
      type: 'object',
      properties: {
        strategy: { type: 'string', enum: ['balanced', 'quality', 'speed', 'cost'] },
        preferredProviders: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        avoidedProviders: { type: 'array', items: { type: 'string' }, maxItems: 100 },
        preferredModels: mediaPreferenceJsonSchema,
        avoidedModels: mediaPreferenceJsonSchema,
        notes: { type: 'string', maxLength: 4_000 },
      },
      additionalProperties: false,
    },
    preview: (input) => ({
      title: '更新生成模型偏好',
      summary: `将更新以下偏好字段：${Object.keys(input).join('、') || '无'}。`,
      targetIds: { preferences: 'assistant/model-preferences.json' },
      reversible: false,
      dataClasses: ['C1'],
    }),
    execute: (input) => updateAssistantModelPreferences(input),
    concurrencyKey: () => 'assistant_model_preferences',
    targetIds: () => ({ preferences: 'assistant/model-preferences.json' }),
    dataClasses: () => ['C1'],
    summarize: (output) => `已更新生成模型偏好，当前策略为 ${output.strategy}。`,
  })

  return [
    eraseToolDefinition(getPreferences),
    eraseToolDefinition(updatePreferences),
  ]
}
