import { createDefaultDiffusionOperationParams } from '../diffusionParams';
import { createDefaultVgpuGlowOperationParams } from '../vgpuGlowParams';
import { parseImageColorGradeParams } from '../../imaging/adjustments/schema';
import { cropImageEditRgbaRegionV3 } from './execution/affineTransform';
import { listImagingEffects, registerImagingEffect } from '../../imaging/effects/registry';
import type { EffectDescriptor } from '../../imaging/effects/descriptor';
import { GAUSSIAN_EFFECT, gaussianParameterSchema } from '../../imaging/effects/gaussian';
import { gaussianExecutionWindows, executeGaussianCpu } from '../../imaging/effects/cpu/gaussian';
import { createFloat32PremultipliedRgbaTile, mixProcessedWithMask } from './effects/contracts';
import { convertFloat32TileColorDomainV3 } from './execution/tileColor';
import { resolveImageGaussianPlan } from './effects/gaussianBlur';
import { colorGradeCpuV3, exposureCpuV3, curvesCpuV3, temperatureCpuV3, hslCpuV3, legacyBlurCpuV3, fastBlurCpuV3, diffusionCpuV3, glowCpuV3 } from './execution/pixelKernels';
import { imageEditorGpuExposureParametersV3, imageEditorGpuHslParametersV3, imageEditorGpuTemperatureMatrixV3 } from './gpuAdjustmentPacking';
import { colorGradeSpatialSupport } from '../../imaging/adjustments/plan'
import { gaussianBlurHalo } from './tileGeometry';
import { resolveFastBlurV3Geometry } from './effects/fastBlur';
import {
  ImageEditRenderNodeRegistry,
  estimateRgbaTileBytes,
  type ImageEditRenderColorContract,
  type RenderNodeDefinition,
} from './renderNodeDefinition';

const LINEAR_PREMULTIPLIED: ImageEditRenderColorContract = {
  input: 'linear-light',
  output: 'linear-light',
  alpha: 'premultiplied',
};

const PASSTHROUGH_PREMULTIPLIED: ImageEditRenderColorContract = {
  input: 'perceptual-working',
  output: 'perceptual-working',
  alpha: 'premultiplied',
};

const definitions: readonly RenderNodeDefinition[] = [
  {
    id: 'source.raster', hostExecution: 'source', version: 1, category: 'source', color: {
      input: 'source-encoded', output: 'linear-light', alpha: 'premultiplied',
    }, qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile',
    estimateBytes: (context) => estimateRgbaTileBytes(context),
  },
  {
    id: 'vector.annotation', hostExecution: 'annotation', version: 1, category: 'vector', color: PASSTHROUGH_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'browser-canvas', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile',
    estimateBytes: (context) => estimateRgbaTileBytes(context),
  },
  {
    id: 'effect.blur-v1', operation: { id: 'image.blur', layerType: 'effect', creatable: false }, cpu: legacyBlurCpuV3, gpu: { kind: 'effect', kernel: 'legacy-gaussian' }, version: 1, category: 'local', color: PASSTHROUGH_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'browser-canvas', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile-with-halo',
    localHalo: (parameters, mip) => {
      const radius = Number((parameters as { radiusPixels?: unknown }).radiusPixels ?? 0);
      return gaussianBlurHalo(Number.isFinite(radius) ? Math.max(0, radius) : 0, mip);
    },
    estimateBytes: (context) => estimateRgbaTileBytes(context, 2),
  },
  {
    id: 'effect.fast-blur', operation: { id: 'image.fast-blur-v3', layerType: 'effect', creatable: true, defaults: () => ({ radius: 12 }) }, cpu: fastBlurCpuV3, gpu: { kind: 'effect', kernel: 'fast-blur' }, version: 3, category: 'global-analysis', color: LINEAR_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'shared-analysis',
    localHalo: (parameters, mip) => {
      const radius = Number((parameters as { radius?: unknown }).radius ?? 0);
      return resolveFastBlurV3Geometry({
        radius: Number.isFinite(radius) ? Math.max(0, radius) : 0,
        mip,
      }).localHaloAtMip;
    },
    globalAnalysis: { maxEdge: 2_048, cacheScope: 'subtree', resultVersion: 3 },
    estimateBytes: (context) => estimateRgbaTileBytes(context, 4),
  },
  {
    id: 'effect.diffusion', operation: { id: 'image.diffusion', layerType: 'effect', creatable: true, defaults: createDefaultDiffusionOperationParams }, cpu: diffusionCpuV3, gpu: { kind: 'effect', kernel: 'diffusion' }, version: 4, category: 'global-analysis', color: LINEAR_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'shared-analysis',
    // 宽尺度散射由共享低频分析提供；最终合成只剩 3px 的底图细节十字低通。
    localHalo: (_parameters, mip) => Math.ceil(3 / (2 ** mip)),
    globalAnalysis: { maxEdge: 2_048, cacheScope: 'subtree', resultVersion: 4 },
    estimateBytes: (context) => estimateRgbaTileBytes(context, 5),
  },
  {
    id: 'effect.vgpu-glow', operation: { id: 'image.vgpu-glow', layerType: 'effect', creatable: true, defaults: createDefaultVgpuGlowOperationParams }, cpu: glowCpuV3, gpu: { kind: 'effect', kernel: 'glow' }, version: 4, category: 'global-analysis', color: LINEAR_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'], fusion: 'never',
    invalidation: 'shared-analysis',
    globalAnalysis: { maxEdge: 1_024, cacheScope: 'subtree', resultVersion: 4 },
    estimateBytes: (context) => estimateRgbaTileBytes(context, 6),
  },
  { id: 'adjustment.color-grade', operation: { id: 'color_grade', layerType: 'adjustment', creatable: true, defaults: () => parseImageColorGradeParams({}) }, cpu: colorGradeCpuV3, gpu: { kind: 'adjustment', kernel: 'color-grade' }, version: 1, category: 'local', color: LINEAR_PREMULTIPLIED, qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'], fusion: 'never', invalidation: 'tile-with-halo',
    localHalo: (parameters, mip) => {
      const values = parameters as Readonly<Record<string, unknown>>
      return colorGradeSpatialSupport(values, Number(values.referenceHeight ?? 1) / 2 ** mip)
      }, estimateBytes: (context) => estimateRgbaTileBytes(context, 5) },
  ...[
    { id: 'exposure', defaults: () => ({ stops: 0, offset: 0, gamma: 1 }), cpu: exposureCpuV3, gpu: { kind: 'adjustment' as const, kernel: 'pointwise', uniformCode: 0, pack: imageEditorGpuExposureParametersV3, fusedCapacity: 8 }, color: LINEAR_PREMULTIPLIED },
    { id: 'curves', defaults: () => { const identity = [{ x: 0, y: 0 }, { x: 1, y: 1 }]; return { master: identity, red: identity, green: identity, blue: identity }; }, cpu: curvesCpuV3, gpu: { kind: 'adjustment' as const, kernel: 'curves' }, color: PASSTHROUGH_PREMULTIPLIED },
    { id: 'temperature-tint', defaults: (workingSpace: string) => ({ temperature: 0, tint: 0, workingSpace }), cpu: temperatureCpuV3, gpu: { kind: 'adjustment' as const, kernel: 'pointwise', uniformCode: 1, pack: imageEditorGpuTemperatureMatrixV3 }, color: LINEAR_PREMULTIPLIED },
    { id: 'hsl', defaults: () => ({ hueDegrees: 0, saturation: 0, lightness: 0 }), cpu: hslCpuV3, gpu: { kind: 'adjustment' as const, kernel: 'pointwise', uniformCode: 2, pack: imageEditorGpuHslParametersV3 }, color: PASSTHROUGH_PREMULTIPLIED },
  ].map(({ id, cpu, gpu, color, defaults }): RenderNodeDefinition => ({
    id: `adjustment.${id}`, version: id === 'curves' ? 2 : 1, category: 'pointwise', color,
    operation: { id, layerType: 'adjustment', creatable: true, defaults }, cpu, gpu,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'pointwise-chain', invalidation: 'tile', estimateBytes: context => estimateRgbaTileBytes(context),
  })),
  {
    id: 'composite.layer', hostExecution: 'composite', version: 1, category: 'composite', color: PASSTHROUGH_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile',
    estimateBytes: (context) => estimateRgbaTileBytes(context, 2),
  },
  {
    id: 'group.isolated', hostExecution: 'alias', version: 1, category: 'group', color: PASSTHROUGH_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile',
    estimateBytes: (context) => estimateRgbaTileBytes(context, 2),
  },
];

export function createBuiltInImageEditRenderNodeRegistry(): ImageEditRenderNodeRegistry {
  const registry = new ImageEditRenderNodeRegistry();
  for (const definition of [...definitions, ...sharedImageDefinitions()]) registry.register(definition);
  return registry;
}

export type ImageEditSharedEffectBindingV3 = Pick<RenderNodeDefinition, 'cpu' | 'gpu' | 'localHalo' | 'inputRegion' | 'estimateBytes'>;
const sharedBindings = new Map<string, ImageEditSharedEffectBindingV3>([[GAUSSIAN_EFFECT.id, {
  cpu: (node, source, mask, context) => {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    const plan = resolveImageGaussianPlan(gaussianParametersFromNodeV3(node.parameters), context);
    const result = executeGaussianCpu(plan, { ...context.inputRegion, data: linear.data }, context.outputRegion);
    return mixProcessedWithMask(cropImageEditRgbaRegionV3(linear, context.inputRegion, context.outputRegion), createFloat32PremultipliedRgbaTile(result.width, result.height,
      'linear-light', result.data, linear.workingSpace, linear.transferFunction, linear.referenceWhiteNits), mask);
  },
  inputRegion: (parameters, context, output) => gaussianExecutionWindows(resolveImageGaussianPlan(gaussianParametersFromNodeV3(parameters), context), output)[0],
  gpu: { kind: 'effect', kernel: 'gaussian', pack: parameters => {
    const value = gaussianParametersFromNodeV3(parameters);
    return [value.sigma_fraction_height, value.axis === 'both' ? 0 : value.axis === 'horizontal' ? 1 : 2, value.edge_mode === 'clamp' ? 1 : 0];
  } },
  localHalo: (parameters, mip) => {
    const width = Number((parameters as Record<string, unknown>).referenceWidth);
    const height = Number((parameters as Record<string, unknown>).referenceHeight);
    const plan = resolveImageGaussianPlan(gaussianParametersFromNodeV3(parameters as Record<string, unknown>), {
      referenceSize: { width, height }, outputSize: { width: Math.max(1, Math.ceil(width / 2 ** mip)), height: Math.max(1, Math.ceil(height / 2 ** mip)) },
      quality: (parameters as Record<string, unknown>).effectQuality === 'interactive' ? 'interactive' : 'final',
    });
    return Math.max(...plan.halo);
  },
  estimateBytes: context => estimateRgbaTileBytes(context, 3),
}]]);

/** 剥离宿主运行参数后仍用严格共享 schema；未知作品参数在正式写入处拒绝。 */
export function gaussianParametersFromNodeV3(parameters: Readonly<Record<string, unknown>>) {
  const { opacity: _opacity, blendMode: _blendMode, transform: _transform, referenceWidth: _width,
    referenceHeight: _height, effectQuality: _quality, ...effect } = parameters;
  return gaussianParameterSchema.parse(effect);
}

/** 一个描述 + 一处宿主绑定；操作列表、CPU/GPU 支持集合随登记/释放一起派生。 */
export function registerImageEditSharedEffectV3<Parameters, Plan>(
  descriptor: EffectDescriptor<Parameters, Plan>, binding: ImageEditSharedEffectBindingV3,
): () => void {
  const release = registerImagingEffect(descriptor);
  sharedBindings.set(descriptor.id, binding);
  return () => { sharedBindings.delete(descriptor.id); release(); };
}

function sharedImageDefinitions(): RenderNodeDefinition[] {
  return listImagingEffects().filter(effect => effect.hosts.includes('image')).map(effect => {
    const binding = sharedBindings.get(effect.id);
    return {
      id: `effect.${effect.id}`, version: 1, category: binding?.localHalo ? 'local' : 'pointwise',
      operation: { id: effect.id, layerType: 'effect', creatable: true },
      color: { input: effect.colorDomain === 'perceptual-working' ? 'perceptual-working' : 'linear-light',
        output: effect.colorDomain === 'perceptual-working' ? 'perceptual-working' : 'linear-light', alpha: 'premultiplied' },
      qualities: ['draft', 'stable', 'export'], backends: [...binding?.gpu ? ['webgpu' as const] : [], ...binding?.cpu ? ['cpu-libvips' as const] : []],
      fusion: 'never', invalidation: binding?.localHalo ? 'tile-with-halo' : 'tile',
      estimateBytes: binding?.estimateBytes ?? (context => estimateRgbaTileBytes(context)), ...binding,
    };
  });
}
