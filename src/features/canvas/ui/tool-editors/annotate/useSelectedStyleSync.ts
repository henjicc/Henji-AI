import { useEffect } from 'react';
import type { ToolOptions } from '@/features/canvas/tools';
import type { AnnotationItem } from '@/features/canvas/tools/annotation';
import {
  clamp,
  fontSizeToPercent,
  lineWidthToPercent,
  MAX_LINE_WIDTH_PERCENT,
  MAX_TEXT_SIZE_PERCENT,
  MIN_LINE_WIDTH_PERCENT,
  MIN_TEXT_SIZE_PERCENT,
  pruneUndefinedToolOptionsPatch,
  type TextEditorState,
} from './shared';

interface UseSelectedStyleSyncParams {
  options: ToolOptions;
  onOptionsChange: (options: ToolOptions) => void;
  selectedAnnotation: AnnotationItem | null;
  textEditorState: TextEditorState | null;
  textBaseSize: number;
}

export function useSelectedStyleSync({
  options,
  onOptionsChange,
  selectedAnnotation,
  textEditorState,
  textBaseSize,
}: UseSelectedStyleSyncParams): void {
  useEffect(() => {
    if (!selectedAnnotation || textEditorState) {
      return;
    }
    const patch: Partial<ToolOptions> = selectedAnnotation.type === 'text'
      ? {
        color: selectedAnnotation.color,
        fontSizePercent: clamp(
          fontSizeToPercent(selectedAnnotation.fontSize, textBaseSize),
          MIN_TEXT_SIZE_PERCENT,
          MAX_TEXT_SIZE_PERCENT
        ),
      }
      : {
        color: selectedAnnotation.stroke,
        lineWidthPercent: clamp(
          lineWidthToPercent(selectedAnnotation.lineWidth, textBaseSize),
          MIN_LINE_WIDTH_PERCENT,
          MAX_LINE_WIDTH_PERCENT
        ),
      };
    const safePatch = pruneUndefinedToolOptionsPatch(patch);
    const hasChange = Object.entries(safePatch).some(([key, value]) => !Object.is(options[key], value));
    if (!hasChange) {
      return;
    }
    onOptionsChange({ ...options, ...safePatch } as ToolOptions);
  }, [onOptionsChange, options, selectedAnnotation, textBaseSize, textEditorState]);
}
