import { memo, useMemo } from 'react';
import { LayoutGrid } from 'lucide-react';

import { NodeHeader, NODE_HEADER_FLOATING_POSITION_CLASS } from '@/features/canvas/ui/NodeHeader';
import { NodeResizeHandle } from '@/features/canvas/ui/NodeResizeHandle';
import { CANVAS_NODE_TYPES, type GroupNodeData } from '@/features/canvas/domain/canvasNodes';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';
import { useCanvasStore } from '@/stores/canvasStore';

type GroupNodeProps = {
  id: string;
  data: GroupNodeData;
  selected?: boolean;
};

export const GroupNode = memo(({ id, data, selected }: GroupNodeProps) => {
  const updateNodeData = useCanvasStore((state) => state.updateNodeData);
  const resolvedTitle = useMemo(
    () => resolveNodeDisplayName(CANVAS_NODE_TYPES.group, data),
    [data]
  );

  return (
    <div
      className={`group relative h-full w-full overflow-visible rounded-[18px] border bg-[rgba(255,255,255,0.03)] backdrop-blur-[1px] ${
        selected
          ? 'border-accent shadow-[0_0_0_1px_rgba(59,130,246,0.35)]'
          : 'border-[rgba(255,255,255,0.26)]'
      }`}
    >
      <NodeHeader
        className={NODE_HEADER_FLOATING_POSITION_CLASS}
        icon={<LayoutGrid className="h-4 w-4" />}
        titleText={resolvedTitle}
        editable
        onTitleChange={(nextTitle) => updateNodeData(id, {
          displayName: nextTitle,
          label: nextTitle,
        })}
      />
      <NodeResizeHandle minWidth={220} minHeight={140} maxWidth={2200} maxHeight={1600} />
    </div>
  );
});

GroupNode.displayName = 'GroupNode';
