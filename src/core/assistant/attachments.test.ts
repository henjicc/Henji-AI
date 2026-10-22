import { describe, expect, it } from 'vitest'

import {
  AGENT_ATTACHMENT_SCHEMA_VERSION,
  agentAttachmentSchema,
  superKeyframeAttachmentSchema, superKeyframeAttachmentContext, validateAgentAttachmentLimits,
} from './attachments'

function attachment(modality: unknown) {
  return {
    schemaVersion: AGENT_ATTACHMENT_SCHEMA_VERSION,
    mediaRef: 'asset:fixture',
    modality,
    mimeType: 'application/octet-stream',
    sizeBytes: 1,
    displayName: 'fixture',
    dataClass: 'C1',
    lifecycle: 'asset_library',
    sourceStatus: 'ready',
  }
}

describe('agentAttachmentSchema', () => {
  it.each(['image', 'video', 'audio'] as const)('接受真实实现的 %s 附件模态', (modality) => {
    expect(agentAttachmentSchema.safeParse(attachment(modality)).success).toBe(true)
  })

  it('拒绝尚未接入资产和模型适配链路的 file 模态', () => {
    const parsed = agentAttachmentSchema.safeParse(attachment('file'))
    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ['modality'] }),
    ]))
  })
})

it('超级关键帧引用可序列化读回，引用解析为整组读取与单事务应用上下文', () => {
  const value = superKeyframeAttachmentSchema.parse({ ...attachment('super_keyframes'), schemaVersion: 'super-keyframe-reference/v1', mediaRef: 'video_edit.intent_draft:project:group', lifecycle: 'document', draftRef: { kind: 'video_edit.intent_draft', id: 'project:group' }, summary: { takeCount: 2, durationSeconds: 3, elements: ['标题'], hasNarration: true } })
  expect(agentAttachmentSchema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value)
  expect(() => validateAgentAttachmentLimits([value])).not.toThrow()
  expect(superKeyframeAttachmentContext(value)).toContain('read_video_edit_super_keyframes')
  expect(superKeyframeAttachmentContext(value)).toContain('一次 change_application_entities')
  expect(superKeyframeAttachmentContext(value)).toContain('project:group')
  expect(agentAttachmentSchema.safeParse({ ...value, draftRef: { kind: 'image_edit.intent_draft', id: 'other' } }).success).toBe(false)
})
