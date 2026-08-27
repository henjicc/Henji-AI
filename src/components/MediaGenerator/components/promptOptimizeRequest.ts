import type { PromptOptimizationTargetModel } from '@/core/llm/promptOptimization'
import { buildPromptOptimizationUserMessage, getDefaultPromptProfile } from '@/core/llm/promptOptimization'
import type { LlmChatMessage, LlmConfigState, LlmMessageContentPart, PromptOptimizationProfile } from '@henjicc/ai-sdk'
import { getPathForFile } from '@/platform/desktopApi'
import { saveUploadVideo } from '@/utils/save'

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
  uploadedFilePaths: string[],
  uploadedVideos: string[],
  uploadedVideoFiles: File[],
  uploadedVideoFilePaths: string[],
  targetModel: PromptOptimizationTargetModel | undefined,
): Promise<LlmChatMessage> {
  const templateContext = {
    prompt: currentPrompt,
    imageCount: uploadedImages.length,
    videoCount: uploadedVideos.length,
    targetModel,
  }
  const baseText = buildPromptOptimizationUserMessage(profile, templateContext)
  const shouldAttachImages = profile.capabilities.image === true && uploadedImages.length > 0
  const shouldAttachVideos = profile.capabilities.video === true &&
    (uploadedVideoFiles.length > 0 || uploadedVideoFilePaths.some((path) => path.trim().length > 0))

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
      uploadedImages.map(async (url, index) => normalizeImageSourceForLlm(url, uploadedFilePaths[index]))
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
      buildVideoSourcesForLlm(uploadedVideoFiles, uploadedVideoFilePaths)
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

async function normalizeImageSourceForLlm(source: string, persistedPath?: string): Promise<string> {
  const normalizedPath = persistedPath?.trim()
  if (normalizedPath) {
    return normalizedPath
  }

  const trimmed = source.trim()
  if (!trimmed) {
    return ''
  }

  if (trimmed.startsWith('blob:')) {
    throw new Error('图片附件仍是临时 Blob URL，请重新上传图片后再优化提示词。')
  }

  return trimmed
}

async function resolveVideoSourceForLlm(file: File, persistedPath?: string): Promise<string> {
  const normalizedPath = persistedPath?.trim()
  if (normalizedPath) {
    return normalizedPath
  }

  const directPath = getPathForFile(file).trim()
  if (directPath) {
    return directPath
  }

  const saved = await saveUploadVideo(file, 'persist')
  return saved.fullPath
}

function buildVideoSourcesForLlm(
  files: File[],
  persistedPaths: string[]
): Array<Promise<string>> {
  const sourceCount = Math.max(files.length, persistedPaths.length)
  const sources: Array<Promise<string>> = []
  for (let index = 0; index < sourceCount; index += 1) {
    const file = files[index]
    const persistedPath = persistedPaths[index]
    if (file) {
      sources.push(resolveVideoSourceForLlm(file, persistedPath))
      continue
    }
    sources.push(Promise.resolve(persistedPath?.trim() ?? ''))
  }
  return sources
}
