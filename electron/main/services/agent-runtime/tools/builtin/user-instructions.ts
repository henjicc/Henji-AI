import { z } from 'zod'

import {
  ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS,
  assistantUserInstructionsSchema,
  assistantUserInstructionsUpdateSchema,
} from '../../../../../../src/core/assistant/userInstructions'
import {
  getAssistantUserInstructions,
  updateAssistantUserInstructions,
} from '../../../assistant/user-instructions'
import { defineAgentTool } from '../define-tool'
import type { AgentToolDefinition } from '../types'

function eraseToolDefinition<TInput, TOutput>(
  definition: AgentToolDefinition<TInput, TOutput>
): AgentToolDefinition {
  return definition as unknown as AgentToolDefinition
}

export function createUserInstructionTools(): AgentToolDefinition[] {
  const getInstructions = defineAgentTool({
    name: 'get_user_instructions',
    version: 1,
    title: '读取用户指令',
    description: '读取用户主动维护的自然语言偏好与工作习惯。它不是模型推断出的长期记忆。',
    category: 'user_instructions',
    side: 'backend',
    risk: 'R0',
    permission: 'assistant_user_instructions:read',
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
    outputSchema: assistantUserInstructionsSchema,
    aiInputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    execute: () => getAssistantUserInstructions(),
    concurrencyKey: () => 'assistant_user_instructions',
    targetIds: () => ({}),
    dataClasses: () => ['C1'],
    summarize: (output) => (
      output.content ? '已读取用户主动维护的助手指令。' : '用户尚未填写助手指令。'
    ),
  })

  const updateInstructions = defineAgentTool({
    name: 'update_user_instructions',
    version: 1,
    title: '更新用户指令',
    description: [
      '仅在用户明确要求长期记住偏好、供应商、模型、回答风格或工作习惯时更新自然语言用户指令。',
      '更新前先读取现有内容，保留无关条目，并提交完整的新内容；不得把模型推断或临时要求擅自写入。',
    ].join(''),
    category: 'user_instructions',
    side: 'backend',
    risk: 'R2',
    permission: 'assistant_user_instructions:write',
    readOnly: false,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 5_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: true,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: assistantUserInstructionsUpdateSchema,
    outputSchema: assistantUserInstructionsSchema,
    aiInputSchema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          maxLength: ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS,
          description: '保留无关条目后的完整自然语言用户指令。',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
    preview: (input) => ({
      title: '更新智能助手用户指令',
      summary: `将把用户指令更新为 ${input.content.length} 个字符的自然语言内容。`,
      targetIds: { instructions: 'assistant/user-instructions.md' },
      reversible: false,
      dataClasses: ['C1'],
    }),
    execute: (input) => updateAssistantUserInstructions(input),
    concurrencyKey: () => 'assistant_user_instructions',
    targetIds: () => ({ instructions: 'assistant/user-instructions.md' }),
    dataClasses: () => ['C1'],
    summarize: (output) => (
      output.content ? '已更新智能助手用户指令。' : '已清空智能助手用户指令。'
    ),
  })

  return [
    eraseToolDefinition(getInstructions),
    eraseToolDefinition(updateInstructions),
  ]
}
