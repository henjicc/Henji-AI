import { inspectAsset, inspectAssets } from '@/commands/assetLibrary'
import {
  AGENT_ATTACHMENT_MAX_COUNT,
  AGENT_ATTACHMENT_SCHEMA_VERSION,
  type AgentAttachment,
} from '@/core/assistant/attachments'
import { addMediaReferenceToLibrary } from '@/features/assets/services/assetCollectionService'
import type { AssetMediaType, AssetRecord } from '@/platform/contracts/assetLibrary'
import { saveUploadAudio, saveUploadImage, saveUploadVideo } from '@/utils/save/uploads'

export interface AssistantAttachmentDraft {
  attachment: AgentAttachment
  previewSrc: string
}

export type AssistantAttachmentDraftAction =
  | { type: 'replace'; attachments: AssistantAttachmentDraft[] }
  | { type: 'remove'; mediaRef: string }
  | { type: 'clear' }

export function assistantAttachmentDraftReducer(
  state: AssistantAttachmentDraft[],
  action: AssistantAttachmentDraftAction
): AssistantAttachmentDraft[] {
  if (action.type === 'clear') return []
  if (action.type === 'remove') return state.filter(item => item.attachment.mediaRef !== action.mediaRef)
  const byRef = new Map(action.attachments.map(item => [item.attachment.mediaRef, item]))
  return [...byRef.values()].slice(0, AGENT_ATTACHMENT_MAX_COUNT)
}

export function inferAssistantAttachmentModality(file: Pick<File, 'type' | 'name'>): AssetMediaType | null {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  if (file.type.startsWith('audio/')) return 'audio'
  const extension = file.name.split('.').pop()?.toLowerCase()
  if (extension && ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension)) return 'image'
  if (extension && ['mp4', 'webm', 'mov'].includes(extension)) return 'video'
  if (extension && ['mp3', 'wav', 'mpeg', 'm4a'].includes(extension)) return 'audio'
  return null
}

export function assetToAgentAttachment(asset: AssetRecord): AgentAttachment {
  return {
    schemaVersion: AGENT_ATTACHMENT_SCHEMA_VERSION,
    mediaRef: `asset:${asset.id}`,
    modality: asset.mediaType,
    mimeType: asset.mimeType ?? `${asset.mediaType}/*`,
    sizeBytes: asset.sizeBytes ?? 0,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
    displayName: asset.displayName,
    dataClass: 'C1',
    lifecycle: 'asset_library',
    sourceStatus: asset.inspectionStatus,
  }
}

export async function importAssistantAttachment(file: File): Promise<AssistantAttachmentDraft> {
  const modality = inferAssistantAttachmentModality(file)
  if (!modality) throw new Error('只支持图片、视频和音频附件')
  const saved = modality === 'image'
    ? await saveUploadImage(file)
    : modality === 'video'
      ? await saveUploadVideo(file)
      : await saveUploadAudio(file)
  const collected = await addMediaReferenceToLibrary({
    filePath: saved.fullPath,
    mediaType: modality,
    source: 'imported',
    displayName: file.name || `粘贴的${modality}`,
  })
  const inspected = await inspectAsset(collected.id)
  if (inspected.inspectionStatus !== 'ready') {
    throw new Error(inspected.inspectionStatus === 'missing' ? '附件源文件已经失效' : '无法读取附件媒体信息')
  }
  return { attachment: assetToAgentAttachment(inspected), previewSrc: saved.displaySrc || inspected.displayUrl }
}

export async function refreshAssistantAttachments(attachments: AgentAttachment[]): Promise<Array<{
  attachment: AgentAttachment
  asset: AssetRecord | null
}>> {
  const ids = attachments.map((attachment) => attachment.mediaRef.slice('asset:'.length))
  const assets = await Promise.all(ids.map(async (id) => {
    try { return (await inspectAssets([id]))[0] ?? null } catch { return null }
  }))
  return attachments.map((attachment, index) => ({ attachment, asset: assets[index] }))
}
