import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { PiAttachments } from './piAttachments'
import type { EmbeddedModel, PreparedEmbeddedAttachment } from './contracts'
import { budgetContext } from './contextBudget'

const directories: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const directory of directories.splice(0)) await fs.rm(directory, { recursive: true, force: true }) })
const model = { model: { capabilities: { image: true, audio: true, video: true } }, api: 'openai-completions' } as EmbeddedModel
const media = (modality: 'image' | 'video' | 'audio', sizeBytes = 5): PreparedEmbeddedAttachment => ({
  attachment: { schemaVersion: 'agent-attachment/v1', mediaRef: `asset:${modality}`, modality,
    mimeType: modality === 'image' ? 'image/png' : modality === 'video' ? 'video/mp4' : 'audio/mpeg', sizeBytes,
    displayName: modality, dataClass: 'C1', lifecycle: 'asset_library', sourceStatus: 'ready' }, data: Buffer.from('bytes').toString('base64'),
})
async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-pi-attachments-'))
  directories.push(directory)
  return new PiAttachments(directory, SessionManager.inMemory())
}
it('同轮工具循环复用编码，下一条用户消息将历史媒体降为引用', async () => {
  const attachments = await fixture()
  const text = await attachments.attach('查看视频', [media('video')])
  const read = vi.spyOn(fs, 'readFile')
  const payload = { messages: [{ role: 'user', content: text }] }
  expect(JSON.stringify(await attachments.apply(payload, model))).toContain('data:video/mp4;base64,')
  await attachments.apply(payload, model)
  expect(read).toHaveBeenCalledTimes(1)
  await attachments.attach('继续', [])
  const next = await attachments.apply({ messages: [...payload.messages, { role: 'user', content: '继续' }] }, model)
  expect(JSON.stringify(next)).not.toContain('data:video/mp4;base64,')
  expect(JSON.stringify(next)).toContain('asset:video')
  expect(read).toHaveBeenCalledTimes(1)
})
it('带标记的真实附件计入上下文预算', async () => {
  const attachments = await fixture()
  const text = await attachments.attach('图片', [media('image')])
  expect(() => budgetContext([{ role: 'user', content: text, timestamp: 0 }], { contextWindow: 5000, maxOutputTokens: 1024,
    instructions: '', tools: [], attachmentTokens: value => attachments.estimateTokens(value) })).toThrow('上下文预算')
})
it('请求体在读盘前检查编码体积', async () => {
  const attachments = await fixture()
  const video = await attachments.attach('视频', [media('video', 100 * 1024 * 1024)])
  const read = vi.spyOn(fs, 'readFile')
  await expect(attachments.apply({ messages: [{ role: 'user', content: video }] }, model)).rejects.toThrow('附件')
  expect(read).not.toHaveBeenCalled()
})
