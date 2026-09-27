// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry';
import { promptPortId } from '@/features/canvas/domain/socketTypes';
import { canvasStoreAttachment, useCanvasStore } from './canvasStore';
import { useSettingsStore } from './settingsStore';

const originalFindNodePosition = useCanvasStore.getState().findNodePosition;

function node(id: string): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 0, y: 0 },
    data: canvasNodeDefinitions[CANVAS_NODE_TYPES.upload].createDefaultData(),
  } as CanvasNode;
}

describe('canvasStore.connectMany', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useCanvasStore.setState({ findNodePosition: originalFindNodePosition });
  });
  beforeEach(() => {
    useCanvasStore.getState().setCanvasData(
      [node('source-1'), node('source-2'), node('target')],
      [],
      { past: [], future: [] },
    );
  });

  it('整批连接只产生一次历史记录并可一次撤销', () => {
    const created = useCanvasStore.getState().connectMany([
      { source: 'source-1', target: 'target', sourceHandle: 'source', targetHandle: 'target' },
      { source: 'source-2', target: 'target', sourceHandle: 'source', targetHandle: 'target' },
    ]);

    expect(created).toHaveLength(2);
    expect(useCanvasStore.getState().edges).toHaveLength(2);
    expect(useCanvasStore.getState().history.past).toHaveLength(1);
    expect(useCanvasStore.getState().undo()).toBe(true);
    expect(useCanvasStore.getState().edges).toEqual([]);
  });

  it('只合并界面通知时，单条连接的历史、领域订阅和逐步撤销保持原样', () => {
    const locate = vi.spyOn(useCanvasStore.getState(), 'findNodePosition');
    const updates = vi.fn();
    const stop = useCanvasStore.subscribe(updates);
    canvasStoreAttachment.batchViewUpdates(() => {
      useCanvasStore.getState().onConnect({ source: 'source-1', target: 'target', sourceHandle: 'source', targetHandle: 'target' });
      useCanvasStore.getState().onConnect({ source: 'source-2', target: 'target', sourceHandle: 'source', targetHandle: 'target' });
    });
    expect(updates).toHaveBeenCalledTimes(2);
    stop();
    expect(locate).not.toHaveBeenCalled();
    expect(useCanvasStore.getState().history.past).toHaveLength(2);
    expect(useCanvasStore.getState().undo()).toBe(true);
    expect(useCanvasStore.getState().edges.map(edge => edge.source)).toEqual(['source-1']);
    expect(useCanvasStore.getState().undo()).toBe(true);
    expect(useCanvasStore.getState().edges).toEqual([]);
    useCanvasStore.getState().redo();
    useCanvasStore.getState().redo();
    expect(useCanvasStore.getState().edges.map(edge => edge.source)).toEqual(['source-1', 'source-2']);
  });

  it('只有首次自动创建文本展示节点才计算位置，后续连线复用它', () => {
    const previous = useSettingsStore.getState().autoInsertTextDisplayNode;
    useSettingsStore.setState({ autoInsertTextDisplayNode: true });
    try {
      const canvas = useCanvasStore.getState();
      const sourceId = canvas.addNode(CANVAS_NODE_TYPES.textProcessing, { x: 0, y: 0 });
      const locate = vi.spyOn(useCanvasStore.getState(), 'findNodePosition').mockReturnValue({ x: 640, y: 80 });
      canvasStoreAttachment.batchViewUpdates(() => {
        canvas.onConnect({ source: sourceId, target: 'source-1', sourceHandle: 'source', targetHandle: promptPortId() });
        canvas.onConnect({ source: sourceId, target: 'source-2', sourceHandle: 'source', targetHandle: promptPortId() });
      });
      expect(locate).toHaveBeenCalledTimes(1);
      const bridges = useCanvasStore.getState().nodes.filter(item => item.type === CANVAS_NODE_TYPES.textAnnotation);
      expect(bridges).toHaveLength(1);
      expect(bridges[0].position).toEqual({ x: 640, y: 80 });
      expect(useCanvasStore.getState().edges.filter(edge => edge.source === bridges[0].id).map(edge => edge.target))
        .toEqual(['source-1', 'source-2']);
    } finally { useSettingsStore.setState({ autoInsertTextDisplayNode: previous }); }
  });

  it('同一批也不会给文本展示创建第二条入边', () => {
    const firstSourceId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.stringSource,
      { x: 0, y: 240 },
      { value: 'A' },
    );
    const secondSourceId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.stringSource,
      { x: 0, y: 400 },
      { value: 'B' },
    );
    const displayId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.textAnnotation,
      { x: 360, y: 240 },
      { content: '' },
    );

    const created = useCanvasStore.getState().connectMany([
      { source: firstSourceId, target: displayId, sourceHandle: 'source', targetHandle: 'target' },
      { source: secondSourceId, target: displayId, sourceHandle: 'source', targetHandle: 'target' },
    ]);

    expect(created).toHaveLength(1);
    expect(useCanvasStore.getState().edges.filter((edge) => edge.target === displayId)).toHaveLength(1);
  });

  it('通用 addEdge 入口也不会给文本展示创建第二条入边', () => {
    const firstSourceId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.textProcessing,
      { x: 0, y: 240 },
      { prompt: 'A' },
    );
    const secondSourceId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.textProcessing,
      { x: 0, y: 400 },
      { prompt: 'B' },
    );
    const displayId = useCanvasStore.getState().addNode(
      CANVAS_NODE_TYPES.textAnnotation,
      { x: 360, y: 240 },
      { content: '' },
    );

    expect(useCanvasStore.getState().addEdge(firstSourceId, displayId)).toBeTruthy();
    expect(useCanvasStore.getState().addEdge(secondSourceId, displayId)).toBeNull();
    expect(useCanvasStore.getState().edges.filter((edge) => edge.target === displayId)).toHaveLength(1);
  });
});
