// @vitest-environment jsdom

import { beforeAll, describe, expect, it } from 'vitest';

import { registry } from '@/core/ModelRegistry';
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels';

import { mapCanvasCapabilityModelParams, resolveCanvasCapabilityModelCandidates } from './modelCompatibility';
import {
  LAYER_SEPARATION_DEFAULT_MODEL_ID,
  LAYER_SEPARATION_MODEL_POLICY,
  selectDefaultLayerSeparationModel,
} from './layerSeparationPolicy';

beforeAll(async () => {
  await loadRealModelsIntoRegistry();
});

describe('layerSeparationPolicy', () => {
  it('只接受三家已核验 Seedream 图层拆分模型并固定各自真实 mode 参数', () => {
    const candidates = resolveCanvasCapabilityModelCandidates(
      registry.getModelsByType('image'),
      LAYER_SEPARATION_MODEL_POLICY,
    ).candidates;
    expect(candidates.map(({ model }) => model.meta.id)).toEqual(expect.arrayContaining([
      'volcengine-seedream-5.0-pro',
      'apimart-seedream-5.0-pro',
      'kie-seedream-5.0-pro',
    ]));
    for (const { model } of candidates) {
      const mapping = mapCanvasCapabilityModelParams(model, LAYER_SEPARATION_MODEL_POLICY);
      const mode = model.params.find((param) => param.transferKey === 'layer-decomposition-mode');
      expect(mapping.compatible).toBe(true);
      expect(mode && mapping.params[mode.id]).toBe('layer-decomposition');
    }
  });

  it('首版始终优先原厂火山，不把聚合渠道当自动重试', () => {
    expect(selectDefaultLayerSeparationModel(registry.getModelsByType('image'))?.meta.id)
      .toBe(LAYER_SEPARATION_DEFAULT_MODEL_ID);
  });
});
