import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Download, SlidersHorizontal } from 'lucide-react';
import { useStoreWithEqualityFn } from 'zustand/traditional';
import { useTranslation } from 'react-i18next';

import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import type { StoryboardExportOptions, StoryboardFrameItem, StoryboardSplitNodeData } from '@/features/canvas/domain/canvasNodes';
import { CANVAS_NODE_TYPES } from '@/features/canvas/domain/canvasNodes';
import { EXPORT_RESULT_DISPLAY_NAME, resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { prepareNodeImage, resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import { PanelTrigger, type PromptReferenceItem, UiButton, UiChipButton } from '@/components/ui';
import ContextMenu from '@/components/ContextMenu';
import { useContextMenu } from '@/hooks/useContextMenu';
import { createLegacyPromptMediaLabels, createPromptMediaLabel } from '@/core/inputs/promptDocument';
import { createCanvasOutputPromptResourceId } from '@/features/canvas/application/generationPromptDocument';
import { areMediaOutputListsEqual, collectInputMediaByKind } from '@/features/canvas/application/graphMediaResolver';
import {
  NODE_CONTROL_CHIP_CLASS,
  NODE_CONTROL_ICON_CLASS,
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
  NODE_SURFACE_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { getSocketColor, mediaPortId } from '@/features/canvas/domain/socketTypes';
import { canvasViewStore, useCanvasStore } from '@/stores/canvasStore';
import { FrameCard } from '@/features/canvas/nodes/storyboardSplit/FrameCard';
import { StoryboardExportSettingsPanel } from '@/features/canvas/nodes/storyboardSplit/ExportSettingsPanel';
import { buildIncomingImagePickerItems } from '@/features/canvas/nodes/storyboardSplit/IncomingImagePicker';
import { exportStoryboardImages } from '@/features/canvas/nodes/storyboardSplit/exporting';
import { useStoryboardSort } from '@/features/canvas/nodes/storyboardSplit/useStoryboardSort';
import { buildFrameViewerImageList, buildIncomingImageItems } from '@/features/canvas/nodes/storyboardSplit/data';
import { resolveExportOptions, STORYBOARD_GRID_GAP_PX } from '@/features/canvas/nodes/storyboardSplit/shared';
import { ICON_STORYBOARD } from '@/core/theme/icons';
import { computeStoryboardSplitBaseLayout, computeStoryboardSplitFrameLayout } from '@/features/canvas/nodes/storyboardSplit/layout';

type StoryboardNodeProps = NodeProps & {
  id: string;
  data: StoryboardSplitNodeData;
  selected?: boolean;
};

export const StoryboardNode = memo(({ id, data, selected, width, height }: StoryboardNodeProps) => {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  // “从输入图片替换”菜单：共享 ContextMenu，贴着格子上的按钮弹出（任务 5.9）
  const picker = useContextMenu();
  const { showMenuAt: showPickerAt, hideMenu: hidePicker } = picker;
  const pickerFrameIdRef = useRef<string | null>(null);

  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  // 本节点只需要"上游连了哪些图片"这一派生结果，不需要整个 nodes/edges 数组；
  // 用内容相等比较订阅，避免画布上任意其他节点的无关编辑都触发本节点重渲染。
  const incomingImageOutputs = useStoreWithEqualityFn(
    canvasViewStore,
    (state) => collectInputMediaByKind(id, state.nodes, state.edges, 'image'),
    areMediaOutputListsEqual
  );
  const reorderStoryboardFrame = useCanvasStore((state) => state.reorderStoryboardFrame);
  const addDerivedExportNode = useCanvasStore((state) => state.addDerivedExportNode);
  const addEdge = useCanvasStore((state) => state.addEdge);
  const hasTargetConnections = useCanvasStore((state) =>
    state.edges.some((edge) => edge.target === id)
  );
  const hasSourceConnections = useCanvasStore((state) =>
    state.edges.some((edge) => edge.source === id)
  );
  const updateStoryboardFrame = useCanvasStore((state) => state.updateStoryboardFrame);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);

  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const {
    draggedFrameId,
    dropTargetFrameId,
    handleSortStart,
    handleSortHover,
  } = useStoryboardSort({
    nodeId: id,
    reorderStoryboardFrame,
    onSortStart: hidePicker,
  });

  const orderedFrames = useMemo(() => [...data.frames].sort((a, b) => a.order - b.order), [data.frames]);
  const frameAspectRatio = useMemo(
    () => data.frameAspectRatio ?? orderedFrames.find((frame) => typeof frame.aspectRatio === 'string')?.aspectRatio ?? '1:1',
    [data.frameAspectRatio, orderedFrames]
  );

  const gridCols = Math.max(1, data.gridCols);
  const gridRows = Math.max(1, data.gridRows);
  const totalFrames = orderedFrames.length;
  const baseLayout = useMemo(
    () => computeStoryboardSplitBaseLayout(frameAspectRatio, gridCols, gridRows),
    [frameAspectRatio, gridCols, gridRows]
  );
  const resolvedNodeWidth = Math.max(baseLayout.nodeWidth, Math.round(width ?? baseLayout.nodeWidth));
  const resolvedNodeHeight = Math.max(baseLayout.nodeHeight, Math.round(height ?? baseLayout.nodeHeight));
  const frameLayout = useMemo(
    () => computeStoryboardSplitFrameLayout(frameAspectRatio, gridCols, gridRows, resolvedNodeWidth, resolvedNodeHeight),
    [frameAspectRatio, gridCols, gridRows, resolvedNodeWidth, resolvedNodeHeight]
  );
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.storyboardSplit, data),
    [data]
  );
  const exportOptions = useMemo(() => resolveExportOptions(data.exportOptions), [data.exportOptions]);

  const incomingImageItems = useMemo(() => buildIncomingImageItems(incomingImageOutputs), [incomingImageOutputs]);
  const incomingReferenceItems = useMemo<PromptReferenceItem[]>(
    () =>
      incomingImageOutputs.map((output, index) => ({
        resourceId: createCanvasOutputPromptResourceId(output, index),
        mediaType: 'image',
        label: createPromptMediaLabel('image', index + 1),
        legacyLabels: createLegacyPromptMediaLabels('image', index + 1),
        thumbnailSrc: resolveImageDisplayUrl(output.previewUrl ?? output.url),
        ...(output.sourceNodeId ? { sourceNodeId: output.sourceNodeId } : {}),
      })),
    [incomingImageOutputs]
  );
  const frameViewerImageList = useMemo(() => buildFrameViewerImageList(orderedFrames), [orderedFrames]);
  const incomingImageViewerList = useMemo(() => incomingImageItems.map((item) => resolveImageDisplayUrl(item.imageUrl)), [incomingImageItems]);

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

  const handleReplaceFromInput = useCallback((frameId: string, imageUrl: string) => {
    setExportError(null);
    const matched = incomingImageItems.find((item) => item.imageUrl === imageUrl);
    updateStoryboardFrame(id, frameId, {
      imageUrl: matched?.imageUrl ?? imageUrl,
      previewImageUrl: matched?.previewImageUrl ?? matched?.imageUrl ?? imageUrl,
    });
  }, [id, incomingImageItems, updateStoryboardFrame]);

  const pickerVisible = picker.menuVisible;
  const handleTogglePicker = useCallback((frameId: string, anchor: Element) => {
    if (pickerVisible && pickerFrameIdRef.current === frameId) {
      hidePicker();
      return;
    }
    pickerFrameIdRef.current = frameId;
    showPickerAt(anchor, buildIncomingImagePickerItems({
      frameId,
      incomingImageItems,
      incomingImageViewerList,
      onReplaceFromInput: handleReplaceFromInput,
    }));
  }, [handleReplaceFromInput, hidePicker, incomingImageItems, incomingImageViewerList, pickerVisible, showPickerAt]);

  return (
    <div
      ref={rootRef}
      className={`
        group relative flex h-full flex-col overflow-visible rounded-[var(--node-radius)] border ${NODE_SURFACE_CLASS} p-2 transition-colors duration-120
        ${selected
          ? NODE_SELECTED_BORDER_CLASS
          : NODE_IDLE_BORDER_CLASS}
      `}
      style={{ width: `${resolvedNodeWidth}px`, height: `${resolvedNodeHeight}px` }}
      onClick={() => setSelectedNode(id)}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<ICON_STORYBOARD className="h-3.5 w-3.5" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, { displayName: nextTitle })}
      />

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          className="grid overflow-hidden rounded-lg border border-line bg-line"
          style={{
            gap: `${STORYBOARD_GRID_GAP_PX}px`,
            width: `${frameLayout.gridWidth}px`,
            height: `${frameLayout.gridHeight}px`,
            gridTemplateColumns: `repeat(${gridCols}, ${frameLayout.cellWidth}px)`,
            gridTemplateRows: `repeat(${gridRows}, ${frameLayout.cellHeight}px)`,
          }}
        >
          {orderedFrames.map((frame, index) => (
            <FrameCard
              key={frame.id}
              nodeId={id}
              selected={Boolean(selected)}
              frame={frame}
              index={index}
              noteFontSizePx={frameLayout.noteFontSizePx}
              noteLineHeightPx={frameLayout.noteLineHeightPx}
              noteHeightPx={frameLayout.noteHeightPx}
              imageFit={exportOptions.imageFit}
              viewerImageList={frameViewerImageList}
              referenceItems={incomingReferenceItems}
              onSelectNode={() => setSelectedNode(id)}
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

      <ContextMenu
        visible={picker.menuVisible}
        position={picker.menuPosition}
        items={picker.menuItems}
        onClose={hidePicker}
        surface="glass"
      />

      <div className="mt-2 flex shrink-0 items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {/* 导出设置：共享浮层（压在画布上用玻璃），点外、Escape 与嵌套归属由 PanelTrigger 处理（任务 5.9） */}
          <PanelTrigger
            className="nodrag"
            surface="glass"
            panelPadding="content"
            panelWidth={340}
            alignment="aboveCenter"
            gap={8}
            renderPanel={() => (
              <StoryboardExportSettingsPanel
                exportOptions={exportOptions}
                onPatch={patchExportOptions}
              />
            )}
          >
            {({ open, togglePanel }) => (
              <UiChipButton
                active={open}
                size="sm"
                aria-expanded={open}
                data-panel-trigger-button
                className={NODE_CONTROL_CHIP_CLASS}
                onClick={(event) => {
                  event.stopPropagation();
                  togglePanel();
                }}
              >
                <SlidersHorizontal className={`${NODE_CONTROL_ICON_CLASS} shrink-0`} />
                <span>{t('canvas.storyboardExport.open')}</span>
              </UiChipButton>
            )}
          </PanelTrigger>

          <div className="truncate text-2xs text-text2">
            {t('canvas.storyboardGrid.summary', { rows: gridRows, cols: gridCols, count: totalFrames })}
          </div>
        </div>

        <UiButton
          variant="secondary"
          size="sm"
          className="nodrag"
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

      {exportError && <div className="mt-2 shrink-0 text-xs text-danger-text">{exportError}</div>}

      <Handle
        type="target"
        id={mediaPortId('image')}
        position={Position.Left}
        style={{ background: getSocketColor('IMAGE') }}
        className={`${NODE_PORT_NODE_CLASS} ${hasTargetConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
      />
      <Handle
        type="source"
        id="source"
        position={Position.Right}
        style={{ background: getSocketColor('IMAGE') }}
        className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`}
      />
      <NodeResizeHandle
        minWidth={baseLayout.nodeWidth}
        minHeight={baseLayout.nodeHeight}
        maxWidth={1800}
        maxHeight={1600}
      />
    </div>
  );
});

StoryboardNode.displayName = 'StoryboardNode';
