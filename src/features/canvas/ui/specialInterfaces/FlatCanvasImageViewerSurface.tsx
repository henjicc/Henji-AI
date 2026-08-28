import { ImageViewerModal } from '@/components/mediaViewer/ImageViewerModal';

import type { CanvasImageViewerSurfaceProps } from './viewerSurfaceRegistry';

/** 平面查看器适配层：专用路由的来源节点字段不泄漏到通用媒体查看器。 */
export function FlatCanvasImageViewerSurface({
  sourceNodeId: _sourceNodeId,
  ...viewerProps
}: CanvasImageViewerSurfaceProps): JSX.Element | null {
  return <ImageViewerModal {...viewerProps} />;
}
