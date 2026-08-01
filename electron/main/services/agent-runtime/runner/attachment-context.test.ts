import { describe, expect, it, vi } from 'vitest'

vi.mock('../../asset-library', () => ({ inspectAsset: vi.fn() }))
vi.mock('node:fs/promises', () => ({ default: { readFile: vi.fn(async () => Buffer.from('media')) } }))

import { inspectAsset } from '../../asset-library'
import type { AgentAttachment } from '../../../../../src/core/assistant/attachments'
import { prepareAgentAttachmentContext } from './attachment-context'
import type { AgentRuntimeModelSet } from './models'

const attachment: AgentAttachment = {
  schemaVersion: 'agent-attachment/v1', mediaRef: 'asset:a1', modality: 'image', mimeType: 'image/png',
  sizeBytes: 5, width: 1, height: 1, durationSeconds: null, displayName: 'a.png', dataClass: 'C1',
  lifecycle: 'asset_library', sourceStatus: 'ready',
}
const model = (image: boolean) => ({
  providerId: 'p', modelId: image ? 'visual' : 'text', adapter: 'openai', apiProtocol: 'openai-compatible' as const,
  capabilities: { image, video: false, audio: false, streaming: true, toolCall: true, parallelTools: false, structuredOutputMode: 'json' as const, reasoning: false, sampling: true, usage: true },
  limits: { contextWindow: 10000, contextWindowSource: 'model' as const },
  settings: { timeoutMs: 1000, maxRetries: 0, maxOutputTokens: 1000 },
})

describe('prepareAgentAttachmentContext', () => {
  it('主模型不支持图片时只把原始字节交给 observer', async () => {
    vi.mocked(inspectAsset).mockResolvedValue({
      id: 'a1', mediaType: 'image', displayName: 'a.png', filePath: 'C:/secret/a.png', displayUrl: '', source: 'imported',
      mimeType: 'image/png', sizeBytes: 5, width: 1, height: 1, durationSeconds: null, thumbnailPath: null,
      thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, lastUsedAt: null,
      createdAt: 1, updatedAt: 1, tags: [], libraryIds: [],
    })
    const models: AgentRuntimeModelSet = { primary: model(false), router: model(false), summarizer: model(false), observer: model(true), fellBack: false }
    const prepared = await prepareAgentAttachmentContext([attachment], models)
    expect(prepared.primaryMessage).toBeNull()
    expect(prepared.observerMessage?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'file' })]))
    expect(String(prepared.referenceMessage.content)).not.toContain('C:/secret')
  })

  it('没有模型支持目标模态时在读取字节前阻断', async () => {
    vi.mocked(inspectAsset).mockResolvedValue({
      id: 'a1', mediaType: 'image', displayName: 'a.png', filePath: 'C:/secret/a.png', displayUrl: '', source: 'imported',
      mimeType: 'image/png', sizeBytes: 5, width: 1, height: 1, durationSeconds: null, thumbnailPath: null,
      thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, lastUsedAt: null,
      createdAt: 1, updatedAt: 1, tags: [], libraryIds: [],
    })
    const models: AgentRuntimeModelSet = { primary: model(false), router: model(false), summarizer: model(false), fellBack: false }
    await expect(prepareAgentAttachmentContext([attachment], models)).rejects.toThrow('[agent_input_modality_unavailable]')
  })
})
