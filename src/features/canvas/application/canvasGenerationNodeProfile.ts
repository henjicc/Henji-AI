import i18n from '@/i18n'
import { useCanvasStore } from '@/stores/canvasStore'
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '../domain/canvasNodes'
import { getCanvasNodeDefinition } from '../domain/nodeRegistry'
import { CANVAS_IMAGE_CAPABILITY_IDS, getCanvasImageCapability } from '../capabilities'
import { prepareImageEditNodeRuntime, resolveImageEditGenerationUi } from './imageEditNodePreparation'
import { prepareOutpaintGeneration } from './outpaintGenerationPreparation'
import { prepareUpscaleNodeRuntime } from './upscaleGenerationPreparation'
import { layerSeparationGenerationExecution } from './layerSeparationGenerationService'
import { localRedrawGenerationExecution } from './localRedrawGenerationService'
import type { GenerationNodeExecutionOptions } from './generationNodeExecutor'

const modelTypes: Partial<Record<CanvasNodeType, GenerationNodeExecutionOptions['modelType']>> = {
  [CANVAS_NODE_TYPES.imageEdit]: 'image', [CANVAS_NODE_TYPES.videoGen]: 'video',
  [CANVAS_NODE_TYPES.audioGen]: 'audio', [CANVAS_NODE_TYPES.upscaleGen]: 'image',
  [CANVAS_NODE_TYPES.panoramaGen]: 'image', [CANVAS_NODE_TYPES.layerSeparationGen]: 'image',
  [CANVAS_NODE_TYPES.elementEditGen]: 'image',
}

const messages: Partial<Record<CanvasNodeType, string>> = {
  [CANVAS_NODE_TYPES.imageEdit]: 'node.imageEdit', [CANVAS_NODE_TYPES.videoGen]: 'node.videoGen',
  [CANVAS_NODE_TYPES.audioGen]: 'node.audioGen', [CANVAS_NODE_TYPES.upscaleGen]: 'node.upscaleGeneration',
  [CANVAS_NODE_TYPES.panoramaGen]: 'node.panoramaGeneration',
  [CANVAS_NODE_TYPES.layerSeparationGen]: 'node.layerSeparationGeneration',
  [CANVAS_NODE_TYPES.elementEditGen]: 'node.elementEditGeneration',
}

export function supportsCanvasGenerationNodeProfile(nodeId: string, store = useCanvasStore): boolean {
  const node = store.getState().nodes.find(item => item.id === nodeId)
  return Boolean(node && modelTypes[node.type] && getCanvasNodeDefinition(node.type)?.generation)
}

/** 标准生成节点的无挂载配置；素材准备和扩图处理仍调用界面的正式实现。 */
export function readCanvasGenerationNodeProfile(nodeId: string, store = useCanvasStore): GenerationNodeExecutionOptions {
  const node = store.getState().nodes.find(item => item.id === nodeId)
  const imageCapabilityId = node?.type === CANVAS_NODE_TYPES.upscaleGen ? CANVAS_IMAGE_CAPABILITY_IDS.upscale
    : node?.type === CANVAS_NODE_TYPES.panoramaGen ? CANVAS_IMAGE_CAPABILITY_IDS.panorama
      : node?.type === CANVAS_NODE_TYPES.layerSeparationGen ? CANVAS_IMAGE_CAPABILITY_IDS.layerSeparation
        : node?.type === CANVAS_NODE_TYPES.elementEditGen ? CANVAS_IMAGE_CAPABILITY_IDS.elementEdit : undefined
  const modelType = node ? modelTypes[node.type] : undefined
  const definition = node ? getCanvasNodeDefinition(node.type) : undefined
  if (!node || !modelType || !definition?.generation) throw new Error('此节点没有标准生成执行入口，请选择图片、视频或音频生成节点。')
  const acceptedKinds = definition.ports?.target?.accepts ?? []
  const ui = resolveImageEditGenerationUi(node.data)
  const isOutpaint = modelType === 'image' && ui.workbenchEditor === 'outpaint'
  const t = i18n.t.bind(i18n)
  const message = messages[node.type]!
  return {
    nodeId, modelType, resultNodeType: definition.generation.resultNodeType as CanvasNodeType,
    acceptedKinds, acceptedMediaKinds: (['image', 'video', 'audio'] as const).filter(kind => acceptedKinds.includes(kind)),
    capability: isOutpaint ? getCanvasImageCapability(CANVAS_IMAGE_CAPABILITY_IDS.outpaint)
      : imageCapabilityId ? getCanvasImageCapability(imageCapabilityId) : null,
    showModelInput: Boolean(imageCapabilityId) || modelType !== 'image' || isOutpaint || ui.modelMode !== 'locked',
    requirePrompt: node.type === CANVAS_NODE_TYPES.elementEditGen || (!imageCapabilityId && (modelType !== 'image' || ui.promptMode === 'required')),
    promptRequiredKey: `${message}.promptRequired`,
    apiKeyRequiredKey: `${imageCapabilityId ? message : 'node.imageEdit'}.apiKeyRequired`,
    resultTitleKey: `${message}.resultTitle`, setPromptInvalid: () => undefined, t,
    ...(modelType === 'image' ? {
      resultNodeExtraData: { resultKind: node.type === CANVAS_NODE_TYPES.panoramaGen ? 'panorama' : 'generic' },
      prepareRuntimeParams: node.type === CANVAS_NODE_TYPES.upscaleGen ? prepareUpscaleNodeRuntime
        : node.type === CANVAS_NODE_TYPES.imageEdit ? context => prepareImageEditNodeRuntime(context, { isOutpaint, excludeParamIds: ui.excludeParamIds, t }) : undefined,
      prepareGenerationRequest: isOutpaint ? prepareOutpaintGeneration : undefined,
    } : {}),
    ...(node.type === CANVAS_NODE_TYPES.layerSeparationGen ? layerSeparationGenerationExecution : {}),
    ...(node.type === CANVAS_NODE_TYPES.elementEditGen ? localRedrawGenerationExecution : {}),
  }
}
