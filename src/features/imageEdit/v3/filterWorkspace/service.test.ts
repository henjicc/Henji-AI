import { afterEach, describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditEffectLayerV3, createImageEditGroupLayerV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import { createImageEditSparseMaskReferenceV3 } from '@/core/imageEdit/v3/layerTypes';
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus';
import { addImageEditFilterV3, changeImageEditFilterV3 } from './service';
import type { ImageEditFilterChoiceV3 } from './catalog';
import { ImageEditorV3CommandRepository } from '@/commands/imageEditorV3';

const materialize = vi.hoisted(() => vi.fn());
vi.mock('../application/imageEditSelectionServiceV3', () => ({ materializeImageEditSelectionMaskV3: materialize }));
const choice: ImageEditFilterChoiceV3 = { id: 'gaussian_blur', kind: 'effect', title: '高斯模糊', titleKey: 'blur', available: true };
const resource = `sha256:${'a'.repeat(64)}`;
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); });
function setup() {
  const document = createImageEditDocumentV3({ width: 32, height: 24 });
  document.layers = [createImageEditRasterLayerV3('bottom', '底图'), createImageEditRasterLayerV3('top', '主体')];
  return new ImageEditCommandBusV3(document);
}
describe('filter workspace uses the document history', () => {
  it('supports ordinary content layers, order, toggle and one-command undo', async () => {
    const bus = setup();
    const first = await addImageEditFilterV3(bus, 'top', choice, 'content', '高斯模糊');
    const second = await addImageEditFilterV3(bus, 'top', choice, 'content', '高斯模糊');
    changeImageEditFilterV3(bus, 'top', second, { kind: 'move', index: 0 });
    expect(bus.getSnapshot().document.layers[1].filters.map(f => f.id)).toEqual([second, first]);
    bus.undo();
    expect(bus.getSnapshot().document.layers[1].filters.map(f => f.id)).toEqual([first, second]);
    changeImageEditFilterV3(bus, 'top', first, { kind: 'update', patch: { enabled: false } });
    expect(bus.getSnapshot().document.layers[1].filters[0].enabled).toBe(false);
    bus.undo();
    expect(bus.getSnapshot().document.layers[1].filters[0].enabled).toBe(true);
    changeImageEditFilterV3(bus, 'top', first, { kind: 'remove' });
    bus.undo();
    expect(bus.getSnapshot().document.layers[1].filters[0].id).toBe(first);
  });
  it('creates a below-composite filter in the selected group', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 24 });
    const group = createImageEditGroupLayerV3('group', '组合');
    group.children = [createImageEditRasterLayerV3('content', '内容')];
    document.layers = [group];
    const bus = new ImageEditCommandBusV3(document);
    const id = await addImageEditFilterV3(bus, 'content', choice, 'below', '高斯模糊');
    const result = bus.getSnapshot().document.layers[0];
    expect(result.type === 'group' && result.children[1].id).toBe(id);
    bus.undo();
    const undone = bus.getSnapshot().document.layers[0];
    expect(undone.type === 'group' && undone.children.length).toBe(1);
  });
  it('samples local masks after target transforms while retaining the ancestor coordinate space', async () => {
    const document = createImageEditDocumentV3({ width: 32, height: 24 });
    const group = createImageEditGroupLayerV3('group', '组合'); group.transform = [2, 0, 0, 2, 5, 7];
    const content = createImageEditRasterLayerV3('content', '内容'); content.transform = [1, 0, 0, 1, 9, 3];
    group.children = [content]; document.layers = [group];
    const bus = new ImageEditCommandBusV3(document); bus.setSelection({ operations: [], feather: 0, inverted: true });
    materialize.mockResolvedValueOnce({ mask: createImageEditSparseMaskReferenceV3('local'), resources: [] });
    await addImageEditFilterV3(bus, 'content', choice, 'content', '局部模糊');
    expect(materialize.mock.calls[0][1].transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(materialize.mock.calls[0][2]).toBe('group');
  });
  it('persists an independent selection snapshot in the document grid', async () => {
    const bus = setup();
    bus.setSelection({ operations: [], feather: 0, inverted: true });
    const mask = createImageEditSparseMaskReferenceV3('selection', false, 0);
    mask.tiles['0/0/0'] = resource;
    materialize.mockResolvedValue({ mask, resources: [{ resourceId: resource, byteSize: 4096 }] });
    await addImageEditFilterV3(bus, 'top', choice, 'content', '局部模糊');
    expect(materialize.mock.calls[0][1].transform).toEqual([1, 0, 0, 1, 0, 0]);
    expect(materialize.mock.calls[0][2]).toBeNull();
    mask.tiles['0/0/0'] = 'later-selection';
    expect(bus.getSnapshot().document.layers[1].filters[0].mask?.tiles['0/0/0']).toBe(resource);
    bus.undo();
    expect(bus.getSnapshot().document.layers[1].filters).toEqual([]);
    expect(bus.getPersistenceSnapshot().retainedResources.some(r => r.resourceId === resource)).toBe(true);
    bus.redo();
    expect(bus.getSnapshot().document.layers[1].filters[0].mask?.tiles['0/0/0']).toBe(resource);
  });
  it('retains both old and new filter mask resources', async () => {
    const bus = setup();
    const first = await addImageEditFilterV3(bus, 'top', choice, 'content', '模糊');
    const mask = createImageEditSparseMaskReferenceV3('old'); mask.tiles['0/0/0'] = resource;
    bus.dispatch({ type: 'layer.update-common', commandId: 'mask', expectedRevision: bus.getSnapshot().document.revision,
      layerId: 'top', patch: { filters: [{ ...bus.getSnapshot().document.layers[1].filters[0], mask }] }, resources: [{ resourceId: resource, byteSize: 4096 }] });
    await addImageEditFilterV3(bus, 'top', choice, 'content', '再模糊');
    changeImageEditFilterV3(bus, 'top', first, { kind: 'remove' });
    expect(bus.getPersistenceSnapshot().retainedResources.some(r => r.resourceId === resource)).toBe(true);
  });
  it('rejects locked targets, unsupported choices and stacking on filter layers', async () => {
    const bus = setup();
    bus.dispatch({ type: 'layer.update-common', commandId: 'lock', expectedRevision: 0, layerId: 'top', patch: { locked: true } });
    await expect(addImageEditFilterV3(bus, 'top', choice, 'content', '模糊')).rejects.toThrow('解锁');
    await expect(addImageEditFilterV3(bus, 'bottom', { ...choice, available: false }, 'content', '模糊')).rejects.toThrow('不可用');
    bus.dispatch({ type: 'layer.add', commandId: 'effect', expectedRevision: bus.getSnapshot().document.revision, parentId: null, index: 2,
      layer: createImageEditEffectLayerV3('filter-layer', '滤镜', 'gaussian_blur', {}) });
    await expect(addImageEditFilterV3(bus, 'filter-layer', choice, 'content', '模糊')).rejects.toThrow('像素图层');
  });
  it('does not commit a cancelled job', async () => {
    const bus = setup();
    const abort = new AbortController(); abort.abort();
    await expect(addImageEditFilterV3(bus, 'top', choice, 'content', '模糊', { signal: abort.signal })).rejects.toThrow();
    expect(bus.getSnapshot().history.undoCount).toBe(0);
    expect(bus.getSnapshot().document.layers[1].filters).toEqual([]);
  });
  it('links rasterization cancellation to document disposal', async () => {
    const bus = setup(); bus.setSelection({ operations: [], feather: 0, inverted: true });
    materialize.mockImplementationOnce(async (_bus, _layer, _parent, _mode, signal: AbortSignal) => {
      bus.dispose(); expect(signal.aborted).toBe(true); signal.throwIfAborted();
    });
    await expect(addImageEditFilterV3(bus, 'top', choice, 'content', '模糊')).rejects.toThrow();
    expect(bus.getSnapshot().document.layers[1].filters).toEqual([]);
  });
  it('rejects stale selection results and collects orphan resources without losing edits', async () => {
    const bus = setup(); bus.setSelection({ operations: [], feather: 0, inverted: true });
    const collect = vi.spyOn(ImageEditorV3CommandRepository.prototype, 'collectGarbage').mockResolvedValue();
    const mask = createImageEditSparseMaskReferenceV3('stale'); mask.tiles['0/0/0'] = resource;
    materialize.mockImplementationOnce(async () => {
      bus.dispatch({ type: 'layer.update-common', commandId: 'concurrent-name', expectedRevision: 0, layerId: 'top', patch: { name: '新名称' } });
      return { mask, resources: [{ resourceId: resource, byteSize: 4096 }] };
    });
    await expect(addImageEditFilterV3(bus, 'top', choice, 'content', '局部模糊')).rejects.toThrow('已变化');
    expect(bus.getSnapshot().document.layers[1].name).toBe('新名称');
    expect(bus.getSnapshot().document.layers[1].filters).toEqual([]);
    expect(collect).toHaveBeenCalledWith(bus.getSnapshot().document.id, []);
  });
});
