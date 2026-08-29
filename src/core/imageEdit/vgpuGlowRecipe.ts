import type { VgpuGlowOperationParams } from './vgpuGlowParams';

export interface VgpuGlowRecipe {
  schemaVersion: 5;
  threshold: number;
  knee: number;
  hdrBoost: number;
  intensity: number;
  whiteHeat: number;
  sigma: number;
  levelWeights: readonly [number, number, number, number, number];
  bloomExposure: number;
  bloomGamma: number;
  tintLinear: readonly [number, number, number];
  tintEnabled: boolean;
  coreGain: number;
  chromaticAberration: number;
  chromaticOffsetPx: number;
}

export function compileVgpuGlowRecipe(params: VgpuGlowOperationParams): VgpuGlowRecipe {
  const radius = params.radius;
  const rawWeights = [
    0.42 - radius * 0.2,
    0.27 - radius * 0.05,
    0.16 + radius * 0.02,
    0.1 + radius * 0.08,
    0.05 + radius * 0.15,
  ] as const;
  const weightSum = rawWeights.reduce((sum, weight) => sum + weight, 0);
  const look = params.look === 'natural'
    ? { boost: 2.4, intensity: 0.92, bloomExposure: 0.82, bloomGamma: 1.08, core: 0.76 }
    : params.look === 'neon'
      ? { boost: 6.8, intensity: 1.36, bloomExposure: 1.24, bloomGamma: 1.04, core: 1.04 }
      : { boost: 4.6, intensity: 1.14, bloomExposure: 1.02, bloomGamma: 1.18, core: 0.88 };
  return {
    schemaVersion: 5,
    threshold: 0.035 + Math.pow(params.sourceThreshold, 1.8) * 0.72,
    knee: 0.08 + (1 - params.sourceThreshold) * 0.24,
    hdrBoost: look.boost,
    intensity: params.intensity * look.intensity,
    whiteHeat: params.whiteHeat,
    // 大半径由连续高斯核与五级金字塔共同形成；不要通过拉开采样间距扩张半径，
    // 否则细线和文字会被离散复制成可见条纹。
    sigma: 1.05 + Math.pow(radius, 1.1) * 3.95,
    levelWeights: [
      rawWeights[0] / weightSum,
      rawWeights[1] / weightSum,
      rawWeights[2] / weightSum,
      rawWeights[3] / weightSum,
      rawWeights[4] / weightSum,
    ],
    bloomExposure: look.bloomExposure,
    bloomGamma: look.bloomGamma,
    tintLinear: parseLinearRgb(params.tintColor),
    tintEnabled: params.tintEnabled,
    coreGain: look.core * (0.68 + params.whiteHeat * 0.48),
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
