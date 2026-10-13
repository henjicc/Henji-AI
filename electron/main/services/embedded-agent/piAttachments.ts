import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { serializeMessage, type LlmContentPart } from '@henjicc/ai-sdk'
import type { SessionManager } from '@earendil-works/pi-coding-agent'
import { agentAttachmentSchema, type AgentAttachment } from '../../../../src/core/assistant/attachments'
import type { EmbeddedModel, PreparedEmbeddedAttachment } from './contracts'
import { embeddedInputModalities } from '../../../../src/core/assistant/embeddedAgent'
import { estimateContextTokens } from './contextBudget'

const entrySchema = z.object({ marker: z.string().uuid(), items: z.array(z.object({ attachment: agentAttachmentSchema, hash: z.string().regex(/^[a-f0-9]{64}$/) })).max(8) })
const entryType = 'henji-attachments'
type StoredAttachments = z.infer<typeof entrySchema>
const markerText = (marker: string): string => `\n[henji-attachments:${marker}]`
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }

/** Pi 会话只保存稳定引用与缓存摘要；媒体不经快照反复送回渲染层。 */
export class PiAttachments {
  private currentMarker?: string
  private encoded = new Map<string, Promise<string>>()
  constructor(private readonly directory: string, private readonly manager: SessionManager) {}
  endTurn(): void { this.currentMarker = undefined; this.encoded.clear() }
  estimateTokens(text: string): number {
    const entry = this.entries().find(item => text.endsWith(markerText(item.marker)))
    if (!entry) return 0
    return entry.items.reduce((sum, { attachment }) => sum + estimateContextTokens(`用户附件：${attachment.displayName}（${attachment.mediaRef}）`)
      + (entry.marker !== this.currentMarker ? 0 : attachment.modality === 'image' ? 4096
        : attachment.modality === 'video' ? Math.max(4096, Math.ceil((attachment.durationSeconds ?? attachment.sizeBytes / 65536) * 1024))
          : Math.max(1024, Math.ceil((attachment.durationSeconds ?? attachment.sizeBytes / 16000) * 64))), 0)
  }
  private entries(): StoredAttachments[] {
    return this.manager.getBranch().flatMap((entry) => {
      if (entry.type !== 'custom' || entry.customType !== entryType) return []
      const parsed = entrySchema.safeParse(entry.data)
      return parsed.success ? [parsed.data] : []
    })
  }
  async attach(text: string, attachments: PreparedEmbeddedAttachment[]): Promise<string> {
    this.endTurn()
    if (!attachments.length) return text
    const directory = path.join(this.directory, 'attachments')
    await fs.mkdir(directory, { recursive: true })
    const items: StoredAttachments['items'] = []
    for (const item of attachments) {
      const bytes = Buffer.from(item.data, 'base64')
      const hash = createHash('sha256').update(bytes).digest('hex')
      const temporary = path.join(directory, `${hash}.${randomUUID()}.tmp`)
      try {
        await fs.writeFile(temporary, bytes, { flag: 'wx' })
        await fs.rename(temporary, path.join(directory, hash))
      } finally {
        await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
      }
      items.push({ attachment: item.attachment, hash })
    }
    const marker = randomUUID()
    this.manager.appendCustomEntry(entryType, { marker, items })
    this.currentMarker = marker
    return text + markerText(marker)
  }
  visible(text: string): { text: string; attachments?: AgentAttachment[] } {
    const entry = this.entries().find((item) => text.endsWith(markerText(item.marker)))
    return entry ? { text: text.slice(0, -markerText(entry.marker).length), attachments: entry.items.map((item) => item.attachment) } : { text }
  }
  async apply(payload: unknown, selected: EmbeddedModel): Promise<unknown> {
    if (!record(payload)) return payload
    const responses = selected.api === 'openai-responses'
    const key = responses ? 'input' : 'messages'
    const messages = payload[key]
    if (!Array.isArray(messages)) return payload
    const entries = this.entries()
    const maxBytes = 128 * 1024 * 1024
    const current = entries.find(entry => entry.marker === this.currentMarker)
    const encodedBytes = current?.items.reduce((sum, { attachment }) => sum + 4 * Math.ceil(attachment.sizeBytes / 3), 0) ?? 0
    const tooLarge = (): Error => new Error('当前附件与对话超出请求体预算，请缩小附件或新建对话；已有操作不会重新执行。')
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') + encodedBytes > maxBytes) throw tooLarge()
    const result = { ...payload, [key]: await Promise.all(messages.map(async (message: unknown) => {
      if (!record(message) || message.role !== 'user') return message
      const parts: unknown[] = typeof message.content === 'string' ? [{ type: responses ? 'input_text' : 'text', text: message.content }] : Array.isArray(message.content) ? message.content : []
      const content: unknown[] = []
      let changed = false
      for (const part of parts) {
        if (!record(part) || typeof part.text !== 'string') { content.push(part); continue }
        const text = part.text
        const entry = entries.find((item) => text.endsWith(markerText(item.marker)))
        if (!entry) { content.push(part); continue }
        changed = true
        content.push({ ...part, text: text.slice(0, -markerText(entry.marker).length) })
        for (const { attachment, hash } of entry.items) {
          const textType = responses ? 'input_text' : 'text'
          content.push({ type: textType, text: `用户附件：${attachment.displayName}（${attachment.mediaRef}）` })
          if (entry.marker !== this.currentMarker) continue
          if (!embeddedInputModalities(selected.model.capabilities, selected.api).includes(attachment.modality)) {
            content.push({ type: textType, text: '当前模型无法读取这份历史附件的内容，请勿声称已看过。' })
            continue
          }
          const cacheKey = `${hash}:${attachment.mimeType}`
          let encoded = this.encoded.get(cacheKey)
          if (!encoded) {
            encoded = fs.readFile(path.join(this.directory, 'attachments', hash)).then(bytes => `data:${attachment.mimeType};base64,${bytes.toString('base64')}`).catch(() => {
              this.encoded.delete(cacheKey)
              throw new Error(`无法读取历史附件“${attachment.displayName}”，请重新添加该附件并新建对话。`)
            })
            this.encoded.set(cacheKey, encoded)
          }
          const url = await encoded
          if (responses) {
            // Pi 只原生建模图片；此处把痕迹的附件消息映射至已存在的 Responses 媒体输入。
            // 火山官方契约：response_input_video_param.py，video_url 支持 data URL。
            content.push(attachment.modality === 'image' ? { type: 'input_image', image_url: url, detail: 'auto' } : { type: 'input_video', video_url: url })
          } else {
            const media: LlmContentPart = attachment.modality === 'image' ? { type: 'image_url', imageUrl: { url } }
              : attachment.modality === 'video' ? { type: 'video_url', videoUrl: { url } }
              : { type: 'input_audio', inputAudio: { data: url.slice(url.indexOf(',') + 1), format: attachment.mimeType.includes('wav') ? 'wav' : 'mp3' } }
            const serialized = serializeMessage({ role: 'user', content: [media] })
            if (Array.isArray(serialized.content)) content.push(...serialized.content)
          }
        }
      }
      return changed ? { ...message, content } : message
    })) }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') > maxBytes) throw tooLarge()
    return result
  }
}
