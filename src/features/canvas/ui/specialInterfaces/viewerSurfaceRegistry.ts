import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import type { ImageViewerModalProps } from '@/components/mediaViewer/ImageViewerModal';
import {
  CANVAS_IMAGE_VIEWER_MODES,
  resolveCanvasImageViewerMode,
  type CanvasImageViewerMode,
} from '@/features/canvas/domain/canvasNodes';

export type CanvasImageViewerSurfaceProps = ImageViewerModalProps;

export interface CanvasViewerSurfaceDefinition {
  mode: CanvasImageViewerMode;
  component: LazyExoticComponent<ComponentType<CanvasImageViewerSurfaceProps>>;
  /** 专用实现未就绪时显式标记安全降级目标。 */
  fallbackMode: CanvasImageViewerMode | null;
}

const loadFlatImageViewer = async (): Promise<{
  default: ComponentType<CanvasImageViewerSurfaceProps>;
}> => import('@/components/mediaViewer/ImageViewerModal').then((module) => ({
  default: module.ImageViewerModal,
}));

/**
 * 稳定查看模式到懒加载界面的唯一路由。
 * panorama 在 2.3 接入球面实现前故意回落到平面查看，保证旧图片可查看。
 */
const VIEWER_SURFACE_REGISTRY: Readonly<Record<CanvasImageViewerMode, CanvasViewerSurfaceDefinition>> = {
  image: {
    mode: 'image',
    component: lazy(loadFlatImageViewer),
    fallbackMode: null,
  },
  panorama: {
    mode: 'panorama',
    component: lazy(loadFlatImageViewer),
    fallbackMode: 'image',
  },
};

export function getCanvasViewerSurfaceDefinition(mode: unknown): CanvasViewerSurfaceDefinition {
  return VIEWER_SURFACE_REGISTRY[resolveCanvasImageViewerMode(mode)];
}

export function listCanvasViewerSurfaceDefinitions(): readonly CanvasViewerSurfaceDefinition[] {
  return CANVAS_IMAGE_VIEWER_MODES.map((mode) => VIEWER_SURFACE_REGISTRY[mode]);
}
