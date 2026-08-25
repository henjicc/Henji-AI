// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveCompatibleTargetHandleForSource } from '@/features/canvas/application/graphValueResolver';
import * as assetGroupApplicationService from '@/features/canvas/application/assetGroupApplicationService';
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

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('从素材组端口拖出时转为整组绑定', () => {
    const bindAssetGroup = vi.spyOn(assetGroupApplicationService, 'bindAssetGroup')
      .mockReturnValue({ connected: 2, pending: 1, unsupported: 0, excluded: 0 });
    const group: CanvasNode = {
      id: 'group-1',
      type: CANVAS_NODE_TYPES.assetGroup,
      position: { x: 0, y: 0 },
      data: {
        ...canvasNodeDefinitions[CANVAS_NODE_TYPES.assetGroup].createDefaultData(),
        memberOrder: ['upload-1'],
      },
    } as CanvasNode;
    const target: CanvasNode = {
      id: 'target-1',
      type: CANVAS_NODE_TYPES.videoGen,
      position: { x: 400, y: 0 },
      data: canvasNodeDefinitions[CANVAS_NODE_TYPES.videoGen].createDefaultData(),
    } as CanvasNode;
    useCanvasStore.getState().setCanvasData(
      [uploadNode('upload-1'), group, target],
      [],
      { past: [], future: [] },
    );
    const { result } = renderActions();

    result.current.handleConnect({
      source: group.id,
      target: target.id,
      sourceHandle: 'source',
      targetHandle: 'param:__image',
    });

    expect(bindAssetGroup).toHaveBeenCalledWith({ groupId: group.id, targetNodeId: target.id });
    expect(useCanvasStore.getState().edges).toHaveLength(0);
  });

  it('创建素材组后明确提示连线被保留或被解开', () => {
    const showToast = vi.fn();
    const createAssetGroup = vi.spyOn(assetGroupApplicationService, 'createAssetGroup')
      .mockReturnValueOnce({
        projectId: 'project-1',
        groupId: 'group-1',
        accepted: 2,
        preservedConnectionCount: 2,
        disconnectedConnectionCount: 0,
      })
      .mockReturnValueOnce({
        projectId: 'project-1',
        groupId: 'group-2',
        accepted: 2,
        preservedConnectionCount: 0,
        disconnectedConnectionCount: 2,
      });
    const { result } = renderHook(() => useCanvasConnectionActions({
      connectNodes: useCanvasStore.getState().onConnect,
      connectMany: useCanvasStore.getState().connectMany,
      schedulePersist: () => undefined,
      showToast,
      t: ((key: string) => key) as unknown as TFunction,
    }));

    result.current.createAssetGroup(['upload-1', 'upload-2']);
    result.current.createAssetGroup(['upload-1', 'upload-2']);

    expect(createAssetGroup).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenNthCalledWith(1, 'canvas.assetGroup.createdPreserved', 'success');
    expect(showToast).toHaveBeenNthCalledWith(2, 'canvas.assetGroup.createdDisconnected', 'success');
  });
});
