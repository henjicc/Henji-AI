import type { z } from 'zod';
import type { ImageEditLayerV3 } from '../layerTypes';

/** 内置内容模块只登记有限类型和正式 schema；持久文档不保存代码或任意 payload。 */
export interface ImageEditLayerContentDefinitionV3<T extends ImageEditLayerV3['type']> {
  type: T;
  schema: z.ZodType<Extract<ImageEditLayerV3, { type: T }>>;
  resourceIds(layer: Extract<ImageEditLayerV3, { type: T }>): readonly string[];
}

export class ImageEditLayerContentRegistryV3 {
  private readonly entries = new Map<ImageEditLayerV3['type'], {
    parse(value: unknown): ImageEditLayerV3;
    resourceIds(value: unknown): readonly string[];
  }>();
  register<T extends ImageEditLayerV3['type']>(entry: ImageEditLayerContentDefinitionV3<T>): void {
    if (this.entries.has(entry.type)) throw new Error(`图层内容重复登记：${entry.type}`);
    this.entries.set(entry.type, {
      parse: value => entry.schema.parse(value),
      resourceIds: value => entry.resourceIds(entry.schema.parse(value)),
    });
  }
  parse(type: ImageEditLayerV3['type'], value: unknown): ImageEditLayerV3 {
    const entry = this.entries.get(type);
    if (!entry) throw new Error(`图层内容没有正式 schema：${type}`);
    const layer = entry.parse(value);
    if (layer.type !== type) throw new Error('图层内容登记与 schema 类型不一致');
    return layer;
  }
  resourceIds(layer: ImageEditLayerV3): readonly string[] {
    const entry = this.entries.get(layer.type);
    if (!entry) throw new Error(`图层内容没有资源枚举器：${layer.type}`);
    return entry.resourceIds(this.parse(layer.type, layer));
  }
}
