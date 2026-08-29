import { prepareNodeImage } from './imageData'
import {
  commitCanvasGenerationOutputs,
  type CommitCanvasGenerationOutputsInput,
  type CommitCanvasGenerationOutputsResult,
} from './generationOutputApplicationService'
import { createGridSplitCompletionId, createStoryboardGridOutputContract } from '../capabilities/nineGridPolicy'
import { CANVAS_NODE_TYPES, type StoryboardFrameItem } from '../domain/canvasNodes'

export interface CommitGridSplitResultInput {
  sourceNodeId: string
  sourceImageUrl: string
  rows: number
  cols: number
  lineThicknessPercent?: number
  frames: readonly StoryboardFrameItem[]
}

type CommitOutputs = (
  input: CommitCanvasGenerationOutputsInput,
) => Promise<CommitCanvasGenerationOutputsResult>

export async function commitGridSplitResult(
  input: CommitGridSplitResultInput,
  commitOutputs: CommitOutputs = commitCanvasGenerationOutputs,
): Promise<CommitCanvasGenerationOutputsResult> {
  const sources = input.frames.map((frame, index) => {
    if (typeof frame.imageUrl !== 'string' || !frame.imageUrl.trim()) {
      throw new Error(`宫格切分第 ${index + 1} 格缺少图片结果`)
    }
    return frame.imageUrl
  })
  const contract = createStoryboardGridOutputContract({
    sources,
    rows: input.rows,
    cols: input.cols,
    frameNotes: input.frames.map((frame) => frame.note),
  })
  if (contract.strategy !== 'assetGroup') {
    throw new Error('宫格切分必须生成完整素材组')
  }

  return await commitOutputs({
    sourceNodeId: input.sourceNodeId,
    resultNodeType: CANVAS_NODE_TYPES.exportImage,
    resultNodeData: { displayName: '宫格切分结果' },
    contract,
    completionId: createGridSplitCompletionId(input),
    groupTitle: `宫格切分 · ${input.rows}×${input.cols}`,
    persistOutput: async (_mediaType, source) => {
      const prepared = await prepareNodeImage(source)
      return {
        imageUrl: prepared.imageUrl,
        previewImageUrl: prepared.previewImageUrl,
        aspectRatio: prepared.aspectRatio,
      }
    },
  })
}
