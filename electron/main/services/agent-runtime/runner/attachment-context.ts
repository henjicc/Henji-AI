import fs from 'node:fs/promises'

import {
  attachmentReferenceMessage,
  validateAgentAttachmentLimits,
  type AgentAttachment,
} from '../../../../../src/core/assistant/attachments'
import type { ModelInputModality, ModelStepMessage } from '@henjicc/ai-sdk'
import { inspectAsset } from '../../asset-library'
import { resolveModelStepProviderAdapter } from '@henjicc/ai-sdk'
import {
  selectAgentObservationRuntimeModel,
  selectAgentRuntimeModels,
  type AgentRuntimeModelSet,
} from './models'
import type { AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import { createMainLogger } from '../../logging'

const MAX_DURATION_SECONDS = { image: null, video: 30 * 60, audio: 60 * 60 } as const
const logger = createMainLogger('main.agent_attachments')

function assetId(attachment: AgentAttachment): string {
  return attachment.mediaRef.slice('asset:'.length)
}

function assertEncoding(modality: ModelInputModality, mimeType: string): void {
  if (modality === 'audio' && !['audio/wav', 'audio/mp3', 'audio/mpeg'].includes(mimeType)) {
    throw new Error('[assistant_attachment_encoding_unsupported] 当前模型协议只支持 WAV 或 MP3 音频附件')
  }
}

async function inspectAndValidate(attachment: AgentAttachment) {
  const asset = await inspectAsset(assetId(attachment)).catch(() => null)
  if (!asset || asset.inspectionStatus !== 'ready') {
    throw new Error(`[assistant_attachment_unavailable] 附件“${attachment.displayName}”源文件已失效`)
  }
  if (asset.mediaType !== attachment.modality) {
    throw new Error(`[assistant_attachment_changed] 附件“${attachment.displayName}”的媒体类型已经变化`)
  }
  const mimeType = asset.mimeType ?? attachment.mimeType
  assertEncoding(attachment.modality, mimeType)
  const maxDuration = MAX_DURATION_SECONDS[attachment.modality]
  if (maxDuration && asset.durationSeconds && asset.durationSeconds > maxDuration) {
    throw new Error(`[assistant_attachment_too_long] 附件“${attachment.displayName}”时长超过限制`)
  }
  return { attachment, asset, mimeType }
}

export async function validateAgentRunAttachments(request: AgentStartRunRequest): Promise<void> {
  const attachments = request.attachments ?? []
  if (attachments.length === 0) return
  logger.info('助手附件预检开始', { event: 'agent_attachment.preflight.start', context: { attachmentCount: attachments.length } })
  try {
    validateAgentAttachmentLimits(attachments)
    const models = selectAgentRuntimeModels(request)
    for (const attachment of attachments) {
      const { mimeType } = await inspectAndValidate(attachment)
      const selected = selectAgentObservationRuntimeModel(models, attachment.modality)
      const protocol = selected.model.apiProtocol ?? 'openai-compatible'
      if (!resolveModelStepProviderAdapter(protocol).supportedInputModalities.includes(attachment.modality)) {
        throw new Error(`[unsupported_provider_modality] ${protocol} 协议当前无法安全表达 ${attachment.modality} 输入`)
      }
      assertEncoding(attachment.modality, mimeType)
    }
    logger.info('助手附件预检完成', { event: 'agent_attachment.preflight.completed', context: { attachmentCount: attachments.length } })
  } catch (error) {
    logger.error('助手附件预检失败', { event: 'agent_attachment.preflight.failed', error, context: { attachmentCount: attachments.length } })
    throw error
  }
}

export interface PreparedAgentAttachmentContext {
  referenceMessage: ModelStepMessage
  primaryMessage: ModelStepMessage | null
  observerMessage: ModelStepMessage | null
  observerModalities: ModelInputModality[]
}

export async function prepareAgentAttachmentContext(
  attachments: AgentAttachment[],
  models: AgentRuntimeModelSet
): Promise<PreparedAgentAttachmentContext> {
  logger.info('助手附件上下文准备开始', { event: 'agent_attachment.context.start', context: { attachmentCount: attachments.length } })
  validateAgentAttachmentLimits(attachments)
  const primaryParts: Array<Record<string, unknown>> = []
  const observerParts: Array<Record<string, unknown>> = []
  const observerModalities = new Set<ModelInputModality>()
  for (const attachment of attachments) {
    const { asset, mimeType } = await inspectAndValidate(attachment)
    const selected = selectAgentObservationRuntimeModel(models, attachment.modality)
    const bytes = new Uint8Array(await fs.readFile(asset.filePath))
    const part = { type: 'file', data: bytes, mediaType: mimeType, filename: attachment.displayName }
    if (selected.role === 'primary') primaryParts.push(part)
    else {
      observerParts.push(part)
      observerModalities.add(attachment.modality)
    }
  }
  const message = (parts: Array<Record<string, unknown>>): ModelStepMessage | null => parts.length > 0
    ? { role: 'user', content: [{ type: 'text', text: '请结合这些用户附件理解本轮目标。' }, ...parts] }
    : null
  const result = {
    referenceMessage: attachmentReferenceMessage(attachments),
    primaryMessage: message(primaryParts),
    observerMessage: message(observerParts),
    observerModalities: [...observerModalities],
  }
  logger.info('助手附件上下文准备完成', {
    event: 'agent_attachment.context.completed',
    context: { attachmentCount: attachments.length, primaryCount: primaryParts.length, observerCount: observerParts.length },
  })
  return result
}
