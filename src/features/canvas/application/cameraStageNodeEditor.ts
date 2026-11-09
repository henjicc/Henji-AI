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

export function markCameraStageNodeEditorFailed(nodeId: string, failure: string): void {
  if (useCameraStageNodeEditor.getState().nodeId === nodeId) useCameraStageNodeEditor.setState({ failure });
}
