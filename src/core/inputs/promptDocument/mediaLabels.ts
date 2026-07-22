import type { PromptMediaType } from './types'

const MEDIA_LABEL_PREFIXES: Record<PromptMediaType, string> = {
  image: '图片',
  video: '视频',
  audio: '音频',
}

export function createPromptMediaLabel(mediaType: PromptMediaType, position: number): string {
  return `${MEDIA_LABEL_PREFIXES[mediaType]}${position}`
}

export function createLegacyPromptMediaLabels(
  mediaType: PromptMediaType,
  position: number,
): readonly string[] {
  const spacedCurrentLabel = `${MEDIA_LABEL_PREFIXES[mediaType]} ${position}`
  return mediaType === 'image'
    ? [`图${position}`, `图 ${position}`, spacedCurrentLabel]
    : [spacedCurrentLabel]
}
