import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentAttachment } from '../../../../src/core/assistant/attachments'
import type { EmbeddedModel } from './contracts'
import { prepareEmbeddedAttachments } from './attachments'

const { inspectAsset } = vi.hoisted(() => ({ inspectAsset: vi.fn() }))
vi.mock('../asset-library', () => ({ inspectAsset }))
const temporary: string[] = []
afterEach(async () => { for (const directory of temporary.splice(0)) await fs.rm(directory, { recursive: true, force: true }); vi.resetAllMocks() })
const attachment: AgentAttachment = { schemaVersion: 'agent-attachment/v1', mediaRef: 'asset:test', modality: 'image', mimeType: 'image/png', sizeBytes: 0, displayName: '测试图片', dataClass: 'C1', lifecycle: 'asset_library', sourceStatus: 'ready' }
const model = { model: { capabilities: { image: true, video: true, audio: true } }, api: 'openai-completions' } as EmbeddedModel
describe('embedded attachment host boundary', () => {
  it('仅读取权威素材路径与实际大小，不信任调用方描述', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-attachment-'))
    temporary.push(directory)
    const filePath = path.join(directory, 'image.png')
    await fs.writeFile(filePath, 'bytes')
    inspectAsset.mockResolvedValue({ filePath, inspectionStatus: 'ready', mediaType: 'image', mimeType: 'image/png' })
    expect(await prepareEmbeddedAttachments([attachment], model, new AbortController().signal)).toMatchObject([{ attachment: { sizeBytes: 5 }, data: 'Ynl0ZXM=' }])
    expect(inspectAsset).toHaveBeenCalledWith('test')
    await fs.truncate(filePath, 21 * 1024 * 1024)
    await expect(prepareEmbeddedAttachments([attachment], model, new AbortController().signal)).rejects.toThrow('过大')
  })
  it('拒绝不支持的模态、失效素材、敏感附件与取消后的读取', async () => {
    const textModel = { ...model, model: { ...model.model, capabilities: { ...model.model.capabilities, image: false } } }
    await expect(prepareEmbeddedAttachments([attachment], textModel, new AbortController().signal)).rejects.toThrow('不支持')
    expect(inspectAsset).not.toHaveBeenCalled()
    inspectAsset.mockResolvedValue({ inspectionStatus: 'missing' })
    await expect(prepareEmbeddedAttachments([attachment], model, new AbortController().signal)).rejects.toThrow('已失效')
    await expect(prepareEmbeddedAttachments([{ ...attachment, dataClass: 'C3' }], model, new AbortController().signal)).rejects.toThrow('C3')
    await expect(prepareEmbeddedAttachments([attachment], model, AbortSignal.abort())).rejects.toThrow()
  })
})
