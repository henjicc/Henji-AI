import { Suspense, useCallback, useEffect } from 'react';

import { commitCanvasSpecialEditor } from '@/features/canvas/application/specialEditorApplicationService';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  shouldCloseCanvasSpecialEditor,
  useCanvasSpecialEditorController,
} from '@/features/canvas/application/specialEditorController';
import { getCanvasSpecialEditorDefinition } from './specialEditorRegistry';

export function CanvasSpecialEditorHost(): JSX.Element | null {
  const session = useCanvasSpecialEditorController((state) => state.session);
  const updateDraft = useCanvasSpecialEditorController((state) => state.updateDraft);
  const requestCancel = useCanvasSpecialEditorController((state) => state.requestCancel);
  const keepEditing = useCanvasSpecialEditorController((state) => state.keepEditing);
  const discard = useCanvasSpecialEditorController((state) => state.discard);
  const currentProjectId = useProjectStore((state) => state.currentProjectId);
  const nodeExists = useCanvasStore((state) => (
    session ? state.nodes.some((node) => node.id === session.nodeId) : false
  ));
  const definition = session ? getCanvasSpecialEditorDefinition(session.editorKey) : null;

  useEffect(() => {
    if (
      session
      && (
        !definition
        || shouldCloseCanvasSpecialEditor(session, currentProjectId, nodeExists)
      )
    ) {
      discard();
    }
  }, [currentProjectId, definition, discard, nodeExists, session]);

  useEffect(() => () => discard(), [discard]);

  const handleConfirm = useCallback(() => {
    if (session) commitCanvasSpecialEditor(session.sessionId);
  }, [session]);

  if (!session) return null;
  if (!definition) return null;
  const EditorSurface = definition.component;

  return (
    <Suspense fallback={null}>
      <EditorSurface
        session={session}
        onDraftChange={updateDraft}
        onConfirm={handleConfirm}
        onCancel={requestCancel}
        onKeepEditing={keepEditing}
        onDiscard={discard}
      />
    </Suspense>
  );
}
