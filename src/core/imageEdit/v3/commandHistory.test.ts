import { describe, expect, it } from 'vitest';
import {
  IMAGE_EDIT_HISTORY_DEFAULT_MAX_BYTES_V3,
  IMAGE_EDIT_HISTORY_DEFAULT_MAX_COMMANDS_V3,
  ImageEditCommandHistoryV3,
} from './commandHistory';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from './documentFactory';
import type { ImageEditDocumentV3 } from './documentTypes';

function createPaintDocument(): ImageEditDocumentV3 {
  return {
    ...createImageEditDocumentV3({ width: 100, height: 80, documentId: 'document-history' }),
    layers: [createImageEditRasterLayerV3('paint', '画笔')],
  };
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
        { tileKey: '0/0/0', resourceId: 'sha256:a', byteSize: 1024 },
        { tileKey: '0/1/0', resourceId: 'sha256:b', byteSize: 1024 },
        { tileKey: '0/2/0', resourceId: 'sha256:c', byteSize: 1024 },
      ],
    });
    expect(history.getState().undoCount).toBe(1);
    expect(document.revision).toBe(1);

    const undone = history.undo(document);
    expect(undone.changed).toBe(true);
    expect(undone.document.layers[0]).toMatchObject({ tiles: {} });
    expect(history.getState()).toMatchObject({ undoCount: 0, redoCount: 1 });

    const redone = history.redo(undone.document);
    expect(redone.document.layers[0]).toMatchObject({
      tiles: { '0/0/0': 'sha256:a', '0/1/0': 'sha256:b', '0/2/0': 'sha256:c' },
    });
    expect(redone.document.revision).toBe(3);
  });

  it('默认上限固定为 200 条或 2GiB，并按先达到的预算裁剪最旧记录', () => {
    expect(IMAGE_EDIT_HISTORY_DEFAULT_MAX_COMMANDS_V3).toBe(200);
    expect(IMAGE_EDIT_HISTORY_DEFAULT_MAX_BYTES_V3).toBe(2 * 1024 * 1024 * 1024);

    const commandLimited = new ImageEditCommandHistoryV3({ maxCommands: 2, maxBytes: 1_000_000 });
    let commandDocument = createPaintDocument();
    for (let index = 0; index < 3; index += 1) {
      commandDocument = commandLimited.execute(commandDocument, {
        commandId: `command-${index}`,
        expectedRevision: commandDocument.revision,
        type: 'raster.apply-tile-delta',
        layerId: 'paint',
        changes: [{ tileKey: `0/${index}/0`, resourceId: `sha256:${index}`, byteSize: 16 }],
      });
    }
    expect(commandLimited.getState().undoCount).toBe(2);

    const byteLimited = new ImageEditCommandHistoryV3({ maxCommands: 10, maxBytes: 7_000 });
    let byteDocument = createPaintDocument();
    for (let index = 0; index < 2; index += 1) {
      byteDocument = byteLimited.execute(byteDocument, {
        commandId: `large-${index}`,
        expectedRevision: byteDocument.revision,
        type: 'raster.apply-tile-delta',
        layerId: 'paint',
        changes: [{ tileKey: `0/${index}/0`, resourceId: `sha256:large-${index}`, byteSize: 5_000 }],
      });
    }
    expect(byteLimited.getState()).toMatchObject({ undoCount: 1, retainedBytes: 5_000 });
  });
});
