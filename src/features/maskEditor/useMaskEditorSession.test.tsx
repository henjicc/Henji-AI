// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
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
