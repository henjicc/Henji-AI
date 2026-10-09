import { applyImageColorGradeV3 } from '../effects/colorGrade';
import type { ImageEditCpuPixelKernelV3 } from '../renderNodeDefinition';
import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
  applyCurvesAdjustment,
  applyDiffusionV4,
  applyExposureAdjustment,
  applyFastBlurV3,
  applyLegacyGaussianBlurV1,
  applyHslAdjustment,
  applyTemperatureTintAdjustment,
  applyVgpuGlowV4,
  compileCurvesAdjustment,
  type CurveControlPoint,
  type CompiledCurvesAdjustment,
} from '../effects';
import type { ImageEditRenderPlanNode } from '../renderPlan';
import {
  convertFloat32TileColorDomainV3,
} from './tileColor';
const MAX_COMPILED_CURVE_CACHE_ENTRIES = 64;
const compiledCurveCache = new Map<string, CompiledCurvesAdjustment>();

function numberParameter(node: ImageEditRenderPlanNode, key: string, fallback: number): number {
  const value = node.parameters[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function curvePoints(value: unknown): CurveControlPoint[] {
  if (!Array.isArray(value)) return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const points: CurveControlPoint[] = [];
  for (const entry of value) {
    if (
      typeof entry === 'object'
      && entry !== null
      && 'x' in entry
      && 'y' in entry
      && typeof entry.x === 'number'
      && typeof entry.y === 'number'
    ) points.push({ x: entry.x, y: entry.y });
  }
  return points.length > 0 ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }];
}

function compiledCurves(node: ImageEditRenderPlanNode): CompiledCurvesAdjustment {
  const key = node.subtreeHash;
  const cached = compiledCurveCache.get(key);
  if (cached) {
    compiledCurveCache.delete(key);
    compiledCurveCache.set(key, cached);
    return cached;
  }
  const compiled = compileCurvesAdjustment({
    master: curvePoints(node.parameters.master),
    red: curvePoints(node.parameters.red),
    green: curvePoints(node.parameters.green),
    blue: curvePoints(node.parameters.blue),
  });
  compiledCurveCache.set(key, compiled);
  while (compiledCurveCache.size > MAX_COMPILED_CURVE_CACHE_ENTRIES) {
    const oldest = compiledCurveCache.keys().next().value;
    if (oldest === undefined) break;
    compiledCurveCache.delete(oldest);
  }
  return compiled;
}


export const colorGradeCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, context) => {
    const { opacity: _opacity, blendMode: _blendMode, transform: _transform, referenceWidth: _width, referenceHeight: _height, effectQuality: _quality, ...params } = node.parameters;
    return applyImageColorGradeV3(source, params, mask, context.loadColorLut, context.coordinates ?? { origin: [0, 0], size: [Number(_width ?? source.width), Number(_height ?? source.height)] });
};

export const exposureCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, _context) => {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyExposureAdjustment(linear, {
      stops: numberParameter(node, 'stops', 0),
      offset: numberParameter(node, 'offset', 0),
      gamma: numberParameter(node, 'gamma', 1),
    }, { mask });
};

export const curvesCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, _context) => {
    const perceptual = convertFloat32TileColorDomainV3(source, 'perceptual-working');
    return applyCurvesAdjustment(perceptual, compiledCurves(node), { mask });
};

export const temperatureCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, _context) => {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyTemperatureTintAdjustment(linear, {
      temperature: numberParameter(node, 'temperature', 0),
      tint: numberParameter(node, 'tint', 0),
      workingSpace: source.workingSpace,
    }, { mask });
};

export const hslCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, _context) => {
    const perceptual = convertFloat32TileColorDomainV3(source, 'perceptual-working');
    return applyHslAdjustment(perceptual, {
      hueDegrees: numberParameter(node, 'hueDegrees', 0),
      saturation: numberParameter(node, 'saturation', 0),
      lightness: numberParameter(node, 'lightness', 0),
    }, { mask });
};

export const legacyBlurCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, _context) => {
    const perceptual = convertFloat32TileColorDomainV3(source, 'perceptual-working');
    return applyLegacyGaussianBlurV1(
      perceptual,
      numberParameter(node, 'radiusPixels', 0),
      { mask },
    );
};

export const fastBlurCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, _context) => {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyFastBlurV3(linear, {
      radius: numberParameter(node, 'radius', 0),
      mip: numberParameter(node, 'mip', 0),
    }, { mask });
};

export const diffusionCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, _context) => {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyDiffusionV4(linear, DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(
      DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
      { width: source.width, height: source.height, quality: 'high' },
    ), { mask });
};

export const glowCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, _context) => {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyVgpuGlowV4(linear, VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(
      VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
      { width: source.width, height: source.height },
    ), { mask });
};
