import type { PromptMediaBinding } from '@/core/inputs/promptDocument'

const MEDIA_URL_FIELDS = ['imageUrl', 'previewImageUrl', 'videoUrl', 'audioUrl'] as const
const MEDIA_INPUT_KINDS = ['image', 'video', 'audio'] as const

export type CanvasNodeMediaValueMapper = (value: string) => string

/** 遍历节点全部可落盘媒体值；结构化文档本身只保存 resourceId。 */
export function mapCanvasNodeMediaReferences(
  data: DynamicValueMap,
  mapValue: CanvasNodeMediaValueMapper,
): DynamicValueMap {
  const next: DynamicValueMap = { ...data }

  MEDIA_URL_FIELDS.forEach((field) => {
    const value = next[field]
    if (typeof value === 'string' && value) next[field] = mapValue(value)
  })

  if (Array.isArray(next.frames)) {
    next.frames = next.frames.map((frame) => {
      if (!frame || typeof frame !== 'object') return frame
      const frameRecord = { ...(frame as DynamicValueMap) }
      ;(['imageUrl', 'previewImageUrl'] as const).forEach((field) => {
        const value = frameRecord[field]
        if (typeof value === 'string' && value) frameRecord[field] = mapValue(value)
      })
      return frameRecord
    })
  }

  if (next.mediaInputs && typeof next.mediaInputs === 'object') {
    const inputs = { ...(next.mediaInputs as DynamicValueMap) }
    MEDIA_INPUT_KINDS.forEach((kind) => {
      const values = inputs[kind]
      if (Array.isArray(values)) {
        inputs[kind] = values.map((value) => (
          typeof value === 'string' && value ? mapValue(value) : value
        ))
      }
    })
    next.mediaInputs = inputs
  }

  if (Array.isArray(next.promptMediaBindings)) {
    next.promptMediaBindings = next.promptMediaBindings.map((binding) => {
      if (!binding || typeof binding !== 'object') return binding
      const nextBinding = { ...(binding as PromptMediaBinding) }
      if (typeof nextBinding.dataUrl === 'string' && nextBinding.dataUrl) {
        nextBinding.dataUrl = mapValue(nextBinding.dataUrl)
      }
      if (typeof nextBinding.filePath === 'string' && nextBinding.filePath) {
        nextBinding.filePath = mapValue(nextBinding.filePath)
      }
      return nextBinding
    })
  }

  return next
}
