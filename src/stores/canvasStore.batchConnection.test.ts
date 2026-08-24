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
});
