import { useDeferredValue, useSyncExternalStore } from 'react';
import { useCanvasViewSubscriptions } from './useCanvasViewSubscriptions';

/**
 * 是否应展示原图（而非缩略图）。
 * 共用画布的派生布尔值，只在跨越 LOD 阈值时通知节点。
 * 再经 useDeferredValue 降级：阈值翻转会让全部图片节点同时重渲染，
 * 同步执行是一次上百毫秒的长任务；deferred 后 React 可分片让位给缩放帧。
 */
export function useOriginalImageLod(): boolean {
  const { originalImage } = useCanvasViewSubscriptions();
  return useDeferredValue(useSyncExternalStore(originalImage.subscribe, originalImage.getSnapshot));
}
