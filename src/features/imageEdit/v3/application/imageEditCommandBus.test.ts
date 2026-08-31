import { describe, expect, it, vi } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from '@/core/imageEdit/v3/documentFactory';
import type { ImageEditDocumentRepositoryV3 } from '@/core/imageEdit/v3/serviceContracts';
import { ImageEditCommandBusV3 } from './imageEditCommandBus';
import { projectImageEditorPreviewDocumentV3 } from '../execution/previewDocumentV3';

function createRepository(): ImageEditDocumentRepositoryV3 {
  return {
    load: vi.fn(),
    save: vi.fn(),
    scheduleAutosave: vi.fn(),
    scheduleGarbageCollection: vi.fn(),
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

  it('一次移动手势可连续覆盖预览，但只提交一个可撤销变换历史', () => {
    const repository = createRepository();
    const initial = createImageEditDocumentV3({ width: 10, height: 10, documentId: 'move' });
    initial.layers = [createImageEditRasterLayerV3('layer', '图层')];
    const bus = new ImageEditCommandBusV3(initial, { repository });

    bus.setPreview({
      id: 'move-gesture', kind: 'transform', targetId: 'layer', baseRevision: 0,
      value: [1, 0, 0, 1, 2, 3],
    });
    bus.setPreview({
      id: 'move-gesture', kind: 'transform', targetId: 'layer', baseRevision: 0,
      value: [1, 0, 0, 1, 7, 9],
    });
    expect(projectImageEditorPreviewDocumentV3(bus.getSnapshot()).layers[0].transform)
      .toEqual([1, 0, 0, 1, 7, 9]);
    expect(bus.getSnapshot()).toMatchObject({ document: { revision: 0 }, history: { undoCount: 0 } });
    expect(repository.scheduleAutosave).not.toHaveBeenCalled();

    bus.commitPreview('move-gesture', {
      type: 'layer.update-common', commandId: 'move-layer', expectedRevision: 0,
      layerId: 'layer', patch: { transform: [1, 0, 0, 1, 7, 9] },
    });
    expect(bus.getSnapshot()).toMatchObject({ document: { revision: 1 }, history: { undoCount: 1 } });
    expect(bus.undo()).toBe(true);
    expect(bus.getSnapshot().document.layers[0].transform).toEqual([1, 0, 0, 1, 0, 0]);
  });

  it('预览入口明确拒绝奇异变换', () => {
    const bus = new ImageEditCommandBusV3(
      createImageEditDocumentV3({ width: 10, height: 10, documentId: 'singular' }),
    );
    expect(() => bus.setPreview({
      id: 'singular', kind: 'transform', targetId: 'layer', baseRevision: 0,
      value: [0, 0, 0, 1, 0, 0],
    })).toThrow(/可逆/);
  });

  it('从持久快照恢复后仍可撤销，瞬态预览不触发持久回调', () => {
    const retained = `sha256:${'a'.repeat(64)}`;
    const persistentChanges = vi.fn();
    const initial = createImageEditDocumentV3({ width: 100, height: 100, documentId: 'restart' });
    const first = new ImageEditCommandBusV3(initial, {
      resourceByteSizes: { [retained]: 4_096 },
    });
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
      retainedResources: [{ resourceId: retained, byteSize: 4_096 }],
    }));
  });

  it('为新增、删除、复制、分组和解组统一生成完整且稳定排序的资源描述', () => {
    const source = `sha256:${'1'.repeat(64)}`;
    const tile = `sha256:${'2'.repeat(64)}`;
    const mask = `sha256:${'3'.repeat(64)}`;
    const layer = createImageEditRasterLayerV3('layer', '图层', source);
    layer.tiles = { '0/0/0': tile };
    layer.mask = { resourceId: mask, inverted: false };
    const bus = new ImageEditCommandBusV3(
      createImageEditDocumentV3({ width: 10, height: 10, documentId: 'structural-resources' }),
      { resourceByteSizes: { [source]: 8_192, [tile]: 2_048, [mask]: 512 } },
    );
    const expected = [
      { resourceId: source, byteSize: 8_192 },
      { resourceId: tile, byteSize: 2_048 },
      { resourceId: mask, byteSize: 512 },
    ];
    const expectLatestResources = (): void => {
      const entry = bus.getPersistenceSnapshot().history.undo.at(-1);
      expect(entry?.resources).toEqual(expected);
      const forward = entry?.forward;
      const inverse = entry?.inverse;
      expect(forward && 'resources' in forward ? forward.resources : undefined).toEqual(expected);
      expect(inverse && 'resources' in inverse ? inverse.resources : undefined).toEqual(expected);
    };

    bus.dispatch({
      type: 'layer.add', commandId: 'add-rich-layer', expectedRevision: 0,
      parentId: null, index: 0, layer,
    });
    expectLatestResources();
    bus.dispatch({
      type: 'layer.duplicate', commandId: 'duplicate-rich-layer', expectedRevision: 1,
      layerId: layer.id, parentId: null, index: 1, idMap: { layer: 'layer-copy' },
    });
    expectLatestResources();
    bus.dispatch({
      type: 'layer.group', commandId: 'group-rich-layers', expectedRevision: 2,
      layerIds: ['layer', 'layer-copy'],
      group: {
        id: 'group', name: '组', type: 'group', visible: true, locked: false,
        opacity: 1, blendMode: 'normal', transform: [1, 0, 0, 1, 0, 0],
        mask: null, isolated: false, children: [],
      },
    });
    expectLatestResources();
    bus.dispatch({
      type: 'layer.ungroup', commandId: 'ungroup-rich-layers', expectedRevision: 3,
      groupId: 'group',
    });
    expectLatestResources();
    bus.dispatch({
      type: 'layer.delete', commandId: 'delete-rich-layer', expectedRevision: 4,
      layerId: 'layer-copy',
    });
    expectLatestResources();
  });

  it('把历史淘汰释放事件从总线公开给 GC 编排层', () => {
    const resource = `sha256:${'4'.repeat(64)}`;
    const repository = createRepository();
    const released = vi.fn();
    const bus = new ImageEditCommandBusV3(
      createImageEditDocumentV3({ width: 10, height: 10, documentId: 'release-events' }),
      {
        repository,
        resourceByteSizes: { [resource]: 1_024 },
        history: { maxCommands: 1, onResourcesReleased: released },
      },
    );
    bus.dispatch({
      type: 'layer.add', commandId: 'resource-layer', expectedRevision: 0,
      parentId: null, index: 0,
      layer: createImageEditRasterLayerV3('resource', '资源', resource),
    });
    bus.dispatch({
      type: 'layer.add', commandId: 'empty-layer', expectedRevision: 1,
      parentId: null, index: 1,
      layer: createImageEditRasterLayerV3('empty', '空图层'),
    });

    expect(released).toHaveBeenCalledWith({
      reason: 'prune',
      resources: [{ resourceId: resource, byteSize: 1_024 }],
    });
    expect(repository.scheduleGarbageCollection).toHaveBeenCalledWith(
      'release-events',
      [resource],
    );
  });
});
