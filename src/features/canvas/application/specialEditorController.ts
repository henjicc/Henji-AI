import { create } from 'zustand';

import type { CanvasImageCapabilityEditorKind } from '@/features/canvas/capabilities';

export type CanvasSpecialEditorKey = Exclude<CanvasImageCapabilityEditorKind, 'standard'>;

export interface CanvasSpecialEditorSession {
  sessionId: string;
  projectId: string;
  nodeId: string;
  editorKey: CanvasSpecialEditorKey;
  initialState: Readonly<DynamicValueMap>;
  draftState: Readonly<DynamicValueMap>;
  isDirty: boolean;
  discardConfirmationRequested: boolean;
}

interface OpenCanvasSpecialEditorRequest {
  projectId: string;
  nodeId: string;
  editorKey: CanvasSpecialEditorKey;
  initialState: Readonly<DynamicValueMap>;
}

export type CanvasSpecialEditorCancelResult = 'closed' | 'confirmation-required';

interface CanvasSpecialEditorControllerState {
  session: CanvasSpecialEditorSession | null;
  open: (request: OpenCanvasSpecialEditorRequest) => string;
  updateDraft: (draftState: Readonly<DynamicValueMap>) => void;
  requestCancel: () => CanvasSpecialEditorCancelResult;
  keepEditing: () => void;
  discard: () => void;
  complete: () => void;
}

const SPECIAL_EDITOR_KEYS = new Set<CanvasImageCapabilityEditorKind>([
  'relight',
  'multiAngle',
  'mask',
  'layers',
  'gridSplit',
]);

function copyState(value: Readonly<DynamicValueMap>): DynamicValueMap {
  return { ...value };
}

export function isCanvasSpecialEditorKey(value: unknown): value is CanvasSpecialEditorKey {
  return typeof value === 'string'
    && value !== 'standard'
    && SPECIAL_EDITOR_KEYS.has(value as CanvasImageCapabilityEditorKind);
}

export const useCanvasSpecialEditorController = create<CanvasSpecialEditorControllerState>(
  (set, get) => ({
    session: null,
    open: (request) => {
      const sessionId = crypto.randomUUID();
      set({
        session: {
          sessionId,
          projectId: request.projectId,
          nodeId: request.nodeId,
          editorKey: request.editorKey,
          initialState: copyState(request.initialState),
          draftState: copyState(request.initialState),
          isDirty: false,
          discardConfirmationRequested: false,
        },
      });
      return sessionId;
    },
    updateDraft: (draftState) => set((state) => state.session
      ? {
          session: {
            ...state.session,
            draftState: copyState(draftState),
            isDirty: true,
            discardConfirmationRequested: false,
          },
        }
      : {}),
    requestCancel: () => {
      const session = get().session;
      if (!session) return 'closed';
      if (!session.isDirty) {
        set({ session: null });
        return 'closed';
      }
      set({ session: { ...session, discardConfirmationRequested: true } });
      return 'confirmation-required';
    },
    keepEditing: () => set((state) => state.session
      ? { session: { ...state.session, discardConfirmationRequested: false } }
      : {}),
    discard: () => set({ session: null }),
    complete: () => set({ session: null }),
  })
);

export function shouldCloseCanvasSpecialEditor(
  session: CanvasSpecialEditorSession,
  currentProjectId: string | null,
  nodeExists: boolean
): boolean {
  return currentProjectId !== session.projectId || !nodeExists;
}
