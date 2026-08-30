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
import { ImageEditorShell } from '@/features/imageEdit';
import { MaskEditorCanvas } from './MaskEditorCanvas';
import { MaskEditorInspector } from './MaskEditorInspector';
import { hasPaintedMask } from './maskDocument';
import { maxMaskBrushSize, useMaskEditorSession } from './useMaskEditorSession';
import type {
  MaskEditorDocument,
  MaskEditorResult,
} from './types';

export interface MaskEditorModalProps {
  isOpen: boolean;
  sourceImage: string;
  initialDocument?: MaskEditorDocument | null;
  onCancel: () => void;
  onConfirm: (result: MaskEditorResult) => void | Promise<void>;
}

export function MaskEditorModal({
  isOpen,
  sourceImage,
  initialDocument,
  onCancel,
  onConfirm,
}: MaskEditorModalProps): JSX.Element {
  const editor = useMaskEditorSession({ sourceImage, initialDocument, active: isOpen, onConfirm });
  const {
    loadState,
    readyImage,
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
  } = editor;
  const handleCancel = (): void => { if (!isConfirming) onCancel(); };
  const handleConfirm = editor.confirm;
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
      onRetry={editor.retryLoad}
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
      maxBrushSize={maxMaskBrushSize(history.document.width, history.document.height)}
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
