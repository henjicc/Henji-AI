import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Download, SlidersHorizontal } from 'lucide-react';

import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import type { StoryboardExportOptions, StoryboardFrameItem, StoryboardSplitNodeData } from '@/features/canvas/domain/canvasNodes';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { EXPORT_RESULT_DISPLAY_NAME, resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { prepareNodeImage, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { UiButton, UiChipButton } from '@/components/ui';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_CONTROL_PRIMARY_BUTTON_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { useCanvasStore } from '@/stores/canvasStore';
import { FrameCard } from '@/features/canvas/nodes/storyboardSplit/FrameCard';
import { StoryboardExportSettingsPanel } from '@/features/canvas/nodes/storyboardSplit/ExportSettingsPanel';
import { IncomingImagePicker } from '@/features/canvas/nodes/storyboardSplit/IncomingImagePicker';
import { exportStoryboardImages } from '@/features/canvas/nodes/storyboardSplit/exporting';
import { useStoryboardSort } from '@/features/canvas/nodes/storyboardSplit/useStoryboardSort';
import { buildFrameViewerImageList, buildIncomingImageItems, collectIncomingImageRefs } from '@/features/canvas/nodes/storyboardSplit/data';
import { type PanelAnchor, resolveExportOptions, resolvePanelAnchor, SplitResultIcon, STORYBOARD_GRID_GAP_PX, STORYBOARD_NODE_MIN_HEIGHT_PX, STORYBOARD_NODE_WIDTH_PX, STORYBOARD_SPLIT_HEADER_ADJUST, STORYBOARD_SPLIT_ICON_ADJUST, STORYBOARD_SPLIT_TITLE_ADJUST, toCssAspectRatio } from '@/features/canvas/nodes/storyboardSplit/shared';

type StoryboardNodeProps = NodeProps & {
  id: string;
  data: StoryboardSplitNodeData;
  selected?: boolean;
};

interface PickerState {
  frameId: string;
  x: number;
  y: number;
}

export const StoryboardNode = memo(({ id, data, selected, width, height }: StoryboardNodeProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerMenuRef = useRef<HTMLDivElement>(null);
  const exportSettingsTriggerRef = useRef<HTMLDivElement>(null);
  const exportSettingsPanelRef = useRef<HTMLDivElement>(null);

  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const nodes = useCanvasStore((state) => state.nodes);
  const edges = useCanvasStore((state) => state.edges);
  const reorderStoryboardFrame = useCanvasStore((state) => state.reorderStoryboardFrame);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const updateStoryboardFrame = useCanvasStore((state) => state.updateStoryboardFrame);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  const [pickerState, setPickerState] = useState<PickerState | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportPanelOpen, setIsExportPanelOpen] = useState(false);
  const [isExportPanelVisible, setIsExportPanelVisible] = useState(false);
  const [exportPanelAnchor, setExportPanelAnchor] = useState<PanelAnchor | null>(null);

  const {
    draggedFrameId,
    dropTargetFrameId,
    handleSortStart,
    handleSortHover,
  } = useStoryboardSort({
    nodeId: id,
    reorderStoryboardFrame,
    onSortStart: () => setPickerState(null),
  });

  const orderedFrames = useMemo(() => [...data.frames].sort((a, b) => a.order - b.order), [data.frames]);
  const frameAspectRatio = useMemo(
    () => data.frameAspectRatio ?? orderedFrames.find((frame) => typeof frame.aspectRatio === 'string')?.aspectRatio ?? '1:1',
    [data.frameAspectRatio, orderedFrames]
  );
  const frameAspectRatioCss = useMemo(() => toCssAspectRatio(frameAspectRatio), [frameAspectRatio]);

  const gridCols = Math.max(1, data.gridCols);
  const gridRows = Math.max(1, data.gridRows);
  const totalFrames = orderedFrames.length;
  const resolvedNodeWidth = Math.max(STORYBOARD_NODE_WIDTH_PX, Math.round(width ?? STORYBOARD_NODE_WIDTH_PX));
  const resolvedNodeHeight = Math.max(
    STORYBOARD_NODE_MIN_HEIGHT_PX,
    Math.round(height ?? STORYBOARD_NODE_MIN_HEIGHT_PX)
  );
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.storyboardSplit, data),
    [data]
  );
  const exportOptions = useMemo(() => resolveExportOptions(data.exportOptions), [data.exportOptions]);

  const incomingImageRefs = useMemo(() => collectIncomingImageRefs(id, nodes, edges), [edges, id, nodes]);
  const incomingImageItems = useMemo(() => buildIncomingImageItems(incomingImageRefs), [incomingImageRefs]);
  const incomingReferenceItems = useMemo(
    () =>
      incomingImageItems.map((item, index) => ({
        id: `incoming-image-ref-${index}`,
        label: item.label,
        thumbnailSrc: item.displayUrl,
      })),
    [incomingImageItems]
  );
  const frameViewerImageList = useMemo(() => buildFrameViewerImageList(orderedFrames), [orderedFrames]);
  const incomingImageViewerList = useMemo(() => incomingImageItems.map((item) => resolveImageDisplayUrl(item.imageUrl)), [incomingImageItems]);

  useEffect(() => {
    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!rootRef.current) {
        return;
      }

      const target = event.target as Node;
      const insideRoot = rootRef.current.contains(target);
      const insidePickerMenu = pickerMenuRef.current?.contains(target) ?? false;
      const insideExportPanel = exportSettingsPanelRef.current?.contains(target) ?? false;
      const insideExportTrigger = exportSettingsTriggerRef.current?.contains(target) ?? false;

      if (!insideRoot && !insidePickerMenu) {
        setPickerState(null);
      }

      if (!insideExportPanel && !insideExportTrigger) {
        setIsExportPanelOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleOutsidePointerDown, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true);
    };
  }, []);

  useEffect(() => {
    if (!isExportPanelOpen) {
      setIsExportPanelVisible(false);
      return;
    }

    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setIsExportPanelVisible(true);
      });
    });

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) {
        cancelAnimationFrame(raf2);
      }
    };
  }, [isExportPanelOpen]);

  const patchExportOptions = useCallback((patch: Partial<StoryboardExportOptions>) => {
    updateNodeData(id, {
      exportOptions: {
        ...exportOptions,
        ...patch,
      },
    });
  }, [exportOptions, id, updateNodeData]);

  const handleEditFrame = useCallback(async (frame: StoryboardFrameItem) => {
    try {
      const sourceImage = frame.imageUrl ?? frame.previewImageUrl;
      if (!sourceImage) {
        setExportError('该分镜没有可编辑图片');
        return;
      }

      const frameIndex = orderedFrames.findIndex((item) => item.id === frame.id);
      const frameTitle = frameIndex >= 0
        ? `分镜 ${frameIndex + 1}`
        : EXPORT_RESULT_DISPLAY_NAME.storyboardFrameEdit;

      const prepared = await prepareNodeImage(sourceImage);
      const createdNodeId = addDerivedExportNode(
        id,
        prepared.imageUrl,
        prepared.aspectRatio,
        prepared.previewImageUrl,
        {
          defaultTitle: frameTitle,
          resultKind: 'storyboardFrameEdit',
        }
      );

      if (createdNodeId) {
        addEdge(id, createdNodeId);
      }
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '创建编辑节点失败');
    }
  }, [addDerivedExportNode, addEdge, id, orderedFrames]);

  const createExportNode = useCallback((imageUrl: string, aspectRatio: string, previewImageUrl: string) => {
    return addDerivedExportNode(id, imageUrl, aspectRatio, previewImageUrl, {
      defaultTitle: EXPORT_RESULT_DISPLAY_NAME.storyboardSplitExport,
      resultKind: 'storyboardSplitExport',
    });
  }, [addDerivedExportNode, id]);

  const linkExportNode = useCallback((createdNodeId: string) => {
    addEdge(id, createdNodeId);
  }, [addEdge, id]);

  const handleExport = useCallback(async (): Promise<void> => {
    if (isExporting) {
      return;
    }

    setIsExporting(true);
    setExportError(null);
    try {
      await exportStoryboardImages({
        nodeId: id,
        gridRows,
        gridCols,
        orderedFrames,
        exportOptions,
        createExportNode,
        linkExportNode,
      });
    } catch (error) {
      setExportError(error instanceof Error ? error.message : '导出失败');
    } finally {
      setIsExporting(false);
    }
  }, [createExportNode, exportOptions, gridCols, gridRows, id, isExporting, linkExportNode, orderedFrames]);

  const handleTogglePicker = useCallback((frameId: string, x: number, y: number) => {
    setPickerState((previous) => {
      if (previous?.frameId === frameId) {
        return null;
      }
      return { frameId, x, y };
    });
  }, []);

  const handleReplaceFromInput = useCallback((frameId: string, imageUrl: string) => {
    setExportError(null);
    const matched = incomingImageItems.find((item) => item.imageUrl === imageUrl);
    updateStoryboardFrame(id, frameId, {
      imageUrl: matched?.imageUrl ?? imageUrl,
      previewImageUrl: matched?.previewImageUrl ?? matched?.imageUrl ?? imageUrl,
    });
    setPickerState(null);
  }, [id, incomingImageItems, updateStoryboardFrame]);

  return (
    <div
      ref={rootRef}
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 p-2 transition-colors duration-150
        ${selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.32)]'
          : 'border-[rgba(255,255,255,0.22)] hover:border-[rgba(255,255,255,0.34)]'}
      `}
      style={{ width: `${resolvedNodeWidth}px`, height: `${resolvedNodeHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<SplitResultIcon className="h-3.5 w-3.5" />}
        titleText={resolvedTitle}
        headerAdjust={STORYBOARD_SPLIT_HEADER_ADJUST}
        iconAdjust={STORYBOARD_SPLIT_ICON_ADJUST}
        titleAdjust={STORYBOARD_SPLIT_TITLE_ADJUST}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="ui-scrollbar nowheel min-h-0 flex-1 overflow-auto" onWheelCapture={(event) => event.stopPropagation()}>
        <div
          className="grid overflow-hidden rounded-lg border border-[rgba(255,255,255,0.16)] bg-[rgba(255,255,255,0.14)]"
          style={{ gap: `${STORYBOARD_GRID_GAP_PX}px`, gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        >
          {orderedFrames.map((frame, index) => (
            <FrameCard
              key={frame.id}
              nodeId={id}
              frame={frame}
              index={index}
              frameAspectRatioCss={frameAspectRatioCss}
              imageFit={exportOptions.imageFit}
              viewerImageList={frameViewerImageList}
              referenceItems={incomingReferenceItems}
              draggedFrameId={draggedFrameId}
              dropTargetFrameId={dropTargetFrameId}
              onSortStart={handleSortStart}
              onSortHover={handleSortHover}
              onTogglePicker={handleTogglePicker}
              onEditFrame={(targetFrame) => {
                void handleEditFrame(targetFrame);
              }}
            />
          ))}
        </div>
      </div>

      <IncomingImagePicker
        pickerState={pickerState}
        pickerMenuRef={pickerMenuRef}
        incomingImageItems={incomingImageItems}
        incomingImageViewerList={incomingImageViewerList}
        onReplaceFromInput={handleReplaceFromInput}
      />

      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div ref={exportSettingsTriggerRef} className="nodrag relative flex">
            <UiChipButton
              active={isExportPanelOpen}
              className={NODE_CONTROL_CHIP_CLASS}
              onClick={(event) => {
                event.stopPropagation();
                if (isExportPanelOpen) {
                  setIsExportPanelOpen(false);
                  return;
                }
                setExportPanelAnchor(resolvePanelAnchor(exportSettingsTriggerRef.current));
                setIsExportPanelOpen(true);
              }}
            >
              <SlidersHorizontal className={`${NODE_CONTROL_ICON_CLASS} shrink-0`} />
              <span>导出设置</span>
            </UiChipButton>
          </div>

          <div className="truncate text-[11px] text-text-muted/80">
            {gridRows} x {gridCols} | {totalFrames} 格
          </div>
        </div>

        <UiButton
          size="sm"
          variant="primary"
          className={`nodrag ${NODE_CONTROL_PRIMARY_BUTTON_CLASS}`}
          onClick={(event) => {
            event.stopPropagation();
            void handleExport();
          }}
          disabled={isExporting}
        >
          <Download className={NODE_CONTROL_ICON_CLASS} />
          {isExporting ? '导出中...' : '合并导出'}
        </UiButton>
      </div>

      <StoryboardExportSettingsPanel
        isOpen={isExportPanelOpen}
        isVisible={isExportPanelVisible}
        anchor={exportPanelAnchor}
        panelRef={exportSettingsPanelRef}
        exportOptions={exportOptions}
        onPatch={patchExportOptions}
      />

      {exportError && <div className="mt-2 shrink-0 text-xs text-red-400">{exportError}</div>}

      <Handle
        type="target"
        id="target"
        position={Position.Left}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-surface-dark !bg-accent"
      />
      <NodeResizeHandle
        minWidth={STORYBOARD_NODE_WIDTH_PX}
        minHeight={STORYBOARD_NODE_MIN_HEIGHT_PX}
        maxWidth={1800}
        maxHeight={1600}
      />
    </div>
  );
});

StoryboardNode.displayName = 'StoryboardNode';
