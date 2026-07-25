import { createContext } from 'react';
import type { ImageMarkDoc, MarkToolType } from '../domain/types';
import type { OrientationOp } from '../domain/geometry';
import type { MarkEditorStyleState } from './shared';
import type { MarkHistoryController } from './useMarkHistory';

export interface MarkEditorContextValue {
  doc: ImageMarkDoc;
  tool: MarkToolType;
  selectTool: (tool: MarkToolType) => void;
  style: MarkEditorStyleState;
  onStylePatch: (patch: Partial<MarkEditorStyleState>) => void;
  cropRatioValue: string;
  onCropRatioChange: (value: string) => void;
  onCropReset: () => void;
  hasCrop: boolean;
  onOrientation: (operation: OrientationOp) => void;
  history: MarkHistoryController;
}

export const MarkEditorContext = createContext<MarkEditorContextValue | null>(null);
