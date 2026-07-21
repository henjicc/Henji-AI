import { createLogger } from '@/core/logging'
import { embedStoryboardImageMetadata } from '@/commands/image'
import type { StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import { runCanvasGeneration } from '@/features/canvas/generation/runGeneration'
import { prepareNodeImage } from '@/features/canvas/application/imageData'
import { sanitizeStoryboardPromptText, sanitizeStoryboardText } from '@/features/canvas/application/storyboardText'
import { generateGridImageDataUrl } from './shared'

const logger = createLogger('features.canvas.nodes.storyboardGen.generation')

interface BuildStoryboardPromptParams {
  nodeData: StoryboardGenNodeData
  frameDescriptionDrafts: Record<string, string>
  keepStyleConsistent: boolean
  disableTextInImage: boolean
  autoInferEmptyFrame: boolean
}

interface GenerateStoryboardImageParams {
  modelId: string
  /** schema 参数 + prompt/text 协议键（智能宽高比由 GenerationService 解析） */
  params: DynamicValueMap
  incomingImages: string[]
  frameAspectRatioValue: string
  gridRows: number
  gridCols: number
  /** 栅格参考图绘制分辨率（如 '2K'） */
  gridImageResolution: string
  frames: StoryboardGenNodeData['frames']
  frameDescriptionDrafts: Record<string, string>
  ignoreAtTagWhenCopyingAndGenerating: boolean
  onProgress?: (progress: number) => void
}

export interface GeneratedStoryboardImage {
  imageUrl: string
  previewImageUrl: string
  aspectRatio: string
}

export function buildStoryboardPrompt({
  nodeData,
  frameDescriptionDrafts,
  keepStyleConsistent,
  disableTextInImage,
  autoInferEmptyFrame
}: BuildStoryboardPromptParams): string {
  const { gridRows, gridCols, frames } = nodeData
  const parts: string[] = []

  const promptDirectives: string[] = [
    `生成一张${gridRows}×${gridCols}的${gridRows * gridCols}宫格分镜图`,
  ]
  if (keepStyleConsistent) {
    promptDirectives.push('图片风格与参考图保持一致')
  }
  if (disableTextInImage) {
    promptDirectives.push('禁止添加描述文本')
  }
  parts.push(`${promptDirectives.join('，')}。`)

  frames.forEach((frame, index) => {
    const frameDescription = frameDescriptionDrafts[frame.id] ?? frame.description
    const sanitizedDescription = sanitizeStoryboardPromptText(frameDescription)
    if (!sanitizedDescription) {
      if (autoInferEmptyFrame) {
        parts.push(`分镜${index + 1}：依据前后内容进行推测`)
      }
      return
    }
    parts.push(`分镜${index + 1}：${sanitizedDescription}`)
  })

  return parts.join('\n')
}

export async function generateStoryboardImage({
  modelId,
  params,
  incomingImages,
  frameAspectRatioValue,
  gridRows,
  gridCols,
  gridImageResolution,
  frames,
  frameDescriptionDrafts,
  ignoreAtTagWhenCopyingAndGenerating,
  onProgress,
}: GenerateStoryboardImageParams): Promise<GeneratedStoryboardImage> {
  const gridImageDataUrl = generateGridImageDataUrl(
    frameAspectRatioValue,
    gridRows,
    gridCols,
    gridImageResolution
  )
  const allReferenceImages = [...incomingImages, gridImageDataUrl]

  const generated = await runCanvasGeneration({
    modelId,
    params,
    referenceImages: allReferenceImages,
    onProgress,
  })

  const prepared = await prepareNodeImage(generated.primary)
  const metadataFrameNotes = frames
    .slice(0, gridRows * gridCols)
    .map((frame) => {
      const description = frameDescriptionDrafts[frame.id] ?? frame.description
      return sanitizeStoryboardText(description, ignoreAtTagWhenCopyingAndGenerating)
    })
  const imageWithMetadata = await embedStoryboardImageMetadata(prepared.imageUrl, {
    gridRows,
    gridCols,
    frameNotes: metadataFrameNotes,
  }).catch((error) => {
    logger.warn('[StoryboardMetadata] embed failed on generation output', error)
    return prepared.imageUrl
  })
  const previewWithMetadata = prepared.previewImageUrl === prepared.imageUrl
    ? imageWithMetadata
    : prepared.previewImageUrl

  return {
    imageUrl: imageWithMetadata,
    previewImageUrl: previewWithMetadata,
    aspectRatio: prepared.aspectRatio,
  }
}

