import { createLogger } from '@/core/logging'
import { embedStoryboardImageMetadata } from '@/commands/image'
import { AUTO_REQUEST_ASPECT_RATIO, type StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import { canvasAiGateway } from '@/features/canvas/application/canvasServices'
import { detectAspectRatio, parseAspectRatio, prepareNodeImage } from '@/features/canvas/application/imageData'
import { sanitizeStoryboardPromptText, sanitizeStoryboardText } from '@/features/canvas/application/storyboardText'
import { generateGridImageDataUrl, pickClosestAspectRatio } from './shared'

const logger = createLogger('features.canvas.nodes.storyboardGen.generation')

interface BuildStoryboardPromptParams {
  nodeData: StoryboardGenNodeData
  frameDescriptionDrafts: Record<string, string>
  keepStyleConsistent: boolean
  disableTextInImage: boolean
}

interface GenerateStoryboardImageParams {
  prompt: string
  providerId: string
  selectedAspectRatio: string
  incomingImages: string[]
  supportedAspectRatioValues: string[]
  frameAspectRatioValue: string
  gridRows: number
  gridCols: number
  selectedResolution: string
  requestModel: string
  extraParams: StoryboardGenNodeData['extraParams']
  frames: StoryboardGenNodeData['frames']
  frameDescriptionDrafts: Record<string, string>
  ignoreAtTagWhenCopyingAndGenerating: boolean
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
  disableTextInImage
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
      return
    }
    parts.push(`分镜${index + 1}：${sanitizedDescription}`)
  })

  return parts.join('\n')
}

export async function generateStoryboardImage({
  prompt,
  providerId: _providerId,
  selectedAspectRatio,
  incomingImages,
  supportedAspectRatioValues,
  frameAspectRatioValue,
  gridRows,
  gridCols,
  selectedResolution,
  requestModel,
  extraParams,
  frames,
  frameDescriptionDrafts,
  ignoreAtTagWhenCopyingAndGenerating,
}: GenerateStoryboardImageParams): Promise<GeneratedStoryboardImage> {
  let resolvedRequestAspectRatio = selectedAspectRatio
  if (resolvedRequestAspectRatio === AUTO_REQUEST_ASPECT_RATIO) {
    if (incomingImages.length > 0) {
      try {
        const sourceAspectRatio = await detectAspectRatio(incomingImages[0])
        const sourceAspectRatioValue = parseAspectRatio(sourceAspectRatio)
        resolvedRequestAspectRatio = pickClosestAspectRatio(
          sourceAspectRatioValue,
          supportedAspectRatioValues
        )
      } catch {
        resolvedRequestAspectRatio = pickClosestAspectRatio(1, supportedAspectRatioValues)
      }
    } else {
      resolvedRequestAspectRatio = pickClosestAspectRatio(1, supportedAspectRatioValues)
    }
  }

  const gridImageDataUrl = generateGridImageDataUrl(
    frameAspectRatioValue,
    gridRows,
    gridCols,
    selectedResolution
  )
  const allReferenceImages = [...incomingImages, gridImageDataUrl]

  const resultUrl = await canvasAiGateway.generateImage({
    prompt,
    model: requestModel,
    size: selectedResolution,
    aspectRatio: resolvedRequestAspectRatio,
    referenceImages: allReferenceImages,
    extraParams,
  })

  const prepared = await prepareNodeImage(resultUrl)
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

