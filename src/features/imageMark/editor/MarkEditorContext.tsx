import { createContext, useContext, type ReactNode } from 'react';
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

const MarkEditorContext = createContext<MarkEditorContextValue | null>(null);

export function MarkEditorContextProvider({
  value,
  children,
}: {
  value: MarkEditorContextValue;
  children: ReactNode;
}): JSX.Element {
  return <MarkEditorContext.Provider value={value}>{children}</MarkEditorContext.Provider>;
}

export function useMarkEditorContext(): MarkEditorContextValue {
  const value = useContext(MarkEditorContext);
  if (!value) {
    throw new Error('MarkEditor 子组件必须位于 MarkEditorContextProvider 内');
  }
  return value;
}
