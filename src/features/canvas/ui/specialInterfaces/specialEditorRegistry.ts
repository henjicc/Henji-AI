import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import {
  isCanvasSpecialEditorKey,
  type CanvasSpecialEditorCancelResult,
  type CanvasSpecialEditorKey,
  type CanvasSpecialEditorSession,
} from '@/features/canvas/application/specialEditorController';

export interface CanvasSpecialEditorSurfaceProps {
  session: CanvasSpecialEditorSession;
  onDraftChange: (draftState: Readonly<DynamicValueMap>) => void;
  onConfirm: () => void;
  onCancel: () => CanvasSpecialEditorCancelResult;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

export interface CanvasSpecialEditorDefinition {
  key: CanvasSpecialEditorKey;
  component: LazyExoticComponent<ComponentType<CanvasSpecialEditorSurfaceProps>>;
}

export type CanvasSpecialEditorLoader = () => Promise<{
  default: ComponentType<CanvasSpecialEditorSurfaceProps>;
}>;

const editorDefinitions = new Map<CanvasSpecialEditorKey, CanvasSpecialEditorDefinition>();

/**
 * 专用编辑器只在运行时注册懒加载组件；能力声明始终只保存稳定 key。
 */
export function registerCanvasSpecialEditor(
  key: CanvasSpecialEditorKey,
  loader: CanvasSpecialEditorLoader
): () => void {
  if (!isCanvasSpecialEditorKey(key)) {
    throw new Error(`未知的画布专用编辑器：${String(key)}`);
  }
  if (editorDefinitions.has(key)) {
    throw new Error(`画布专用编辑器重复注册：${key}`);
  }
  const definition: CanvasSpecialEditorDefinition = {
    key,
    component: lazy(loader),
  };
  editorDefinitions.set(key, definition);
  return () => {
    if (editorDefinitions.get(key) === definition) editorDefinitions.delete(key);
  };
}

export function getCanvasSpecialEditorDefinition(
  key: CanvasSpecialEditorKey
): CanvasSpecialEditorDefinition | null {
  return editorDefinitions.get(key) ?? null;
}
