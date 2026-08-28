import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import type { ImageViewerModalProps } from '@/components/mediaViewer/ImageViewerModal';
import {
  CANVAS_IMAGE_VIEWER_MODES,
  resolveCanvasImageViewerMode,
  type CanvasImageViewerMode,
} from '@/features/canvas/domain/canvasNodes';

export interface CanvasImageViewerSurfaceProps extends ImageViewerModalProps {
  /** 来源结果节点，用于查看器内下载原始受管媒体与日志定位。 */
  sourceNodeId?: string | null;
}

export interface CanvasViewerSurfaceDefinition {
  mode: CanvasImageViewerMode;
  component: LazyExoticComponent<ComponentType<CanvasImageViewerSurfaceProps>>;
  /** 专用实现未就绪时显式标记安全降级目标。 */
  fallbackMode: CanvasImageViewerMode | null;
}

const loadFlatImageViewer = async (): Promise<{
  default: ComponentType<CanvasImageViewerSurfaceProps>;
}> => import('./FlatCanvasImageViewerSurface').then((module) => ({
  default: module.FlatCanvasImageViewerSurface,
}));

const loadPanoramaViewer = async (): Promise<{
  default: ComponentType<CanvasImageViewerSurfaceProps>;
}> => import('./panorama/PanoramaViewerModal').then((module) => ({
  default: module.PanoramaViewerModal,
}));

/**
 * 稳定查看模式到懒加载界面的唯一路由。
 * 重型查看界面只在请求对应模式后才加载，避免 WebGL 进入画布启动包与节点热路径。
 */
const VIEWER_SURFACE_REGISTRY: Readonly<Record<CanvasImageViewerMode, CanvasViewerSurfaceDefinition>> = {
  image: {
    mode: 'image',
    component: lazy(loadFlatImageViewer),
    fallbackMode: null,
  },
  panorama: {
    mode: 'panorama',
    component: lazy(loadPanoramaViewer),
    fallbackMode: null,
  },
};

export function getCanvasViewerSurfaceDefinition(mode: unknown): CanvasViewerSurfaceDefinition {
  return VIEWER_SURFACE_REGISTRY[resolveCanvasImageViewerMode(mode)];
}

export function listCanvasViewerSurfaceDefinitions(): readonly CanvasViewerSurfaceDefinition[] {
  return CANVAS_IMAGE_VIEWER_MODES.map((mode) => VIEWER_SURFACE_REGISTRY[mode]);
}
