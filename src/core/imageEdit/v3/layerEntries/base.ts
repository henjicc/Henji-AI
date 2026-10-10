import type { z } from 'zod';
import { registerImageEditSmartContentV3 } from './smart';
import { imageLayerSchema } from '../../../persistence/imageSchemas';
import { ImageEditLayerContentRegistryV3 } from '../layerModel/contentRegistry';
import { collectImageEditJsonResourceIdsV3 } from '../resourceReferences';
import { collectImageEditMaskResourceIdsV3, type ImageEditLayerV3 } from '../layerTypes';

/** 所有内置内容均使用保存/导入同一 schema，不允许未知类型 fallback。 */
export function createImageEditLayerContentRegistryV3(): ImageEditLayerContentRegistryV3 {
  const registry = new ImageEditLayerContentRegistryV3();
  registerImageEditSmartContentV3(registry);
  for (const type of ['raster', 'text', 'shape', 'path', 'effect', 'adjustment', 'group'] as const) {
    registry.register({ type, schema: imageLayerSchema as z.ZodType<ImageEditLayerV3>, resourceIds: layer => {
      const output = collectImageEditJsonResourceIdsV3(layer);
      if (layer.mask) output.push(...collectImageEditMaskResourceIdsV3(layer.mask));
      for (const filter of layer.filters) if (filter.mask) output.push(...collectImageEditMaskResourceIdsV3(filter.mask));
      if (layer.type === 'raster') {
        if (layer.source.kind === 'resource') output.push(layer.source.resourceId);
        output.push(...Object.values(layer.tiles));
      }
      if (layer.type === 'group') for (const child of layer.children) output.push(...registry.resourceIds(child));
      return [...new Set(output)].sort();
    } });
  }
  return registry;
}
