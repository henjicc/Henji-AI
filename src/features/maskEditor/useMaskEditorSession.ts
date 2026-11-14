import { useCallback, useEffect, useReducer, useRef, useState, type RefObject } from 'react';

import { createLogger } from '@/core/logging';
import { loadImageElement } from '@/services/imageSource';
import { DEFAULT_MASK_BRUSH_HARDNESS } from './brushHardness';
import { exportMaskDocumentToPngAsync } from './maskExport';
import {
  appendMaskStroke,
  cloneMaskDocument,
  createEmptyMaskDocument,
  createMaskHistoryState,
  reduceMaskHistory,
  sameMaskMarks,
  resolveMaskDocument,
} from './maskDocument';
import type { MaskHistoryState } from './maskDocument';
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

/**
 * 会话离开时的样子（撤销栈、工具与笔刷）。编辑器所在的界面会被卸载再挂上（画布正文随视口挂卸），
 * 再次打开同一张源图、且节点里存的遮罩文档仍是离开时那一份时，从这里接着编辑。
 */
export interface MaskEditorRetainedSession {
  sourceImage: string;
  /**
   * 会话最近一次与节点数据对上的那份遮罩文档（同一个对象）：加载时的文档，或自动保存写回的文档。
   * 节点里的文档之后被撤销、助手改写或别处换掉，就与它不是同一个对象，不再接着用。
   */
  basis: MaskEditorDocument | null | undefined;
  history: MaskHistoryState;
  tool: MaskTool;
  mode: MaskStrokeMode;
  brushSize: number;
  brushHardness: number;
}

interface UseMaskEditorSessionOptions {
  sourceImage: string;
  initialDocument?: MaskEditorDocument | null;
  /** 跨卸载保留会话的存放处；不传时每次挂载都从 initialDocument 重新开始。 */
  retained?: { current: MaskEditorRetainedSession | null };
  active?: boolean;
  /** 保留会话和画面时，可单独关闭后台节点的快捷键。 */
  keyboardEnabled?: boolean;
  keyboardScope?: RefObject<HTMLElement>;
  onConfirm?: (result: MaskEditorResult) => void | Promise<void>;
}

function defaultMaskBrushSize(width: number, height: number): number {
  return Math.min(256, Math.max(12, Math.round(Math.min(width, height) * 0.04)));
}

export function maxMaskBrushSize(width: number, height: number): number {
  return Math.min(512, Math.max(64, Math.round(Math.min(width, height) * 0.3)));
}

export function useMaskEditorSession({
  sourceImage,
  initialDocument,
  active = true,
  keyboardEnabled = true,
  keyboardScope,
  onConfirm,
  retained,
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
  const confirmationRef = useRef<AbortController | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [history, dispatchHistory] = useReducer(
    reduceMaskHistory,
    createMaskHistoryState(createEmptyMaskDocument('', 1, 1)),
  );
  /** 这次加载是接着上次离开时的会话（撤销栈原样恢复），而不是从节点里的遮罩文档重新开始。 */
  const [resumed, setResumed] = useState(false);
  const basisRef = useRef<MaskEditorDocument | null | undefined>(undefined);

  useEffect(() => {
    if (!active) {
      confirmationRef.current?.abort();
      dispatchHistory({ type: 'reset', document: createEmptyMaskDocument('', 1, 1) });
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
        const kept = retained?.current;
        if (
          kept
          && kept.sourceImage === sourceImage
          && kept.basis === sourceSessionRef.current.initialDocument
          && kept.history.document.sourceRef === sourceImage
          && kept.history.document.width === width
          && kept.history.document.height === height
        ) {
          basisRef.current = kept.basis;
          dispatchHistory({ type: 'restore', state: kept.history });
          setBrushSize(kept.brushSize);
          setBrushHardness(kept.brushHardness);
          setTool(kept.tool);
          setMode(kept.mode);
          setResumed(true);
          setLoadState({ status: 'ready', image });
          logger.info('遮罩编辑器接着上次的会话', {
            event: 'mask_editor.load.resumed',
            width,
            height,
            undoDepth: kept.history.undoStack.length,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
          return;
        }
        const resolved = resolveMaskDocument(
          sourceSessionRef.current.initialDocument,
          sourceImage,
          width,
          height,
        );
        basisRef.current = sourceSessionRef.current.initialDocument;
        dispatchHistory({ type: 'reset', document: resolved.document });
        setBrushSize(defaultMaskBrushSize(width, height));
        setBrushHardness(DEFAULT_MASK_BRUSH_HARDNESS);
        setTool('brush');
        setMode('paint');
        setResumed(false);
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
    return () => { cancelled = true; confirmationRef.current?.abort(); };
    // retained 是跨挂载不变的存放处，只在加载完成时读一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, loadAttempt, sourceImage]);

  // 每次编辑、换工具、节点里的遮罩文档更新后记下当前会话；加载完成之前不记，免得用空文档盖掉。
  // 节点里的文档只有与会话内容一致（自己保存写回的）才算新的依据；别处写进来的不算，重挂时就从它重新开始
  useEffect(() => {
    if (!retained || !active || loadState.status !== 'ready') return;
    if (initialDocument !== basisRef.current && sameMaskMarks(history.document, initialDocument)) basisRef.current = initialDocument;
    retained.current = {
      sourceImage,
      basis: basisRef.current,
      history,
      tool,
      mode,
      brushSize,
      brushHardness,
    };
  }, [active, brushHardness, brushSize, history, initialDocument, loadState.status, mode, retained, sourceImage, tool]);

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
    if (confirmationRef.current) return;
    const confirmController = new AbortController();
    confirmationRef.current = confirmController;
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
      const maskDataUrl = await exportMaskDocumentToPngAsync(history.document, confirmController.signal);
      if (confirmController.signal.aborted) return;
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
      if (confirmController.signal.aborted) return;
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
      if (confirmationRef.current === confirmController) confirmationRef.current = null;
      setIsConfirming(false);
    }
  }, [history.document, onConfirm]);

  useEffect(() => {
    if (!active || !keyboardEnabled) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]')) return;
      const modal = document.querySelector('[aria-modal="true"]');
      if (modal && keyboardScope?.current && !modal.contains(keyboardScope.current)) return;
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
    // 在背景画布的 document 监听器之前消费撤销，避免一次按键同时撤销节点和遮罩。
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [active, keyboardEnabled, keyboardScope]);

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
    resumed,
    commitMark,
    clearDocument,
    isConfirming,
    confirmError,
    confirm,
  };
}
