import type { ImageEditGroupLayerV3, ImageEditLayerV3 } from './layerTypes';

export interface ImageEditCommandLayerLocationV3 {
  layer: ImageEditLayerV3;
  parentId: string | null;
  index: number;
  ancestors: ImageEditGroupLayerV3[];
}

export function findImageEditCommandLayerLocationV3(
  layers: readonly ImageEditLayerV3[],
  layerId: string,
  parentId: string | null = null,
  ancestors: ImageEditGroupLayerV3[] = [],
): ImageEditCommandLayerLocationV3 | null {
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (layer.id === layerId) return { layer, parentId, index, ancestors };
    if (layer.type === 'group') {
      const nested = findImageEditCommandLayerLocationV3(
        layer.children,
        layerId,
        layer.id,
        [...ancestors, layer],
      );
      if (nested) return nested;
    }
  }
  return null;
}
