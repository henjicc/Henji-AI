import fs from 'node:fs/promises'
import { AGENT_ATTACHMENT_MAX_BYTES, AGENT_ATTACHMENT_MIME_TYPES, validateAgentAttachmentLimits, type AgentAttachment } from '../../../../src/core/assistant/attachments'
import { inspectAsset } from '../asset-library'
import type { EmbeddedModel, PreparedEmbeddedAttachment } from './contracts'

// 先检查权威素材信息，再读内容；不信任渲染层传来的大小、类型或文件路径。
export async function prepareEmbeddedAttachments(attachments: AgentAttachment[], model: EmbeddedModel, signal: AbortSignal): Promise<PreparedEmbeddedAttachment[]> {
  validateAgentAttachmentLimits(attachments)
  const prepared: PreparedEmbeddedAttachment[] = []
  let total = 0
  for (const attachment of attachments) {
    signal.throwIfAborted()
    if (!model.model.capabilities[attachment.modality]) throw new Error(`当前模型不支持“${attachment.displayName}”的附件类型，请移除附件或切换模型。`)
    if (attachment.modality === 'audio' && model.api !== 'openai-completions') throw new Error('当前模型的连接方式不支持音频输入，请选择使用兼容对话接口的音频模型。')
    const asset = await inspectAsset(attachment.mediaRef.slice('asset:'.length))
    if (asset.inspectionStatus !== 'ready' || asset.mediaType !== attachment.modality) throw new Error(`附件“${attachment.displayName}”已失效，请重新添加。`)
    const mimeType = asset.mimeType ?? ''
    if (!AGENT_ATTACHMENT_MIME_TYPES[asset.mediaType].includes(mimeType)) throw new Error(`附件“${attachment.displayName}”的格式暂不支持，请转换为 PNG/JPEG/WebP/GIF、MP4/WebM/MOV 或 MP3/WAV 后添加。`)
    const file = await fs.open(asset.filePath, 'r')
    try {
      const stat = await file.stat()
      total += stat.size
      if (!stat.isFile() || stat.size > AGENT_ATTACHMENT_MAX_BYTES[asset.mediaType] || total > 128 * 1024 * 1024) throw new Error(`附件“${attachment.displayName}”过大，请缩小文件后重试。`)
      signal.throwIfAborted()
      const bytes = await file.readFile({ signal })
      if (bytes.length !== stat.size) throw new Error(`附件“${attachment.displayName}”正在变化，请保存完成后重新添加。`)
      prepared.push({ attachment: { ...attachment, mimeType, sizeBytes: bytes.length, sourceStatus: 'ready' }, data: bytes.toString('base64') })
    } finally { await file.close() }
  }
  return prepared
}
