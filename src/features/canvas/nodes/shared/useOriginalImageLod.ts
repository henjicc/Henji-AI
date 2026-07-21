import { useDeferredValue } from 'react';
import { useStore, type ReactFlowState } from '@xyflow/react';

import { shouldUseOriginalImageByZoom } from '@/features/canvas/application/imageData';

const selector = (state: ReactFlowState): boolean => shouldUseOriginalImageByZoom(state.transform[2]);

/**
 * 是否应展示原图（而非缩略图）。
 * 用 useStore + 派生布尔值订阅视口，只在跨越 LOD 阈值时才触发重渲染，
 * 避免像 useViewport() 那样在每一帧拖拽/缩放时都重渲染节点。
 * 再经 useDeferredValue 降级：阈值翻转会让全部图片节点同时重渲染，
 * 同步执行是一次上百毫秒的长任务；deferred 后 React 可分片让位给缩放帧。
 */
export function useOriginalImageLod(): boolean {
  return useDeferredValue(useStore(selector));
}
