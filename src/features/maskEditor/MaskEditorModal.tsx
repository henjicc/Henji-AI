import { useCallback, useEffect, useReducer, useState } from 'react';
import { Brush, Circle, Lasso, Redo2, Square, Trash2, Undo2 } from 'lucide-react';
import {
  UI_TEXT_SECTION_CLASS,
  UiButton,
  UiChipButton,
  UiError,
  UiIconButton,
  UiLoading,
  UiModal,
} from '@/components/ui';
import { createLogger } from '@/core/logging';
import { ImageEditorShell } from '@/features/imageEdit';
import { loadImageElement } from '@/services/imageSource';
import { MaskEditorCanvas } from './MaskEditorCanvas';
import { MaskEditorInspector } from './MaskEditorInspector';
import { DEFAULT_MASK_BRUSH_HARDNESS } from './brushHardness';
import { exportMaskDocumentToPng } from './maskExport';
import {
  appendMaskStroke,
  cloneMaskDocument,
  createEmptyMaskDocument,
  createMaskHistoryState,
  hasPaintedMask,
  reduceMaskHistory,
  resolveMaskDocument,
} from './maskDocument';
import type {
  MaskEditorDocument,
  MaskMark,
  MaskEditorResult,
  MaskStrokeMode,
  MaskTool,
} from './types';

const logger = createLogger('features.maskEditor');

export interface MaskEditorModalProps {
  isOpen: boolean;
  sourceImage: string;
  initialDocument?: MaskEditorDocument | null;
  onCancel: () => void;
  onConfirm: (result: MaskEditorResult) => void | Promise<void>;
}

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; image: HTMLImageElement }
  | { status: 'failed'; message: string };

function defaultBrushSize(width: number, height: number): number {
  return Math.min(256, Math.max(12, Math.round(Math.min(width, height) * 0.04)));
}

function maxBrushSize(width: number, height: number): number {
  return Math.min(512, Math.max(64, Math.round(Math.min(width, height) * 0.3)));
}

export function MaskEditorModal({
  isOpen,
  sourceImage,
  initialDocument,
  onCancel,
  onConfirm,
}: MaskEditorModalProps): JSX.Element {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [tool, setTool] = useState<MaskTool>('brush');
  const [mode, setMode] = useState<MaskStrokeMode>('paint');
  const [brushSize, setBrushSize] = useState(32);
  const [brushHardness, setBrushHardness] = useState(DEFAULT_MASK_BRUSH_HARDNESS);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [history, dispatchHistory] = useReducer(
    reduceMaskHistory,
    createMaskHistoryState(createEmptyMaskDocument('', 1, 1))
  );

  useEffect(() => {
    if (!isOpen) {
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
      hasEditableDocument: Boolean(initialDocument),
    });
    void loadImageElement(sourceImage)
      .then((image) => {
        if (cancelled) return;
        const width = image.naturalWidth || image.width;
        const height = image.naturalHeight || image.height;
        if (width < 1 || height < 1) {
          throw new Error('源图片尺寸无效');
        }
        const resolved = resolveMaskDocument(initialDocument, sourceImage, width, height);
        dispatchHistory({ type: 'reset', document: resolved.document });
        setBrushSize(defaultBrushSize(width, height));
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
    return () => {
      cancelled = true;
    };
  }, [initialDocument, isOpen, loadAttempt, sourceImage]);

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

  const handleCancel = useCallback(() => {
    if (!isConfirming) onCancel();
  }, [isConfirming, onCancel]);

  const handleConfirm = useCallback(async () => {
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
      await onConfirm({
        document: cloneMaskDocument(history.document),
        maskDataUrl,
        width: history.document.width,
        height: history.document.height,
      });
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
    if (!isOpen) return;
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
  }, [isOpen]);

  const readyImage = loadState.status === 'ready' ? loadState.image : null;
  const toolbar = (
    <div className="flex min-h-10 min-w-0 items-center gap-2">
      <h2 className={`${UI_TEXT_SECTION_CLASS} mr-2 shrink-0`}>绘制局部重绘遮罩</h2>
      <UiChipButton
        type="button"
        selectionRole="navigation"
        active={tool === 'brush'}
        onClick={() => setTool('brush')}
        title="画笔(B)"
      >
        <Brush className="h-4 w-4" />
        画笔
      </UiChipButton>
      <UiChipButton
        type="button"
        selectionRole="navigation"
        active={tool === 'rectangle'}
        onClick={() => setTool('rectangle')}
        title="矩形框选(R)"
      >
        <Square className="h-4 w-4" />
        矩形
      </UiChipButton>
      <UiChipButton
        type="button"
        selectionRole="navigation"
        active={tool === 'circle'}
        onClick={() => setTool('circle')}
        title="圆形框选(O)"
      >
        <Circle className="h-4 w-4" />
        圆形
      </UiChipButton>
      <UiChipButton
        type="button"
        selectionRole="navigation"
        active={tool === 'lasso'}
        onClick={() => setTool('lasso')}
        title="自由框选(L)"
      >
        <Lasso className="h-4 w-4" />
        自由框选
      </UiChipButton>
      <div className="ml-1 flex items-center gap-1 border-l border-border-dark pl-2">
        <UiIconButton
          type="button"
          showBorder={false}
          appearance="hover-only"
          className="h-8 w-8"
          disabled={history.undoStack.length === 0}
          onClick={() => dispatchHistory({ type: 'undo' })}
          title="撤销(Ctrl+Z)"
          aria-label="撤销"
        >
          <Undo2 className="h-4 w-4" />
        </UiIconButton>
        <UiIconButton
          type="button"
          showBorder={false}
          appearance="hover-only"
          className="h-8 w-8"
          disabled={history.redoStack.length === 0}
          onClick={() => dispatchHistory({ type: 'redo' })}
          title="重做(Ctrl+Y)"
          aria-label="重做"
        >
          <Redo2 className="h-4 w-4" />
        </UiIconButton>
        <UiIconButton
          type="button"
          showBorder={false}
          appearance="hover-only"
          hoverVariant="danger"
          className="h-8 w-8"
          disabled={history.document.strokes.length === 0}
          onClick={clearDocument}
          title="清空遮罩"
          aria-label="清空遮罩"
        >
          <Trash2 className="h-4 w-4" />
        </UiIconButton>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <UiButton type="button" variant="ghost" size="sm" onClick={handleCancel} disabled={isConfirming}>
          取消
        </UiButton>
        <UiButton
          type="button"
          variant="primary"
          size="sm"
          onClick={() => void handleConfirm()}
          disabled={!readyImage || !hasPaintedMask(history.document) || isConfirming}
        >
          {isConfirming ? '正在保存…' : '完成'}
        </UiButton>
      </div>
    </div>
  );

  const canvas = readyImage ? (
    <MaskEditorCanvas
      image={readyImage}
      document={history.document}
      tool={tool}
      mode={mode}
      brushSize={brushSize}
      brushHardness={brushHardness}
      onMarkComplete={commitMark}
    />
  ) : loadState.status === 'failed' ? (
    <UiError
      title="无法打开参考图"
      message={loadState.message}
      onRetry={() => setLoadAttempt((attempt) => attempt + 1)}
      className="flex-1"
    />
  ) : (
    <UiLoading message="正在打开第一张参考图…" className="flex-1" />
  );

  const sidePanel = (
    <MaskEditorInspector
      mode={mode}
      tool={tool}
      brushSize={brushSize}
      brushHardness={brushHardness}
      maxBrushSize={maxBrushSize(history.document.width, history.document.height)}
      confirmError={confirmError}
      onModeChange={setMode}
      onBrushSizeChange={setBrushSize}
      onBrushHardnessChange={setBrushHardness}
    />
  );

  return (
    <UiModal
      isOpen={isOpen}
      title="绘制局部重绘遮罩"
      ariaLabel="绘制局部重绘遮罩"
      hideHeader
      size="workspace"
      contentClassName="p-0"
      onClose={handleCancel}
    >
      <ImageEditorShell
        toolbar={toolbar}
        canvas={canvas}
        sidePanel={sidePanel}
        className="min-h-0 flex-1"
      />
    </UiModal>
  );
}
