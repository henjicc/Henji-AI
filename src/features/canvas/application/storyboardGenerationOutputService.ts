import { embedStoryboardImageMetadata } from '@/commands/image'
import { createLogger } from '@/core/logging'

import { createStoryboardGridOutputContract } from '../capabilities/nineGridPolicy'
import type { StoryboardGenNodeData } from '../domain/canvasNodes'
import type { CanvasGenerationOutputBatchContractV1 } from '../domain/generationOutputs'
import { prepareNodeImage } from './imageData'
import { sanitizeStoryboardText } from './storyboardText'

const logger = createLogger('features.canvas.storyboard-generation-output')

export const STORYBOARD_GENERATION_RESUME_CONTEXT_FIELD = 'storyboardGenerationResumeContext'

export type StoryboardGenerationResumeContextV1 = DynamicValueMap & {
  version: 1
  gridRows: number
  gridCols: number
  frameNotes: string[]
}

export function createStoryboardGenerationResumeContext(input: {
  gridRows: number
  gridCols: number
  frames: StoryboardGenNodeData['frames']
  frameDescriptionDrafts: Record<string, string>
  ignoreAtTagWhenCopyingAndGenerating: boolean
}): StoryboardGenerationResumeContextV1 {
  const gridRows = Math.max(1, Math.floor(input.gridRows))
  const gridCols = Math.max(1, Math.floor(input.gridCols))
  return {
    version: 1,
    gridRows,
    gridCols,
    frameNotes: input.frames
      .slice(0, gridRows * gridCols)
      .map((frame) => sanitizeStoryboardText(
        input.frameDescriptionDrafts[frame.id] ?? frame.description,
        input.ignoreAtTagWhenCopyingAndGenerating,
      )),
  }
}

export function parseStoryboardGenerationResumeContext(
  value: DynamicValue,
): StoryboardGenerationResumeContextV1 | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as DynamicValueMap
  if (
    record.version !== 1
    || typeof record.gridRows !== 'number'
    || !Number.isInteger(record.gridRows)
    || record.gridRows < 1
    || typeof record.gridCols !== 'number'
    || !Number.isInteger(record.gridCols)
    || record.gridCols < 1
    || !Array.isArray(record.frameNotes)
    || record.frameNotes.some((note) => typeof note !== 'string')
    || record.frameNotes.length > record.gridRows * record.gridCols
  ) return null
  return {
    version: 1,
    gridRows: record.gridRows,
    gridCols: record.gridCols,
    frameNotes: [...record.frameNotes] as string[],
  }
}

export async function prepareStoryboardGenerationOutputContract(input: {
  outputs: readonly string[]
  context: StoryboardGenerationResumeContextV1
}): Promise<CanvasGenerationOutputBatchContractV1> {
  let sources = [...input.outputs]
  if (sources.length === 1) {
    const prepared = await prepareNodeImage(sources[0])
    const imageWithMetadata = await embedStoryboardImageMetadata(prepared.imageUrl, {
      gridRows: input.context.gridRows,
      gridCols: input.context.gridCols,
      frameNotes: input.context.frameNotes,
    }).catch((error) => {
      logger.warn('分镜生成结果元数据嵌入失败', error, {
        event: 'canvas.storyboard_generation.metadata_embed.failed',
        context: {
          gridRows: input.context.gridRows,
          gridCols: input.context.gridCols,
        },
      })
      return prepared.imageUrl
    })
    sources = [imageWithMetadata]
  }

  return createStoryboardGridOutputContract({
    sources,
    rows: input.context.gridRows,
    cols: input.context.gridCols,
    frameNotes: input.context.frameNotes,
  })
}
