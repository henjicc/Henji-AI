import { useDeferredValue, useSyncExternalStore } from 'react';
import { useCanvasViewSubscriptions } from './useCanvasViewSubscriptions';

/** 当前缩放是否低于内容 LOD 阈值（true = 应展示轻量占位），受设置项 canvasLodLevel 控制 */
export function useCanvasContentLod(): boolean {
  const { contentLow } = useCanvasViewSubscriptions();
  return useSyncExternalStore(contentLow.subscribe, contentLow.getSnapshot);
}

/**
 * 媒体节点（图片/上传/视频封面）是否应降为微缩略图。
 * 与内容 LOD 共用同一阈值，但经 useDeferredValue 降级：
 * 阈值翻转会让全部媒体节点同时换图源，deferred 后 React 可分片让位给缩放帧。
 */
export function useMediaMicroLod(): boolean {
  return useDeferredValue(useCanvasContentLod());
}
