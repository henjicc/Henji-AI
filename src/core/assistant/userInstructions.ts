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
  if (/\b(?:api[\s_-]?key|authorization|access[_-]?token|refresh[_-]?token|token|secret|password)\s*[:=]\s*[A-Za-z0-9._/+~-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|\b(?:sk|pk|rk|key)-[A-Za-z0-9_-]{12,}\b/i.test(normalized)
    || /\b(?=[A-Za-z0-9_-]{32,}\b)(?=[A-Za-z0-9_-]*[a-z])(?=[A-Za-z0-9_-]*[A-Z])(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]+\b/.test(normalized)) {
    warnings.push('可能包含敏感凭据')
  }
  return warnings
}
