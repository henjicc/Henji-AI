import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus';
import { prepareImageEditFilterConversionV3, commitImageEditFilterConversionV3 } from './service';
import { describe, expect, it } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3, createImageEditEffectLayerV3, createImageEditGroupLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes';
import { applyImageEditCommandV3 } from '@/core/imageEdit/v3/commandReducer';
import { prepareImageEditCommandResourceMetadataV3 } from '@/core/imageEdit/v3/commandLayerResourceMetadata';
import { planImageEditFilterConversionV3 } from './conversion';

function fixture() {
  const document = createImageEditDocumentV3({ width: 40, height: 30 });
  const content = createImageEditRasterLayerV3('content', '主体');
  content.filters = [{ id: 'blur', operationType: 'effect', effectId: 'gaussian_blur', params: {}, enabled: false, opacity: .7, blendMode: 'screen', mask: createImageEditSparseMaskReferenceV3('local', true, 0) }];
  document.layers = [createImageEditRasterLayerV3('bottom', '背景'), content];
  return document;
}
describe('filter scope conversion planning', () => {
  it('makes the scope expansion explicit and preserves settings and mask ownership', () => {
    const document = fixture();
    const plan = planImageEditFilterConversionV3(document, { direction: 'content-to-composite', layerId: 'content', filterId: 'blur', title: '模糊层' }, {});
    expect(plan.beforeTargets).toEqual(['主体']); expect(plan.afterTargets).toEqual(['背景', '主体']);
    expect(plan.changesOrder).toBe(false);
    let current = document;
    for (const command of plan.commands) current = applyImageEditCommandV3(current, prepareImageEditCommandResourceMetadataV3(current, command, new Map())).document;
    expect(current.layers[1].filters).toEqual([]);
    expect(current.layers[2]).toMatchObject({ opacity: .7, blendMode: 'screen', renderable: false, mask: document.layers[1].filters[0].mask });
    const back = planImageEditFilterConversionV3(current, { direction: 'composite-to-content', layerId: current.layers[2].id, targetLayerId: 'content' }, {});
    expect(back.beforeTargets).toEqual(['背景', '主体']); expect(back.afterTargets).toEqual(['主体']);
    const update = back.commands[0];
    expect(update.type === 'layer.update-common' && update.patch.filters?.[0]).toMatchObject({ enabled: false, opacity: .7, blendMode: 'screen' });
    expect(document.layers[1].filters).toHaveLength(1);
  });
  it('确认转换只发布一条历史，撤销整组恢复；过期计划无部分提交', () => {
    const document = fixture(), bus = new ImageEditCommandBusV3(document);
    const plan = prepareImageEditFilterConversionV3(bus, { direction: 'content-to-composite', layerId: 'content', filterId: 'blur', title: '模糊层' });
    commitImageEditFilterConversionV3(bus, plan);
    expect(bus.getSnapshot().document.revision).toBe(1); expect(bus.getSnapshot().history.undoCount).toBe(1);
    const converted = bus.getSnapshot().document.layers;
    bus.undo(); expect(bus.getSnapshot().document.layers).toEqual(document.layers);
    bus.redo(); expect(bus.getSnapshot().document.layers).toEqual(converted);
    const before = bus.getSnapshot().document;
    expect(() => commitImageEditFilterConversionV3(bus, plan)).toThrow();
    expect(bus.getSnapshot().document).toBe(before); bus.dispose();
  });
  it('reports reordered processing and constrains scope to the current group', () => {
    const document = fixture();
    document.layers[1].filters.push({ ...document.layers[1].filters[0], id: 'later' });
    const group = createImageEditGroupLayerV3('g', '组'); group.children = [document.layers[1]];
    document.layers = [document.layers[0], group];
    const plan = planImageEditFilterConversionV3(document, { direction: 'content-to-composite', layerId: 'content', filterId: 'blur', title: '模糊' }, {});
    expect(plan.afterTargets).toEqual(['主体']); expect(plan.changesOrder).toBe(true);
    expect(plan.commands[1]).toMatchObject({ parentId: 'g', index: 1 });
  });
  it('rejects metadata or mask transforms that cannot be represented without baking', () => {
    const document = fixture();
    const layer = createImageEditEffectLayerV3('effect', '模糊', 'gaussian_blur', {}); layer.maskAttachment.density = .5;
    document.layers.push(layer);
    expect(() => planImageEditFilterConversionV3(document, { direction: 'composite-to-content', layerId: 'effect', targetLayerId: 'content' }, {})).toThrow('浓度');
    layer.maskAttachment.density = 1;
    document.layers[1].locked = true;
    expect(() => planImageEditFilterConversionV3(document, { direction: 'composite-to-content', layerId: 'effect', targetLayerId: 'content' }, {})).toThrow('紧邻');
  });
});
