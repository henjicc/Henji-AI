import { Trash2, Undo2 } from 'lucide-react';
import type { AnnotationToolType } from '@/features/canvas/tools/annotation';
import {
  MAX_LINE_WIDTH_PERCENT,
  MAX_TEXT_SIZE_PERCENT,
  MIN_LINE_WIDTH_PERCENT,
  MIN_TEXT_SIZE_PERCENT,
  TOOL_BUTTONS,
} from './shared';

interface AnnotateToolbarProps {
  tool: AnnotationToolType;
  setTool: (tool: AnnotationToolType) => void;
  setTextEditorState: (open: boolean) => void;
  activeStyleKind: 'shape' | 'text' | null;
  color: string;
  lineWidthPercent: number;
  textSizePercent: number;
  onStylePatch: (patch: { color?: string; lineWidthPercent?: number; fontSizePercent?: number }) => void;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
  canDeleteSelected: boolean;
  canClear: boolean;
}

export function AnnotateToolbar({
  tool,
  setTool,
  setTextEditorState,
  activeStyleKind,
  color,
  lineWidthPercent,
  textSizePercent,
  onStylePatch,
  onUndo,
  onRedo,
  onDeleteSelected,
  onClear,
  canUndo,
  canRedo,
  canDeleteSelected,
  canClear,
}: AnnotateToolbarProps): JSX.Element {
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {TOOL_BUTTONS.map((button) => {
          const Icon = button.icon;
          const active = tool === button.type;
          return (
            <button
              key={button.type}
              type="button"
              onClick={() => {
                setTool(button.type);
                if (button.type !== 'text') {
                  setTextEditorState(false);
                }
              }}
              className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                active
                  ? 'border-accent/45 bg-accent/15 text-text-dark'
                  : 'border-[rgba(255,255,255,0.14)] text-text-muted hover:bg-bg-dark'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {button.label}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {activeStyleKind && (
          <>
            <input
              type="color"
              value={color}
              onChange={(event) => onStylePatch({ color: event.target.value })}
              className="h-9 w-10 cursor-pointer rounded-md border border-[rgba(255,255,255,0.18)] bg-transparent p-1"
            />
            {activeStyleKind === 'shape' && (
              <>
                <input
                  type="range"
                  min={MIN_LINE_WIDTH_PERCENT}
                  max={MAX_LINE_WIDTH_PERCENT}
                  step={0.1}
                  value={Number(lineWidthPercent.toFixed(1))}
                  onChange={(event) => onStylePatch({ lineWidthPercent: Number(event.target.value) })}
                />
                <span className="w-10 text-xs text-text-muted">{lineWidthPercent.toFixed(1)}%</span>
              </>
            )}
            {activeStyleKind === 'text' && (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={MIN_TEXT_SIZE_PERCENT}
                  max={MAX_TEXT_SIZE_PERCENT}
                  step={0.5}
                  value={Number(textSizePercent.toFixed(1))}
                  onChange={(event) =>
                    onStylePatch({
                      fontSizePercent: Number(event.target.value),
                    })
                  }
                  className="h-9 w-24 rounded-lg border border-[rgba(255,255,255,0.14)] bg-bg-dark/80 px-2 text-sm text-text-dark outline-none"
                />
                <span className="text-xs text-text-muted">%</span>
              </div>
            )}
          </>
        )}
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.14)] px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-dark"
          onClick={onUndo}
          disabled={!canUndo}
        >
          <Undo2 className="h-3.5 w-3.5" />
          撤销
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.14)] px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-dark"
          onClick={onRedo}
          disabled={!canRedo}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
          </svg>
          重做
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.14)] px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-dark"
          onClick={onDeleteSelected}
          disabled={!canDeleteSelected}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除选中
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-lg border border-[rgba(255,255,255,0.14)] px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-bg-dark"
          onClick={onClear}
          disabled={!canClear}
        >
          <Trash2 className="h-3.5 w-3.5" />
          清空
        </button>
      </div>
    </>
  );
}
