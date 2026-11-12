import { create } from 'zustand';

/**
 * 画布里 3D 镜头参考节点的全屏编辑器开关。
 * 界面双击节点和助手打开节点走同一份状态；documentId 在编辑器把节点的镜头参考载入场景后才写入，
 * 打开方据此确认编辑器真的可用，而不是只发出了打开请求。
 */
interface CameraStageNodeEditorState {
  nodeId: string | null;
  documentId: string | null;
  failure: string | null;
}

export const useCameraStageNodeEditor = create<CameraStageNodeEditorState>(() => ({
  nodeId: null,
  documentId: null,
  failure: null,
}));

export function openCameraStageNodeEditorDialog(nodeId: string): void {
  useCameraStageNodeEditor.setState({ nodeId, documentId: null, failure: null });
}

export function closeCameraStageNodeEditorDialog(): void {
  useCameraStageNodeEditor.setState({ nodeId: null, documentId: null, failure: null });
}

export function markCameraStageNodeEditorLoaded(nodeId: string, documentId: string): void {
  if (useCameraStageNodeEditor.getState().nodeId === nodeId) useCameraStageNodeEditor.setState({ documentId, failure: null });
}

/**
 * 节点编辑器载入的镜头参考文档在画布页显示时算前台编辑，删除与后台释放都要拒绝。
 * 画布页切走后不算：这时释放会结束会话，编辑器跟着关掉（不再保存，会话关闭时已写完）。
 */
export function registerCameraStageNodeEditorDocument(
  registerEditor: (name: string, provider: (host: { activeWorkspace: string }) => string | undefined) => () => void,
  subscribeDisposal: (listener: (documentId: string) => void) => () => void,
): () => void {
  const unregister = registerEditor('canvas.cameraStageNode', host => host.activeWorkspace === 'nodes' ? useCameraStageNodeEditor.getState().documentId ?? undefined : undefined);
  const unsubscribe = subscribeDisposal((documentId) => {
    if (useCameraStageNodeEditor.getState().documentId === documentId) closeCameraStageNodeEditorDialog();
  });
  return () => { unregister(); unsubscribe(); };
}

export function markCameraStageNodeEditorFailed(nodeId: string, failure: string): void {
  if (useCameraStageNodeEditor.getState().nodeId === nodeId) useCameraStageNodeEditor.setState({ failure });
}
