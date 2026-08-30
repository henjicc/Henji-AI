import type { StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import { runCanvasGeneration } from '@/features/canvas/generation/runGeneration'
import { sanitizeStoryboardPromptText } from '@/features/canvas/application/storyboardText'
import { isNineGridStoryboard } from '@/features/canvas/capabilities/nineGridPolicy'
import type { CanvasGenerationOutputBatchContractV1 } from '@/features/canvas/domain/generationOutputs'
import {
  prepareStoryboardGenerationOutputContract,
  type StoryboardGenerationResumeContextV1,
} from '@/features/canvas/application/storyboardGenerationOutputService'
import { generateGridImageDataUrl } from './shared'

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
  resumeContext: StoryboardGenerationResumeContextV1
  /** 栅格参考图绘制分辨率（如 '2K'） */
  gridImageResolution: string
  onProgress?: (progress: number) => void
  onTaskId?: (taskId: string) => void
  assertCurrent?: () => Promise<void> | void
}

export interface GeneratedStoryboardImage {
  contract: CanvasGenerationOutputBatchContractV1
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
    isNineGridStoryboard(nodeData)
      ? '生成一组固定 3×3 的九宫格画面，九格按从左到右、从上到下的顺序表达内容'
      : `生成一张${gridRows}×${gridCols}的${gridRows * gridCols}宫格分镜图`,
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
  resumeContext,
  gridImageResolution,
  onProgress,
  onTaskId,
  assertCurrent,
}: GenerateStoryboardImageParams): Promise<GeneratedStoryboardImage> {
  const gridImageDataUrl = generateGridImageDataUrl(
    frameAspectRatioValue,
    resumeContext.gridRows,
    resumeContext.gridCols,
    gridImageResolution
  )
  const allReferenceImages = [...incomingImages, gridImageDataUrl]

  const generated = await runCanvasGeneration({
    modelId,
    params,
    referenceImages: allReferenceImages,
    onProgress,
    onTaskId,
    assertCurrent,
  })

  return {
    contract: await prepareStoryboardGenerationOutputContract({
      outputs: generated.outputs,
      context: resumeContext,
    }),
  }
}
