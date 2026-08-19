import type {
  LlmChatMessage,
  LlmChatRequest,
  LlmConfigState,
  LlmModelConfig,
  LlmProviderConfig,
  TextProcessingPromptTemplate,
} from '@/core/llm/types'
import type { RowMediaKind } from '@/features/canvas/domain/socketTypes'

const MODEL_KEY_SEPARATOR = '\u0000'
const MEDIA_KIND_ORDER: RowMediaKind[] = ['image', 'video', 'audio']

export interface TextProcessingModelChoice {
  key: string
  label: string
  model: LlmModelConfig
  provider: LlmProviderConfig
}

export const TEXT_PROCESSING_CUSTOM_TEMPLATE_ID = 'custom'

export function resolveTextProcessingSystemPrompt(
  customPrompt: string,
  templateId: string | undefined,
  templates: TextProcessingPromptTemplate[],
): string {
  if (!templateId || templateId === TEXT_PROCESSING_CUSTOM_TEMPLATE_ID) return customPrompt
  return templates.find((template) => template.id === templateId)?.systemPrompt ?? customPrompt
}

export interface TextProcessingMedia {
  image: string[]
  video: string[]
  audio: string[]
}

export function createTextProcessingModelKey(providerId: string, modelId: string): string {
  return `${providerId}${MODEL_KEY_SEPARATOR}${modelId}`
}

export function listTextProcessingModels(config: LlmConfigState): TextProcessingModelChoice[] {
  const enabledProviders = new Map(
    config.providers
      .filter((provider) => provider.enabled)
      .map((provider) => [provider.providerId, provider]),
  )

  return config.models.flatMap((model) => {
    const provider = enabledProviders.get(model.providerId)
    if (!provider || !model.enabled || !model.capabilities.text) return []
    return [{
      key: createTextProcessingModelKey(model.providerId, model.modelId),
      label: `${provider.displayName} · ${model.displayName}`,
      model,
      provider,
    }]
  })
}

export function resolveTextProcessingModel(
  choices: TextProcessingModelChoice[],
  providerId: string,
  modelId: string,
): TextProcessingModelChoice | null {
  const key = createTextProcessingModelKey(providerId, modelId)
  return choices.find((choice) => choice.key === key) ?? choices[0] ?? null
}

export function getTextProcessingMediaKinds(model: LlmModelConfig | null): RowMediaKind[] {
  if (!model) return []
  return MEDIA_KIND_ORDER.filter((kind) => model.capabilities[kind])
}

function inferAudioFormat(source: string): string {
  const withoutQuery = source.split(/[?#]/, 1)[0]
  const extension = withoutQuery.match(/\.([a-zA-Z0-9]+)$/)?.[1]?.toLowerCase()
  return extension || 'mp3'
}

function buildUserMessage(prompt: string, media: TextProcessingMedia): LlmChatMessage {
  const content: NonNullable<Exclude<LlmChatMessage['content'], string>> = [
    { type: 'text', text: prompt },
    ...media.image.map((url) => ({ type: 'image_url' as const, imageUrl: { url } })),
    ...media.video.map((url) => ({ type: 'video_url' as const, videoUrl: { url } })),
    ...media.audio.map((data) => ({
      type: 'input_audio' as const,
      inputAudio: { data, format: inferAudioFormat(data) },
    })),
  ]
  return { role: 'user', content }
}

export function buildTextProcessingRequest(input: {
  requestId: string
  prompt: string
  systemPrompt: string
  choice: TextProcessingModelChoice
  media: TextProcessingMedia
  uploadProvider: string
  uploadFallback: boolean
}): LlmChatRequest {
  const { choice, media } = input
  const systemPrompt = input.systemPrompt.trim()
  return {
    requestId: input.requestId,
    providerId: choice.provider.providerId,
    modelId: choice.model.modelId,
    adapter: choice.model.adapter || choice.provider.adapter,
    baseUrl: choice.model.baseUrl ?? choice.provider.baseUrl,
    reasoning: choice.provider.reasoning,
    messages: [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      buildUserMessage(input.prompt, media),
    ],
    capabilities: choice.model.capabilities,
    metadata: {
      source: 'canvas-text-processing',
      images: media.image,
      uploadedFilePaths: media.image,
      videos: media.video,
      uploadedVideoFilePaths: media.video,
      audios: media.audio,
      uploadedAudioFilePaths: media.audio,
      __upload_provider: input.uploadProvider,
      __upload_fallback: input.uploadFallback,
    },
  }
}
