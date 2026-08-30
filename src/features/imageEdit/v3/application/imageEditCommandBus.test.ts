import { describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import type { ImageEditDocumentRepositoryV3 } from '@/core/imageEdit/v3/serviceContracts';
import { ImageEditCommandBusV3 } from './imageEditCommandBus';

function createRepository(): ImageEditDocumentRepositoryV3 {
  return {
    load: vi.fn(),
    save: vi.fn(),
    scheduleAutosave: vi.fn(),
    cancelAutosave: vi.fn(),
    collectGarbage: vi.fn(),
  };
}

describe('图片编辑 V3 命令总线', () => {
  it('滑杆过程不改 revision、不写盘，结束只产生一条历史', () => {
    const repository = createRepository();
    const initial = createImageEditDocumentV3({ width: 100, height: 100, documentId: 'doc' });
    const bus = new ImageEditCommandBusV3(initial, { repository });
    bus.setPreview({ id: 'gesture', kind: 'parameter', targetId: 'layer', baseRevision: 0, value: 0.2 });
    bus.setPreview({ id: 'gesture', kind: 'parameter', targetId: 'layer', baseRevision: 0, value: 0.8 });
    expect(bus.getSnapshot().document.revision).toBe(0);
    expect(repository.scheduleAutosave).not.toHaveBeenCalled();

    bus.commitPreview('gesture', {
      type: 'layer.add', commandId: 'add', expectedRevision: 0, parentId: null, index: 0,
      layer: createImageEditRasterLayerV3('layer', '图层'),
    });
    expect(bus.getSnapshot()).toMatchObject({
      document: { revision: 1 },
      history: { undoCount: 1 },
      previewOverrides: {},
    });
    expect(repository.scheduleAutosave).toHaveBeenCalledOnce();
  });

  it('撤销重做都通过命令历史并清空瞬态覆盖', () => {
    const initial = createImageEditDocumentV3({ width: 100, height: 100, documentId: 'doc' });
    const bus = new ImageEditCommandBusV3(initial);
    bus.dispatch({
      type: 'layer.add', commandId: 'add', expectedRevision: 0, parentId: null, index: 0,
      layer: createImageEditRasterLayerV3('layer', '图层'),
    });
    bus.setPreview({ id: 'move', kind: 'transform', targetId: 'layer', baseRevision: 1, value: [1, 0, 0, 1, 2, 3] });
    expect(bus.undo()).toBe(true);
    expect(bus.getSnapshot().document.layers).toHaveLength(0);
    expect(bus.getSnapshot().previewOverrides).toEqual({});
    expect(bus.redo()).toBe(true);
    expect(bus.getSnapshot().document.layers).toHaveLength(1);
  });

  it('从持久快照恢复后仍可撤销，瞬态预览不触发持久回调', () => {
    const retained = `sha256:${'a'.repeat(64)}`;
    const persistentChanges = vi.fn();
    const initial = createImageEditDocumentV3({ width: 100, height: 100, documentId: 'restart' });
    const first = new ImageEditCommandBusV3(initial);
    first.dispatch({
      type: 'layer.add', commandId: 'add-before-restart', expectedRevision: 0,
      parentId: null, index: 0,
      layer: createImageEditRasterLayerV3('layer', '图层', retained),
    });
    const persisted = first.getPersistenceSnapshot();

    const restored = new ImageEditCommandBusV3(persisted.document, {
      historySnapshot: persisted.history,
      onPersistentChange: persistentChanges,
    });
    restored.setPreview({
      id: 'pointer-preview', kind: 'parameter', targetId: 'layer',
      baseRevision: persisted.document.revision, value: 0.5,
    });
    expect(persistentChanges).not.toHaveBeenCalled();
    expect(restored.undo()).toBe(true);
    expect(restored.getSnapshot().document.layers).toHaveLength(0);
    expect(persistentChanges).toHaveBeenCalledWith(expect.objectContaining({
      history: expect.objectContaining({ documentId: 'restart', headRevision: 2 }),
      retainedResources: [{ resourceId: retained, byteSize: null }],
    }));
  });
});
