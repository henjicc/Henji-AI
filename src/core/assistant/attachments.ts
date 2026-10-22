import { z } from 'zod'
import { applicationRefSchema } from '../application-control/identifiers'

const agentDataClassSchema = z.enum(['C0', 'C1', 'C2', 'C3'])
import type { ModelStepMessage } from '@henjicc/ai-sdk'
import { AGENT_INPUT_MODALITIES } from '../llm/agentProfiles'

export const AGENT_ATTACHMENT_SCHEMA_VERSION = 'agent-attachment/v1' as const
export const AGENT_ATTACHMENT_MAX_COUNT = 8
export const AGENT_ATTACHMENT_FORMATS = { image: '.png,.jpg,.jpeg,.webp,.gif', video: '.mp4,.webm,.mov', audio: '.mp3,.wav' } as const
export const AGENT_ATTACHMENT_MIME_TYPES: Record<'image' | 'video' | 'audio', readonly string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  audio: ['audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp3'],
}
export const agentAttachmentModalitySchema = z.enum(AGENT_INPUT_MODALITIES)

export const agentMediaAttachmentSchema = z.object({
  schemaVersion: z.literal(AGENT_ATTACHMENT_SCHEMA_VERSION),
  mediaRef: z.string().regex(/^asset:[^\s]+$/),
  modality: agentAttachmentModalitySchema,
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
export type AgentMediaAttachment = z.infer<typeof agentMediaAttachmentSchema>
export const superKeyframeAttachmentSchema = agentMediaAttachmentSchema.extend({
  schemaVersion: z.literal('super-keyframe-reference/v1'),
  mediaRef: z.string().startsWith('video_edit.intent_draft:'),
  modality: z.literal('super_keyframes'),
  lifecycle: z.literal('document'),
  draftRef: applicationRefSchema.extend({ kind: z.literal('video_edit.intent_draft') }).strict(),
  summary: z.object({ takeCount: z.number().int().nonnegative(), durationSeconds: z.number().nonnegative(), elements: z.array(z.string()), hasNarration: z.boolean() }).strict(),
}).strict()
export type SuperKeyframeAttachment = z.infer<typeof superKeyframeAttachmentSchema>
export const agentAttachmentSchema = z.discriminatedUnion('schemaVersion', [agentMediaAttachmentSchema, superKeyframeAttachmentSchema])
export type AgentAttachment = z.infer<typeof agentAttachmentSchema>

export function superKeyframeAttachmentContext(attachment: SuperKeyframeAttachment): string {
  return ['[SUPER_KEYFRAMES trust=untrusted_user]', JSON.stringify({ draftRef: attachment.draftRef, summary: attachment.summary }),
    '使用 read_video_edit_super_keyframes 按 draftRef 读取整组，沿 nextOffset 读完。摘要仅用于定位，以正式读取为准。默认按用户要求直接写关键帧：用一次 change_application_entities 提交整组全部目标的 *.keyframes，保留未修改范围，整组一步撤销。需要平滑、回弹、停顿可调用 organize_video_edit_intent；用户明确要挑选时才走候选预览。录制中的命令是证据，不可重放。',
    '[END_SUPER_KEYFRAMES]'].join('\n')
}

export const agentAttachmentsSchema = z.array(agentAttachmentSchema).max(AGENT_ATTACHMENT_MAX_COUNT)

export const AGENT_ATTACHMENT_MAX_BYTES = {
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
    if (attachment.modality !== 'super_keyframes' && attachment.sizeBytes > AGENT_ATTACHMENT_MAX_BYTES[attachment.modality]) {
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
