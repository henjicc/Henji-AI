import type {
  DiffusionMode,
  DiffusionOperationParams,
  DiffusionQuality,
} from './types';

export const DIFFUSION_RECIPE_VERSION = 1 as const;
export const DIFFUSION_SCALE_COUNT = 6 as const;

export interface DiffusionScaleRecipe {
  index: number;
  radius: number;
  weight: number;
}

export interface DiffusionRecipe {
  version: typeof DIFFUSION_RECIPE_VERSION;
  mode: DiffusionMode;
  quality: DiffusionQuality;
  strength: number;
  densityMultiplier: number;
  image: {
    width: number;
    height: number;
    referenceDimension: number;
    aspectCorrection: readonly [number, number];
  };
  source: {
    thresholdLinear: number;
    softKneeLinear: number;
    power: number;
    highlightGain: number;
    microGain: number;
    highlightRecovery: number;
  };
  scales: readonly DiffusionScaleRecipe[];
  energy: {
    scatterFraction: number;
    directRetention: number;
    veil: number;
  };
  tone: {
    blackRetention: number;
    highlightCompression: number;
    scatterDesaturation: number;
  };
  detail: {
    highFrequencyRetention: number;
    midFrequencyRetention: number;
  };
  optics: {
    anisotropy: number;
    angleRadians: number;
    chromaticSpread: number;
    positionVariation: number;
  };
}

export interface CompileDiffusionRecipeOptions {
  width: number;
  height: number;
  quality?: DiffusionQuality;
}

const DENSITY_MULTIPLIERS = {
  '1/8': 0.5,
  '1/4': 0.72,
  '1/2': 0.88,
  '1': 1,
} as const;

const MODE_RESPONSE = {
  black_mist: {
    highlightGain: 1,
    microGain: 0.52,
    longTailBias: 0.82,
    energyScale: 0.72,
    veilScale: 0.35,
  },
  white_mist: {
    highlightGain: 0.82,
    microGain: 1.22,
    longTailBias: 1,
    energyScale: 0.9,
    veilScale: 1,
  },
  glow: {
    highlightGain: 1.35,
    microGain: 0.34,
    longTailBias: 1.3,
    energyScale: 1,
    veilScale: 0,
  },
} as const;

export function compileDiffusionRecipe(
  params: DiffusionOperationParams,
  options: CompileDiffusionRecipeOptions
): DiffusionRecipe {
  assertImageDimension(options.width, 'width');
  assertImageDimension(options.height, 'height');
  const referenceDimension = Math.max(options.width, options.height);
  const quality = options.quality ?? params.quality;
  const densityMultiplier = DENSITY_MULTIPLIERS[params.density];
  const response = MODE_RESPONSE[params.mode];
  const minimumRadius = 1 / referenceDimension;
  const qualityRadiusScale = quality === 'high' ? 1 : 0.82;
  const nearRadius = Math.max(minimumRadius, params.scatter.nearRadius);
  const farRadius = Math.max(
    nearRadius,
    params.scatter.farRadius * qualityRadiusScale
  );
  const weights = compileScaleWeights(
    params.scatter.tailShape,
    params.scatter.tailAmount,
    response.longTailBias
  );
  const scales = weights.map((weight, index) => ({
    index,
    radius: interpolateRadius(nearRadius, farRadius, index),
    weight,
  }));
  const strength = clamp01(params.strength * densityMultiplier);
  const sourceEnergy = clamp01(
    params.scatter.highlightAmount * response.highlightGain
      + params.scatter.microAmount * response.microGain
      + params.scatter.tailAmount * 0.25
  );
  const scatterFraction = clamp01(strength * sourceEnergy * response.energyScale);

  return {
    version: DIFFUSION_RECIPE_VERSION,
    mode: params.mode,
    quality,
    strength,
    densityMultiplier,
    image: {
      width: options.width,
      height: options.height,
      referenceDimension,
      aspectCorrection: [
        referenceDimension / options.width,
        referenceDimension / options.height,
      ],
    },
    source: {
      thresholdLinear: 0.18 * Math.pow(2, params.source.thresholdEV),
      softKneeLinear: Math.max(
        1 / 65_535,
        0.18 * (Math.pow(2, params.source.softKneeEV) - 1)
      ),
      power: params.source.power,
      highlightGain: params.scatter.highlightAmount * response.highlightGain,
      microGain: params.scatter.microAmount * response.microGain,
      highlightRecovery: params.source.highlightRecovery,
    },
    scales,
    energy: {
      scatterFraction,
      directRetention: 1 - scatterFraction,
      veil: params.tone.veil * strength * response.veilScale,
    },
    tone: {
      blackRetention: params.tone.blackRetention,
      highlightCompression: params.tone.highlightCompression,
      scatterDesaturation: params.tone.scatterDesaturation,
    },
    detail: {
      highFrequencyRetention: params.detail.highFrequencyRetention,
      midFrequencyRetention: params.detail.midFrequencyRetention,
    },
    optics: {
      anisotropy: params.scatter.anisotropy,
      angleRadians: params.scatter.angle * Math.PI / 180,
      chromaticSpread: params.scatter.chromaticSpread,
      positionVariation: params.lens.positionVariation,
    },
  };
}

function compileScaleWeights(
  tailShape: number,
  tailAmount: number,
  longTailBias: number
): number[] {
  const raw = Array.from({ length: DIFFUSION_SCALE_COUNT }, (_, index) => {
    const normalizedIndex = index / (DIFFUSION_SCALE_COUNT - 1);
    const nearWeight = Math.exp(-normalizedIndex * tailShape);
    const tailWeight = Math.pow(normalizedIndex, 1.5) * tailAmount * longTailBias;
    return Math.max(Number.EPSILON, nearWeight + tailWeight);
  });
  const sum = raw.reduce((total, weight) => total + weight, 0);
  return raw.map((weight) => weight / sum);
}

function interpolateRadius(nearRadius: number, farRadius: number, index: number): number {
  if (nearRadius === farRadius) return nearRadius;
  const position = index / (DIFFUSION_SCALE_COUNT - 1);
  return nearRadius * Math.pow(farRadius / nearRadius, position);
}

function assertImageDimension(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`柔光配方 ${name} 必须是正整数`);
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
