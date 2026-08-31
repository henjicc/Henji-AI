import { describe, expect, it, vi } from 'vitest';
import {
  IMAGE_EDIT_HISTORY_DEFAULT_MAX_BYTES_V3,
  IMAGE_EDIT_HISTORY_DEFAULT_MAX_COMMANDS_V3,
  ImageEditCommandHistoryV3,
} from './commandHistory';
import { InvalidImageEditHistorySnapshotV3Error } from './commandHistoryCodec';
import { ImageEditRevisionConflictErrorV3 } from './commandReducer';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from './documentFactory';
import type { ImageEditDocumentV3 } from './documentTypes';
import { createImageEditSparseMaskReferenceV3 } from './layerTypes';

function createPaintDocument(): ImageEditDocumentV3 {
  return {
    ...createImageEditDocumentV3({ width: 100, height: 80, documentId: 'document-history' }),
    layers: [createImageEditRasterLayerV3('paint', '画笔')],
  };
}

function addTile(
  history: ImageEditCommandHistoryV3,
  document: ImageEditDocumentV3,
  index: number,
  byteSize: number,
): ImageEditDocumentV3 {
  return history.execute(document, {
    commandId: `command-${index}`,
    expectedRevision: document.revision,
    type: 'raster.apply-tile-delta',
    layerId: 'paint',
    changes: [{
      tileKey: `0/${index}/0`,
      previousResourceId: null,
      previousByteSize: 0,
      resourceId: `sha256:${index}`,
      byteSize,
    }],
  });
}

function createStrictMaskHistoryFixture() {
  const paint = createImageEditRasterLayerV3('paint', '画笔');
  paint.mask = {
    ...createImageEditSparseMaskReferenceV3('old-mask'),
    tiles: { '0/0/0': 'sha256:old-mask' },
  };
  const source: ImageEditDocumentV3 = {
    ...createImageEditDocumentV3({ width: 100, height: 80, documentId: 'document-history-mask' }),
    layers: [paint],
  };
  const history = new ImageEditCommandHistoryV3();
  const changed = history.execute(source, {
    commandId: 'strict-mask-history',
    expectedRevision: 0,
    type: 'layer.set-mask',
    layerId: paint.id,
    mask: {
      ...createImageEditSparseMaskReferenceV3('next-mask', false, 0),
      tiles: { '0/0/0': 'sha256:next-a', '0/1/0': 'sha256:next-b' },
    },
    maskResources: [
      { resourceId: 'sha256:next-a', byteSize: 128 },
      { resourceId: 'sha256:next-b', byteSize: 256 },
    ],
    previousMaskResources: [{ resourceId: 'sha256:old-mask', byteSize: 64 }],
  });
  return { changed, history };
}

describe('图片编辑 V3 命令历史', () => {
  it('整次画笔手势只形成一条历史，撤销与重做原子覆盖全部瓦片', () => {
    const history = new ImageEditCommandHistoryV3();
    let document = createPaintDocument();
    document = history.execute(document, {
      commandId: 'pointer-gesture-1',
      expectedRevision: 0,
      type: 'raster.apply-tile-delta',
      layerId: 'paint',
      changes: [
        { tileKey: '0/0/0', previousResourceId: null, previousByteSize: 0, resourceId: 'sha256:a', byteSize: 1024 },
        { tileKey: '0/1/0', previousResourceId: null, previousByteSize: 0, resourceId: 'sha256:b', byteSize: 2048 },
        { tileKey: '0/2/0', previousResourceId: null, previousByteSize: 0, resourceId: 'sha256:c', byteSize: 4096 },
      ],
    });
    expect(history.getState()).toMatchObject({
      undoCount: 1,
      retainedResourceCount: 3,
      retainedResourceBytes: 7_168,
    });
    expect(document.revision).toBe(1);

    const undone = history.undo(document);
    expect(undone.changed).toBe(true);
    expect(undone.document.layers[0]).toMatchObject({ tiles: {} });
    expect(history.getState()).toMatchObject({ undoCount: 0, redoCount: 1, retainedResourceBytes: 7_168 });

    const redone = history.redo(undone.document);
    expect(redone.document.layers[0]).toMatchObject({
      tiles: { '0/0/0': 'sha256:a', '0/1/0': 'sha256:b', '0/2/0': 'sha256:c' },
    });
    expect(redone.document.revision).toBe(3);
  });

  it('默认上限固定为 200 条或 2GiB，并按命令数和真实资源字节先到者裁剪', () => {
    expect(IMAGE_EDIT_HISTORY_DEFAULT_MAX_COMMANDS_V3).toBe(200);
    expect(IMAGE_EDIT_HISTORY_DEFAULT_MAX_BYTES_V3).toBe(2 * 1024 * 1024 * 1024);

    const commandLimited = new ImageEditCommandHistoryV3({ maxCommands: 2, maxBytes: 1_000_000 });
    let commandDocument = createPaintDocument();
    for (let index = 0; index < 3; index += 1) {
      commandDocument = addTile(commandLimited, commandDocument, index, 16);
    }
    expect(commandLimited.getState()).toMatchObject({ undoCount: 2, retainedResourceCount: 2 });

    const byteLimited = new ImageEditCommandHistoryV3({ maxCommands: 10, maxBytes: 7_000 });
    const byteDocument = addTile(byteLimited, createPaintDocument(), 0, 5_000);
    addTile(byteLimited, byteDocument, 1, 5_000);
    expect(byteLimited.getState()).toMatchObject({ undoCount: 1, retainedResourceBytes: 5_000 });
  });

  it('跨相邻笔画去重资源预算，同时保留旧、新瓦片的真实大小', () => {
    const history = new ImageEditCommandHistoryV3();
    let document = createPaintDocument();
    document = addTile(history, document, 0, 3_000);
    history.execute(document, {
      commandId: 'replace-tile', expectedRevision: 1, type: 'raster.apply-tile-delta', layerId: 'paint',
      changes: [{
        tileKey: '0/0/0', previousResourceId: 'sha256:0', previousByteSize: 3_000,
        resourceId: 'sha256:new', byteSize: 7_000,
      }],
    });
    expect(history.getRetainedResources()).toEqual([
      { resourceId: 'sha256:0', byteSize: 3_000 },
      { resourceId: 'sha256:new', byteSize: 7_000 },
    ]);
    expect(history.getState()).toMatchObject({ retainedResourceCount: 2, retainedResourceBytes: 10_000 });
  });

  it('事务回滚丢弃补偿产生的重做项，并释放失败事务独占的资源租约', () => {
    const released = vi.fn();
    const history = new ImageEditCommandHistoryV3({ onResourcesReleased: released });
    const source = createPaintDocument();
    const first = addTile(history, source, 0, 128);
    const second = addTile(history, first, 1, 256);

    const rolledBack = history.rollbackCommands(second, ['command-1', 'command-0']);

    expect(rolledBack.changed).toBe(true);
    expect(rolledBack.document.layers[0]).toMatchObject({ tiles: {} });
    expect(history.getState()).toMatchObject({ undoCount: 0, redoCount: 0, retainedResourceCount: 0 });
    expect(history.redo(rolledBack.document)).toEqual({ document: rolledBack.document, changed: false });
    expect(released).toHaveBeenLastCalledWith({
      reason: 'rollback',
      resources: [
        { resourceId: 'sha256:0', byteSize: 128 },
        { resourceId: 'sha256:1', byteSize: 256 },
      ],
    });
  });

  it('裁剪、清空和清空 redo 时只通知真正失去历史租约的资源', () => {
    const released = vi.fn();
    const history = new ImageEditCommandHistoryV3({
      maxCommands: 1,
      maxBytes: 1_000_000,
      onResourcesReleased: released,
    });
    let document = createPaintDocument();
    document = addTile(history, document, 0, 100);
    document = addTile(history, document, 1, 200);
    expect(released).toHaveBeenLastCalledWith({
      reason: 'prune',
      resources: [{ resourceId: 'sha256:0', byteSize: 100 }],
    });

    const undone = history.undo(document);
    document = history.execute(undone.document, {
      commandId: 'replace-redo', expectedRevision: undone.document.revision,
      type: 'raster.apply-tile-delta', layerId: 'paint',
      changes: [{
        tileKey: '0/2/0', previousResourceId: null, previousByteSize: 0,
        resourceId: 'sha256:replacement', byteSize: 300,
      }],
    });
    expect(released).toHaveBeenLastCalledWith({
      reason: 'redo-cleared',
      resources: [{ resourceId: 'sha256:1', byteSize: 200 }],
    });
    history.clear(document);
    expect(released).toHaveBeenLastCalledWith({
      reason: 'clear',
      resources: [{ resourceId: 'sha256:replacement', byteSize: 300 }],
    });
    expect(history.takeReleasedResourceEvents().map((event) => event.reason)).toEqual([
      'prune', 'redo-cleared', 'clear',
    ]);
  });

  it('把撤销/重做栈保存为不含像素的可验证 JSON，并按文档头恢复', () => {
    const source = createPaintDocument();
    const history = new ImageEditCommandHistoryV3();
    const painted = addTile(history, source, 0, 128);
    const undone = history.undo(painted);
    const json = history.stringifySnapshot();
    expect(json).not.toContain('pixel');
    expect(json).toContain('sha256:0');

    const restored = new ImageEditCommandHistoryV3();
    restored.restore(undone.document, json);
    expect(restored.getState()).toMatchObject({ undoCount: 0, redoCount: 1, retainedResourceBytes: 128 });
    expect(restored.redo(undone.document).document.layers[0]).toMatchObject({
      tiles: { '0/0/0': 'sha256:0' },
    });

    expect(() => new ImageEditCommandHistoryV3().restore(source, json))
      .toThrow(ImageEditRevisionConflictErrorV3);
  });

  it('输出裁剪与方向命令可随历史快照恢复和重做', () => {
    const history = new ImageEditCommandHistoryV3();
    const source = createPaintDocument();
    const cropped = history.execute(source, {
      commandId: 'crop-history',
      expectedRevision: 0,
      type: 'document.update-output-geometry',
      orientation: { rotate: 90, mirrored: false },
      crop: { x: 4, y: 5, width: 60, height: 90 },
    });
    const undone = history.undo(cropped).document;
    const restored = new ImageEditCommandHistoryV3();
    restored.restore(undone, history.stringifySnapshot());

    expect(restored.redo(undone).document.geometry).toMatchObject({
      orientation: { rotate: 90, mirrored: false },
      crop: { x: 4, y: 5, width: 60, height: 90 },
    });
  });

  it('严格 set-mask 历史按真实资源大小恢复，并兼容无元数据的旧历史', () => {
    const { changed, history } = createStrictMaskHistoryFixture();
    const restored = new ImageEditCommandHistoryV3();
    restored.restore(changed, history.stringifySnapshot());
    expect(restored.getState()).toMatchObject({
      undoCount: 1,
      retainedResourceCount: 3,
      retainedResourceBytes: 448,
    });

    const legacyHistory = new ImageEditCommandHistoryV3();
    const source = createPaintDocument();
    const masked = legacyHistory.execute(source, {
      commandId: 'legacy-mask-history', expectedRevision: 0, type: 'layer.set-mask',
      layerId: 'paint', mask: { resourceId: 'sha256:legacy-mask', inverted: false },
    });
    const legacyRestored = new ImageEditCommandHistoryV3();
    legacyRestored.restore(masked, legacyHistory.stringifySnapshot());
    expect(legacyRestored.getState()).toMatchObject({ undoCount: 1, retainedResourceBytes: 0 });
  });

  it('历史 codec 拒绝 set-mask 的缺侧、零负字节、错误 ID 与未排序描述', () => {
    const corruptions: Array<(snapshot: ReturnType<ImageEditCommandHistoryV3['createSnapshot']>) => void> = [
      (snapshot) => {
        const forward = snapshot.undo[0]?.forward;
        if (forward?.type !== 'layer.set-mask') throw new Error('测试 set-mask 命令缺失');
        delete forward.previousMaskResources;
      },
      (snapshot) => {
        const forward = snapshot.undo[0]?.forward;
        if (forward?.type !== 'layer.set-mask') throw new Error('测试 set-mask 命令缺失');
        delete forward.maskResources;
      },
      (snapshot) => {
        const forward = snapshot.undo[0]?.forward;
        if (forward?.type !== 'layer.set-mask' || !forward.maskResources?.[0]) {
          throw new Error('测试 set-mask 元数据缺失');
        }
        forward.maskResources[0].byteSize = 0;
      },
      (snapshot) => {
        const inverse = snapshot.undo[0]?.inverse;
        if (inverse?.type !== 'layer.set-mask' || !inverse.maskResources?.[0]) {
          throw new Error('测试 set-mask 元数据缺失');
        }
        inverse.maskResources[0].byteSize = -1;
      },
      (snapshot) => {
        const forward = snapshot.undo[0]?.forward;
        if (forward?.type !== 'layer.set-mask' || !forward.maskResources?.[0]) {
          throw new Error('测试 set-mask 元数据缺失');
        }
        forward.maskResources[0].resourceId = 'sha256:wrong';
      },
      (snapshot) => {
        const forward = snapshot.undo[0]?.forward;
        if (forward?.type !== 'layer.set-mask' || !forward.maskResources) {
          throw new Error('测试 set-mask 元数据缺失');
        }
        forward.maskResources.reverse();
      },
    ];

    corruptions.forEach((corrupt) => {
      const { changed, history } = createStrictMaskHistoryFixture();
      const snapshot = structuredClone(history.createSnapshot());
      corrupt(snapshot);
      expect(() => new ImageEditCommandHistoryV3().restore(changed, snapshot))
        .toThrow(InvalidImageEditHistorySnapshotV3Error);
    });
  });

  it('历史快照拒绝奇异图层变换命令', () => {
    const history = new ImageEditCommandHistoryV3();
    const source = createPaintDocument();
    const moved = history.execute(source, {
      commandId: 'move-history', expectedRevision: 0, type: 'layer.update-common',
      layerId: 'paint', patch: { transform: [1, 0, 0, 1, 4, 5] },
    });
    const snapshot = structuredClone(history.createSnapshot());
    const forward = snapshot.undo[0]?.forward;
    if (!forward || forward.type !== 'layer.update-common') throw new Error('测试历史命令缺失');
    forward.patch.transform = [0, 0, 0, 1, 0, 0];
    expect(() => new ImageEditCommandHistoryV3().restore(moved, snapshot))
      .toThrow(InvalidImageEditHistorySnapshotV3Error);
  });

  it('拒绝未知字段、篡改大小、危险键、超限和未知版本，失败时不污染现有历史', () => {
    const history = new ImageEditCommandHistoryV3({ maxCommands: 2, maxBytes: 100_000 });
    const document = addTile(history, createPaintDocument(), 0, 128);
    const baseline = history.stringifySnapshot();
    const snapshot = history.createSnapshot() as unknown as Record<string, unknown>;
    const undo = snapshot.undo as Array<Record<string, unknown>>;

    expect(() => history.restore(document, { ...snapshot, surprise: true }))
      .toThrow(InvalidImageEditHistorySnapshotV3Error);
    expect(() => history.restore(document, { ...snapshot, version: 99 }))
      .toThrow(InvalidImageEditHistorySnapshotV3Error);
    expect(() => history.restore(document, {
      ...snapshot,
      undo: [{ ...undo[0], metadataBytes: 1 }],
    })).toThrow(InvalidImageEditHistorySnapshotV3Error);
    expect(() => history.restore(document, JSON.parse('{"version":1,"documentId":"x","headRevision":0,"undo":[],"redo":[],"__proto__":{}}')))
      .toThrow(InvalidImageEditHistorySnapshotV3Error);
    expect(() => new ImageEditCommandHistoryV3({ maxCommands: 0 }).restore(document, baseline))
      .toThrow(InvalidImageEditHistorySnapshotV3Error);
    expect(history.stringifySnapshot()).toBe(baseline);
  });
});
