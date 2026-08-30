import { CANVAS_NODE_TYPES } from '../domain/canvasNodes'
import type { CanvasImageCapabilityDefinition } from './types'

const IMAGE_SOURCE = {
  mediaTypes: ['image'],
  minCount: 1,
  maxCount: 1,
  requireMaterializedMedia: true,
} as const

export function createFalUtilityCapability(options: {
  id: CanvasImageCapabilityDefinition['id']
  titleKey: string
  descriptionKey: string
  group: CanvasImageCapabilityDefinition['group']
  icon: CanvasImageCapabilityDefinition['icon']
  order: number
  modelId: string
  promptMode?: 'optional' | 'hidden'
  promptMaxCharacters?: number
}): CanvasImageCapabilityDefinition {
  return {
    id: options.id,
    titleKey: options.titleKey,
    descriptionKey: options.descriptionKey,
    group: options.group,
    groupLabelKey: `imageCapabilities.groups.${options.group}`,
    icon: options.icon,
    order: options.order,
    source: IMAGE_SOURCE,
    node: { kind: 'standard-generation', editor: 'standard' },
    implementation: {
      status: 'implemented',
      execution: {
        kind: 'canvas-node',
        nodeType: CANVAS_NODE_TYPES.imageEdit,
        useLocalizedDisplayName: true,
        initialData: {
          modelId: options.modelId,
          params: {},
          generationUi: {
            promptMode: options.promptMode ?? 'hidden',
            modelMode: 'locked',
            layoutMode: 'workbench',
            excludeParamIds: ['image'],
            ...(options.promptMaxCharacters
              ? { promptMaxCharacters: options.promptMaxCharacters }
              : {}),
          },
        },
      },
    },
    availability: {
      releaseStage: 'available',
      defaultEnabled: true,
      unavailableReasonKey: null,
    },
    modelPolicy: { mode: 'not-applicable' },
    promptPolicy: {
      hiddenTemplateVersion: null,
      fixedSemanticParams: {},
      visibleParameterKeys: [],
    },
    outputPolicy: {
      resultKind: 'image',
      count: { mode: 'single' },
      postProcess: 'none',
      failureMode: 'single-result',
    },
  }
}
