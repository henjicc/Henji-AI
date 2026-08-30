import { registry } from '@/core/ModelRegistry'
import { analyzeRatioResolutionParams } from '@/core/params/ratioResolution'
import type { ModelTag } from '@/core/types'
import { collectInputMediaByKind } from '@/features/canvas/application/graphMediaResolver'
import { createStoryboardGenerationResumeContext } from '@/features/canvas/application/storyboardGenerationOutputService'
import {
  collectInputValues,
  getConnectedParamIds,
} from '@/features/canvas/application/graphValueResolver'
import { getDefaultModelId } from '@/features/canvas/domain/defaultModels'
import type { StoryboardGenNodeData } from '@/features/canvas/domain/canvasNodes'
import { MODEL_PARAM_ID } from '@/features/canvas/domain/socketTypes'
import { resolveNodeModelExecutionParamValues } from '@/features/canvas/params/useNodeModelParams'
import { useCanvasStore } from '@/stores/canvasStore'
import { useSettingsStore } from '@/stores/settingsStore'

import { buildStoryboardPrompt } from './generation'
import { buildFrameDescriptionDrafts } from './shared'

export const STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS: ModelTag[] = ['image-to-image']

export function resolveStoryboardExecutionInput(nodeId: string) {
  const canvas = useCanvasStore.getState()
  const latestNode = canvas.nodes.find((node) => node.id === nodeId)
  if (!latestNode) throw new Error(`画布执行节点不存在：${nodeId}`)
  const data = latestNode.data as StoryboardGenNodeData
  const injectedValues = collectInputValues(nodeId, canvas.nodes, canvas.edges)
  const connectedParamIds = getConnectedParamIds(nodeId, canvas.edges)
  const storedModelId = typeof data.modelId === 'string' ? data.modelId.trim() : ''
  const storedModel = storedModelId ? registry.getModel(storedModelId) : undefined
  const selectedModelId = storedModel
    && STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS.every((tag) => storedModel.meta.tags?.includes(tag))
    ? storedModelId
    : getDefaultModelId('image', STORYBOARD_IMAGE_EDIT_REQUIRED_TAGS)
  const modelId = connectedParamIds.has(MODEL_PARAM_ID)
    && typeof injectedValues[MODEL_PARAM_ID] === 'string'
    ? injectedValues[MODEL_PARAM_ID] as string
    : selectedModelId
  const incomingImages = collectInputMediaByKind(nodeId, canvas.nodes, canvas.edges, 'image')
    .map((output) => output.url)
  const images = incomingImages.length > 0 ? incomingImages : (data.mediaInputs?.image ?? [])
  const paramValues = resolveNodeModelExecutionParamValues(
    modelId,
    data.params,
    { images },
  )
  const ratioSpec = analyzeRatioResolutionParams(registry.getSchema(modelId), images)
  const aspectValue = ratioSpec?.aspectParam?.id
    ? paramValues[ratioSpec.aspectParam.id]
    : undefined
  const frameAspectRatio = typeof aspectValue === 'string'
    && /^\d+\s*:\s*\d+$/.test(aspectValue.trim())
    ? aspectValue.trim()
    : data.aspectRatio || '1:1'
  const resolutionValue = ratioSpec?.resolutionParam?.id
    ? paramValues[ratioSpec.resolutionParam.id]
    : undefined
  const gridResolution = typeof resolutionValue === 'string' && resolutionValue
    ? resolutionValue
    : '2K'
  const settings = useSettingsStore.getState()
  const frameDescriptionDrafts = buildFrameDescriptionDrafts(data.frames)
  const resumeContext = createStoryboardGenerationResumeContext({
    gridRows: data.gridRows,
    gridCols: data.gridCols,
    frames: data.frames,
    frameDescriptionDrafts,
    ignoreAtTagWhenCopyingAndGenerating: settings.ignoreAtTagWhenCopyingAndGenerating,
  })
  const model = registry.getModel(modelId)

  return {
    data,
    injectedValues,
    modelId,
    model,
    images,
    paramValues,
    frameAspectRatio,
    gridResolution,
    frameDescriptionDrafts,
    resumeContext,
    providerConfigured: Boolean(
      model && settings.providerKeyStatus[model.meta.provider] === true,
    ),
    prompt: buildStoryboardPrompt({
      nodeData: data,
      frameDescriptionDrafts,
      keepStyleConsistent: settings.storyboardGenKeepStyleConsistent,
      disableTextInImage: settings.storyboardGenDisableTextInImage,
      autoInferEmptyFrame: settings.storyboardGenAutoInferEmptyFrame,
    }),
  }
}

export function getStoryboardExecutionSignatureExtras(): Record<string, unknown> {
  const settings = useSettingsStore.getState()
  return {
    contractVersion: 2,
    keepStyleConsistent: settings.storyboardGenKeepStyleConsistent,
    disableTextInImage: settings.storyboardGenDisableTextInImage,
    autoInferEmptyFrame: settings.storyboardGenAutoInferEmptyFrame,
    ignoreAtTagWhenCopyingAndGenerating: settings.ignoreAtTagWhenCopyingAndGenerating,
  }
}
