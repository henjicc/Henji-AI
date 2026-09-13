import i18n from '@/i18n'
import { registry } from '@/core/ModelRegistry'
import { getSupportedAspectRatios } from '@/core/params/ratioResolution'
import { normalizeLocalRedrawSettings, prepareElementEditPreflight } from '../capabilities/elementEditPolicy'
import type { ElementEditGenerationNodeData } from '../domain/canvasNodes'
import type { GenerationNodeExecutionOptions } from './generationNodeExecutor'
import type { GenerationNodeRequestPreparation, GenerationNodeResultCommitContext, GenerationNodeRuntimePreparationContext } from '../nodes/shared/generationNodeExecutionTypes'
import { composeLocalRedraw, prepareLocalRedraw, readImageInfo, type LocalRedrawContext } from '@/commands/image'
import type { CanvasGenerationOutput } from '@/features/canvas/generation/runGeneration'
import type { CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import { createDefaultGenerationOutputItems } from '@/features/canvas/domain/generationOutputs'
import { useProjectStore } from '@/stores/projectStore'
import { commitCanvasGenerationOutputsInProject } from './generationOutputApplicationService'

export const LOCAL_REDRAW_CONTEXT_FIELD = 'generationLocalRedrawContext'

export function parseLocalRedrawContext(value: unknown): LocalRedrawContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const context = value as Partial<LocalRedrawContext>
  if (context.version !== 2 || typeof context.source !== 'string' || typeof context.mask !== 'string') return null
  if (!context.crop || !context.settings) return null
  return context as LocalRedrawContext
}

interface CommitLocalRedrawGenerationInput {
  projectId?: string
  signal?: AbortSignal
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
  input.signal?.throwIfAborted()
  const projectId = input.projectId ?? useProjectStore.getState().currentProjectId
  if (!projectId) throw new Error('未找到局部重绘的原画布项目')
  const generatedSource = input.result.outputs[0] ?? input.result.primary
  if (!generatedSource) throw new Error('局部重绘模型没有返回图片')
  const composed = await composeLocalRedraw({ generatedSource, context: input.context })
  input.signal?.throwIfAborted()
  return await commitCanvasGenerationOutputsInProject(projectId, {
    signal: input.signal,
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

/** 界面与无挂载任务共用裁剪、校验及原项目合成。 */
export const localRedrawGenerationExecution = {
  supportsBackgroundCompletion: true,
  prepareRuntimeParams: async ({
    data: runtimeData,
    images,
  }: GenerationNodeRuntimePreparationContext): Promise<DynamicValueMap> => {
    const latestData = runtimeData as ElementEditGenerationNodeData
    await prepareElementEditPreflight({
      images,
      maskSource: latestData.localRedrawMaskSource,
      maskDocument: latestData.localRedrawMaskDocument,
      readImageInfo,
    })
    return {}
  },

  prepareGenerationRequest: async ({
    data: runtimeData,
    images,
    videos,
    audios,
    params,
    modelId,
  }: GenerationNodeRuntimePreparationContext): Promise<GenerationNodeRequestPreparation> => {
    const latestData = runtimeData as ElementEditGenerationNodeData
    const mask = latestData.localRedrawMaskSource
    if (!mask || !images[0]) throw new Error(i18n.t('node.elementEditGeneration.missingInput'))
    const model = registry.getModel(modelId)
    const prepared = await prepareLocalRedraw({
      source: images[0],
      mask,
      settings: normalizeLocalRedrawSettings(latestData.localRedrawSettings),
      preferredAspectRatios: model ? getSupportedAspectRatios(model.params) : undefined,
    })
    return {
      requestId: prepared.context.requestId,
      createdFilePaths: prepared.createdFilePaths,
      params,
      inputs: { images: [prepared.cropSource], videos, audios },
      resultNodeData: { [LOCAL_REDRAW_CONTEXT_FIELD]: prepared.context as unknown as DynamicValue },
    }
  },

  commitGenerationResult: async (context: GenerationNodeResultCommitContext) => {
    const localRedrawContext = parseLocalRedrawContext(context.resultNodeData[LOCAL_REDRAW_CONTEXT_FIELD])
    if (!localRedrawContext) throw new Error(i18n.t('node.elementEditGeneration.missingContext'))
    return await commitLocalRedrawGeneration({
      projectId: context.projectId,
      signal: context.signal,
      sourceNodeId: context.sourceNodeId,
      placeholderNodeId: context.placeholderNodeId,
      resultNodeType: context.resultNodeType,
      completionId: context.completionId,
      context: localRedrawContext,
      result: context.result,
    })
  },

} satisfies Pick<GenerationNodeExecutionOptions, 'prepareRuntimeParams' | 'prepareGenerationRequest' | 'commitGenerationResult' | 'supportsBackgroundCompletion'>
