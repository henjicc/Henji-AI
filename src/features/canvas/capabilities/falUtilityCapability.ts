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
  workbenchEditor?: 'outpaint'
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
    node: { kind: options.workbenchEditor ? 'special-generation' : 'standard-generation', editor: 'standard' },
    implementation: {
      status: 'implemented',
      execution: {
        kind: 'canvas-node',
        nodeType: CANVAS_NODE_TYPES.imageEdit,
        useLocalizedDisplayName: true,
        initialData: {
          modelId: options.modelId,
          params: options.workbenchEditor ? { zoomOutPercentage: 0 } : {},
          generationUi: {
            promptMode: options.promptMode ?? 'hidden',
            modelMode: options.workbenchEditor ? 'selectable' : 'locked',
            layoutMode: options.workbenchEditor ? 'workbench' : 'stacked',
            ...(options.workbenchEditor ? { workbenchEditor: options.workbenchEditor } : {}),
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
    modelPolicy: options.workbenchEditor
      ? { mode: 'node-schema', requiredTags: ['image-to-image'], additionalModelIds: [options.modelId] }
      : { mode: 'not-applicable' },
    promptPolicy: {
      hiddenTemplateVersion: null,
      fixedSemanticParams: {},
      visibleParameterKeys: [],
      ...(options.workbenchEditor ? { showAllModelParameters: true } : {}),
    },
    outputPolicy: {
      resultKind: 'image',
      count: options.workbenchEditor ? { mode: 'dynamic', minCount: 1, maxCount: 64 } : { mode: 'single' },
      postProcess: 'none',
      failureMode: 'single-result',
    },
  }
}
