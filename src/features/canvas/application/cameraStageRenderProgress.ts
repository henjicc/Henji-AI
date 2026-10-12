import { create } from 'zustand';
import type { CameraStageRenderTaskSnapshot } from '@/platform/contracts/cameraStageRender';

export interface CameraStageNodeRenderProgress {
  outputKind: 'image' | 'video';
  progress: number;
  phase: CameraStageRenderTaskSnapshot['phase'];
  requestId?: string;
}

/** 渲染任务的瞬态投影。作品、撤销和持久化都不拥有这份状态。 */
const useRenderProgressStore = create<{ tasks: ReadonlyMap<string, CameraStageNodeRenderProgress> }>(() => ({ tasks: new Map() }));
const keyOf = (projectId: string, nodeId: string): string => `${projectId}:${nodeId}`;

export function setCameraStageNodeRenderProgress(projectId: string, nodeId: string, progress: CameraStageNodeRenderProgress | null): void {
  useRenderProgressStore.setState((state) => {
    const tasks = new Map(state.tasks);
    const key = keyOf(projectId, nodeId);
    if (progress) tasks.set(key, progress);
    else tasks.delete(key);
    return { tasks };
  });
}

export function useCameraStageNodeRenderProgress(projectId: string | null, nodeId: string): CameraStageNodeRenderProgress | null {
  return useRenderProgressStore((state) => projectId ? state.tasks.get(keyOf(projectId, nodeId)) ?? null : null);
}

export function clearCameraStageRenderProgress(): void {
  useRenderProgressStore.setState({ tasks: new Map() });
}

/** 旧任务清理不能覆盖同一节点上新任务的投影。 */
export function clearCameraStageNodeRenderProgress(projectId: string, nodeId: string, requestId: string): void {
  const current = useRenderProgressStore.getState().tasks.get(keyOf(projectId, nodeId));
  if (current?.requestId === requestId) setCameraStageNodeRenderProgress(projectId, nodeId, null);
}
