import type { ImageModelDefinition, ModelProviderDefinition } from './types';
import { getRuntimeRegistrySnapshot } from './runtime/runtimeRegistry';

export function getDefaultImageModelId(): string {
  return getRuntimeRegistrySnapshot().defaultModelId;
}

export const DEFAULT_IMAGE_MODEL_ID = getDefaultImageModelId();

export function listImageModels(): ImageModelDefinition[] {
  return getRuntimeRegistrySnapshot().imageModels;
}

export function listModelProviders(): ModelProviderDefinition[] {
  return getRuntimeRegistrySnapshot().providers;
}

export function getImageModel(modelId: string): ImageModelDefinition {
  const snapshot = getRuntimeRegistrySnapshot();
  const requested = modelId.trim();
  const resolved = snapshot.aliasMap.get(requested) ?? requested;

  return (
    snapshot.imageModelMap.get(resolved)
    ?? snapshot.imageModelMap.get(snapshot.defaultModelId)
    ?? snapshot.imageModels[0]
  );
}

export function getModelProvider(providerId: string): ModelProviderDefinition {
  const snapshot = getRuntimeRegistrySnapshot();
  return (
    snapshot.providerMap.get(providerId) ?? {
      id: providerId || 'unknown',
      name: providerId ? providerId.toUpperCase() : 'Unknown Provider',
      label: providerId || 'Unknown',
    }
  );
}
