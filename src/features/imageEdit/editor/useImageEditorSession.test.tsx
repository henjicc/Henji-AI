/** @vitest-environment jsdom */

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  createEmptyImageEditDocument,
  IMAGE_EDIT_OPERATION_IDS,
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

  it('把连续柔光滑块更新合并为一条文档历史记录', () => {
    const { result } = renderHook(() => useImageEditorSession({}));
    act(() => {
      result.current.documentController.beginTransaction();
      result.current.documentController.updateOperation(IMAGE_EDIT_OPERATION_IDS.diffusion, (params) => ({
        ...params,
        strength: 0.2,
      }));
      result.current.documentController.updateOperation(IMAGE_EDIT_OPERATION_IDS.diffusion, (params) => ({
        ...params,
        strength: 0.5,
      }));
      result.current.documentController.commitTransaction();
    });

    expect(result.current.markController.history.canUndo).toBe(true);
    expect(result.current.documentController.getOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)?.params).toMatchObject({ strength: 0.5 });

    act(() => result.current.markController.history.handleUndo());
    expect(result.current.documentController.getOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)).toBeNull();
  });

  it('6.1：两个 hook 实例各有独立的 sessionId，互相隔离（模拟同时开着两个宿主）', () => {
    const first = renderHook(() => useImageEditorSession({}));
    const second = renderHook(() => useImageEditorSession({}));

    expect(first.result.current.sessionId).not.toBe(second.result.current.sessionId);

    act(() => {
      first.result.current.documentController.updateOperation(IMAGE_EDIT_OPERATION_IDS.diffusion, (params) => ({
        ...params,
        strength: 0.7,
      }));
    });

    expect(first.result.current.documentController.getOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)).not.toBeNull();
    // 第二个实例完全没被第一个实例的写入影响
    expect(second.result.current.documentController.getOperation(IMAGE_EDIT_OPERATION_IDS.diffusion)).toBeNull();

    act(() => {
      second.result.current.markController.history.commitDoc({
        ...second.result.current.markDoc,
        crop: { x: 1, y: 2, width: 30, height: 40 },
      });
    });

    expect(imageEditDocumentToMarkDoc(second.result.current.document).crop).toEqual({
      x: 1, y: 2, width: 30, height: 40,
    });
    // 第一个实例的裁剪状态不受第二个实例影响
    expect(imageEditDocumentToMarkDoc(first.result.current.document).crop).toBeNull();
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
