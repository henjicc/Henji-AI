import type { ModelDefinition } from '@/core/types';

import type {
  AspectRatioOption,
  ImageModelDefinition,
  ModelProviderDefinition,
  ResolutionOption,
} from '../types';
import {
  extractAspectRatioOptions,
  extractPreferredAspectRatio,
  extractPreferredResolution,
  extractResolutionOptions,
  pickDefaultValue,
  toDisplayText,
} from './optionExtractors';

function resolveExpectedDurationMs(model: ModelDefinition, defaultDurationMs: number): number {
  const progress = model.meta.progress;
  if (progress?.mode === 'time') {
    return Math.max(8_000, Math.round(progress.baseDurationMs));
  }

  if (progress?.mode === 'polling') {
    const intervalMs = progress.intervalMs ?? model.meta.polling?.interval ?? 3_000;
    const attempts = progress.baseAttempts;
    return Math.max(10_000, Math.round(intervalMs * attempts));
  }

  if (model.meta.polling?.expectedAttempts) {
    return Math.max(
      10_000,
      Math.round(model.meta.polling.interval * model.meta.polling.expectedAttempts)
    );
  }

  return defaultDurationMs;
}

function formatEta(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return '1min';
  }

  const seconds = Math.max(1, Math.round(durationMs / 1_000));
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes}min`;
}

export interface CanvasModelMapperOptions {
  fallbackAspectRatios: AspectRatioOption[];
  fallbackResolutions: ResolutionOption[];
  defaultDescription: string;
  defaultDurationMs: number;
}

export function toCanvasImageModel(
  model: ModelDefinition,
  options: CanvasModelMapperOptions
): ImageModelDefinition {
  const aspectRatios = extractAspectRatioOptions(model, options.fallbackAspectRatios);
  const resolutions = extractResolutionOptions(model, options.fallbackResolutions);
  const preferredAspectRatio = extractPreferredAspectRatio(model);
  const preferredResolution = extractPreferredResolution(model);
  const expectedDurationMs = resolveExpectedDurationMs(model, options.defaultDurationMs);

  return {
    id: model.meta.id,
    mediaType: 'image',
    displayName: toDisplayText(model.meta.name, model.meta.id),
    providerId: model.meta.provider,
    description: toDisplayText(model.meta.description, options.defaultDescription),
    eta: formatEta(expectedDurationMs),
    expectedDurationMs,
    defaultAspectRatio: pickDefaultValue(aspectRatios, preferredAspectRatio, '1:1'),
    defaultResolution: pickDefaultValue(resolutions, preferredResolution, '2K'),
    aspectRatios,
    resolutions,
    resolveRequest: ({ referenceImageCount }) => ({
      requestModel: model.meta.id,
      modeLabel: referenceImageCount > 0 ? '编辑模式' : '生成模式',
    }),
  };
}

export function toProviderDefinition(
  providerId: string,
  providerDisplayMap: Record<string, { name: string; label: string }>
): ModelProviderDefinition {
  const known = providerDisplayMap[providerId.toLowerCase()];
  if (known) {
    return {
      id: providerId,
      name: known.name,
      label: known.label,
    };
  }

  const display = providerId.trim() || 'Unknown';
  return {
    id: providerId,
    name: display.toUpperCase(),
    label: display,
  };
}
