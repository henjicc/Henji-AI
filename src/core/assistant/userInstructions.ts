import { z } from 'zod'

export const ASSISTANT_USER_INSTRUCTIONS_SCHEMA_VERSION = 'assistant-user-instructions/v1' as const
export const ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS = 4_000

const instructionContentSchema = z.string()
  .max(ASSISTANT_USER_INSTRUCTIONS_MAX_CHARACTERS)
  .refine((value) => !value.includes('\0'), '用户指令不能包含空字符')

export const assistantUserInstructionsSchema = z.object({
  schemaVersion: z.literal(ASSISTANT_USER_INSTRUCTIONS_SCHEMA_VERSION),
  content: instructionContentSchema,
  updatedAt: z.string().datetime(),
}).strict()

export const assistantUserInstructionsUpdateSchema = z.object({
  content: instructionContentSchema,
}).strict()

export type AssistantUserInstructions = z.infer<typeof assistantUserInstructionsSchema>
export type AssistantUserInstructionsUpdate = z.infer<typeof assistantUserInstructionsUpdateSchema>

export type AssistantUserInstructionsWarning =
  | '可能包含敏感凭据'
  | '包含无法覆盖的安全或审批规则'

export function normalizeAssistantUserInstructionsContent(content: string): string {
  return instructionContentSchema.parse(content.replace(/\r\n?/g, '\n').trim())
}

export function createEmptyAssistantUserInstructions(
  updatedAt = new Date().toISOString()
): AssistantUserInstructions {
  return assistantUserInstructionsSchema.parse({
    schemaVersion: ASSISTANT_USER_INSTRUCTIONS_SCHEMA_VERSION,
    content: '',
    updatedAt,
  })
}

export function getAssistantUserInstructionsWarnings(
  content: string
): AssistantUserInstructionsWarning[] {
  const normalized = normalizeAssistantUserInstructionsContent(content)
  const warnings: AssistantUserInstructionsWarning[] = []
  if (/\b(?:api[\s_-]?key|authorization|access[_-]?token|refresh[_-]?token|token|secret|password)\b|Bearer\s+\S+|\b(?:sk|pk|rk|key)-[A-Za-z0-9_-]{12,}\b/i.test(normalized)) {
    warnings.push('可能包含敏感凭据')
  }
  if (/(?:忽略|绕过|覆盖).{0,16}(?:系统|安全|权限|审批|规则)|(?:自动|无需).{0,8}(?:批准|审批|确认)|ignore.{0,16}(?:system|safety|permission|approval)/i.test(normalized)) {
    warnings.push('包含无法覆盖的安全或审批规则')
  }
  return warnings
}
