import type { VgpuGlowOperationParams } from './vgpuGlowParams';

export interface VgpuGlowRecipe {
  schemaVersion: 3;
  threshold: number;
  knee: number;
  hdrBoost: number;
  intensity: number;
  whiteHeat: number;
  sigma: number;
  levelWeights: readonly [number, number, number];
  shoulder: number;
  rolloff: number;
  tintLinear: readonly [number, number, number];
  tintEnabled: boolean;
  coreGain: number;
  edgeGain: number;
  chromaticAberration: number;
  chromaticOffsetPx: number;
}

export function compileVgpuGlowRecipe(params: VgpuGlowOperationParams): VgpuGlowRecipe {
  const radius = params.radius;
  const rawWeights = [
    0.68 - radius * 0.28,
    0.24 + radius * 0.04,
    0.08 + radius * 0.24,
  ] as const;
  const weightSum = rawWeights[0] + rawWeights[1] + rawWeights[2];
  const look = params.look === 'natural'
    ? { boost: 3.4, exposure: 1.35, shoulder: 0.84, rolloff: 0.72, edge: 1.05 }
    : params.look === 'neon'
      ? { boost: 8.8, exposure: 2.15, shoulder: 0.72, rolloff: 0.9, edge: 1.4 }
      : { boost: 5.8, exposure: 1.75, shoulder: 0.78, rolloff: 0.82, edge: 1.2 };
  return {
    schemaVersion: 3,
    threshold: 0.035 + Math.pow(params.sourceThreshold, 1.8) * 0.72,
    knee: 0.08 + (1 - params.sourceThreshold) * 0.24,
    hdrBoost: look.boost,
    intensity: params.intensity * look.exposure,
    whiteHeat: params.whiteHeat,
    sigma: 0.85 + Math.pow(radius, 1.2) * 3.45,
    levelWeights: [
      rawWeights[0] / weightSum,
      rawWeights[1] / weightSum,
      rawWeights[2] / weightSum,
    ],
    shoulder: look.shoulder,
    rolloff: look.rolloff,
    tintLinear: parseLinearRgb(params.tintColor),
    tintEnabled: params.tintEnabled,
    coreGain: 0.7 + params.whiteHeat * 0.75,
    edgeGain: look.edge + (1 - radius) * 0.85,
    chromaticAberration: params.chromaticAberration,
    chromaticOffsetPx: Math.pow(params.chromaticAberration, 1.5) * (1.5 + radius * 4.5),
  };
}

function parseLinearRgb(color: string): readonly [number, number, number] {
  return [
    srgbToLinear(Number.parseInt(color.slice(1, 3), 16) / 255),
    srgbToLinear(Number.parseInt(color.slice(3, 5), 16) / 255),
    srgbToLinear(Number.parseInt(color.slice(5, 7), 16) / 255),
  ];
}

function srgbToLinear(value: number): number {
  return value <= 0.04045
    ? value / 12.92
    : Math.pow((value + 0.055) / 1.055, 2.4);
}
