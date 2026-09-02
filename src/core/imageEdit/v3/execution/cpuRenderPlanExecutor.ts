import {
  DIFFUSION_V4_RECIPE_ADAPTER,
  VGPU_GLOW_V4_RECIPE_ADAPTER,
  applyCurvesAdjustment,
  applyDiffusionV4,
  applyExposureAdjustment,
  applyFastBlurV3,
  applyGaussianBlurV2,
  applyLegacyGaussianBlurV1,
  applyHslAdjustment,
  applyTemperatureTintAdjustment,
  applyVgpuGlowV4,
  compileCurvesAdjustment,
  createFloat32MaskTile,
  mixProcessedWithMask,
  type CurveControlPoint,
  type CompiledCurvesAdjustment,
  type Float32MaskTile,
  type Float32PremultipliedRgbaTile,
} from '../effects';
import type { ImageEditBlendModeV3, ImageEditMaskReferenceV3 } from '../layerTypes';
import type { ImageEditRenderPlan, ImageEditRenderPlanNode } from '../renderPlan';
import {
  convertFloat32TileColorDomainV3,
  convertFloat32TileWorkingSpaceV3,
} from './tileColor';
import {
  applyContentMaskAndOpacityV3,
  compositePremultipliedTilesV3,
  mixEffectLayerV3,
} from './tileBlend';

const MAX_COMPILED_CURVE_CACHE_ENTRIES = 64;
const compiledCurveCache = new Map<string, CompiledCurvesAdjustment>();

/** 生产 CPU/ROI 执行器真实覆盖的节点；新增注册节点但漏接执行器时由动态测试阻断。 */
export const IMAGE_EDIT_TILED_CPU_NODE_IDS_V3: ReadonlySet<string> = new Set([
  'source.raster',
  'vector.annotation',
  'effect.blur-v1',
  'effect.gaussian-blur',
  'effect.fast-blur',
  'effect.diffusion',
  'effect.vgpu-glow',
  'adjustment.exposure',
  'adjustment.curves',
  'adjustment.temperature-tint',
  'adjustment.hsl',
  'composite.layer',
  'group.isolated',
]);

export class ImageEditRenderNodeUnsupportedErrorV3 extends Error {
  constructor(readonly definitionId: string) {
    super(`当前 CPU 执行器不支持渲染节点：${definitionId}`);
    this.name = 'ImageEditRenderNodeUnsupportedErrorV3';
  }
}

export interface ImageEditCpuRenderContextV3 {
  loadRaster(node: ImageEditRenderPlanNode): Promise<Float32PremultipliedRgbaTile>;
  rasterizeAnnotations(node: ImageEditRenderPlanNode): Promise<Float32PremultipliedRgbaTile>;
  loadMask?(reference: ImageEditMaskReferenceV3, node: ImageEditRenderPlanNode): Promise<Float32MaskTile>;
  transformContent?(
    content: Float32PremultipliedRgbaTile,
    transform: readonly number[],
    node: ImageEditRenderPlanNode,
  ): Promise<Float32PremultipliedRgbaTile>;
  transformMask?(
    mask: Float32MaskTile,
    transform: readonly number[],
    node: ImageEditRenderPlanNode,
  ): Promise<Float32MaskTile>;
  executeCustomEffect?(
    node: ImageEditRenderPlanNode,
    source: Float32PremultipliedRgbaTile,
    mask?: Float32MaskTile,
  ): Promise<Float32PremultipliedRgbaTile>;
  signal?: AbortSignal;
  onNodeCompleted?: (node: ImageEditRenderPlanNode) => void;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('图片渲染已取消');
  error.name = 'AbortError';
  throw error;
}

function numberParameter(node: ImageEditRenderPlanNode, key: string, fallback: number): number {
  const value = node.parameters[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function imageEditCpuRenderNodeBlendModeV3(
  node: ImageEditRenderPlanNode,
): ImageEditBlendModeV3 {
  const value = node.parameters.blendMode;
  return value === 'multiply' || value === 'screen' || value === 'overlay' || value === 'soft-light'
    ? value
    : 'normal';
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

function isIdentityTransform(value: unknown): value is readonly number[] {
  return Array.isArray(value)
    && value.length === 6
    && value.every((entry, index) => entry === [1, 0, 0, 1, 0, 0][index]);
}

async function loadNodeMask(
  node: ImageEditRenderPlanNode,
  context: ImageEditCpuRenderContextV3,
): Promise<Float32MaskTile | undefined> {
  if (!node.mask) return undefined;
  if (!context.loadMask) throw new Error(`图层蒙版没有可用的资源读取器：${node.layerId}`);
  const mask = await context.loadMask(node.mask, node);
  if (!node.mask.inverted) return mask;
  const data = new Float32Array(mask.data.length);
  for (let index = 0; index < data.length; index += 1) data[index] = 1 - mask.data[index];
  return createFloat32MaskTile(mask.width, mask.height, data);
}

function requireInput(
  outputs: ReadonlyMap<string, Float32PremultipliedRgbaTile>,
  node: ImageEditRenderPlanNode,
  index = 0,
): Float32PremultipliedRgbaTile {
  const inputId = node.inputNodeIds[index];
  const input = inputId ? outputs.get(inputId) : undefined;
  if (!input) throw new Error(`渲染节点缺少输入：${node.id}`);
  return input;
}

export async function executeImageEditCpuAdjustmentNodeV3(
  node: ImageEditRenderPlanNode,
  source: Float32PremultipliedRgbaTile,
  mask: Float32MaskTile | undefined,
): Promise<Float32PremultipliedRgbaTile> {
  if (node.definitionId === 'adjustment.exposure') {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyExposureAdjustment(linear, {
      stops: numberParameter(node, 'stops', 0),
      offset: numberParameter(node, 'offset', 0),
      gamma: numberParameter(node, 'gamma', 1),
    }, { mask });
  }
  if (node.definitionId === 'adjustment.curves') {
    const perceptual = convertFloat32TileColorDomainV3(source, 'perceptual-working');
    return applyCurvesAdjustment(perceptual, compiledCurves(node), { mask });
  }
  if (node.definitionId === 'adjustment.temperature-tint') {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyTemperatureTintAdjustment(linear, {
      temperature: numberParameter(node, 'temperature', 0),
      tint: numberParameter(node, 'tint', 0),
      workingSpace: source.workingSpace,
    }, { mask });
  }
  const perceptual = convertFloat32TileColorDomainV3(source, 'perceptual-working');
  return applyHslAdjustment(perceptual, {
    hueDegrees: numberParameter(node, 'hueDegrees', 0),
    saturation: numberParameter(node, 'saturation', 0),
    lightness: numberParameter(node, 'lightness', 0),
  }, { mask });
}

export async function executeImageEditCpuEffectNodeV3(
  node: ImageEditRenderPlanNode,
  source: Float32PremultipliedRgbaTile,
  mask: Float32MaskTile | undefined,
  context: Pick<ImageEditCpuRenderContextV3, 'executeCustomEffect'>,
): Promise<Float32PremultipliedRgbaTile> {
  if (node.definitionId === 'effect.blur-v1') {
    const perceptual = convertFloat32TileColorDomainV3(source, 'perceptual-working');
    return applyLegacyGaussianBlurV1(
      perceptual,
      numberParameter(node, 'radiusPixels', 0),
      { mask },
    );
  }
  if (node.definitionId === 'effect.gaussian-blur') {
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyGaussianBlurV2(linear, {
      radius: numberParameter(node, 'radius', 0),
      mip: numberParameter(node, 'mip', 0),
    }, { mask });
  }
  if (node.definitionId === 'effect.fast-blur') {
    if (context.executeCustomEffect) return context.executeCustomEffect(node, source, mask);
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyFastBlurV3(linear, {
      radius: numberParameter(node, 'radius', 0),
      mip: numberParameter(node, 'mip', 0),
    }, { mask });
  }
  if (node.definitionId === 'effect.diffusion') {
    if (context.executeCustomEffect) return context.executeCustomEffect(node, source, mask);
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyDiffusionV4(linear, DIFFUSION_V4_RECIPE_ADAPTER.compileRecipe(
      DIFFUSION_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
      { width: source.width, height: source.height, quality: 'high' },
    ), { mask });
  }
  if (node.definitionId === 'effect.vgpu-glow') {
    if (context.executeCustomEffect) return context.executeCustomEffect(node, source, mask);
    const linear = convertFloat32TileColorDomainV3(source, 'linear-light');
    return applyVgpuGlowV4(linear, VGPU_GLOW_V4_RECIPE_ADAPTER.compileRecipe(
      VGPU_GLOW_V4_RECIPE_ADAPTER.parseParameters(node.parameters),
      { width: source.width, height: source.height },
    ), { mask });
  }
  if (context.executeCustomEffect) return context.executeCustomEffect(node, source, mask);
  throw new ImageEditRenderNodeUnsupportedErrorV3(node.definitionId);
}

async function executeComposite(
  node: ImageEditRenderPlanNode,
  outputs: ReadonlyMap<string, Float32PremultipliedRgbaTile>,
  context: ImageEditCpuRenderContextV3,
): Promise<Float32PremultipliedRgbaTile> {
  const contentIndex = node.inputNodeIds.length === 1 ? 0 : 1;
  let content = requireInput(outputs, node, contentIndex);
  const transform = node.parameters.transform;
  let mask = await loadNodeMask(node, context);
  if (!isIdentityTransform(transform)) {
    if (!Array.isArray(transform) || !context.transformContent) {
      throw new Error(`图层变换没有可用执行器：${node.layerId}`);
    }
    content = await context.transformContent(content, transform.filter((entry): entry is number => typeof entry === 'number'), node);
    if (mask) {
      if (!context.transformMask) throw new Error(`图层蒙版变换没有可用执行器：${node.layerId}`);
      mask = await context.transformMask(
        mask,
        transform.filter((entry): entry is number => typeof entry === 'number'),
        node,
      );
    }
  }
  const backdrop = node.inputNodeIds.length > 1 ? requireInput(outputs, node, 0) : null;
  if (backdrop) {
    content = convertFloat32TileWorkingSpaceV3(content, backdrop.workingSpace);
    content = convertFloat32TileColorDomainV3(content, backdrop.colorDomain);
  }
  const masked = applyContentMaskAndOpacityV3(
    content,
    numberParameter(node, 'opacity', 1),
    mask,
  );
  return compositePremultipliedTilesV3(backdrop, masked, imageEditCpuRenderNodeBlendModeV3(node));
}

export async function executeImageEditCpuRenderPlanV3(
  plan: ImageEditRenderPlan,
  context: ImageEditCpuRenderContextV3,
): Promise<Float32PremultipliedRgbaTile | null> {
  if (!plan.outputNodeId) return null;
  const outputs = new Map<string, Float32PremultipliedRgbaTile>();
  for (const node of plan.nodes) {
    throwIfAborted(context.signal);
    let output: Float32PremultipliedRgbaTile;
    if (node.definitionId === 'source.raster') output = await context.loadRaster(node);
    else if (node.definitionId === 'vector.annotation') output = await context.rasterizeAnnotations(node);
    else if (node.definitionId === 'composite.layer') output = await executeComposite(node, outputs, context);
    else if (node.definitionId === 'group.isolated') output = requireInput(outputs, node);
    else {
      const source = requireInput(outputs, node);
      const mask = await loadNodeMask(node, context);
      const processed = node.definitionId.startsWith('adjustment.')
        ? await executeImageEditCpuAdjustmentNodeV3(node, source, mask)
        : await executeImageEditCpuEffectNodeV3(node, source, mask, context);
      const original = convertFloat32TileColorDomainV3(source, processed.colorDomain);
      // 内建 kernel 已混入蒙版；custom effect 可选择返回裸结果，因此在 context 内遵循同一契约。
      output = mixEffectLayerV3(
        original,
        processed,
        imageEditCpuRenderNodeBlendModeV3(node),
        numberParameter(node, 'opacity', 1),
      );
    }
    throwIfAborted(context.signal);
    outputs.set(node.id, output);
    context.onNodeCompleted?.(node);
  }
  return outputs.get(plan.outputNodeId) ?? null;
}

export function mixCustomEffectMaskV3(
  source: Float32PremultipliedRgbaTile,
  processed: Float32PremultipliedRgbaTile,
  mask?: Float32MaskTile,
): Float32PremultipliedRgbaTile {
  return mixProcessedWithMask(source, processed, mask);
}
