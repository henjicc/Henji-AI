// @vitest-environment jsdom

import { act, cleanup, fireEvent, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MaskEditorDocument } from './types';
import { useMaskEditorSession } from './useMaskEditorSession';

const { loadImageElement } = vi.hoisted(() => ({
  loadImageElement: vi.fn(async () => ({
    naturalWidth: 640,
    naturalHeight: 480,
    width: 640,
    height: 480,
  })),
}));

vi.mock('@/services/imageSource', () => ({ loadImageElement }));

function createDocument(strokeId?: string): MaskEditorDocument {
  return {
    version: 1,
    sourceRef: '/managed/source.png',
    width: 640,
    height: 480,
    strokes: strokeId ? [{
      id: strokeId,
      kind: 'stroke',
      mode: 'paint',
      size: 24,
      points: [{ x: 80, y: 90 }],
    }] : [],
  };
}

afterEach(() => {
  cleanup();
  loadImageElement.mockClear();
});

describe('useMaskEditorSession', () => {
  it('常驻的多个节点只让当前节点响应快捷键，切换时不重载或丢失工具和撤销记录', async () => {
    const { result, rerender } = renderHook(({ firstSelected }) => ({
      first: useMaskEditorSession({ sourceImage: '/managed/source.png', keyboardEnabled: firstSelected }),
      second: useMaskEditorSession({ sourceImage: '/managed/second.png', keyboardEnabled: !firstSelected }),
    }), { initialProps: { firstSelected: true } });
    await waitFor(() => expect(result.current.first.readyImage && result.current.second.readyImage).toBeTruthy());
    act(() => {
      result.current.first.commitMark(createDocument('first').strokes[0]);
      result.current.second.commitMark(createDocument('second').strokes[0]);
      result.current.first.setBrushSize(80);
    });
    fireEvent.keyDown(window, { key: 'r' });
    expect(result.current.first.tool).toBe('rectangle');
    expect(result.current.second.tool).toBe('brush');
    rerender({ firstSelected: false });
    const backgroundUndo = vi.fn();
    const handleBackgroundKey = (event: KeyboardEvent) => { if (!event.defaultPrevented) backgroundUndo(); };
    document.addEventListener('keydown', handleBackgroundKey);
    try {
      const undo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
      act(() => document.body.dispatchEvent(undo));
      expect(undo.defaultPrevented).toBe(true);
      expect(backgroundUndo).not.toHaveBeenCalled();
      expect(result.current.first.history.document.strokes).toHaveLength(1);
      expect(result.current.second.history.document.strokes).toHaveLength(0);
    } finally {
      document.removeEventListener('keydown', handleBackgroundKey);
    }
    rerender({ firstSelected: true });
    expect(result.current.first.tool).toBe('rectangle');
    expect(result.current.first.brushSize).toBe(80);
    expect(result.current.first.history.undoStack).toHaveLength(1);
    expect(loadImageElement).toHaveBeenCalledTimes(2);
  });

  it('输入文字或打开其他模态窗口时不接管遮罩快捷键', async () => {
    const scope = document.createElement('div');
    const input = document.createElement('input');
    const modal = document.createElement('div');
    const { result } = renderHook(() => useMaskEditorSession({
      sourceImage: '/managed/source.png', keyboardScope: { current: scope },
    }));
    await waitFor(() => expect(result.current.readyImage).toBeTruthy());
    document.body.append(scope, input);
    try {
      fireEvent.keyDown(input, { key: 'r' });
      expect(result.current.tool).toBe('brush');
      modal.setAttribute('aria-modal', 'true');
      document.body.append(modal);
      fireEvent.keyDown(window, { key: 'e' });
      expect(result.current.mode).toBe('paint');
    } finally {
      scope.remove();
      input.remove();
      modal.remove();
    }
  });

  it('同一源图自动回写持久化文档时不重载画布或覆盖当前撤销会话', async () => {
    const rendered = renderHook(
      ({ initialDocument }) => useMaskEditorSession({
        sourceImage: '/managed/source.png',
        initialDocument,
      }),
      { initialProps: { initialDocument: createDocument() } },
    );

    await waitFor(() => expect(rendered.result.current.readyImage).toBeTruthy());
    act(() => rendered.result.current.commitMark({
      id: 'local-stroke',
      kind: 'stroke',
      mode: 'paint',
      size: 24,
      points: [{ x: 120, y: 140 }],
    }));

    rendered.rerender({ initialDocument: createDocument('persisted-copy') });

    expect(loadImageElement).toHaveBeenCalledTimes(1);
    expect(rendered.result.current.history.document.strokes.map((stroke) => stroke.id))
      .toEqual(['local-stroke']);
    expect(rendered.result.current.history.undoStack).toHaveLength(1);
  });
});
