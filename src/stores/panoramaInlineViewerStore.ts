import { create } from 'zustand';

interface PanoramaInlineViewerState {
  activeNodeId: string | null;
  claim: (nodeId: string) => void;
  release: (nodeId: string) => void;
}

/** 画布会挂载全部节点；全局租约保证同一时刻最多一个内嵌全景 WebGL 上下文。 */
export const usePanoramaInlineViewerStore = create<PanoramaInlineViewerState>((set) => ({
  activeNodeId: null,
  claim: (nodeId) => set((state) => (
    state.activeNodeId === nodeId ? state : { activeNodeId: nodeId }
  )),
  release: (nodeId) => set((state) => (
    state.activeNodeId === nodeId ? { activeNodeId: null } : state
  )),
}));
