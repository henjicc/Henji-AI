import { memo, useEffect, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import { Image as ImageIcon, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import {
  CANVAS_NODE_TYPES,
  DEFAULT_ASPECT_RATIO,
  EXPORT_RESULT_NODE_MIN_WIDTH,
  EXPORT_RESULT_NODE_MIN_HEIGHT,
  type CanvasNodeType,
  type ExportImageNodeData,
  type ImageEditNodeData,
} from '@/features/canvas/domain/canvasNodes';
import {
  resolveMinEdgeFittedSize,
  resolveResizeMinConstraintsByAspect,
} from '@/features/canvas/application/imageNodeSizing';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_GENERATION_ERROR_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { CanvasNodeImage } from '@/features/canvas/ui/CanvasNodeImage';
import { useGenerationProgressDisplay } from '@/features/canvas/nodes/shared/useGenerationProgressDisplay';
import { NodeGenerationError } from '@/features/canvas/nodes/shared/NodeGenerationError';
import { useOriginalImageLod } from '@/features/canvas/nodes/shared/useOriginalImageLod';
import { useMediaMicroLod } from '@/features/canvas/nodes/shared/useCanvasContentLod';
import { useMicroThumbnail } from '@/features/canvas/nodes/shared/useMicroThumbnail';
import { useDecodedImageSource } from '@/features/canvas/nodes/shared/useDecodedImageSource';
import { useCanvasStore } from '@/stores/canvasStore';

type ImageNodeProps = NodeProps & {
  id: string;
  data: ImageEditNodeData | ExportImageNodeData;
  selected?: boolean;
};

function resolveNodeDimension(value: number | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 1) {
    return Math.round(value);
  }
  return fallback;
}

export const ImageNode = memo(({ id, data, selected, type, width, height }: ImageNodeProps) => {
  const { t } = useTranslation();
  const updateNodeInternals = useUpdateNodeInternals();
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const hasTargetConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainTarget ?? false
  );
  const hasSourceConnections = useCanvasStore(
    (state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false
  );
  const preferOriginalImage = useOriginalImageLod();
  const isExportResultNode = type === CANVAS_NODE_TYPES.exportImage;
  const { isGenerating, progress: displayProgress, transitionDurationMs } = useGenerationProgressDisplay(id, data);
  const generationError = typeof data.generationError === 'string' ? data.generationError : null;
  const resolvedAspectRatio = data.aspectRatio || DEFAULT_ASPECT_RATIO;
  const compactSize = resolveMinEdgeFittedSize(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeConstraints = resolveResizeMinConstraintsByAspect(resolvedAspectRatio, {
    minWidth: EXPORT_RESULT_NODE_MIN_WIDTH,
    minHeight: EXPORT_RESULT_NODE_MIN_HEIGHT,
  });
  const resizeMinWidth = resizeConstraints.minWidth;
  const resizeMinHeight = resizeConstraints.minHeight;
  const resolvedWidth = resolveNodeDimension(width, compactSize.width);
  const resolvedHeight = resolveNodeDimension(height, compactSize.height);

  useEffect(() => {
    updateNodeInternals(id);
  }, [id, resolvedWidth, resolvedHeight, updateNodeInternals]);

  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(type as CanvasNodeType, data),
    [data, type]
  );

  const baseImageSource = useMemo(() => {
    const picked = preferOriginalImage
      ? data.imageUrl || data.previewImageUrl
      : data.previewImageUrl || data.imageUrl;
    return picked ? resolveImageDisplayUrl(picked) : null;
  }, [data.imageUrl, data.previewImageUrl, preferOriginalImage]);
  // 低倍率降为微缩略图：生成完成前继续显示原缩略图，不闪空白
  const preferMicroImage = useMediaMicroLod();
  const microImageSource = useMicroThumbnail(baseImageSource, preferMicroImage);
  const imageSource = useDecodedImageSource(microImageSource ?? baseImageSource);

  // 获取原图 URL 用于查看器
  const originalImageUrl = useMemo(() => {
    if (!data.imageUrl) return null;
    return resolveImageDisplayUrl(data.imageUrl);
  }, [data.imageUrl]);

  return (
    <div
      className={`
        group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/85 p-0 transition-colors duration-150
        ${generationError
          ? NODE_GENERATION_ERROR_BORDER_CLASS
          : selected
            ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
            : 'border-[rgba(255,255,255,0.22)] hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={isExportResultNode
          ? <ImageIcon className="h-4 w-4" />
          : <Sparkles className="h-4 w-4" />}
        titleText={resolvedTitle}
        titleClassName="inline-block max-w-[220px] truncate whitespace-nowrap align-bottom"
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div
        className="relative h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-bg-dark"
      >
        {generationError ? null : data.imageUrl ? (
          <CanvasNodeImage
            src={imageSource ?? ''}
            alt={isExportResultNode ? t('node.imageNode.resultAlt') : t('node.imageNode.generatedAlt')}
            viewerSourceUrl={originalImageUrl}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-text-muted/85">
            {isExportResultNode ? (
              <ImageIcon className="h-7 w-7 opacity-60" />
            ) : (
              <Sparkles className="h-7 w-7 opacity-60" />
            )}
            <span className="px-4 text-center text-[12px] leading-6">
              {isExportResultNode ? t('node.imageNode.waitingResult') : t('node.imageNode.selectToEdit')}
            </span>
          </div>
        )}

        {isGenerating && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-bg-dark/55" />
            <div
              className="absolute left-0 top-0 h-full w-full origin-left bg-gradient-to-r from-[rgba(255,255,255,0.4)] to-[rgba(255,255,255,0.06)] ease-out"
              style={{ transform: `scaleX(${displayProgress})`, transition: `transform ${transitionDurationMs}ms ease-out` }}
            />
          </div>
        )}

        {generationError && <NodeGenerationError message={generationError} />}
      </div>

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className={`${NODE_PORT_NODE_CLASS} ${hasTargetConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ left: 0, top: '50%', transform: 'translate(-50%, -50%)' }}
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
        style={{ right: 0, top: '50%', transform: 'translate(50%, -50%)' }}
      />
      <NodeResizeHandle
        minWidth={resizeMinWidth}
        minHeight={resizeMinHeight}
        maxWidth={1600}
        maxHeight={1600}
      />
    </div>
  );
});

ImageNode.displayName = 'ImageNode';
