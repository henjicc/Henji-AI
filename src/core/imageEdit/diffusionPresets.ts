import { createDefaultDiffusionOperationParams } from './diffusionParams';
import type { DiffusionOperationParams } from './types';

export type DiffusionPresetId = 'black-mist-soft' | 'white-mist-soft' | 'glow-soft';

export interface DiffusionPresetDefinition {
  id: DiffusionPresetId;
  mode: DiffusionOperationParams['mode'];
  apply: (base: DiffusionOperationParams) => DiffusionOperationParams;
}

const DIFFUSION_PRESETS: readonly DiffusionPresetDefinition[] = [
  {
    id: 'black-mist-soft',
    mode: 'black_mist',
    apply: (base) => ({
      ...base,
      mode: 'black_mist',
      presetId: 'black-mist-soft',
      strength: 0.35,
      density: '1/4',
      scatter: { ...base.scatter, highlightAmount: 0.12, farRadius: 0.045, tailAmount: 0.06 },
      tone: { ...base.tone, veil: 0.012, blackRetention: 0.92 },
    }),
  },
  {
    id: 'white-mist-soft',
    mode: 'white_mist',
    apply: (base) => ({
      ...base,
      mode: 'white_mist',
      presetId: 'white-mist-soft',
      strength: 0.28,
      density: '1/4',
      scatter: { ...base.scatter, highlightAmount: 0.1, farRadius: 0.04, tailAmount: 0.04 },
      tone: { ...base.tone, veil: 0.024, blackRetention: 0.96 },
    }),
  },
  {
    id: 'glow-soft',
    mode: 'glow',
    apply: (base) => ({
      ...base,
      mode: 'glow',
      presetId: 'glow-soft',
      strength: 0.42,
      density: '1/2',
      scatter: { ...base.scatter, highlightAmount: 0.18, microAmount: 0.025, farRadius: 0.06, tailAmount: 0.1 },
      tone: { ...base.tone, veil: 0.018, highlightCompression: 0.12 },
    }),
  },
];

export function listDiffusionPresets(): readonly DiffusionPresetDefinition[] {
  return DIFFUSION_PRESETS;
}

export function applyDiffusionPreset(presetId: DiffusionPresetId): DiffusionOperationParams {
  const preset = DIFFUSION_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) throw new Error(`未知柔光预设：${presetId}`);
  return preset.apply(createDefaultDiffusionOperationParams());
}
