/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyImageEditDocument,
  imageEditDocumentToMarkDoc,
  type ImageEditOperation,
} from '@/core/imageEdit';
import {
  IMAGE_EDITOR_INSPECTOR_MAX_WIDTH,
  IMAGE_EDITOR_INSPECTOR_MIN_WIDTH,
  clampImageEditorInspectorWidth,
  clampImageEditorInspectorWidthToViewport,
} from '../store/imageEditorUiStore';
import { useImageEditorSession } from './useImageEditorSession';

describe('useImageEditorSession', () => {
  it('统一记录标注与几何历史，并在撤销重做时保留未来操作', () => {
    const initialDocument = createEmptyImageEditDocument();
    const futureOperation: ImageEditOperation = {
      id: 'future-effect',
      operationId: 'image.future-effect',
      enabled: true,
      params: { amount: 0.25 },
    };
    initialDocument.operations.splice(1, 0, futureOperation);
    const onDocumentChange = vi.fn();
    const { result } = renderHook(() => useImageEditorSession({ initialDocument, onDocumentChange }));

    act(() => {
      result.current.markController.history.commitDoc({
        ...result.current.markDoc,
        crop: { x: 5, y: 6, width: 70, height: 50 },
      });
    });

    expect(result.current.markController.history.canUndo).toBe(true);
    expect(result.current.document.operations[1]).toEqual(futureOperation);
    expect(imageEditDocumentToMarkDoc(result.current.document).crop).toEqual({
      x: 5,
      y: 6,
      width: 70,
      height: 50,
    });

    act(() => result.current.markController.history.handleUndo());
    expect(imageEditDocumentToMarkDoc(result.current.document).crop).toBeNull();
    expect(result.current.document.operations[1]).toEqual(futureOperation);
    expect(result.current.markController.history.canRedo).toBe(true);

    act(() => result.current.markController.history.handleRedo());
    expect(imageEditDocumentToMarkDoc(result.current.document).crop).not.toBeNull();
    expect(result.current.document.operations[1]).toEqual(futureOperation);
    expect(onDocumentChange).toHaveBeenCalledTimes(3);
  });
});

describe('图片编辑器检查器宽度', () => {
  it('同时遵守固定边界和小视口剩余空间约束', () => {
    expect(clampImageEditorInspectorWidth(100)).toBe(IMAGE_EDITOR_INSPECTOR_MIN_WIDTH);
    expect(clampImageEditorInspectorWidth(900)).toBe(IMAGE_EDITOR_INSPECTOR_MAX_WIDTH);
    expect(clampImageEditorInspectorWidthToViewport(420, 720)).toBe(360);
    expect(clampImageEditorInspectorWidthToViewport(420, 500)).toBe(IMAGE_EDITOR_INSPECTOR_MIN_WIDTH);
  });
});
