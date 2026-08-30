import { composeLocalRedraw, type LocalRedrawContext } from '@/commands/image'
import type { CanvasGenerationOutput } from '@/features/canvas/generation/runGeneration'
import type { CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import { createDefaultGenerationOutputItems } from '@/features/canvas/domain/generationOutputs'
import { commitCanvasGenerationOutputs } from './generationOutputApplicationService'

export const LOCAL_REDRAW_CONTEXT_FIELD = 'generationLocalRedrawContext'

export function parseLocalRedrawContext(value: unknown): LocalRedrawContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const context = value as Partial<LocalRedrawContext>
  if (context.version !== 2 || typeof context.source !== 'string' || typeof context.mask !== 'string') return null
  if (!context.crop || !context.settings) return null
  return context as LocalRedrawContext
}

interface CommitLocalRedrawGenerationInput {
  sourceNodeId?: string
  placeholderNodeId: string
  resultNodeType: CanvasNodeType
  completionId: string
  context: LocalRedrawContext
  result: CanvasGenerationOutput
}

export async function commitLocalRedrawGeneration(input: CommitLocalRedrawGenerationInput): Promise<{
  resultNodeIds: string[]
  idempotent?: boolean
}> {
  const generatedSource = input.result.outputs[0] ?? input.result.primary
  if (!generatedSource) throw new Error('局部重绘模型没有返回图片')
  const composed = await composeLocalRedraw({ generatedSource, context: input.context })
  return await commitCanvasGenerationOutputs({
    sourceNodeId: input.sourceNodeId,
    placeholderNodeId: input.placeholderNodeId,
    resultNodeType: input.resultNodeType,
    contract: {
      version: 1,
      strategy: 'single',
      resultKind: 'image',
      expectedOutputCount: 1,
      outputs: createDefaultGenerationOutputItems({
        sources: [composed.source],
        mediaType: 'image',
        resultKind: 'image',
        semanticKind: 'generated-media',
      }),
    },
    completionId: input.completionId,
  })
}
