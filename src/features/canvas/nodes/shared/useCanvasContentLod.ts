import { useCallback, useDeferredValue } from 'react';
import { useStore, type ReactFlowState } from '@xyflow/react';

import { useSettingsStore, type CanvasLodLevel } from '@/stores/settingsStore';

/**
 * 各 LOD 等级的缩放阈值：低于该倍率时启用低倍率简化
 * （内容型节点正文换轻量占位 + 媒体节点缩略图降为微缩略图）。
 * null = 该等级从不简化。阈值只在跨越时触发一次布尔翻转，不随缩放逐帧变化。
 */
const CONTENT_LOD_THRESHOLDS: Record<CanvasLodLevel, number | null> = {
  off: null,
  detail: 0.25,
  balanced: 0.4,
  performance: 0.6,
};

function useContentLodThreshold(): number | null {
  const level = useSettingsStore((state) => state.canvasLodLevel);
  return CONTENT_LOD_THRESHOLDS[level] ?? CONTENT_LOD_THRESHOLDS.balanced;
}

/** 当前缩放是否低于内容 LOD 阈值（true = 应展示轻量占位），受设置项 canvasLodLevel 控制 */
export function useCanvasContentLod(): boolean {
  const threshold = useContentLodThreshold();
  const selector = useCallback(
    (state: ReactFlowState): boolean => threshold !== null && state.transform[2] < threshold,
    [threshold]
  );
  return useStore(selector);
}

/**
 * 媒体节点（图片/上传/视频封面）是否应降为微缩略图。
 * 与内容 LOD 共用同一阈值，但经 useDeferredValue 降级：
 * 阈值翻转会让全部媒体节点同时换图源，deferred 后 React 可分片让位给缩放帧。
 */
export function useMediaMicroLod(): boolean {
  const threshold = useContentLodThreshold();
  const selector = useCallback(
    (state: ReactFlowState): boolean => threshold !== null && state.transform[2] < threshold,
    [threshold]
  );
  return useDeferredValue(useStore(selector));
}
