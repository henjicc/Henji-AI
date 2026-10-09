import { z } from 'zod';
import { isImageEditTransformInvertibleV3 } from '../execution/affineTransform';
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes';
import { imageEditRenderDefinitionIdForOperationV3, parseImageEditSharedEffectParametersV3 } from '../operationCatalog';
import { parseImageColorGradeParams } from '../../../imaging/adjustments/schema';
import type { ImageEditLayerV3 } from '../layerTypes';

export const imageEditTransformSchemaV3 = z.tuple([
  z.number().finite(), z.number().finite(), z.number().finite(),
  z.number().finite(), z.number().finite(), z.number().finite(),
]).refine(isImageEditTransformInvertibleV3, '变换必须是可逆的有限仿射矩阵');

export const imageEditSparseMaskSchemaV3 = z.object({
  kind: z.literal('sparse-mask'), storage: z.literal('mask-float32'),
  maskId: z.string().min(1), tileSize: z.literal(512),
  defaultValue: z.union([z.literal(0), z.literal(1)]),
  tiles: z.record(z.string().regex(/^0\/(?:0|[1-9]\d*)\/(?:0|[1-9]\d*)$/), z.string().min(1)),
  inverted: z.boolean(),
}).strict();

export const imageEditMaskAttachmentSchemaV3 = z.object({
  enabled: z.boolean(), linked: z.boolean(), density: z.number().min(0).max(1),
  /** 链接时相对内容空间；解绑时相对文档空间。 */
  transform: imageEditTransformSchemaV3,
}).strict();

export const imageEditLayerFilterSchemaV3 = z.object({
  id: z.string().min(1), operationType: z.enum(['effect', 'adjustment']),
  effectId: z.string().min(1), params: z.record(z.string(), z.json()),
  enabled: z.boolean(), opacity: z.number().min(0).max(1),
  blendMode: z.enum(['normal', 'multiply', 'screen', 'overlay', 'soft-light']),
  mask: imageEditSparseMaskSchemaV3.nullable(),
}).strict().superRefine((filter, context) => {
  const id = imageEditRenderDefinitionIdForOperationV3(filter.effectId, filter.operationType);
  const definition = createBuiltInImageEditRenderNodeRegistry().get(id);
  if (!definition?.cpu || !definition.operation) {
    context.addIssue({ code: 'custom', path: ['effectId'], message: '滤镜未登记可求值的共享节点' });
    return;
  }
  try {
    if (filter.operationType === 'effect') parseImageEditSharedEffectParametersV3(filter.effectId, filter.params);
    if (filter.effectId === 'color_grade') parseImageColorGradeParams(filter.params);
  } catch {
    context.addIssue({ code: 'custom', path: ['params'], message: '滤镜参数无效' });
  }
});

export const imageEditLayerFiltersSchemaV3 = z.array(imageEditLayerFilterSchemaV3)
  .refine(filters => new Set(filters.map(filter => filter.id)).size === filters.length, '滤镜标识重复');

/** 剪贴只指向同一容器中下方连续栈的内容基底，不存第二份引用。 */
export function assertImageEditLayerSemanticsV3(layers: readonly ImageEditLayerV3[]): void {
  const ids = new Set<string>();
  const visit = (entries: readonly ImageEditLayerV3[]): void => {
    let hasBase = false;
    for (const layer of entries) {
      if (ids.has(layer.id)) throw new Error('图层标识重复或图层树循环');
      ids.add(layer.id);
      if (!Number.isFinite(layer.fillOpacity) || layer.fillOpacity < 0 || layer.fillOpacity > 1
        || typeof layer.clipping !== 'boolean') throw new Error('填充或剪贴属性无效');
      imageEditMaskAttachmentSchemaV3.parse(layer.maskAttachment);
      imageEditLayerFiltersSchemaV3.parse(layer.filters);
      const content = layer.type === 'raster' || layer.type === 'annotation' || layer.type === 'group';
      if (!content && layer.filters.length) throw new Error('作用域滤镜层不能再挂内容滤镜；请添加独立滤镜层');
      if (layer.clipping && (!hasBase || !content)) throw new Error('剪贴层需要同组下方的内容基底');
      if (!layer.clipping) hasBase = content;
      if (layer.type === 'group') visit(layer.children);
    }
  };
  visit(layers);
}
