// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCompatibleTargetHandleForSource } from '@/features/canvas/application/graphValueResolver';
import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasConnectionActions } from './useCanvasConnectionActions';

function uploadNode(id: string): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 0, y: 0 },
    data: {
      ...canvasNodeDefinitions[CANVAS_NODE_TYPES.upload].createDefaultData(),
      imageUrl: 'file://fixture.png',
    },
  } as CanvasNode;
}

function renderActions() {
  return renderHook(() => useCanvasConnectionActions({
    connectNodes: useCanvasStore.getState().onConnect,
    connectMany: useCanvasStore.getState().connectMany,
    schedulePersist: () => undefined,
    showToast: () => undefined,
    t: ((key: string) => key) as unknown as TFunction,
  }));
}

describe('useCanvasConnectionActions.handleConnect', () => {
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData([uploadNode('upload-1')], [], { past: [], future: [] });
  });

  it('连接同一次事件里刚创建的节点（快捷连接不能读渲染期快照）', () => {
    const { result } = renderActions();
    // 渲染之后再建节点：React 尚未重渲染，只有 store 里有这个节点
    const targetId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.videoGen, { x: 400, y: 0 });
    const source = useCanvasStore.getState().nodes.find((node) => node.id === 'upload-1');
    const targetHandle = resolveCompatibleTargetHandleForSource(
      source as CanvasNode,
      CANVAS_NODE_TYPES.videoGen,
      'source',
    );
    expect(targetHandle).toBeTruthy();

    result.current.handleConnect({
      source: 'upload-1',
      target: targetId,
      sourceHandle: 'source',
      targetHandle,
    });

    const edges = useCanvasStore.getState().edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: 'upload-1', target: targetId });
  });

  it('类型不匹配时不连线并提示', () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useCanvasConnectionActions({
      connectNodes: useCanvasStore.getState().onConnect,
      connectMany: useCanvasStore.getState().connectMany,
      schedulePersist: () => undefined,
      showToast,
      t: ((key: string) => key) as unknown as TFunction,
    }));
    const targetId = useCanvasStore.getState().addNode(CANVAS_NODE_TYPES.intSource, { x: 400, y: 0 });

    result.current.handleConnect({
      source: 'upload-1',
      target: targetId,
      sourceHandle: 'source',
      targetHandle: 'target',
    });

    expect(useCanvasStore.getState().edges).toHaveLength(0);
    expect(showToast).toHaveBeenCalled();
  });
});
