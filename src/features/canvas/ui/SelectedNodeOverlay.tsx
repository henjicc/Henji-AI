import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useCanvasStore } from '@/stores/canvasStore';
import { NodeActionToolbar } from './NodeActionToolbar';
import { MultiNodeActionToolbar } from './MultiNodeActionToolbar';

export const SelectedNodeOverlay = memo(() => {
  // 直接在 selector 里按 id 查找：未选中节点变化时 zustand 默认按引用比较即可短路，
  // 不会因为画布上任意其他节点的编辑（整份 nodes 数组换引用）而跟着重渲染。
  const selectedNode = useCanvasStore((state) =>
    state.selectedNodeId ? state.nodes.find((node) => node.id === state.selectedNodeId) ?? null : null
  );
  const selectedNodes = useCanvasStore(useShallow((state) =>
    state.nodes.filter((node) => Boolean(node.selected))
  ));

  if (selectedNodes.length > 1) {
    return <MultiNodeActionToolbar nodes={selectedNodes} />;
  }

  if (!selectedNode) {
    return null;
  }

  return (
    <>
      <NodeActionToolbar node={selectedNode} />
    </>
  );
});

SelectedNodeOverlay.displayName = 'SelectedNodeOverlay';
