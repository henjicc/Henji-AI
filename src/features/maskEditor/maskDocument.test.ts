import { describe, expect, it } from 'vitest';
import {
  appendMaskPoint,
  appendMaskStroke,
  createEmptyMaskDocument,
  createMaskHistoryState,
  fitMaskStage,
  parseMaskEditorDocument,
  reduceMaskHistory,
  resolveMaskDocument,
} from './maskDocument';

describe('maskDocument', () => {
  it('只复用同一源图且同尺寸的可编辑文档', () => {
    const document = appendMaskStroke(createEmptyMaskDocument('source-a', 1024, 768), {
      id: 'stroke-1',
      mode: 'paint',
      size: 32,
      points: [{ x: 10, y: 20 }],
    });

    const reused = resolveMaskDocument(document, 'source-a', 1024, 768);
    expect(reused.reused).toBe(true);
    expect(reused.document).toEqual(document);
    expect(reused.document).not.toBe(document);

    const changedSource = resolveMaskDocument(document, 'source-b', 1024, 768);
    expect(changedSource).toMatchObject({
      reused: false,
      invalidationReason: 'source-changed',
    });
    expect(changedSource.document.strokes).toEqual([]);

    const changedSize = resolveMaskDocument(document, 'source-a', 512, 512);
    expect(changedSize).toMatchObject({
      reused: false,
      invalidationReason: 'size-changed',
    });
  });

  it('在持久化边界解析文档并拒绝损坏的笔画', () => {
    const raw = {
      version: 1,
      sourceRef: 'source-a',
      width: 320,
      height: 240,
      strokes: [{
        id: 'stroke-1',
        mode: 'erase',
        size: 18,
        points: [{ x: 2, y: 3 }, { x: 8, y: 13 }],
      }],
    };
    expect(parseMaskEditorDocument(raw)).toEqual(raw);
    expect(parseMaskEditorDocument({ ...raw, version: 2 })).toBeNull();
    expect(parseMaskEditorDocument({
      ...raw,
      strokes: [{ ...raw.strokes[0], points: [{ x: 'bad', y: 3 }] }],
    })).toBeNull();
  });

  it('每次提交形成可撤销快照，重做后恢复同一文档', () => {
    const empty = createEmptyMaskDocument('source-a', 100, 100);
    const painted = appendMaskStroke(empty, {
      id: 'paint',
      mode: 'paint',
      size: 12,
      points: [{ x: 20, y: 20 }],
    });
    const committed = reduceMaskHistory(createMaskHistoryState(empty), {
      type: 'commit',
      document: painted,
    });
    expect(committed.document.strokes).toHaveLength(1);
    const undone = reduceMaskHistory(committed, { type: 'undo' });
    expect(undone.document.strokes).toEqual([]);
    const redone = reduceMaskHistory(undone, { type: 'redo' });
    expect(redone.document).toEqual(painted);
  });

  it('过滤过密坐标并按可用视口等比适配源图', () => {
    const first = [{ x: 10, y: 10 }];
    expect(appendMaskPoint(first, { x: 10.1, y: 10.1 })).toBe(first);
    expect(appendMaskPoint(first, { x: 12, y: 10 })).toEqual([
      { x: 10, y: 10 },
      { x: 12, y: 10 },
    ]);
    expect(fitMaskStage(1000, 700, 1600, 900, 20)).toEqual({
      width: 960,
      height: 540,
      scale: 0.6,
    });
  });
});
