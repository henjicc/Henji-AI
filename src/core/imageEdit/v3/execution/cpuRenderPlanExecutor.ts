import { resolveDeformationSampling, resampleDeformation } from './deformationSampling';
import { maskDensity } from '../../../imaging/compositing';
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes';
import type { ImageEditPixelExecutionContextV3 } from '../renderNodeDefinition';
import type { AdjustmentCoordinates } from '../../../imaging/effects/cpu/colorGrade'
import type { CubeLut } from '../../../imaging/lut/cube';
import { createFloat32MaskTile, mixProcessedWithMask, type Float32MaskTile, type Float32PremultipliedRgbaTile } from '../effects/contracts';
import type { ImageEditBlendModeV3, ImageEditMaskReferenceV3 } from '../layerTypes';
import type { ImageEditRenderPlan, ImageEditRenderPlanNode } from '../renderPlan';
import {
  convertFloat32TileColorDomainV3,
  convertFloat32TileColorContractV3,
} from './tileColor';
import {
  applyContentMaskAndOpacityV3,
  compositePremultipliedTilesV3,
  mixEffectLayerV3,
} from './tileBlend';

export class ImageEditRenderNodeUnsupportedErrorV3 extends Error {
  constructor(readonly definitionId: string) {
    super(`当前 CPU 执行器不支持渲染节点：${definitionId}`);
    this.name = 'ImageEditRenderNodeUnsupportedErrorV3';
  }
}

export interface ImageEditCpuRenderContextV3 {
  /** Reference evaluation grid, distinct from the source bitmap dimensions. */
  size?: { width: number; height: number };
  loadColorLut?: (ref: string) => Promise<CubeLut>;
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
  let mask = await context.loadMask(node.mask, node);
  const transform = node.parameters.maskTransform ?? node.parameters.transform;
  const size=context.size??{width:mask.width,height:mask.height},region={x:0,y:0,...size};
  const warped=resolveDeformationSampling({size},node,{kind:'mask',ownerNode:node,reference:node.mask},region);
  if(warped) mask=resampleDeformation(mask,region,{...warped,region:{x:0,y:0,width:mask.width,height:mask.height}});
  else if (transform !== undefined && !isIdentityTransform(transform)) {
    if (!Array.isArray(transform) || !context.transformMask) throw new Error(`图层蒙版变换没有可用执行器：${node.layerId}`);
    mask = await context.transformMask(mask, transform.filter((entry): entry is number => typeof entry === 'number'), node);
  }
  const data = new Float32Array(mask.data.length);
  for (let index = 0; index < data.length; index += 1) data[index] = maskDensity(node.mask.inverted ? 1 - mask.data[index] : mask.data[index], numberParameter(node, 'maskDensity', 1));
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

export function listImageEditCpuNodeIdsV3(): ReadonlySet<string> {
  return new Set(createBuiltInImageEditRenderNodeRegistry().list()
    .filter(definition => definition.cpu || definition.hostExecution).map(definition => definition.id));
}

export function imageEditPixelContextV3(node: ImageEditRenderPlanNode, source: Float32PremultipliedRgbaTile): ImageEditPixelExecutionContextV3 {
  const width = Number(node.parameters.referenceWidth ?? source.width);
  const height = Number(node.parameters.referenceHeight ?? source.height);
  return {
    referenceSize: { width, height }, outputSize: { width: source.width, height: source.height },
    quality: node.parameters.effectQuality === 'interactive' ? 'interactive' : 'final',
    inputRegion: { x: 0, y: 0, width: source.width, height: source.height },
    outputRegion: { x: 0, y: 0, width: source.width, height: source.height },
  };
}

export async function executeImageEditCpuAdjustmentNodeV3(
  node: ImageEditRenderPlanNode, source: Float32PremultipliedRgbaTile, mask: Float32MaskTile | undefined,
  loadColorLut?: (ref: string) => Promise<CubeLut>, coordinates?: AdjustmentCoordinates,
): Promise<Float32PremultipliedRgbaTile> {
  const definition = createBuiltInImageEditRenderNodeRegistry().get(node.definitionId);
  if (!definition?.cpu) throw new ImageEditRenderNodeUnsupportedErrorV3(node.definitionId);
  return definition.cpu(node, source, mask, { ...imageEditPixelContextV3(node, source), loadColorLut, coordinates });
}

export async function executeImageEditCpuEffectNodeV3(
  node: ImageEditRenderPlanNode, source: Float32PremultipliedRgbaTile, mask: Float32MaskTile | undefined,
  context: Pick<ImageEditCpuRenderContextV3, 'executeCustomEffect'> & { evaluation?: ImageEditPixelExecutionContextV3 },
): Promise<Float32PremultipliedRgbaTile> {
  const definition = createBuiltInImageEditRenderNodeRegistry().get(node.definitionId);
  if (!definition?.cpu) throw new ImageEditRenderNodeUnsupportedErrorV3(node.definitionId);
  if (definition.globalAnalysis && context.executeCustomEffect) return context.executeCustomEffect(node, source, mask);
  return definition.cpu(node, source, mask, context.evaluation ?? imageEditPixelContextV3(node, source));
}

async function executeComposite(
  node: ImageEditRenderPlanNode,
  outputs: ReadonlyMap<string, Float32PremultipliedRgbaTile>,
  context: ImageEditCpuRenderContextV3,
): Promise<Float32PremultipliedRgbaTile> {
  const contentIndex = node.inputNodeIds.length === 1 ? 0 : 1;
  let content = requireInput(outputs, node, contentIndex);
  const transform = node.parameters.transform;
  const mask = await loadNodeMask(node, context);
  const size=context.size??{width:content.width,height:content.height},region={x:0,y:0,...size};
  const warped=resolveDeformationSampling({size},node,{kind:'content',node},region);
  if(warped) content=resampleDeformation(content,region,{...warped,region:{x:0,y:0,width:content.width,height:content.height}});
  else if (!isIdentityTransform(transform)) {
    if (!Array.isArray(transform) || !context.transformContent) {
      throw new Error(`图层变换没有可用执行器：${node.layerId}`);
    }
    content = await context.transformContent(content, transform.filter((entry): entry is number => typeof entry === 'number'), node);
  }
  const backdrop = node.inputNodeIds.length > 1 ? requireInput(outputs, node, 0) : null;
  if (backdrop) {
    content = convertFloat32TileColorContractV3(content, backdrop);
  }
  const masked = applyContentMaskAndOpacityV3(
    content,
    numberParameter(node, 'opacity', 1),
    mask,
  );
  return compositePremultipliedTilesV3(backdrop, masked, imageEditCpuRenderNodeBlendModeV3(node), node.parameters.clipping === true);
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
        ? await executeImageEditCpuAdjustmentNodeV3(node, source, mask, context.loadColorLut)
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
