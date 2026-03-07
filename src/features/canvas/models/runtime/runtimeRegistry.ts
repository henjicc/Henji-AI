import { registry as coreRegistry } from '@/core/ModelRegistry';
import type { ModelDefinition } from '@/core/types';
import i18n from '@/i18n';

import type {
  AspectRatioOption,
  ImageModelDefinition,
  ModelProviderDefinition,
  ResolutionOption,
} from '../types';
import { toCanvasImageModel, toProviderDefinition } from './modelMappers';

const fallbackProviderModules = import.meta.glob<{ provider: ModelProviderDefinition }>(
  '../providers/*.ts',
  { eager: true }
);
const fallbackModelModules = import.meta.glob<{ imageModel: ImageModelDefinition }>(
  '../image/**/*.ts',
  { eager: true }
);

const fallbackProviders: ModelProviderDefinition[] = Object.values(fallbackProviderModules)
  .map((module) => module.provider)
  .filter((provider): provider is ModelProviderDefinition => Boolean(provider))
  .sort((a, b) => a.id.localeCompare(b.id));

const fallbackImageModels: ImageModelDefinition[] = Object.values(fallbackModelModules)
  .map((module) => module.imageModel)
  .filter((model): model is ImageModelDefinition => Boolean(model))
  .sort((a, b) => a.id.localeCompare(b.id));

const FALLBACK_RESOLUTIONS: ResolutionOption[] = [
  { value: '0.5K', label: '0.5K' },
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

const FALLBACK_ASPECT_RATIOS: AspectRatioOption[] = [
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
  { value: '4:3', label: '4:3' },
  { value: '3:4', label: '3:4' },
  { value: '21:9', label: '21:9' },
];

const DEFAULT_MODEL_DURATION_MS = 60_000;
const DEFAULT_MODEL_DESCRIPTION = '图像生成模型';

const LEGACY_IMAGE_MODEL_ALIASES = ['ppio/gemini-3.1-flash', 'gemini-3.1-flash', 'gemini-3.1-flash-edit'];

const PREFERRED_DEFAULT_MODEL_IDS = [
  'fal-ai-nano-banana',
  'fal-ai-nano-banana-pro',
  'kie-nano-banana-pro',
  'ppio-seedream-4.5',
  'ppio-seedream-4.0',
];

const KNOWN_PROVIDER_DISPLAY: Record<string, { name: string; label: string }> = {
  ppio: { name: 'PPIO', label: '派欧云' },
  fal: { name: 'Fal', label: 'Fal' },
  kie: { name: 'KIE', label: 'KIE' },
  modelscope: { name: 'ModelScope', label: 'ModelScope' },
};

export interface RuntimeRegistrySnapshot {
  defaultModelId: string;
  imageModels: ImageModelDefinition[];
  providers: ModelProviderDefinition[];
  imageModelMap: Map<string, ImageModelDefinition>;
  providerMap: Map<string, ModelProviderDefinition>;
  aliasMap: Map<string, string>;
}

let snapshotCache: RuntimeRegistrySnapshot | null = null;
let snapshotSignature = '';

function getCurrentLocale(): string {
  return i18n.resolvedLanguage || i18n.language || 'zh-CN';
}

function resolveDefaultModelId(imageModels: ImageModelDefinition[]): string {
  for (const preferredId of PREFERRED_DEFAULT_MODEL_IDS) {
    if (imageModels.some((model) => model.id === preferredId)) {
      return preferredId;
    }
  }

  return imageModels[0]?.id ?? fallbackImageModels[0]?.id ?? 'fallback-image-model';
}

function buildAliasMap(
  sourceModels: ModelDefinition[],
  imageModels: ImageModelDefinition[],
  defaultModelId: string
): Map<string, string> {
  const aliasMap = new Map<string, string>();

  for (const model of imageModels) {
    aliasMap.set(model.id, model.id);

    if (model.id.includes('/')) {
      const shortId = model.id.split('/').pop();
      if (shortId && !aliasMap.has(shortId)) {
        aliasMap.set(shortId, model.id);
      }
    }
  }

  for (const sourceModel of sourceModels) {
    const canonicalId = sourceModel.meta.id;
    for (const alias of sourceModel.meta.aliases ?? []) {
      aliasMap.set(alias, canonicalId);
      if (alias.includes('/')) {
        const shortAlias = alias.split('/').pop();
        if (shortAlias && !aliasMap.has(shortAlias)) {
          aliasMap.set(shortAlias, canonicalId);
        }
      }
    }
  }

  for (const alias of LEGACY_IMAGE_MODEL_ALIASES) {
    aliasMap.set(alias, defaultModelId);
  }

  return aliasMap;
}

function buildRuntimeSnapshot(): RuntimeRegistrySnapshot {
  const sourceModels = coreRegistry
    .getModelsByType('image')
    .filter((model) => model.meta.type === 'image');

  const imageModels = sourceModels.length > 0
    ? sourceModels
      .map((model) =>
        toCanvasImageModel(model, {
          fallbackAspectRatios: FALLBACK_ASPECT_RATIOS,
          fallbackResolutions: FALLBACK_RESOLUTIONS,
          defaultDescription: DEFAULT_MODEL_DESCRIPTION,
          defaultDurationMs: DEFAULT_MODEL_DURATION_MS,
        })
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans-CN'))
    : fallbackImageModels;

  const defaultModelId = resolveDefaultModelId(imageModels);

  const providerIds = Array.from(new Set(imageModels.map((model) => model.providerId)));
  const providers = (providerIds.length > 0
    ? providerIds.map((providerId) => toProviderDefinition(providerId, KNOWN_PROVIDER_DISPLAY))
    : fallbackProviders
  ).sort((a, b) => a.id.localeCompare(b.id));

  const imageModelMap = new Map<string, ImageModelDefinition>(
    imageModels.map((model) => [model.id, model])
  );
  const providerMap = new Map<string, ModelProviderDefinition>(
    providers.map((provider) => [provider.id, provider])
  );

  const aliasMap = buildAliasMap(sourceModels, imageModels, defaultModelId);

  return {
    defaultModelId,
    imageModels,
    providers,
    imageModelMap,
    providerMap,
    aliasMap,
  };
}

export function getRuntimeRegistrySnapshot(): RuntimeRegistrySnapshot {
  const locale = getCurrentLocale();
  const stats = coreRegistry.getStats();
  const signature = `${stats.totalEntries}:${stats.imageModels}:${locale}`;

  if (snapshotCache && snapshotSignature === signature) {
    return snapshotCache;
  }

  snapshotSignature = signature;
  snapshotCache = buildRuntimeSnapshot();
  return snapshotCache;
}
