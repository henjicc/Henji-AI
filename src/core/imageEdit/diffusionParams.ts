import type {
  DiffusionDensity,
  DiffusionMode,
  DiffusionOperationParams,
  DiffusionQuality,
} from './types';

export class InvalidDiffusionOperationParamsError extends Error {}

const DIFFUSION_MODES: DiffusionMode[] = ['black_mist', 'white_mist', 'glow'];
const DIFFUSION_DENSITIES: DiffusionDensity[] = ['1/8', '1/4', '1/2', '1'];
const DIFFUSION_QUALITIES: DiffusionQuality[] = ['realtime', 'high'];

export function createDefaultDiffusionOperationParams(): DiffusionOperationParams {
  return {
    schemaVersion: 1,
    mode: 'black_mist',
    presetId: null,
    strength: 0.35,
    density: '1/4',
    source: {
      thresholdEV: 1.8,
      softKneeEV: 0.8,
      power: 1.2,
      highlightRecovery: 0.25,
    },
    scatter: {
      highlightAmount: 0.12,
      microAmount: 0.018,
      nearRadius: 0.003,
      farRadius: 0.045,
      tailAmount: 0.06,
      tailShape: 2.4,
      anisotropy: 0,
      angle: 0,
      chromaticSpread: 0.002,
    },
    tone: {
      veil: 0.012,
      blackRetention: 0.92,
      highlightCompression: 0.08,
      scatterDesaturation: 0.04,
    },
    detail: {
      highFrequencyRetention: 0.94,
      midFrequencyRetention: 0.99,
    },
    lens: {
      focalLengthEq: 50,
      aperture: 2.8,
      positionVariation: 0,
    },
    quality: 'realtime',
  };
}

export function parseDiffusionOperationParams(value: unknown): DiffusionOperationParams {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new InvalidDiffusionOperationParamsError('柔光参数版本无效');
  }
  const source = readGroup(value, 'source');
  const scatter = readGroup(value, 'scatter');
  const tone = readGroup(value, 'tone');
  const detail = readGroup(value, 'detail');
  const lens = readGroup(value, 'lens');
  const nearRadius = readFiniteRange(scatter, 'nearRadius', 0, 1);
  const farRadius = readFiniteRange(scatter, 'farRadius', 0, 1);
  if (nearRadius > farRadius) {
    throw new InvalidDiffusionOperationParamsError('柔光近距半径不能大于远距半径');
  }
  const rawPresetId = value.presetId;
  if (
    rawPresetId !== null
    && (typeof rawPresetId !== 'string' || rawPresetId.trim().length === 0)
  ) {
    throw new InvalidDiffusionOperationParamsError('柔光预设 ID 无效');
  }
  return {
    schemaVersion: 1,
    mode: readEnum(value, 'mode', DIFFUSION_MODES),
    presetId: rawPresetId as string | null,
    strength: readFiniteRange(value, 'strength', 0, 1),
    density: readEnum(value, 'density', DIFFUSION_DENSITIES),
    source: {
      thresholdEV: readFiniteRange(source, 'thresholdEV', -8, 8),
      softKneeEV: readFiniteRange(source, 'softKneeEV', 0, 8),
      power: readFiniteRange(source, 'power', 0.1, 8),
      highlightRecovery: readFiniteRange(source, 'highlightRecovery', 0, 1),
    },
    scatter: {
      highlightAmount: readFiniteRange(scatter, 'highlightAmount', 0, 1),
      microAmount: readFiniteRange(scatter, 'microAmount', 0, 1),
      nearRadius,
      farRadius,
      tailAmount: readFiniteRange(scatter, 'tailAmount', 0, 1),
      tailShape: readFiniteRange(scatter, 'tailShape', 1, 16),
      anisotropy: readFiniteRange(scatter, 'anisotropy', 0, 1),
      angle: readFiniteRange(scatter, 'angle', -360, 360),
      chromaticSpread: readFiniteRange(scatter, 'chromaticSpread', 0, 0.25),
    },
    tone: {
      veil: readFiniteRange(tone, 'veil', 0, 1),
      blackRetention: readFiniteRange(tone, 'blackRetention', 0, 1),
      highlightCompression: readFiniteRange(tone, 'highlightCompression', 0, 1),
      scatterDesaturation: readFiniteRange(tone, 'scatterDesaturation', 0, 1),
    },
    detail: {
      highFrequencyRetention: readFiniteRange(detail, 'highFrequencyRetention', 0, 1),
      midFrequencyRetention: readFiniteRange(detail, 'midFrequencyRetention', 0, 1),
    },
    lens: {
      focalLengthEq: readFiniteRange(lens, 'focalLengthEq', 1, 1000),
      aperture: readFiniteRange(lens, 'aperture', 0.1, 64),
      positionVariation: readFiniteRange(lens, 'positionVariation', 0, 1),
    },
    quality: readEnum(value, 'quality', DIFFUSION_QUALITIES),
  };
}

export function hasDiffusionEffect(params: DiffusionOperationParams): boolean {
  return params.strength > 0 && (
    params.scatter.highlightAmount > 0
    || params.scatter.microAmount > 0
    || params.tone.veil > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readFiniteRange(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number
): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new InvalidDiffusionOperationParamsError(`柔光参数无效：${key}`);
  }
  return value;
}

function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T {
  const value = record[key];
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new InvalidDiffusionOperationParamsError(`柔光参数无效：${key}`);
  }
  return value as T;
}

function readGroup(
  record: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = record[key];
  if (!isRecord(value)) {
    throw new InvalidDiffusionOperationParamsError(`柔光参数缺少分组：${key}`);
  }
  return value;
}
