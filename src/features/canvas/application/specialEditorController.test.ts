import { beforeEach, describe, expect, it } from 'vitest';

import {
  isCanvasSpecialEditorKey,
  shouldCloseCanvasSpecialEditor,
  useCanvasSpecialEditorController,
} from './specialEditorController';

describe('specialEditorController', () => {
  beforeEach(() => {
    useCanvasSpecialEditorController.setState({ session: null });
  });

  it('只接受能力契约中的稳定专用编辑器 key', () => {
    expect(isCanvasSpecialEditorKey('relight')).toBe(true);
    expect(isCanvasSpecialEditorKey('standard')).toBe(false);
    expect(isCanvasSpecialEditorKey('unknown')).toBe(false);
  });

  it('管理打开、草稿、脏状态与确认完成', () => {
    const controller = useCanvasSpecialEditorController.getState();
    const sessionId = controller.open({
      projectId: 'project-a',
      nodeId: 'node-a',
      editorKey: 'relight',
      initialState: { params: { brightness: 1 } },
    });
    expect(useCanvasSpecialEditorController.getState().session).toMatchObject({
      sessionId,
      isDirty: false,
      discardConfirmationRequested: false,
    });

    useCanvasSpecialEditorController.getState().updateDraft({ params: { brightness: 2 } });
    expect(useCanvasSpecialEditorController.getState().session).toMatchObject({ isDirty: true });
    useCanvasSpecialEditorController.getState().complete();
    expect(useCanvasSpecialEditorController.getState().session).toBeNull();
  });

  it('干净会话直接取消，脏会话要求二次确认', () => {
    useCanvasSpecialEditorController.getState().open({
      projectId: 'project-a', nodeId: 'node-a', editorKey: 'mask', initialState: {},
    });
    expect(useCanvasSpecialEditorController.getState().requestCancel()).toBe('closed');
    expect(useCanvasSpecialEditorController.getState().session).toBeNull();

    useCanvasSpecialEditorController.getState().open({
      projectId: 'project-a', nodeId: 'node-a', editorKey: 'mask', initialState: {},
    });
    useCanvasSpecialEditorController.getState().updateDraft({ mask: 'derived-media-ref' });
    expect(useCanvasSpecialEditorController.getState().requestCancel()).toBe('confirmation-required');
    expect(useCanvasSpecialEditorController.getState().session?.discardConfirmationRequested).toBe(true);
    useCanvasSpecialEditorController.getState().keepEditing();
    expect(useCanvasSpecialEditorController.getState().session?.discardConfirmationRequested).toBe(false);
    useCanvasSpecialEditorController.getState().discard();
    expect(useCanvasSpecialEditorController.getState().session).toBeNull();
  });

  it('节点删除或项目切换时判定会话失效', () => {
    useCanvasSpecialEditorController.getState().open({
      projectId: 'project-a', nodeId: 'node-a', editorKey: 'layers', initialState: {},
    });
    const session = useCanvasSpecialEditorController.getState().session;
    expect(session).not.toBeNull();
    if (!session) return;

    expect(shouldCloseCanvasSpecialEditor(session, 'project-a', true)).toBe(false);
    expect(shouldCloseCanvasSpecialEditor(session, 'project-a', false)).toBe(true);
    expect(shouldCloseCanvasSpecialEditor(session, 'project-b', true)).toBe(true);
  });
});
