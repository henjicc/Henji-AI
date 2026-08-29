import { describe, expect, it } from 'vitest'

import {
  AGENT_ATTACHMENT_SCHEMA_VERSION,
  agentAttachmentSchema,
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
