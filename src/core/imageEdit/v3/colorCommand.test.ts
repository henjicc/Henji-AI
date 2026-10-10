import { describe, expect, it } from 'vitest';
import { ImageEditCommandHistoryV3 } from './commandHistory';
import { prepareImageEditCommandV3 } from './commandPreparation';
import { createImageEditDocumentV3 } from './documentFactory';

describe('颜色命令的持久历史与 ICC 租约元数据', () => {
  it('正反向保留两个 profile 的字节声明，恢复历史后一次撤销/重做交换 profile', () => {
    const oldProfile = `sha256:${'a'.repeat(64)}`, nextProfile = `sha256:${'b'.repeat(64)}`;
    const document = createImageEditDocumentV3({ width: 1, height: 1 });
    document.color.iccProfileResourceId = oldProfile;
    const command = prepareImageEditCommandV3(document, { type: 'document.set-color', commandId: 'profile-change',
      expectedRevision: 0, color: { ...document.color, workingSpace: 'display-p3', bitDepth: 16, iccProfileResourceId: nextProfile } },
    new Map([[oldProfile, 100], [nextProfile, 200]]));
    const history = new ImageEditCommandHistoryV3(), next = history.execute(document, command);
    const snapshot = history.createSnapshot();
    expect(snapshot.undo[0].forward).toMatchObject({ resources: [{ resourceId: oldProfile, byteSize: 100 }, { resourceId: nextProfile, byteSize: 200 }] });
    expect(snapshot.undo[0].inverse).toMatchObject({ resources: [{ resourceId: oldProfile, byteSize: 100 }, { resourceId: nextProfile, byteSize: 200 }] });
    const restored = new ImageEditCommandHistoryV3(); restored.restore(next, JSON.parse(JSON.stringify(snapshot)));
    const undone = restored.undo(next).document;
    expect(undone.color).toEqual(document.color);
    expect(restored.redo(undone).document.color).toEqual(next.color);
  });
  it('缺少原 profile 资源与非法 HDR 组合不能提交', () => {
    const document = createImageEditDocumentV3({ width: 1, height: 1 });
    document.color.iccProfileResourceId = `sha256:${'a'.repeat(64)}`;
    expect(() => prepareImageEditCommandV3(document, { type: 'document.set-color', commandId: 'missing-profile', expectedRevision: 0,
      color: { ...document.color, iccProfileResourceId: null } }, new Map())).toThrow();
    expect(() => new ImageEditCommandHistoryV3().execute({ ...document, color: { ...document.color, iccProfileResourceId: null } },
      { type: 'document.set-color', commandId: 'invalid-hdr', expectedRevision: 0,
        color: { ...document.color, iccProfileResourceId: null, transferFunction: 'pq' } })).toThrow();
  });
});
