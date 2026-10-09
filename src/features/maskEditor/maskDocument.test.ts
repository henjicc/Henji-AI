import { describe, expect, it } from 'vitest';
import {
  appendMaskPoint,
  appendMaskStroke,
  createEmptyMaskDocument,
  createMaskHistoryState,
  fitMaskStage,
  parseMaskEditorDocument,
  reduceMaskHistory,
  resolveMaskShapeBounds,
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

  it('在持久化边界兼容旧笔画并解析三种区域标记', () => {
    const raw = {
      version: 1,
      sourceRef: 'source-a',
      width: 320,
      height: 240,
      strokes: [
        {
          id: 'stroke-1',
          mode: 'erase',
          size: 18,
          points: [{ x: 2, y: 3 }, { x: 8, y: 13 }],
        },
        {
          id: 'rectangle-1',
          kind: 'rectangle',
          mode: 'erase',
          points: [{ x: 10, y: 20 }, { x: 80, y: 90 }],
        },
        {
          id: 'circle-1',
          kind: 'circle',
          mode: 'paint',
          points: [{ x: 30, y: 40 }, { x: 130, y: 140 }],
        },
        {
          id: 'lasso-1',
          kind: 'lasso',
          mode: 'paint',
          points: [{ x: 1, y: 1 }, { x: 40, y: 8 }, { x: 20, y: 50 }],
        },
      ],
    };
    expect(parseMaskEditorDocument(raw)).toEqual(raw);
    expect(parseMaskEditorDocument({ ...raw, version: 2 })).toBeNull();
    expect(parseMaskEditorDocument({
      ...raw,
      strokes: [{ ...raw.strokes[0], points: [{ x: 'bad', y: 3 }] }],
    })).toBeNull();
    expect(parseMaskEditorDocument({
      ...raw,
      strokes: [{ ...raw.strokes[1], points: [{ x: 10, y: 20 }] }],
    })).toBeNull();
    expect(parseMaskEditorDocument({
      ...raw,
      strokes: [{ ...raw.strokes[3], points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }],
    })).toBeNull();
    expect(parseMaskEditorDocument({
      ...raw,
      strokes: [{ ...raw.strokes[0], hardness: 1.2 }],
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
    expect(resolveMaskShapeBounds('circle', { x: 80, y: 60 }, { x: 20, y: 30 })).toEqual({
      x: 20,
      y: 0,
      width: 60,
      height: 60,
    });
  });

  it('超过 40 次仍全部可撤销，历史仅保存增量且空提交不破坏重做', () => {
    let state = createMaskHistoryState(createEmptyMaskDocument('source', 100, 100));
    for (let i = 0; i < 85; i++) state = reduceMaskHistory(state, { type: 'commit', document: appendMaskStroke(state.document,
      { id: String(i), mode: 'paint', size: 8, points: [{ x: i, y: i }] }) });
    expect(state.undoStack).toHaveLength(85);
    expect(state.undoStack.every(delta => delta.added.length === 1 && delta.removed.length === 0)).toBe(true);
    for (let i = 0; i < 85; i++) state = reduceMaskHistory(state, { type: 'undo' });
    expect(state.document.strokes).toHaveLength(0);
    const emptyCommit = reduceMaskHistory(state, { type: 'commit', document: { ...state.document, strokes: [] } });
    expect(emptyCommit).toBe(state);
    for (let i = 0; i < 85; i++) state = reduceMaskHistory(state, { type: 'redo' });
    expect(state.document.strokes.map(mark => mark.id)).toEqual(Array.from({ length: 85 }, (_, i) => String(i)));
    const cleared = reduceMaskHistory(state, { type: 'commit', document: { ...state.document, strokes: [] } });
    expect(reduceMaskHistory(cleared, { type: 'undo' }).document).toEqual(state.document);
  });

  it('外部提交缓冲不能改变历史，并且编辑撤销后新提交会分叉', () => {
    let state = createMaskHistoryState(createEmptyMaskDocument('source', 100, 100));
    const mark = { id: 'one', mode: 'paint' as const, size: 8, points: [{ x: 2, y: 2 }] };
    const submitted = appendMaskStroke(state.document, mark);
    state = reduceMaskHistory(state, { type: 'commit', document: submitted });
    submitted.strokes[0].points[0].x = 90;
    expect(state.document.strokes[0].points[0].x).toBe(2);
    state = reduceMaskHistory(state, { type: 'undo' });
    state = reduceMaskHistory(state, { type: 'commit', document: appendMaskStroke(state.document, { ...mark, id: 'two' }) });
    expect(state.redoStack).toHaveLength(0);
    expect(reduceMaskHistory(state, { type: 'redo' })).toBe(state);
  });
});
