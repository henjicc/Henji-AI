export type ImageEditRenderNodeCategory =
  | 'pointwise'
  | 'local'
  | 'global-analysis'
  | 'geometry'
  | 'vector'
  | 'composite'
  | 'group'
  | 'source';

export type ImageEditRenderQuality = 'draft' | 'stable' | 'export';
export type ImageEditRenderBackend = 'webgpu' | 'cpu-libvips' | 'browser-canvas';
export type ImageEditColorDomain = 'source-encoded' | 'linear-light' | 'perceptual-working';
export type ImageEditAlphaContract = 'premultiplied' | 'straight' | 'passthrough';

export interface ImageEditRenderColorContract {
  input: ImageEditColorDomain;
  output: ImageEditColorDomain;
  alpha: ImageEditAlphaContract;
}

export interface ImageEditRenderEstimateContext {
  tileWidth: number;
  tileHeight: number;
  bytesPerChannel: number;
  mip: number;
  quality: ImageEditRenderQuality;
}

export interface ImageEditGlobalAnalysisDefinition {
  maxEdge: number;
  cacheScope: 'subtree';
  resultVersion: number;
}

export interface RenderNodeDefinition<TParameters extends object = object> {
  id: string;
  version: number;
  category: ImageEditRenderNodeCategory;
  color: ImageEditRenderColorContract;
  qualities: readonly ImageEditRenderQuality[];
  backends: readonly ImageEditRenderBackend[];
  operation?: { id: string; layerType: 'effect' | 'adjustment'; creatable: boolean; defaults?: (workingSpace: string) => object };
  cpu?: ImageEditCpuPixelKernelV3;
  gpu?: ImageEditGpuKernelV3;
  /** 宿主源/合成节点没有像素 kernel，按类别交由宿主执行。 */
  hostExecution?: 'source' | 'vector' | 'composite' | 'alias';
  /** 点式节点只有在无蒙版、同颜色域且相邻时才允许融合。 */
  fusion: 'never' | 'pointwise-chain';
  localHalo?: (parameters: TParameters, mip: number) => number;
  /** 有共享全局网格算法时反向规划真实输入，CPU 输出直接为请求区域。 */
  inputRegion?: (parameters: Readonly<Record<string, unknown>>, context: EffectEvaluationContext, output: ImageEditRect) => ImageEditRect;
  globalAnalysis?: ImageEditGlobalAnalysisDefinition;
  estimateBytes(context: ImageEditRenderEstimateContext, parameters: TParameters): number;
  invalidation: 'tile' | 'tile-with-halo' | 'shared-analysis' | 'all';
}

export class ImageEditRenderNodeRegistry {
  private readonly definitions = new Map<string, RenderNodeDefinition>();

  register<TParameters extends object>(definition: RenderNodeDefinition<TParameters>): void {
    if (this.definitions.has(definition.id)) throw new Error(`渲染节点重复注册：${definition.id}`);
    if (!Number.isSafeInteger(definition.version) || definition.version < 1) {
      throw new Error(`渲染节点版本无效：${definition.id}`);
    }
    this.definitions.set(definition.id, definition as RenderNodeDefinition);
  }

  get<TParameters extends object = object>(id: string): RenderNodeDefinition<TParameters> | null {
    return (this.definitions.get(id) as RenderNodeDefinition<TParameters> | undefined) ?? null;
  }

  list(): readonly RenderNodeDefinition[] {
    return [...this.definitions.values()];
  }
}

export function estimateRgbaTileBytes(
  context: ImageEditRenderEstimateContext,
  surfaceCount = 1,
): number {
  return context.tileWidth * context.tileHeight * 4 * context.bytesPerChannel * surfaceCount;
}
import type { CubeLut } from '../../imaging/lut/cube';
import type { AdjustmentCoordinates } from '../../imaging/effects/cpu/colorGrade';
import type { EffectEvaluationContext } from '../../imaging/effects/descriptor';
import type { Float32MaskTile, Float32PremultipliedRgbaTile } from './effects/contracts';
import type { ImageEditRenderPlanNode } from './renderPlan';
import type { ImageEditRect } from './tileGeometry';

export interface ImageEditPixelExecutionContextV3 extends EffectEvaluationContext {
  inputRegion: ImageEditRect;
  outputRegion: ImageEditRect;
  loadColorLut?: (ref: string) => Promise<CubeLut>;
  coordinates?: AdjustmentCoordinates;
}

export type ImageEditCpuPixelKernelV3 = (
  node: ImageEditRenderPlanNode,
  source: Float32PremultipliedRgbaTile,
  mask: Float32MaskTile | undefined,
  context: ImageEditPixelExecutionContextV3,
) => Float32PremultipliedRgbaTile | Promise<Float32PremultipliedRgbaTile>;

/** GPU kernel 引用是宿主 ABI 名称，设备/纹理生命周期仍由 GPU 宿主绑定。 */
export interface ImageEditGpuKernelV3 {
  kind: 'adjustment' | 'effect';
  kernel: string;
  uniformCode?: number;
  pack?: (parameters: Readonly<Record<string, unknown>>) => ArrayLike<number>;
  fusedCapacity?: number;
}
