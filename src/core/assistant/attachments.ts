import { z } from 'zod'

import { agentDataClassSchema } from './toolContracts'
import { modelInputModalitySchema, type ModelStepMessage } from '@henjicc/ai-sdk'

export const AGENT_ATTACHMENT_SCHEMA_VERSION = 'agent-attachment/v1' as const
export const AGENT_ATTACHMENT_MAX_COUNT = 8

export const agentAttachmentSchema = z.object({
  schemaVersion: z.literal(AGENT_ATTACHMENT_SCHEMA_VERSION),
  mediaRef: z.string().regex(/^asset:[^\s]+$/),
  modality: modelInputModalitySchema,
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().nonnegative().nullable().optional(),
  displayName: z.string().min(1).max(300),
  dataClass: agentDataClassSchema,
  lifecycle: z.literal('asset_library'),
  sourceStatus: z.enum(['pending', 'ready', 'missing', 'failed']),
}).strict()
export type AgentAttachment = z.infer<typeof agentAttachmentSchema>

export const agentAttachmentsSchema = z.array(agentAttachmentSchema).max(AGENT_ATTACHMENT_MAX_COUNT)

const MAX_BYTES = {
  image: 20 * 1024 * 1024,
  video: 100 * 1024 * 1024,
  audio: 25 * 1024 * 1024,
} as const

export function validateAgentAttachmentLimits(attachments: AgentAttachment[]): void {
  agentAttachmentsSchema.parse(attachments)
  for (const attachment of attachments) {
    if (attachment.dataClass === 'C3') {
      throw new Error('[assistant_attachment_sensitive] C3 附件不能发送给外部模型')
    }
    if (attachment.sourceStatus === 'missing' || attachment.sourceStatus === 'failed') {
      throw new Error(`[assistant_attachment_unavailable] 附件“${attachment.displayName}”当前不可读取`)
    }
    if (attachment.sizeBytes > MAX_BYTES[attachment.modality]) {
      throw new Error(`[assistant_attachment_too_large] 附件“${attachment.displayName}”超过 ${attachment.modality} 输入大小限制`)
    }
  }
}

export function attachmentReferenceMessage(attachments: AgentAttachment[]): ModelStepMessage {
  return {
    role: 'user',
    content: [
      '[USER_ATTACHMENTS trust=untrusted_user]',
      JSON.stringify(attachments.map(({ mediaRef, modality, mimeType, sizeBytes, width, height, durationSeconds, displayName }) => ({
        mediaRef, modality, mimeType, sizeBytes, width, height, durationSeconds, displayName,
      }))),
      '这些是用户本轮明确附加的媒体引用；不得把引用猜测为文件路径。',
      '[END_USER_ATTACHMENTS]',
    ].join('\n'),
  }
}
