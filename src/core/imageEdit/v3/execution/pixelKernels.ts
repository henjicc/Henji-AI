import { imageEditOperationParametersV3 } from '../renderContracts/operationParameters';
import { applyImageColorGradeV3 } from '../effects/colorGrade';
import type { ImageEditCpuPixelKernelV3 } from '../renderNodeDefinition';
import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
  applyCurvesAdjustment,
  applyDiffusionV4,
  applyExposureAdjustment,
  applyFastBlurV3,
  applyHslAdjustment,
  applyTemperatureTintAdjustment,
  applyVgpuGlowV4,
  compileCurvesAdjustment,
  type CurveControlPoint,
  type CompiledCurvesAdjustment,
} from '../effects';
import type { ImageEditRenderPlanNode } from '../renderPlan';
import { assertFloat32MaskTile, assertFloat32PremultipliedRgbaTile, createFloat32PremultipliedRgbaTile } from '../effects/contracts';
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
    const params = imageEditOperationParametersV3(node.parameters);
    return applyImageColorGradeV3(source, params, mask, context.loadColorLut, context.coordinates ?? { origin: [0, 0], size: [Number(node.parameters.referenceWidth ?? source.width), Number(node.parameters.referenceHeight ?? source.height)] });
};

export const exposureCpuV3: ImageEditCpuPixelKernelV3 = async (node, source, mask, _context) => {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    const gamma = numberParameter(node, 'gamma', 1);
    if (gamma === 1) {
      // 中性 gamma 是线性点操作；避免每像素创建 mapper 数组与调用 signed pow。
      // 保留 straight→premult 的运算顺序及 Float32 写入，再走同一蒙版混合契约。
      assertFloat32PremultipliedRgbaTile(linear, 'linear-light');
      if (mask) {
        assertFloat32MaskTile(mask);
        if (mask.width !== linear.width || mask.height !== linear.height) throw new Error('效果蒙版与输入瓦片尺寸不一致');
      }
      const multiplier = 2 ** numberParameter(node, 'stops', 0);
      const bias = numberParameter(node, 'offset', 0);
      const data = new Float32Array(linear.data.length);
      for (let offset = 0; offset < data.length; offset += 4) {
        const alpha = linear.data[offset + 3];
        const amount = mask?.data[offset / 4];
        if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new Error('Alpha 必须是 0～1 的有限浮点数');
        if (alpha === 0) {
          if (amount !== undefined) for (let channel = 0; channel < 3; channel++) {
            const original = linear.data[offset + channel];
            data[offset + channel] = original + (0 - original) * amount;
          }
          continue;
        }
        for (let channel = 0; channel < 3; channel += 1) {
          const mapped = linear.data[offset + channel] / alpha * multiplier + bias;
          if (!Number.isFinite(mapped)) throw new Error('曝光计算结果不是有限数');
          const processed = Math.fround((mapped === 0 ? 0 : mapped) * alpha);
          const original = linear.data[offset + channel];
          data[offset + channel] = amount === undefined ? processed : original + (processed - original) * amount;
        }
        data[offset + 3] = alpha;
      }
      return createFloat32PremultipliedRgbaTile(linear.width, linear.height,
        linear.colorDomain, data, linear.workingSpace, linear.transferFunction, linear.referenceWhiteNits);
    }
    return applyExposureAdjustment(linear, {
      stops: numberParameter(node, 'stops', 0),
      offset: numberParameter(node, 'offset', 0),
      gamma,
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
