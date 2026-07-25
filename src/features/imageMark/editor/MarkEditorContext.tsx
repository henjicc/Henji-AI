import type { ReactNode } from 'react';
import { MarkEditorContext, type MarkEditorContextValue } from './markEditorContextValue';

export function MarkEditorContextProvider({
  value,
  children,
}: {
  value: MarkEditorContextValue;
  children: ReactNode;
}): JSX.Element {
  return <MarkEditorContext.Provider value={value}>{children}</MarkEditorContext.Provider>;
}

export type { MarkEditorContextValue } from './markEditorContextValue';
