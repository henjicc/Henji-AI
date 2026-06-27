import { useStore, type ReactFlowState } from '@xyflow/react';

import { shouldUseOriginalImageByZoom } from '@/features/canvas/application/imageData';

const selector = (state: ReactFlowState): boolean => shouldUseOriginalImageByZoom(state.transform[2]);

/**
 * 是否应展示原图（而非缩略图）。
 * 用 useStore + 派生布尔值订阅视口，只在跨越 LOD 阈值时才触发重渲染，
 * 避免像 useViewport() 那样在每一帧拖拽/缩放时都重渲染节点。
 */
export function useOriginalImageLod(): boolean {
  return useStore(selector);
}
