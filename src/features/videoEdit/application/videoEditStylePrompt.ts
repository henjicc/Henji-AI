import { cachedMemory } from '@/services/assistantMemory/memoryState'
import { styleGuideGenerationPrompt } from '@/core/videoEdit/styles/styleGuide'
import type { VideoEditStyle } from '@/core/videoEdit/styles/styleSchemas'
import type { VideoEditDocument, VideoEditSequence } from '@/core/videoEdit/document'

/** 序列绑定的工程风格副本；没有绑定时为 undefined，绑定指向缺失的副本时报错（文档 schema 已保证不会发生）。 */
export function boundVideoEditStyle(document: Pick<VideoEditDocument, 'styles'>, sequence: Pick<VideoEditSequence, 'styleId'>): VideoEditStyle | undefined {
  if (!sequence.styleId) return undefined
  const style = document.styles?.find(value => value.id === sequence.styleId)
  if (!style) throw new Error('绑定的风格副本不存在，请重新绑定风格。')
  return style
}
/** 原地生成画面时并入提示词的一两句（说明书的“画面生成提示”栏）；没有时为空。 */
export function videoEditStyleGenerationPrompt(document: Pick<VideoEditDocument, 'styles'>, sequence: Pick<VideoEditSequence, 'styleId'> | undefined): { name: string; prompt: string } | undefined {
  const style = sequence ? boundVideoEditStyle(document, sequence) : undefined
  const guide = style ? styleGuideGenerationPrompt(style.guide) : ''
  const preferences = cachedMemory()?.settings.enabled ? style?.userPreferences?.map(entry => entry.content).join('；') : ''
  const prompt = [guide, preferences ? `使用者偏好：${preferences}` : ''].filter(Boolean).join('\n')
  return style && prompt ? { name: style.name, prompt } : undefined
}

