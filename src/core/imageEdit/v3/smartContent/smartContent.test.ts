import { describe, expect, it } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '../documentFactory';
import { decodeImageEditDocumentV3 } from '../documentCodec';
import { ImageEditCommandHistoryV3 } from '../commandHistory';
import { decodeImageEditCommandHistorySnapshotV3 } from '../commandHistoryCodec';
import { applyImageEditCommandV3 } from '../commandReducer';
import { collectImageEditResourceRolesV3 } from '../resourceRoles';
import { collectImageEditJsonResourceIdsV3 } from '../resourceReferences';
import { createImageEditContentReplacementV3, embedImageEditRasterV3, rasterizeImageEditSmartLayerV3, updateImageEditSmartInstancesV3 } from './commands';
import { assertImageEditSmartGraphV3 } from './graph';
import { compileImageEditRenderPlanV3 } from '../renderPlanCompiler';
import { createBuiltInImageEditRenderNodeRegistry } from '../builtInRenderNodes';

const resource = `sha256:${'a'.repeat(64)}`, cache = `sha256:${'b'.repeat(64)}`;
function fixture() {
  const document = createImageEditDocumentV3({ width: 64, height: 48, documentId: 'parent', sourceResourceId: resource });
  document.layers[0].filters = [{ id: 'exposure', operationType: 'adjustment', effectId: 'exposure', params: { stops: .5 }, enabled: true, opacity: 1, blendMode: 'normal', mask: null }];
  document.layers[0].deformation = { kind: 'perspective', points: [[.1, 0], [1, 0], [1, 1], [0, 1]] };
  const layer = embedImageEditRasterV3(document, document.layers[0].id);
  document.layers = [layer, { ...structuredClone(layer), id: 'copy', transform: [1, 0, 0, 1, 20, 4] }];
  return { document, layer };
}
describe('智能对象权威内容、实例和资源', () => {
  it('编码后可重开分层内容，实例滤镜不进入内容或被执行两次', () => {
    const { document, layer } = fixture();
    const reopened = decodeImageEditDocumentV3(JSON.stringify(document));
    expect(reopened.document).toEqual(document);
    expect(layer.content.document.layers[0].filters).toEqual([]);
    expect(layer.content.document.layers[0].deformation).toBeUndefined();
    const plan = compileImageEditRenderPlanV3(document, createBuiltInImageEditRenderNodeRegistry(), 'export');
    expect(plan.nodes.filter(node => node.definitionId === 'adjustment.exposure')).toHaveLength(2);
  });
  it('同源实例一起刷新，一次撤销/重做，资源和变换保留', () => {
    const { document, layer } = fixture();
    const content = { ...layer.content, document: { ...layer.content.document, revision: 1 } };
    const command = updateImageEditSmartInstancesV3(document, content, { source: { kind: 'empty' }, tiles: { '0/0/0': cache } }, { [resource]: 100, [cache]: 1024 });
    const history = new ImageEditCommandHistoryV3(); history.clear(document);
    const updated = history.execute(document, command);
    const snapshot = decodeImageEditCommandHistorySnapshotV3(JSON.stringify(history.createSnapshot())).snapshot;
    const reopenedHistory = new ImageEditCommandHistoryV3(); reopenedHistory.restore(updated, snapshot);
    expect(reopenedHistory.undo(updated).document.layers).toEqual(document.layers);
    expect(updated.layers.map(item => item.transform)).toEqual(document.layers.map(item => item.transform));
    expect(updated.layers.every(item => item.type === 'smart' && item.content.document.revision === 1)).toBe(true);
    expect(history.getState().undoCount).toBe(1);
    const restored = history.undo(updated).document;
    expect(restored.layers).toEqual(document.layers);
    expect(history.redo(restored).document.layers).toEqual(updated.layers);
    expect(collectImageEditResourceRolesV3(updated).sparse.has(cache)).toBe(true);
    expect(collectImageEditJsonResourceIdsV3(updated)).toEqual([resource, cache]);
    expect(decodeImageEditDocumentV3(updated).document).toEqual(updated);
  });
  it('栅格化保留原生尺寸和 R13 滤镜，撤销恢复可编辑内容', () => {
    const { document, layer } = fixture();
    const raster = rasterizeImageEditSmartLayerV3(layer);
    const command = createImageEditContentReplacementV3(document, raster, { [resource]: 100 });
    const result = applyImageEditCommandV3(document, command);
    expect(result.document.layers[0].type).toBe('raster');
    expect(result.document.layers[0]).toMatchObject({ filters: layer.filters, rasterCanvasSize: { width: 64, height: 48 } });
    expect(applyImageEditCommandV3(result.document, result.inverse).document.layers).toEqual(document.layers);
  });
  it('拒绝直接/间接来源循环、非 JSON 循环与不一致实例', () => {
    const { document, layer } = fixture();
    const cycle = structuredClone(document); const smart = cycle.layers[0];
    if (smart.type !== 'smart') throw new Error('fixture');
    smart.content.origin = { kind: 'image_edit.document', id: 'v3:parent' };
    expect(decodeImageEditDocumentV3(cycle).document).toBeNull();
    const indirect = structuredClone(layer); indirect.content.document.layers = [{ ...structuredClone(layer), id: 'nested' }];
    expect(() => assertImageEditSmartGraphV3(indirect)).toThrow(/上级内容/);
    const object: { self?: unknown } = {}; object.self = object;
    expect(() => assertImageEditSmartGraphV3(object)).toThrow(/循环/);
    const inconsistent = structuredClone(document);
    if (inconsistent.layers[1].type === 'smart') inconsistent.layers[1].content.document.revision++;
    expect(decodeImageEditDocumentV3(inconsistent).document).toBeNull();
  });
  it('资源枚举不按图层数量或层级拒绝', () => {
    let tree: unknown = resource;
    for (let i = 0; i < 500; i++) tree = [tree];
    expect(collectImageEditJsonResourceIdsV3(tree)).toEqual([resource]);
    const document = createImageEditDocumentV3({ width: 1, height: 1 }); document.layers = [createImageEditRasterLayerV3('empty', '空白')];
    expect(embedImageEditRasterV3(document, 'empty').content.document.layers).toHaveLength(1);
  });
});
