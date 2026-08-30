// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import { CANVAS_NODE_TYPES, type CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { canvasNodeDefinitions } from '@/features/canvas/domain/nodeRegistry';
import { useCanvasStore } from './canvasStore';

function node(id: string): CanvasNode {
  return {
    id,
    type: CANVAS_NODE_TYPES.upload,
    position: { x: 0, y: 0 },
    data: canvasNodeDefinitions[CANVAS_NODE_TYPES.upload].createDefaultData(),
  } as CanvasNode;
}

describe('canvasStore.connectMany', () => {
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
