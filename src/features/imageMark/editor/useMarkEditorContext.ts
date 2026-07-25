import { useContext } from 'react';
import { MarkEditorContext, type MarkEditorContextValue } from './markEditorContextValue';

export function useMarkEditorContext(): MarkEditorContextValue {
  const value = useContext(MarkEditorContext);
  if (!value) {
    throw new Error('标注编辑器子组件必须位于 MarkEditorContextProvider 内');
  }
  return value;
}
