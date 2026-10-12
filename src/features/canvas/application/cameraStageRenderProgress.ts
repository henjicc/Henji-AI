import { create } from 'zustand';
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
export const useCameraStageRenderProgressStore = create<RenderProgressState>((set) => ({
  tasks: new Map(),
  setProgress: (key, progress) => set((state) => {
    const tasks = new Map(state.tasks);
    if (progress) tasks.set(key, progress);
    else tasks.delete(key);
    return { tasks };
  }),
  clearAll: () => set({ tasks: new Map() }),
}));

export function setCameraStageNodeRenderProgress(projectId: string, nodeId: string, progress: CameraStageNodeRenderProgress | null): void {
  useCameraStageRenderProgressStore.getState().setProgress(keyOf(projectId, nodeId), progress);
}

export function useCameraStageNodeRenderProgress(projectId: string | null, nodeId: string): CameraStageNodeRenderProgress | null {
  return useCameraStageRenderProgressStore((state) => projectId ? state.tasks.get(keyOf(projectId, nodeId)) ?? null : null);
}

export function clearCameraStageRenderProgress(): void {
  useCameraStageRenderProgressStore.getState().clearAll();
}

/** 旧任务清理不能覆盖同一节点上新任务的投影。 */
export function clearCameraStageNodeRenderProgress(projectId: string, nodeId: string, requestId: string): void {
  const current = useCameraStageRenderProgressStore.getState().tasks.get(keyOf(projectId, nodeId));
  if (current?.requestId === requestId) setCameraStageNodeRenderProgress(projectId, nodeId, null);
}
