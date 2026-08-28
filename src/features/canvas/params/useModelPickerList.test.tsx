// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registry } from '@/core/ModelRegistry';
import type { ModelDefinition } from '@/core/types';
import type { CanvasImageCapabilityModelPolicy } from '@/features/canvas/capabilities/types';
import { useModelPickerList } from './useModelPickerList';

function imageModel(id: string, canonicalModelId: string, provider: string): ModelDefinition {
  return {
    meta: {
      id,
      canonicalModelId,
      provider,
      type: 'image',
      name: { zh: id, en: id },
      tags: ['text-to-image'],
    },
    params: [],
    linkages: [],
    endpoints: '/generate',
    pricing: { currency: '$', fixed: 1 },
  };
}

const models = [
  imageModel('allowed', 'family-a', 'provider-a'),
  imageModel('rejected', 'family-b', 'provider-b'),
];

const policy: CanvasImageCapabilityModelPolicy = {
  mode: 'verified-families',
  allowedCanonicalFamilies: ['family-a'],
  requiredTags: ['text-to-image'],
  providerCompatibility: 'verified-combinations-only',
  allowedProviderConfigurations: [{ providerId: 'provider-a' }],
  semanticRequirements: {},
};

describe('useModelPickerList 能力约束', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function installRegistryMocks(): void {
    vi.spyOn(registry, 'getModelsByType').mockReturnValue(models);
    vi.spyOn(registry, 'getModel').mockImplementation((id) => models.find((model) => model.meta.id === id));
  }

  it('未传能力约束时保持历史模型列表行为', () => {
    installRegistryMocks();
    const { result } = renderHook(() => useModelPickerList({ mediaType: 'image', modelId: 'rejected' }));
    expect(result.current.models.map((model) => model.meta.id)).toEqual(['allowed', 'rejected']);
    expect(result.current.selectedModel?.meta.id).toBe('rejected');
    expect(result.current.hasCompatibleModels).toBe(true);
  });

  it('传入约束后只显示兼容候选并保留拒绝原因', () => {
    installRegistryMocks();
    const { result } = renderHook(() => useModelPickerList({
      mediaType: 'image',
      modelId: 'rejected',
      modelPolicy: policy,
    }));
    expect(result.current.models.map((model) => model.meta.id)).toEqual(['allowed']);
    expect(result.current.selectedModel?.meta.id).toBe('allowed');
    expect(result.current.rejectedModels[0].reasons.map(({ code }) => code))
      .toContain('canonical-family');

    act(() => result.current.setModelSearchQuery('missing'));
    expect(result.current.filteredModels).toEqual([]);
    expect(result.current.hasCompatibleModels).toBe(true);
  });
});
