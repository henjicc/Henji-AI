import { createBuiltInImageEditRenderNodeRegistry } from './builtInRenderNodes';
import { listImagingEffects } from '../../imaging/effects/registry';
import type { ImageEditJsonObjectV3 } from './layerTypes';

export interface ImageEditLayerOperationDefinitionV3 {
  readonly operationId: string;
  readonly renderDefinitionId: string;
  readonly layerType: 'effect' | 'adjustment';
  readonly creatable: boolean;
}

export function listImageEditLayerOperationsV3(): ImageEditLayerOperationDefinitionV3[] {
  return createBuiltInImageEditRenderNodeRegistry().list().flatMap(definition => definition.operation
    ? [{ operationId: definition.operation.id, renderDefinitionId: definition.id,
      layerType: definition.operation.layerType, creatable: definition.operation.creatable }] : []);
}

export function imageEditRenderDefinitionIdForOperationV3(operationId: string, layerType: 'effect' | 'adjustment'): string {
  return listImageEditLayerOperationsV3().find(entry => entry.operationId === operationId && entry.layerType === layerType)?.renderDefinitionId
    ?? (layerType === 'adjustment' ? `adjustment.${operationId}` : operationId);
}

export function listCreatableImageEditOperationIdsV3(layerType: 'effect' | 'adjustment'): string[] {
  return listImageEditLayerOperationsV3().filter(entry => entry.layerType === layerType && entry.creatable).map(entry => entry.operationId);
}

/** 创建和通用写入都使用共享参数 schema，开发期不接受旧高斯字段。 */
export function parseImageEditSharedEffectParametersV3(operationId: string, parameters: ImageEditJsonObjectV3): ImageEditJsonObjectV3 {
  const descriptor = listImagingEffects().find(effect => effect.id === operationId && effect.hosts.includes('image'));
  return descriptor ? descriptor.parameterSchema.parse(parameters) as ImageEditJsonObjectV3 : parameters;
}

export function createImageEditOperationParametersV3(operationId: string, workingSpace = 'srgb'): ImageEditJsonObjectV3 {
  const definition = createBuiltInImageEditRenderNodeRegistry().list().find(node => node.operation?.id === operationId);
  if (!definition?.operation) throw new Error(`没有登记图片操作：${operationId}`);
  return parseImageEditSharedEffectParametersV3(operationId, JSON.parse(JSON.stringify(definition.operation.defaults?.(workingSpace) ?? {})) as ImageEditJsonObjectV3);
}
