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
  /** 点式节点只有在无蒙版、同颜色域且相邻时才允许融合。 */
  fusion: 'never' | 'pointwise-chain';
  localHalo?: (parameters: TParameters, mip: number) => number;
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
