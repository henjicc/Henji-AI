import type { ModelDefinition, ParamDef } from '@/core/types';
import { getI18nText } from '@/core/types/I18nText';
import i18n from '@/i18n';

import type { AspectRatioOption, ResolutionOption } from '../types';

type UnknownRecord = Record<string, unknown>;

const ASPECT_RATIO_KEYWORDS = ['aspect', 'ratio', 'image_size'];
const RESOLUTION_KEYWORDS = ['resolution', 'size', 'quality', 'image_size'];

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function getCurrentLocale(): string {
  return i18n.resolvedLanguage || i18n.language || 'zh-CN';
}

export function toDisplayText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (isRecord(value)) {
    const i18nText = value as Parameters<typeof getI18nText>[0];
    const translated = getI18nText(i18nText, getCurrentLocale()).trim();
    if (translated.length > 0) {
      return translated;
    }
  }

  return fallback;
}

function parseOptionEntry(entry: unknown): { value: string; label: string } | null {
  if (typeof entry === 'string' || typeof entry === 'number') {
    const value = String(entry).trim();
    if (!value) {
      return null;
    }
    return { value, label: value };
  }

  if (!isRecord(entry)) {
    return null;
  }

  const rawValue = entry.value ?? entry.id;
  if (typeof rawValue !== 'string' && typeof rawValue !== 'number') {
    return null;
  }

  const value = String(rawValue).trim();
  if (!value) {
    return null;
  }

  const label = toDisplayText(entry.label ?? entry.name, value);
  return {
    value,
    label: label.trim() || value,
  };
}

function parseOptions(input: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(input)) {
    return [];
  }

  const parsed: Array<{ value: string; label: string }> = [];
  for (const option of input) {
    const normalized = parseOptionEntry(option);
    if (!normalized) {
      continue;
    }
    parsed.push(normalized);
  }
  return parsed;
}

function dedupeOptions<T extends { value: string; label: string }>(options: T[]): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const option of options) {
    const key = option.value.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(option);
  }

  return deduped;
}

function matchesKeywords(param: ParamDef, keywords: string[]): boolean {
  const idText = param.id.toLowerCase();
  const apiFieldText = typeof param.apiField === 'string' ? param.apiField.toLowerCase() : '';
  const apiText = typeof param.api === 'string' ? param.api.toLowerCase() : '';

  return keywords.some((keyword) =>
    idText.includes(keyword) || apiFieldText.includes(keyword) || apiText.includes(keyword)
  );
}

function isAspectRatioValue(value: string): boolean {
  return /^(?:\d+(?:\.\d+)?:\d+(?:\.\d+)?|smart|auto)$/i.test(value.trim());
}

function extractChoiceOptions(param: ParamDef): Array<{ value: string; label: string }> {
  if (param.type === 'dropdown' || param.type === 'radio') {
    return parseOptions(param.options);
  }

  if (param.type === 'aspect-ratio') {
    return parseOptions(param.options.map((item) => ({ value: item.value, label: item.label })));
  }

  if (param.type === 'resolution') {
    return parseOptions(param.presets.map((preset) => ({
      value: preset.value,
      label: preset.label,
    })));
  }

  return [];
}

function extractCompositeConfig(param: ParamDef): UnknownRecord | null {
  if (param.type !== 'composite') {
    return null;
  }
  if (!isRecord(param.config)) {
    return null;
  }
  return param.config;
}

function extractCompositeOptions(
  config: UnknownRecord,
  key: string
): Array<{ value: string; label: string }> {
  const raw = config[key];
  if (Array.isArray(raw)) {
    return parseOptions(raw);
  }

  if (isRecord(raw)) {
    return parseOptions(raw.options);
  }

  return [];
}

function extractCompositePresetOptions(config: UnknownRecord): Array<{ value: string; label: string }> {
  const presets = config.presets;
  if (!Array.isArray(presets)) {
    return [];
  }

  const parsed: Array<{ value: string; label: string }> = [];
  for (const preset of presets) {
    if (!isRecord(preset)) {
      continue;
    }

    const width = Number(preset.width);
    const height = Number(preset.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      continue;
    }

    const value = `${Math.round(width)}x${Math.round(height)}`;
    const label = toDisplayText(preset.label, value);
    parsed.push({
      value,
      label: label.trim() || value,
    });
  }

  return parsed;
}

function extractCompositeDefaultValue(paramDefault: unknown, key: string): string | null {
  if (!isRecord(paramDefault)) {
    return null;
  }

  const value = paramDefault[key];
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null;
  }

  const normalized = String(value).trim();
  return normalized || null;
}

export function extractAspectRatioOptions(
  model: ModelDefinition,
  fallbackOptions: AspectRatioOption[]
): AspectRatioOption[] {
  const collected: AspectRatioOption[] = [];

  for (const param of model.params) {
    const isAspectParam =
      param.type === 'aspect-ratio' || matchesKeywords(param, ASPECT_RATIO_KEYWORDS);
    if (!isAspectParam) {
      continue;
    }

    for (const option of extractChoiceOptions(param)) {
      if (!isAspectRatioValue(option.value)) {
        continue;
      }
      collected.push(option);
    }

    const compositeConfig = extractCompositeConfig(param);
    if (compositeConfig) {
      for (const option of extractCompositeOptions(compositeConfig, 'aspectRatios')) {
        if (!isAspectRatioValue(option.value)) {
          continue;
        }
        collected.push(option);
      }
    }
  }

  const deduped = dedupeOptions(collected);
  return deduped.length > 0 ? deduped : fallbackOptions;
}

export function extractResolutionOptions(
  model: ModelDefinition,
  fallbackOptions: ResolutionOption[]
): ResolutionOption[] {
  const collected: ResolutionOption[] = [];

  for (const param of model.params) {
    const isResolutionParam =
      param.type === 'resolution' || matchesKeywords(param, RESOLUTION_KEYWORDS);
    if (!isResolutionParam || matchesKeywords(param, ASPECT_RATIO_KEYWORDS)) {
      if (param.type !== 'resolution') {
        continue;
      }
    }

    for (const option of extractChoiceOptions(param)) {
      collected.push(option);
    }

    const compositeConfig = extractCompositeConfig(param);
    if (compositeConfig) {
      for (const option of extractCompositeOptions(compositeConfig, 'qualityTiers')) {
        collected.push(option);
      }
      for (const option of extractCompositePresetOptions(compositeConfig)) {
        collected.push(option);
      }
    }
  }

  const deduped = dedupeOptions(collected);
  return deduped.length > 0 ? deduped : fallbackOptions;
}

export function extractPreferredAspectRatio(model: ModelDefinition): string | null {
  for (const param of model.params) {
    const isAspectParam =
      param.type === 'aspect-ratio' || matchesKeywords(param, ASPECT_RATIO_KEYWORDS);
    if (!isAspectParam) {
      continue;
    }

    if (typeof param.default === 'string' || typeof param.default === 'number') {
      const value = String(param.default).trim();
      if (value) {
        return value;
      }
    }

    const compositeDefault = extractCompositeDefaultValue(param.default, 'aspectRatio');
    if (compositeDefault) {
      return compositeDefault;
    }
  }

  return null;
}

export function extractPreferredResolution(model: ModelDefinition): string | null {
  for (const param of model.params) {
    const isResolutionParam =
      param.type === 'resolution' || matchesKeywords(param, RESOLUTION_KEYWORDS);
    if (!isResolutionParam || matchesKeywords(param, ASPECT_RATIO_KEYWORDS)) {
      if (param.type !== 'resolution') {
        continue;
      }
    }

    if (typeof param.default === 'string' || typeof param.default === 'number') {
      const value = String(param.default).trim();
      if (value) {
        return value;
      }
    }

    const quality = extractCompositeDefaultValue(param.default, 'quality');
    if (quality) {
      return quality;
    }

    const preset = extractCompositeDefaultValue(param.default, 'preset');
    if (preset) {
      return preset;
    }
  }

  return null;
}

export function pickDefaultValue(
  options: Array<{ value: string }>,
  preferredValue: string | null,
  fallbackValue: string
): string {
  if (preferredValue && options.some((option) => option.value === preferredValue)) {
    return preferredValue;
  }

  if (options.some((option) => option.value === fallbackValue)) {
    return fallbackValue;
  }

  return options[0]?.value ?? fallbackValue;
}
