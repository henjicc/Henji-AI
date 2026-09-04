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
    id: 'source.raster', version: 1, category: 'source', color: {
      input: 'source-encoded', output: 'linear-light', alpha: 'premultiplied',
    }, qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile',
    estimateBytes: (context) => estimateRgbaTileBytes(context),
  },
  {
    id: 'vector.annotation', version: 1, category: 'vector', color: PASSTHROUGH_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'browser-canvas', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile',
    estimateBytes: (context) => estimateRgbaTileBytes(context),
  },
  {
    id: 'effect.blur-v1', version: 1, category: 'local', color: PASSTHROUGH_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'browser-canvas', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile-with-halo',
    localHalo: (parameters, mip) => {
      const radius = Number((parameters as { radiusPixels?: unknown }).radiusPixels ?? 0);
      return gaussianBlurHalo(Number.isFinite(radius) ? Math.max(0, radius) : 0, mip);
    },
    estimateBytes: (context) => estimateRgbaTileBytes(context, 2),
  },
  {
    id: 'effect.gaussian-blur', version: 2, category: 'local', color: LINEAR_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile-with-halo',
    localHalo: (parameters, mip) => {
      const radius = Number((parameters as { radius?: unknown }).radius ?? 0);
      return gaussianBlurHalo(Number.isFinite(radius) ? Math.max(0, radius) : 0, mip);
    },
    estimateBytes: (context) => estimateRgbaTileBytes(context, 3),
  },
  {
    id: 'effect.fast-blur', version: 3, category: 'global-analysis', color: LINEAR_PREMULTIPLIED,
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
    id: 'effect.diffusion', version: 4, category: 'global-analysis', color: LINEAR_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'shared-analysis',
    // 宽尺度散射由共享低频分析提供；最终合成只剩 3px 的底图细节十字低通。
    localHalo: (_parameters, mip) => Math.ceil(3 / (2 ** mip)),
    globalAnalysis: { maxEdge: 2_048, cacheScope: 'subtree', resultVersion: 4 },
    estimateBytes: (context) => estimateRgbaTileBytes(context, 5),
  },
  {
    id: 'effect.vgpu-glow', version: 4, category: 'global-analysis', color: LINEAR_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'], fusion: 'never',
    invalidation: 'shared-analysis',
    globalAnalysis: { maxEdge: 1_024, cacheScope: 'subtree', resultVersion: 4 },
    estimateBytes: (context) => estimateRgbaTileBytes(context, 6),
  },
  ...['exposure', 'curves', 'temperature-tint', 'hsl'].map((kind): RenderNodeDefinition => ({
    id: `adjustment.${kind}`,
    version: kind === 'curves' ? 2 : 1,
    category: 'pointwise',
    color: kind === 'curves' || kind === 'hsl' ? PASSTHROUGH_PREMULTIPLIED : LINEAR_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'],
    backends: ['webgpu', 'cpu-libvips'],
    fusion: 'pointwise-chain',
    invalidation: 'tile',
    estimateBytes: (context) => estimateRgbaTileBytes(context),
  })),
  {
    id: 'composite.layer', version: 1, category: 'composite', color: PASSTHROUGH_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile',
    estimateBytes: (context) => estimateRgbaTileBytes(context, 2),
  },
  {
    id: 'group.isolated', version: 1, category: 'group', color: PASSTHROUGH_PREMULTIPLIED,
    qualities: ['draft', 'stable', 'export'], backends: ['webgpu', 'cpu-libvips'],
    fusion: 'never', invalidation: 'tile',
    estimateBytes: (context) => estimateRgbaTileBytes(context, 2),
  },
];

export function createBuiltInImageEditRenderNodeRegistry(): ImageEditRenderNodeRegistry {
  const registry = new ImageEditRenderNodeRegistry();
  for (const definition of definitions) registry.register(definition);
  return registry;
}
