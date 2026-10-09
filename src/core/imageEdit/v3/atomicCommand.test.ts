import { describe, expect, it } from 'vitest';
import { createImageEditDocumentV3, createImageEditRasterLayerV3 } from './documentFactory';
import { ImageEditCommandHistoryV3 } from './commandHistory';
import { applyImageEditCommandV3 } from './commandReducer';
import type { ImageEditAtomicCommandV3 } from './commandTypes';

function fixture() {
  const document = createImageEditDocumentV3({ width: 8, height: 8 });
  document.layers = [createImageEditRasterLayerV3('base', '原图')];
  const command: ImageEditAtomicCommandV3 = { type: 'document.atomic', commandId: 'atomic', expectedRevision: 0, commands: [
    { type: 'layer.update-common', commandId: 'first', expectedRevision: 0, layerId: 'base', patch: { opacity: .4 } },
    { type: 'layer.add', commandId: 'second', expectedRevision: 1, parentId: null, index: 1, layer: createImageEditRasterLayerV3('new', '新图层'), resources: [] },
  ] };
  return { document, command };
}
describe('原子命令', () => {
  it('一次 revision、一次历史；序列化重开后整组撤销和重做', () => {
    const { document, command } = fixture(), history = new ImageEditCommandHistoryV3();
    const result = history.execute(document, command);
    expect(result.revision).toBe(1); expect(history.createSnapshot().undo).toHaveLength(1);
    const reopened = new ImageEditCommandHistoryV3();
    reopened.restore(result, JSON.parse(JSON.stringify(history.createSnapshot())));
    const undone = reopened.undo(result).document;
    expect(undone.layers).toEqual(document.layers);
    expect(reopened.redo(undone).document.layers).toEqual(result.layers);
  });
  it('后续操作失败时不发布前面的写入；外层 CAS 拒绝过期转换', () => {
    const { document, command } = fixture();
    command.commands[1] = { type: 'layer.delete', commandId: 'second', expectedRevision: 1, layerId: 'missing' };
    expect(() => applyImageEditCommandV3(document, command)).toThrow();
    expect(document.layers[0].opacity).toBe(1); expect(document.revision).toBe(0);
    expect(() => applyImageEditCommandV3({ ...document, revision: 1 }, command)).toThrow();
  });
});
