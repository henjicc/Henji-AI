import type { VgpuGlowOperationParams } from './vgpuGlowParams';

export interface VgpuGlowRecipe {
  schemaVersion: 1;
  threshold: number;
  knee: number;
  hdrBoost: number;
  intensity: number;
  whiteHeat: number;
  sigma: number;
  levelWeights: readonly [number, number, number];
  shoulder: number;
  rolloff: number;
}

export function compileVgpuGlowRecipe(params: VgpuGlowOperationParams): VgpuGlowRecipe {
  const spread = params.spread;
  const rawWeights = [
    0.58 - spread * 0.22,
    0.29 + spread * 0.04,
    0.13 + spread * 0.28,
  ] as const;
  const weightSum = rawWeights[0] + rawWeights[1] + rawWeights[2];
  const look = params.look === 'natural'
    ? { boost: 3.2, exposure: 1.25, shoulder: 0.84, rolloff: 0.72 }
    : params.look === 'neon'
      ? { boost: 8.5, exposure: 2.05, shoulder: 0.72, rolloff: 0.9 }
      : { boost: 5.6, exposure: 1.65, shoulder: 0.78, rolloff: 0.82 };
  return {
    schemaVersion: 1,
    threshold: 0.035 + Math.pow(params.sourceThreshold, 1.8) * 0.72,
    knee: 0.08 + (1 - params.sourceThreshold) * 0.24,
    hdrBoost: look.boost,
    intensity: params.intensity * look.exposure,
    whiteHeat: params.whiteHeat,
    sigma: 1.15 + spread * 2.65,
    levelWeights: [
      rawWeights[0] / weightSum,
      rawWeights[1] / weightSum,
      rawWeights[2] / weightSum,
    ],
    shoulder: look.shoulder,
    rolloff: look.rolloff,
  };
}
