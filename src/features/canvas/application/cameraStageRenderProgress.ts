import { createTransientProgressStore } from '@/stores/createTransientProgressStore';
import type { CameraStageRenderTaskSnapshot } from '@/platform/contracts/cameraStageRender';

export interface CameraStageNodeRenderProgress {
  outputKind: 'image' | 'video';
  progress: number;
  phase: CameraStageRenderTaskSnapshot['phase'];
  requestId?: string;
}

/** 渲染任务的瞬态投影。作品、撤销和持久化都不拥有这份状态。 */
interface RenderProgressState {
  tasks: ReadonlyMap<string, CameraStageNodeRenderProgress>
  setProgress: (key: string, progress: CameraStageNodeRenderProgress | null) => void
  clearAll: () => void
}
const keyOf = (projectId: string, nodeId: string): string => `${projectId}:${nodeId}`;
const progressStore = createTransientProgressStore<CameraStageNodeRenderProgress, RenderProgressState>({
  initialState: actions => ({ tasks: new Map(), setProgress: actions.set, clearAll: actions.clearAll }),
  getEntry: (state, id) => state.tasks.get(id),
  entries: state => state.tasks,
  patch: tasks => ({ tasks }),
  equals: (current, next) => current.outputKind === next.outputKind && current.progress === next.progress
    && current.phase === next.phase && current.requestId === next.requestId,
});
export const useCameraStageRenderProgressStore = progressStore.store;

export function setCameraStageNodeRenderProgress(projectId: string, nodeId: string, progress: CameraStageNodeRenderProgress | null): void {
  useCameraStageRenderProgressStore.getState().setProgress(keyOf(projectId, nodeId), progress);
}

export function useCameraStageNodeRenderProgress(projectId: string | null, nodeId: string): CameraStageNodeRenderProgress | null {
  return progressStore.useEntry(projectId ? keyOf(projectId, nodeId) : null) ?? null;
}

export function clearCameraStageRenderProgress(): void {
  useCameraStageRenderProgressStore.getState().clearAll();
}

/** 旧任务清理不能覆盖同一节点上新任务的投影。 */
export function clearCameraStageNodeRenderProgress(projectId: string, nodeId: string, requestId: string): void {
  const current = useCameraStageRenderProgressStore.getState().tasks.get(keyOf(projectId, nodeId));
  if (current?.requestId === requestId) setCameraStageNodeRenderProgress(projectId, nodeId, null);
}
