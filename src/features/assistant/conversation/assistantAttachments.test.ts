import { describe, expect, it } from 'vitest'

import { assistantAttachmentDraftReducer, assetToAgentAttachment, inferAssistantAttachmentModality } from './assistantAttachments'

describe('assistantAttachments', () => {
  it('按 MIME 与扩展名识别三种附件', () => {
    expect(inferAssistantAttachmentModality({ type: 'image/png', name: 'a.bin' })).toBe('image')
    expect(inferAssistantAttachmentModality({ type: '', name: 'clip.mp4' })).toBe('video')
    expect(inferAssistantAttachmentModality({ type: 'audio/wav', name: 'a.wav' })).toBe('audio')
    expect(inferAssistantAttachmentModality({ type: 'text/plain', name: 'a.txt' })).toBeNull()
  })

  it('只把稳定资产引用和安全元数据写入附件契约', () => {
    const attachment = assetToAgentAttachment({
      id: 'asset-1', mediaType: 'image', displayName: 'demo.png', filePath: 'C:/private/demo.png',
      displayUrl: 'henji-media://local/private', source: 'imported', mimeType: 'image/png', sizeBytes: 12,
      width: 10, height: 20, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null,
      inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, lastUsedAt: null,
      createdAt: 1, updatedAt: 1, tags: [], libraryIds: [],
    })
    expect(attachment).toMatchObject({ mediaRef: 'asset:asset-1', modality: 'image', displayName: 'demo.png' })
    expect(JSON.stringify(attachment)).not.toContain('C:/private')
    expect(JSON.stringify(attachment)).not.toContain('henji-media')
  })

  it('草稿 reducer 去重、移除并清空附件', () => {
    const first = { attachment: { ...assetToAgentAttachment({
      id: 'a1', mediaType: 'image', displayName: 'a.png', filePath: 'x', displayUrl: '', source: 'imported',
      mimeType: 'image/png', sizeBytes: 1, width: 1, height: 1, durationSeconds: null, thumbnailPath: null,
      thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, lastUsedAt: null,
      createdAt: 1, updatedAt: 1, tags: [], libraryIds: [],
    }) }, previewSrc: 'blob:a' }
    expect(assistantAttachmentDraftReducer([], { type: 'replace', attachments: [first, first] })).toHaveLength(1)
    expect(assistantAttachmentDraftReducer([first], { type: 'remove', mediaRef: 'asset:a1' })).toEqual([])
    expect(assistantAttachmentDraftReducer([first], { type: 'clear' })).toEqual([])
  })
})
