import { createLogger } from '@/core/logging';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import {
  isCanvasSpecialEditorKey,
  useCanvasSpecialEditorController,
  type CanvasSpecialEditorCancelResult,
  type CanvasSpecialEditorKey,
} from './specialEditorController';
import { CanvasApplicationError, requireCurrentCanvasProject } from './canvasApplicationService';
import { updateCanvasNodeFromSpecialEditor } from './canvasMutationService';

const logger = createLogger('features.canvas.specialEditor');

export function openCanvasSpecialEditor(input: {
  projectId: string;
  nodeId: string;
  editorKey: CanvasSpecialEditorKey;
  initialState: Readonly<DynamicValueMap>;
}): string {
  requireCurrentCanvasProject(input.projectId);
  if (!isCanvasSpecialEditorKey(input.editorKey)) {
    throw new CanvasApplicationError('INVALID_INPUT', '未知的画布专用编辑器', true, {
      editorKey: input.editorKey,
    });
  }
  if (!useCanvasStore.getState().nodes.some((node) => node.id === input.nodeId)) {
    throw new CanvasApplicationError('NOT_FOUND', '画布节点不存在', true, { nodeId: input.nodeId });
  }
  return useCanvasSpecialEditorController.getState().open(input);
}

export function commitCanvasSpecialEditor(sessionId: string): void {
  const controller = useCanvasSpecialEditorController.getState();
  const session = controller.session;
  if (!session || session.sessionId !== sessionId) {
    throw new CanvasApplicationError('STALE_CONTEXT', '专用编辑会话已过期', true, { sessionId });
  }
  requireCurrentCanvasProject(session.projectId);
  logger.info('专用编辑器提交开始', {
    event: 'canvas.special_editor.commit.start',
    projectId: session.projectId,
    context: { nodeId: session.nodeId, editorKey: session.editorKey, sessionId },
  });
  try {
    if (session.isDirty) {
      const changedEntries = Object.entries(session.draftState).filter(([key, value]) => (
        JSON.stringify(value) !== JSON.stringify(session.initialState[key])
      ));
      updateCanvasNodeFromSpecialEditor({
        projectId: session.projectId,
        nodeId: session.nodeId,
        data: Object.fromEntries(changedEntries),
      });
    }
    useCanvasSpecialEditorController.getState().complete();
    logger.info('专用编辑器提交完成', {
      event: 'canvas.special_editor.commit.completed',
      projectId: session.projectId,
      context: { nodeId: session.nodeId, editorKey: session.editorKey, sessionId },
    });
  } catch (error) {
    logger.error('专用编辑器提交失败', error, {
      event: 'canvas.special_editor.commit.failed',
      projectId: session.projectId,
      context: { nodeId: session.nodeId, editorKey: session.editorKey, sessionId },
    });
    throw error;
  }
}

export function cancelCanvasSpecialEditor(): CanvasSpecialEditorCancelResult {
  return useCanvasSpecialEditorController.getState().requestCancel();
}

export function closeCanvasSpecialEditorForInvalidContext(): void {
  const session = useCanvasSpecialEditorController.getState().session;
  if (!session) return;
  const currentProjectId = useProjectStore.getState().currentProjectId;
  const nodeExists = useCanvasStore.getState().nodes.some((node) => node.id === session.nodeId);
  if (currentProjectId !== session.projectId || !nodeExists) {
    useCanvasSpecialEditorController.getState().discard();
  }
}
