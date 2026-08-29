import { memo, useMemo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Maximize2 } from 'lucide-react';

import { UiButton } from '@/components/ui';
import { ICON_NODE_ASSET_GROUP } from '@/core/theme/icons';
import { openCanvasSpecialEditor } from '@/features/canvas/application/specialEditorApplicationService';
import { resolveImageDisplayUrl } from '@/features/canvas/application/imageData';
import type { LayerStackResultNodeData } from '@/features/canvas/domain/canvasNodes';
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
  const hasTargetConnections = useCanvasStore((state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainTarget ?? false);
  const hasSourceConnections = useCanvasStore((state) => getMainPortConnectionFlags(state.edges).get(id)?.hasMainSource ?? false);
  const document = useMemo(() => readDocument(data), [data]);
  const composite = document?.resources.find((item) => item.resourceId === document.compositeResourceId);
  const thumbnail = document?.resources.find((item) => item.resourceId === document.thumbnailResourceId);
  const preview = thumbnail?.filePath ?? composite?.filePath ?? data.previewImageUrl ?? data.imageUrl ?? null;
  const resolvedWidth = Math.max(240, typeof width === 'number' ? width : 300);
  const resolvedHeight = Math.max(180, typeof height === 'number' ? height : 220);

  const openEditor = (): void => {
    if (!projectId || !document) return;
    openCanvasSpecialEditor({
      projectId,
      nodeId: id,
      editorKey: 'layers',
      initialState: { ...data, layerStackDocument: document },
    });
  };

  return (
    <div
      data-layer-stack-node-id={id}
      data-layer-stack-status={document?.status ?? 'invalid'}
      className={`group relative overflow-visible rounded-[var(--node-radius)] border bg-surface-dark/90 ${selected ? NODE_SELECTED_BORDER_CLASS : NODE_IDLE_BORDER_CLASS}`}
      style={{ width: resolvedWidth, height: resolvedHeight }}
      onClick={() => setSelectedNode(id)}
      onDoubleClick={(event) => { event.stopPropagation(); openEditor(); }}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<ICON_NODE_ASSET_GROUP className="h-4 w-4" />}
        titleText={data.displayName ?? '图层结果'}
        editable
        onTitleChange={(displayName) => updateNodeData(id, { displayName })}
      />
      <div className="relative h-full w-full overflow-hidden rounded-[var(--node-radius)] bg-bg-dark">
        {preview ? (
          <img src={resolveImageDisplayUrl(preview)} alt="图层合成预览" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-text-muted">
            <ICON_NODE_ASSET_GROUP className="h-8 w-8" />
            <span className="text-xs">图层资源不可用</span>
          </div>
        )}
        <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg bg-overlay px-2.5 py-1.5 text-2xs text-text-soft">
          <span>{document?.layers.length ?? 0} 层</span>
          <span>{document?.status === 'degraded' ? '资源缺失' : '由底到顶'}</span>
        </div>
        {document && (
          <UiButton
            type="button"
            size="sm"
            variant="glass"
            className="nodrag absolute bottom-3 right-3 gap-1.5"
            onClick={(event) => { event.stopPropagation(); openEditor(); }}
          >
            <Maximize2 className="h-3.5 w-3.5" />
            图层
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
