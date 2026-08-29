import { createPlainTextPromptDocument } from '@/core/inputs/promptDocument'
import { registry } from '@/core/ModelRegistry'
import type { ModelDefinition } from '@/core/types'
import { prepareRelightRoute, type RelightSettingsV1 } from '@/features/canvas/capabilities/relightPolicy'

export function buildRelightEditorDraft(
  state: Readonly<DynamicValueMap>,
  settings: RelightSettingsV1,
  imageModels: readonly ModelDefinition[] = registry.getModelsByType('image'),
): DynamicValueMap {
  const route = prepareRelightRoute(
    settings,
    imageModels,
    state.params && typeof state.params === 'object' ? state.params as DynamicValueMap : {},
  )
  const lightingReferences = settings.lightingMode === 'smart'
    ? settings.smart.lightingReferenceImages
    : []
  const mediaInputs = state.mediaInputs && typeof state.mediaInputs === 'object'
    ? state.mediaInputs as DynamicValueMap
    : {}
  return {
    ...state,
    relightSettings: settings,
    modelId: route.model?.meta.id ?? '',
    params: route.params,
    prompt: route.prompt,
    promptDocument: createPlainTextPromptDocument(route.prompt),
    promptTemplateVersion: route.templateVersion,
    mediaInputs: { ...mediaInputs, image: mediaInputs.image ?? [] },
    lightingReferenceImages: [...lightingReferences],
    relightRouteReasons: [...route.reasons],
  }
}
