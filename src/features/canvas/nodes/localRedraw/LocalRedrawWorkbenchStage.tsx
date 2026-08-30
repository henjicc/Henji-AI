import { Brush, Circle, Eraser, Lasso, Redo2, Square, Trash2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { UiChipButton, UiError, UiIconButton, UiLoading, UiRangeInput } from '@/components/ui';
import { MaskEditorCanvas } from '@/features/maskEditor/MaskEditorCanvas';
import { hasPaintedMask } from '@/features/maskEditor/maskDocument';
import type { MaskEditorDocument, MaskTool } from '@/features/maskEditor/types';
import { maxMaskBrushSize, useMaskEditorSession } from '@/features/maskEditor/useMaskEditorSession';
import { useLocalRedrawMaskAutosave } from './useLocalRedrawMaskAutosave';

interface LocalRedrawWorkbenchStageProps {
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

export function LocalRedrawWorkbenchStage({
  sourceImage,
  initialDocument,
  onPersist,
}: LocalRedrawWorkbenchStageProps): JSX.Element {
  const { t } = useTranslation();
  const editor = useMaskEditorSession({
    sourceImage,
    initialDocument,
  });
  const autosave = useLocalRedrawMaskAutosave({
    document: editor.history.document,
    ready: Boolean(editor.readyImage),
    onPersist,
  });
  const painted = hasPaintedMask(editor.history.document);
  const brushMax = maxMaskBrushSize(editor.history.document.width, editor.history.document.height);

  return (
    <div
      data-local-redraw-workbench="true"
      className="nodrag nowheel relative flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      {editor.readyImage ? (
        <MaskEditorCanvas
          image={editor.readyImage}
          document={editor.history.document}
          tool={editor.tool}
          mode={editor.mode}
          brushSize={editor.brushSize}
          brushHardness={editor.brushHardness}
          onMarkComplete={editor.commitMark}
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

      <div className="absolute left-2 right-2 top-2 flex min-w-0 items-center gap-1 rounded-lg bg-overlay p-1.5">
        {TOOLS.map(({ value, labelKey, icon: Icon }) => {
          const label = t(labelKey);
          return (
            <UiChipButton
              key={value}
              type="button"
              selectionRole="navigation"
              active={editor.tool === value}
              title={label}
              aria-label={label}
              className="h-8 px-2"
              onClick={() => editor.setTool(value)}
            >
              <Icon className="h-3.5 w-3.5" />
            </UiChipButton>
          );
        })}
        <UiChipButton
          type="button"
          selectionRole="navigation"
          active={editor.mode === 'erase'}
          title={t('node.elementEditGeneration.tools.erase')}
          aria-label={t('node.elementEditGeneration.tools.erase')}
          className="h-8 px-2"
          onClick={() => editor.setMode(editor.mode === 'erase' ? 'paint' : 'erase')}
        >
          <Eraser className="h-3.5 w-3.5" />
        </UiChipButton>
        <div className="ml-1 flex items-center gap-1 border-l border-veil-subtle pl-1.5">
          <UiIconButton
            type="button"
            appearance="hover-only"
            showBorder={false}
            aria-label={t('node.elementEditGeneration.undoMask')}
            disabled={editor.history.undoStack.length === 0}
            onClick={() => editor.dispatchHistory({ type: 'undo' })}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </UiIconButton>
          <UiIconButton
            type="button"
            appearance="hover-only"
            showBorder={false}
            aria-label={t('node.elementEditGeneration.redoMask')}
            disabled={editor.history.redoStack.length === 0}
            onClick={() => editor.dispatchHistory({ type: 'redo' })}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </UiIconButton>
          <UiIconButton
            type="button"
            appearance="hover-only"
            showBorder={false}
            hoverVariant="danger"
            aria-label={t('node.elementEditGeneration.clearMask')}
            disabled={!painted}
            onClick={editor.clearDocument}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </UiIconButton>
        </div>
      </div>

      <div className="absolute bottom-2 left-2 right-2 flex items-center gap-2 rounded-lg bg-overlay p-2">
        <span className="shrink-0 text-2xs text-text-soft">
          {t('node.elementEditGeneration.brushSize', { size: Math.round(editor.brushSize) })}
        </span>
        <UiRangeInput
          min={4}
          max={brushMax}
          step={1}
          value={editor.brushSize}
          onChange={(event) => editor.setBrushSize(Number(event.currentTarget.value))}
          className="min-w-0 flex-1"
        />
        <span
          data-local-redraw-autosave-status={autosave.status}
          className={`shrink-0 text-2xs ${autosave.status === 'failed' ? 'text-danger' : 'text-text-muted'}`}
        >
          {autosave.status === 'saving'
            ? t('node.elementEditGeneration.autosave.saving')
            : autosave.status === 'saved'
              ? t('node.elementEditGeneration.autosave.saved')
              : autosave.status === 'failed'
                ? t('node.elementEditGeneration.autosave.failed')
                : t('node.elementEditGeneration.autosave.idle')}
        </span>
      </div>
    </div>
  );
}
