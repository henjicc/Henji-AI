import type { PromptOptimizationTargetModel } from '@/core/llm/promptOptimization'
import { buildPromptOptimizationUserMessage, getDefaultPromptProfile } from '@/core/llm/promptOptimization'
import type { LlmChatMessage, LlmConfigState, LlmMessageContentPart, PromptOptimizationProfile } from '@/core/llm/types'

export function resolvePromptOptimizationProfile(
  config: LlmConfigState | null,
  selectedProfileId: string
): PromptOptimizationProfile | null {
  if (!config) return null
  const enabledProfiles = config.promptProfiles.filter((profile) => profile.enabled)
  return enabledProfiles.find((profile) => profile.id === selectedProfileId)
    ?? (config.selectedPromptProfileId
      ? enabledProfiles.find((profile) => profile.id === config.selectedPromptProfileId)
      : null)
    ?? getDefaultPromptProfile(config)
    ?? enabledProfiles[0]
    ?? null
}

export async function buildPromptOptimizationUserMessageWithAttachments(
  currentPrompt: string,
  profile: PromptOptimizationProfile,
  uploadedImages: string[],
  uploadedVideos: string[],
  uploadedVideoFiles: File[],
  targetModel: PromptOptimizationTargetModel | undefined,
  fileToDataUrl: (file: File) => Promise<string>
): Promise<LlmChatMessage> {
  const templateContext = {
    prompt: currentPrompt,
    imageCount: uploadedImages.length,
    videoCount: uploadedVideos.length,
    targetModel,
  }
  const baseText = buildPromptOptimizationUserMessage(profile, templateContext)
  const shouldAttachImages = profile.capabilities.image === true && uploadedImages.length > 0
  const shouldAttachVideos = profile.capabilities.video === true && uploadedVideoFiles.length > 0

  if (!shouldAttachImages && !shouldAttachVideos) {
    return {
      role: 'user',
      content: baseText,
    }
  }

  const content: LlmMessageContentPart[] = [
    { type: 'text', text: baseText },
  ]

  if (shouldAttachImages) {
    const normalizedImageUrls = await Promise.all(
      uploadedImages.map(async (url) => normalizeImageSourceForLlm(url))
    )
    normalizedImageUrls.forEach((url) => {
      if (!url.trim()) return
      content.push({
        type: 'image_url',
        imageUrl: { url },
      })
    })
  }

  if (shouldAttachVideos) {
    const videoUrls = await Promise.all(
      uploadedVideoFiles.map(async (file) => fileToDataUrl(file))
    )
    videoUrls.forEach((url) => {
      if (!url.trim()) return
      content.push({
        type: 'video_url',
        videoUrl: { url },
      })
    })
  }

  return {
    role: 'user',
    content,
  }
}

async function normalizeImageSourceForLlm(source: string): Promise<string> {
  const trimmed = source.trim()
  if (!trimmed) {
    return ''
  }

  if (!trimmed.startsWith('blob:')) {
    return trimmed
  }

  const response = await fetch(trimmed)
  const blob = await response.blob()
  return await blobToDataUrl(blob)
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}
