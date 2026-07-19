import { useStore, type ReactFlowState } from '@xyflow/react';

/**
 * 低于该倍率时，内容型节点（生成壳/分镜编辑格）的正文已不可读，
 * 切换为轻量占位渲染（CSS visibility 隐藏正文 + 显示大号标题占位）。
 * 阈值只在跨越时触发一次布尔翻转，不随缩放逐帧变化。
 */
const CONTENT_LOD_ZOOM_THRESHOLD = 0.4;

const selector = (state: ReactFlowState): boolean => state.transform[2] < CONTENT_LOD_ZOOM_THRESHOLD;

/** 当前缩放是否低于内容 LOD 阈值（true = 应展示轻量占位） */
export function useCanvasContentLod(): boolean {
  return useStore(selector);
}
