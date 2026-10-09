import { describe, expect, it } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3, createImageEditGroupLayerV3 } from '../documentFactory';
import { applyImageEditCommandV3 } from '../commandReducer';
import { parseImageEditDocumentV3, stringifyImageEditDocumentV3 } from '../documentCodec';
import { createImageEditSparseMaskReferenceV3 } from '../layerTypes';
import { collectImageEditLayerResourceIdsForCommandV3 } from '../commandTypes';
import { prepareImageEditCommandResourceMetadataV3 } from '../commandLayerResourceMetadata';
import { imageEditLayerFiltersSchemaV3 } from './semantics';
import { createImageEditLayerContentRegistryV3 } from '../layerEntries/base';

const ref = `sha256:${'a'.repeat(64)}`;
function document() {
  const result = createImageEditDocumentV3({ width: 4, height: 2, documentId: 'semantics' });
  result.layers = [createImageEditRasterLayerV3('base', '基底'), createImageEditRasterLayerV3('top', '剪贴')];
  return result;
}
describe('图层共同语义与正式格式', () => {
  it('填充、剪贴、独立蒙版和局部滤镜保存后保持快照；逆命令恢复共同字段', () => {
    const source = document();
    const patch = { fillOpacity: .3, clipping: true,
      maskAttachment: { enabled: true, linked: false, density: .4, transform: [1,0,0,1,2,0] as const },
      filters: [{ id: 'exposure', operationType: 'adjustment' as const, effectId: 'exposure', params: { stops: 1 },
        enabled: true, opacity: .8, blendMode: 'normal' as const, mask: createImageEditSparseMaskReferenceV3('region', false, 0) }],
    };
    const applied = applyImageEditCommandV3(source, { commandId: 'common', expectedRevision: 0, type: 'layer.update-common', layerId: 'top', patch });
    patch.filters[0].params.stops = 3;
    const restored = parseImageEditDocumentV3(stringifyImageEditDocumentV3(applied.document));
    expect(restored.layers[1]).toMatchObject({ fillOpacity: .3, clipping: true, filters: [{ params: { stops: 1 } }] });
    expect(applyImageEditCommandV3(restored, applied.inverse).document.layers).toEqual(source.layers);
  });

  it('删除/移动剪贴基底、无基底剪贴、跨组剪贴与循环全部原子拒绝', () => {
    const source = document(); source.layers[1].clipping = true;
    const group = createImageEditGroupLayerV3('group', '空组'); source.layers.push(group);
    for (const command of [
      { type: 'layer.delete' as const, layerId: 'base', resources: [] },
      { type: 'layer.move' as const, layerId: 'top', parentId: 'group', index: 0 },
      { type: 'layer.update-common' as const, layerId: 'base', patch: { clipping: true } },
      { type: 'layer.move' as const, layerId: 'group', parentId: 'group', index: 0 },
    ]) expect(() => applyImageEditCommandV3(source, { ...command, commandId: 'invalid', expectedRevision: 0 })).toThrow();
    expect(source.revision).toBe(0); expect(group.children).toEqual([]);
  });

  it('滤镜区域资源进入命令资源保留；删除滤镜仍保留撤销像素，缺描述符拒绝', () => {
    const source = document();
    const mask = createImageEditSparseMaskReferenceV3('filter-mask'); mask.tiles['0/0/0'] = ref;
    source.layers[1].filters = [{ id: 'local', operationType: 'adjustment', effectId: 'exposure', params: { stops: 1 },
      enabled: true, opacity: 1, blendMode: 'normal', mask }];
    expect(collectImageEditLayerResourceIdsForCommandV3(source.layers[1])).toEqual([ref]);
    const command = { commandId: 'remove-filter', expectedRevision: 0, type: 'layer.update-common' as const, layerId: 'top', patch: { filters: [] } };
    expect(() => applyImageEditCommandV3(source, command)).toThrow('资源');
    const prepared = prepareImageEditCommandResourceMetadataV3(source, command, new Map([[ref, 1_048_576]]));
    const applied = applyImageEditCommandV3(source, prepared);
    expect(applied.historyResources).toEqual([{ resourceId: ref, byteSize: 1_048_576 }]);
    expect(applyImageEditCommandV3(applied.document, applied.inverse).document.layers).toEqual(source.layers);
  });

  it('未知滤镜、重复标识、退化蒙版变换与错类型内容登记拒绝', () => {
    const source = document();
    source.layers[0].maskAttachment.transform = [0,0,0,0,0,0];
    expect(() => stringifyImageEditDocumentV3(source)).toThrow();
    expect(() => createImageEditLayerContentRegistryV3().parse('raster', createImageEditGroupLayerV3('g','g'))).toThrow();
    const filter = { id: 'x', effectId: 'missing', operationType: 'effect', params: {}, enabled: true, opacity: 1, blendMode: 'normal', mask: null };
    expect(imageEditLayerFiltersSchemaV3.safeParse([filter]).success).toBe(false);
    expect(imageEditLayerFiltersSchemaV3.safeParse([{ ...filter, effectId: 'exposure', operationType: 'adjustment' }, { ...filter, effectId: 'exposure', operationType: 'adjustment' }]).success).toBe(false);
  });
});
