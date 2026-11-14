import { UiFieldMessage } from '@/components/ui'
import { UI_ICON_SIZE_CLASS } from '@/components/ui/styleTokens'
import { Brush, Circle, Eraser, Lasso, Redo2, Square, Trash2, Undo2 } from 'lucide-react';
import { memo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { UiChipButton, UiError, UiIconButton, UiLoading, UiRangeInput } from '@/components/ui';
import { MaskEditorCanvas } from '@/features/maskEditor/MaskEditorCanvas';
import { hasPaintedMask, sameMaskMarks } from '@/features/maskEditor/maskDocument';
import type { MaskEditorDocument, MaskTool } from '@/features/maskEditor/types';
import { maxMaskBrushSize, useMaskEditorSession, type MaskEditorRetainedSession } from '@/features/maskEditor/useMaskEditorSession';
import { useCanvasNodeUiRef } from '@/features/canvas/presence/canvasNodeUiState';
import type { RetainedZoomPan } from '@/hooks/useZoomPanViewport';
import { useLocalRedrawMaskAutosave } from './useLocalRedrawMaskAutosave';

interface LocalRedrawWorkbenchStageProps {
  nodeId: string;
  selected: boolean;
  sourceImage: string;
  initialDocument?: MaskEditorDocument | null;
  onPersist: (result: { maskSource: string | null; document: MaskEditorDocument }) => void;
}

const TOOLS: ReadonlyArray<{
  value: MaskTool;
  labelKey: string;
  icon: typeof Brush;
}> = [
  { value: 'brush', labelKey: 'node.elementEditGeneration.tools.brush', icon: Brush },
  { value: 'rectangle', labelKey: 'node.elementEditGeneration.tools.rectangle', icon: Square },
  { value: 'circle', labelKey: 'node.elementEditGeneration.tools.circle', icon: Circle },
  { value: 'lasso', labelKey: 'node.elementEditGeneration.tools.lasso', icon: Lasso },
];

export const LocalRedrawWorkbenchStage = memo(function LocalRedrawWorkbenchStage({
  nodeId,
  selected,
  sourceImage,
  initialDocument,
  onPersist,
}: LocalRedrawWorkbenchStageProps): JSX.Element {
  const { t } = useTranslation();
  const keyboardScope = useRef<HTMLDivElement>(null);
  // 撤销栈与笔刷跨正文卸载保留（大画布上平移走再回来还能接着撤销）
  const retained = useCanvasNodeUiRef<MaskEditorRetainedSession | null>(nodeId, 'maskEditorSession', null);
  const retainedView = useCanvasNodeUiRef<RetainedZoomPan | null>(nodeId, 'maskEditorView', null);
  const editor = useMaskEditorSession({
    sourceImage,
    initialDocument,
    keyboardEnabled: selected,
    keyboardScope,
    retained,
  });
  const autosave = useLocalRedrawMaskAutosave({
    document: editor.history.document,
    ready: Boolean(editor.readyImage),
    // 卸载时还没来得及保存的最后几笔：接回会话后补存
    unsavedOnStart: editor.resumed && !sameMaskMarks(editor.history.document, initialDocument),
    onPersist,
  });
  const painted = hasPaintedMask(editor.history.document);
  const brushMax = maxMaskBrushSize(editor.history.document.width, editor.history.document.height);

  return (
    <div
      ref={keyboardScope}
      data-local-redraw-workbench="true"
      className="nodrag nowheel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {/* 工具行直接放在画面区的底上，不另起一块框；笔刷大小是画笔的属性，跟在工具后面，只在画笔时出现 */}
      <div className="flex h-10 min-w-0 shrink-0 items-center gap-0.5 px-1.5">
        {TOOLS.map(({ value, labelKey, icon: Icon }) => {
          const label = t(labelKey);
          return (
            <UiChipButton
              key={value}
              type="button"
              selectionRole="navigation"
              active={editor.tool === value}
              tooltip={label}
              aria-label={label}
              size="md"
              onClick={() => editor.setTool(value)}
            >
              <Icon className={`${UI_ICON_SIZE_CLASS.sm}`} />
            </UiChipButton>
          );
        })}
        <UiChipButton
          type="button"
          selectionRole="navigation"
          active={editor.mode === 'erase'}
          tooltip={t('node.elementEditGeneration.tools.erase')}
          aria-label={t('node.elementEditGeneration.tools.erase')}
          size="md"
          onClick={() => editor.setMode(editor.mode === 'erase' ? 'paint' : 'erase')}
        >
          <Eraser className={`${UI_ICON_SIZE_CLASS.sm}`} />
        </UiChipButton>
        {editor.tool === 'brush' && (
          <>
            <span aria-hidden="true" className="mx-1.5 h-4 w-px shrink-0 bg-line-strong" />
            <UiRangeInput
              min={4}
              max={brushMax}
              step={1}
              value={editor.brushSize}
              aria-label={t('node.elementEditGeneration.brushSize', { size: Math.round(editor.brushSize) })}
              onChange={(event) => editor.setBrushSize(Number(event.currentTarget.value))}
              className="min-w-10 max-w-28 flex-1"
            />
            <span className="w-7 shrink-0 text-right text-xs tabular-nums text-text2">{Math.round(editor.brushSize)}</span>
          </>
        )}
        <span className="min-w-0 flex-1" />
        <UiIconButton
          type="button"
          tooltip={t('node.elementEditGeneration.undoMask')}
          disabled={editor.history.undoStack.length === 0}
          onClick={() => editor.dispatchHistory({ type: 'undo' })}
        >
          <Undo2 />
        </UiIconButton>
        <UiIconButton
          type="button"
          tooltip={t('node.elementEditGeneration.redoMask')}
          disabled={editor.history.redoStack.length === 0}
          onClick={() => editor.dispatchHistory({ type: 'redo' })}
        >
          <Redo2 />
        </UiIconButton>
        <UiIconButton
          tone="danger"
          type="button"
          tooltip={t('node.elementEditGeneration.clearMask')}
          disabled={!painted}
          onClick={editor.clearDocument}
        >
          <Trash2 />
        </UiIconButton>
      </div>

      {editor.readyImage ? (
        <MaskEditorCanvas
          image={editor.readyImage}
          document={editor.history.document}
          tool={editor.tool}
          mode={editor.mode}
          brushSize={editor.brushSize}
          brushHardness={editor.brushHardness}
          onMarkComplete={editor.commitMark}
          retainedView={retainedView}
        />
      ) : editor.loadState.status === 'failed' ? (
        <UiError
          title={t('node.elementEditGeneration.sourceLoadFailed')}
          message={editor.loadState.message}
          onRetry={editor.retryLoad}
          className="flex-1"
        />
      ) : (
        <UiLoading message={t('node.elementEditGeneration.loadingMask')} className="flex-1" />
      )}

      {/* 蒙版改了就自动存，正常时不提示；只有保存失败（会自动重试）才说一声 */}
      {autosave.status === 'failed' && (
        <UiFieldMessage data-local-redraw-autosave-status={autosave.status} tone="error" className="shrink-0 px-3 pb-2">
          {t('node.elementEditGeneration.autosave.failed')}
        </UiFieldMessage>
      )}
    </div>
  );
});
