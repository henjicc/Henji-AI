import { useCallback, useEffect, useReducer, useRef, useState } from 'react';

import { createLogger } from '@/core/logging';
import { loadImageElement } from '@/services/imageSource';
import { DEFAULT_MASK_BRUSH_HARDNESS } from './brushHardness';
import { exportMaskDocumentToPng } from './maskExport';
import {
  appendMaskStroke,
  cloneMaskDocument,
  createEmptyMaskDocument,
  createMaskHistoryState,
  reduceMaskHistory,
  resolveMaskDocument,
} from './maskDocument';
import type {
  MaskEditorDocument,
  MaskEditorResult,
  MaskMark,
  MaskStrokeMode,
  MaskTool,
} from './types';

const logger = createLogger('features.maskEditor');

export type MaskEditorLoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; image: HTMLImageElement }
  | { status: 'failed'; message: string };

interface UseMaskEditorSessionOptions {
  sourceImage: string;
  initialDocument?: MaskEditorDocument | null;
  active?: boolean;
  onConfirm?: (result: MaskEditorResult) => void | Promise<void>;
}

export function defaultMaskBrushSize(width: number, height: number): number {
  return Math.min(256, Math.max(12, Math.round(Math.min(width, height) * 0.04)));
}

export function maxMaskBrushSize(width: number, height: number): number {
  return Math.min(512, Math.max(64, Math.round(Math.min(width, height) * 0.3)));
}

export function useMaskEditorSession({
  sourceImage,
  initialDocument,
  active = true,
  onConfirm,
}: UseMaskEditorSessionOptions) {
  const sourceSessionRef = useRef({ sourceImage, initialDocument });
  if (!active || sourceSessionRef.current.sourceImage !== sourceImage) {
    sourceSessionRef.current = { sourceImage, initialDocument };
  }
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<MaskEditorLoadState>({ status: 'idle' });
  const [tool, setTool] = useState<MaskTool>('brush');
  const [mode, setMode] = useState<MaskStrokeMode>('paint');
  const [brushSize, setBrushSize] = useState(32);
  const [brushHardness, setBrushHardness] = useState(DEFAULT_MASK_BRUSH_HARDNESS);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [history, dispatchHistory] = useReducer(
    reduceMaskHistory,
    createMaskHistoryState(createEmptyMaskDocument('', 1, 1)),
  );

  useEffect(() => {
    if (!active) {
      setLoadState({ status: 'idle' });
      setConfirmError(null);
      setIsConfirming(false);
      return;
    }
    let cancelled = false;
    const startedAt = performance.now();
    setLoadState({ status: 'loading' });
    setConfirmError(null);
    logger.info('遮罩编辑器加载开始', {
      event: 'mask_editor.load.start',
      hasEditableDocument: Boolean(sourceSessionRef.current.initialDocument),
    });
    void loadImageElement(sourceImage)
      .then((image) => {
        if (cancelled) return;
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (width < 1 || height < 1) throw new Error('源图片尺寸无效');
        // 同一编辑会话内的自动保存会回写 initialDocument；不能因此重新加载图片并清空撤销栈。
        // 源图切换或下次重新打开时，sourceSessionRef 才会接收新的持久化文档。
        const resolved = resolveMaskDocument(
          sourceSessionRef.current.initialDocument,
          sourceImage,
          width,
          height,
        );
        dispatchHistory({ type: 'reset', document: resolved.document });
        setBrushSize(defaultMaskBrushSize(width, height));
        setBrushHardness(DEFAULT_MASK_BRUSH_HARDNESS);
        setTool('brush');
        setMode('paint');
        setLoadState({ status: 'ready', image });
        logger.info('遮罩编辑器加载完成', {
          event: 'mask_editor.load.completed',
          width,
          height,
          reusedEditableDocument: resolved.reused,
          invalidationReason: resolved.invalidationReason,
          elapsedMs: Math.round(performance.now() - startedAt),
        });
      })
      .catch((error) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        setLoadState({ status: 'failed', message });
        logger.error('遮罩编辑器加载失败', {
          event: 'mask_editor.load.failed',
          error: message,
        });
      });
    return () => { cancelled = true; };
  }, [active, loadAttempt, sourceImage]);

  const commitMark = useCallback((mark: MaskMark) => {
    dispatchHistory({
      type: 'commit',
      document: appendMaskStroke(history.document, mark),
    });
  }, [history.document]);

  const clearDocument = useCallback(() => {
    if (history.document.strokes.length === 0) return;
    dispatchHistory({
      type: 'commit',
      document: { ...history.document, strokes: [] },
    });
  }, [history.document]);

  const confirm = useCallback(async () => {
    const startedAt = performance.now();
    setIsConfirming(true);
    setConfirmError(null);
    logger.info('遮罩编辑确认开始', {
      event: 'mask_editor.confirm.start',
      width: history.document.width,
      height: history.document.height,
      strokeCount: history.document.strokes.length,
    });
    try {
      const maskDataUrl = exportMaskDocumentToPng(history.document);
      if (onConfirm) {
        await onConfirm({
          document: cloneMaskDocument(history.document),
          maskDataUrl,
          width: history.document.width,
          height: history.document.height,
        });
      }
      logger.info('遮罩编辑确认完成', {
        event: 'mask_editor.confirm.completed',
        width: history.document.width,
        height: history.document.height,
        strokeCount: history.document.strokes.length,
        elapsedMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setConfirmError(message);
      logger.error('遮罩编辑确认失败', {
        event: 'mask_editor.confirm.failed',
        width: history.document.width,
        height: history.document.height,
        strokeCount: history.document.strokes.length,
        error: message,
      });
    } finally {
      setIsConfirming(false);
    }
  }, [history.document, onConfirm]);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 'z') {
          event.preventDefault();
          dispatchHistory({ type: event.shiftKey ? 'redo' : 'undo' });
          return;
        }
        if (event.key.toLowerCase() === 'y') {
          event.preventDefault();
          dispatchHistory({ type: 'redo' });
        }
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 'b') setTool('brush');
      if (key === 'r') setTool('rectangle');
      if (key === 'o') setTool('circle');
      if (key === 'l') setTool('lasso');
      if (key === 'd') setMode('paint');
      if (key === 'e') setMode('erase');
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [active]);

  return {
    loadState,
    readyImage: loadState.status === 'ready' ? loadState.image : null,
    retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
    tool,
    setTool,
    mode,
    setMode,
    brushSize,
    setBrushSize,
    brushHardness,
    setBrushHardness,
    history,
    dispatchHistory,
    commitMark,
    clearDocument,
    isConfirming,
    confirmError,
    confirm,
  };
}
