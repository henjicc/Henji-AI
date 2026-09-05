import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Maximize2 } from 'lucide-react';

import { UiButton, UiEmpty, UiError, UiLoading } from '@/components/ui';
import { ICON_NODE_ASSET_GROUP } from '@/core/theme/icons';
import { canvasEventBus } from '@/features/canvas/application/canvasServices';
import { migrateLegacyMultiLayerDocumentNode } from '@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter';
import { openMultiLayerDocumentNodeEditor } from '@/features/canvas/application/multiLayerDocumentNodeEditorApplicationService';
import { canRetryLayerStackResult, retryLayerStackResult } from '@/features/canvas/application/layerStackResultRecoveryService';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { LayerStackResultNodeData } from '@/features/canvas/domain/canvasNodes';
import { isEditableMultiLayerDocumentNode } from '@/features/canvas/domain/multiLayerDocumentNode';
import { LAYER_STACK_DOWNLOAD_FAILURE_MESSAGE } from '@/features/canvas/domain/generationFailure';
import { getMainPortConnectionFlags } from '@/features/canvas/domain/connectionIndex';
import { getSocketColor } from '@/features/canvas/domain/socketTypes';
import { validateLayerStackDocument, type LayerStackDocumentV1 } from '@/features/canvas/domain/layerStack';
import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import {
  NODE_IDLE_BORDER_CLASS,
  NODE_PORT_NODE_CLASS,
  NODE_PORT_VISIBLE_CLASS,
  NODE_SELECTED_BORDER_CLASS,
} from '@/features/canvas/ui/nodeControlStyles';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';

type LayerStackResultNodeProps = NodeProps & {
  id: string;
  data: LayerStackResultNodeData;
  selected?: boolean;
};

function readDocument(data: LayerStackResultNodeData): LayerStackDocumentV1 | null {
  try {
    return data.layerStackDocument ? validateLayerStackDocument(data.layerStackDocument) : null;
  } catch {
    return null;
  }
}

export const LayerStackResultNode = memo(({ id, data, selected, width, height }: LayerStackResultNodeProps) => {
  const setSelectedNode = useCanvasStore((state) => state.setSelectedNode);
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const projectId = useProjectStore((state) => state.currentProjectId);
  const historyPast = useCanvasStore((state) => state.history.past);
  const hasTargetConnections = useCanvasStore((state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainTarget ?? false);
  const hasSourceConnections = useCanvasStore((state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false);
  const document = useMemo(() => readDocument(data), [data]);
  const isEditableV3 = useMemo(() => isEditableMultiLayerDocumentNode(data), [data]);
  const composite = document?.resources.find((item) => item.resourceId === document.compositeResourceId);
  const thumbnail = document?.resources.find((item) => item.resourceId === document.thumbnailResourceId);
  const legacyPreview = thumbnail?.filePath ?? composite?.filePath ?? null;
  const preview = isEditableV3
    ? data.previewImageUrl ?? data.imageUrl ?? null
    : legacyPreview ?? data.previewImageUrl ?? data.imageUrl ?? null;
  const resolvedWidth = Math.max(240, typeof width === 'number' ? width : 300);
  const resolvedHeight = Math.max(180, typeof height === 'number' ? height : 220);
  const generationError = typeof data.generationError === 'string' ? data.generationError : null;
  const canRetrieveResult = Boolean(projectId) && Boolean(generationError)
    && canRetryLayerStackResult({ id, data }, { past: historyPast });
  const retryResult = (): void => {
    if (!projectId) return;
    try {
      retryLayerStackResult({ projectId, nodeId: id });
    } catch (error) {
      canvasEventBus.publish('canvas/toast', {
        message: error instanceof Error ? error.message : '获取结果失败，请重试',
        type: 'error',
      });
    }
  };

  const openEditor = async (): Promise<void> => {
    if (!projectId) return;
    try {
      if (!isEditableV3) {
        if (!document) return;
        await migrateLegacyMultiLayerDocumentNode({ projectId, nodeId: id, data });
      }
      await openMultiLayerDocumentNodeEditor({
        projectRef: { kind: 'canvas.project', id: projectId },
        nodeRef: { kind: 'canvas.node', id: `${projectId}:${id}` },
      });
    } catch (error) {
      canvasEventBus.publish('canvas/toast', {
        message: error instanceof Error ? error.message : '多图层图片编辑器打开失败，请重试',
        type: 'error',
      });
    }
  };

  return (
    <div
      data-layer-stack-node-id={id}
      data-layer-stack-status={isEditableV3 ? 'editable-v3' : document?.status ?? 'invalid'}
      className={`group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 ${selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS}`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
      onDoubleClick={(event) => { event.stopPropagation(); void openEditor(); }}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<ICON_NODE_ASSET_GROUP className="h-4 w-4" />}
        titleText={data.displayName ?? '多图层图片文档'}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />
      <div className="relative h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-bg-dark">
        {generationError ? (
          <UiError
            title="多图层图片未能加载"
            message={canRetrieveResult ? LAYER_STACK_DOWNLOAD_FAILURE_MESSAGE : '请检查网络或生成设置后重试。'}
            size="xs"
            className="nodrag h-full px-4"
            retryLabel="重新获取结果"
            onRetry={canRetrieveResult ? retryResult : undefined}
          />
        ) : data.isGenerating ? (
          <UiLoading message="正在准备多图层图片…" size="xs" className="h-full" />
        ) : preview ? (
          <img src={resolveImageDisplayUrl(preview)} alt="多图层图片预览" className="h-full w-full object-contain" />
        ) : (
          <UiEmpty title="多图层图片暂不可用" size="xs" className="h-full" />
        )}
        {document?.status === 'degraded' && !isEditableV3 && (
          <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-overlay px-2.5 py-1.5 text-2xs text-text-soft">
            <span>部分图层资源缺失</span>
          </div>
        )}
        {!generationError && !data.isGenerating && (isEditableV3 || document) && (
          <UiButton
            type="button"
            size="sm"
            variant="glass"
            className="nodrag absolute bottom-3 right-3 gap-1.5"
            onClick={(event) => { event.stopPropagation(); void openEditor(); }}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            编辑
          </UiButton>
        )}
      </div>
      <Handle type="target" id="target" position={Position.Left} className={`${NODE_PORT_NODE_CLASS} ${hasTargetConnections ? NODE_PORT_VISIBLE_CLASS : ''}`} style={{ background: getSocketColor('IMAGE'), left: 0, top: '50%', transform: 'translate(-50%, -50%)' }} />
      <Handle type="source" id="source" position={Position.Right} className={`${NODE_PORT_NODE_CLASS} ${hasSourceConnections ? NODE_PORT_VISIBLE_CLASS : ''}`} style={{ background: getSocketColor('IMAGE'), right: 0, top: '50%', transform: 'translate(50%, -50%)' }} />
      <NodeResizeHandle minWidth={240} minHeight={180} maxWidth={1200} maxHeight={1000} />
    </div>
  );
});

LayerStackResultNode.displayName = 'LayerStackResultNode';
