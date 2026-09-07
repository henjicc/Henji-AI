import { ImageViewerModal } from '@/components/mediaViewer/ImageViewerModal';
import { useCanvasStore } from '@/stores/canvasStore';
import { resolveImageDisplayUrl } from '@/services/imageSource';
import { resolveUpscaleComparisonSource } from '../../domain/upscaleComparison';

import type { CanvasImageViewerSurfaceProps } from './viewerSurfaceRegistry';

/** 对比原图取生成时保存的输入，不追踪可被用户换图的上游连线。 */
export function FlatCanvasImageViewerSurface({
  sourceNodeId,
  ...viewerProps
}: CanvasImageViewerSurfaceProps): JSX.Element | null {
  const original = useCanvasStore((state) => resolveUpscaleComparisonSource(
    sourceNodeId ? state.nodes.find((node) => node.id === sourceNodeId)?.data : undefined,
    viewerProps.imageUrl,
    resolveImageDisplayUrl,
  ));
  return <ImageViewerModal {...viewerProps} comparisonImageUrl={original ?? undefined} />;
}
