export interface ImageEditLayerOperationDefinitionV3 {
  readonly operationId: string
  readonly renderDefinitionId: string
  readonly layerType: 'effect' | 'adjustment'
  readonly creatable: boolean
}

/** 图层操作到渲染节点的唯一映射；旧文档操作可保留但不会重新出现在创建入口。 */
export const IMAGE_EDIT_LAYER_OPERATION_CATALOG_V3: readonly ImageEditLayerOperationDefinitionV3[] = [
  { operationId: 'image.blur', renderDefinitionId: 'effect.blur-v1', layerType: 'effect', creatable: false },
  { operationId: 'image.fast-blur-v3', renderDefinitionId: 'effect.fast-blur', layerType: 'effect', creatable: true },
  { operationId: 'image.gaussian-blur-v2', renderDefinitionId: 'effect.gaussian-blur', layerType: 'effect', creatable: true },
  { operationId: 'image.diffusion', renderDefinitionId: 'effect.diffusion', layerType: 'effect', creatable: true },
  { operationId: 'image.vgpu-glow', renderDefinitionId: 'effect.vgpu-glow', layerType: 'effect', creatable: true },
  { operationId: 'exposure', renderDefinitionId: 'adjustment.exposure', layerType: 'adjustment', creatable: true },
  { operationId: 'curves', renderDefinitionId: 'adjustment.curves', layerType: 'adjustment', creatable: true },
  { operationId: 'temperature-tint', renderDefinitionId: 'adjustment.temperature-tint', layerType: 'adjustment', creatable: true },
  { operationId: 'hsl', renderDefinitionId: 'adjustment.hsl', layerType: 'adjustment', creatable: true },
]

export function imageEditRenderDefinitionIdForOperationV3(
  operationId: string,
  layerType: 'effect' | 'adjustment',
): string {
  return IMAGE_EDIT_LAYER_OPERATION_CATALOG_V3.find((entry) => (
    entry.operationId === operationId && entry.layerType === layerType
  ))?.renderDefinitionId ?? (layerType === 'adjustment' ? `adjustment.${operationId}` : operationId)
}

export function listCreatableImageEditOperationIdsV3(
  layerType: 'effect' | 'adjustment',
): string[] {
  return IMAGE_EDIT_LAYER_OPERATION_CATALOG_V3
    .filter((entry) => entry.layerType === layerType && entry.creatable)
    .map((entry) => entry.operationId)
}
