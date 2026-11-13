import { describe, expect, it } from 'vitest';
import { Position } from '@xyflow/react';
import { createCanvasScene, type CanvasSceneSource, type CanvasSceneState } from './canvasScene';

interface FixtureNode {
  id: string; x: number; y: number; width?: number; height?: number; z?: number; type?: string; selected?: boolean;
  data?: Record<string, unknown>;
  handles?: { source?: Array<{ id: string; x: number; y: number }>; target?: Array<{ id: string; x: number; y: number }> };
}

function fixture(nodes: FixtureNode[], edges: Array<{ id: string; source: string; target: string; sourceHandle?: string; targetHandle?: string }> = []) {
  const listeners = new Set<(state: CanvasSceneState, previous: CanvasSceneState) => void>();
  const internal = (node: FixtureNode) => {
    const userNode = { id: node.id, type: node.type ?? 'textAnnotationNode', data: node.data ?? {}, position: { x: node.x, y: node.y } };
    const bounds = (list: Array<{ id: string; x: number; y: number }> | undefined, type: 'source' | 'target') => list?.map(handle => ({
      ...handle, width: 8, height: 8, type, nodeId: node.id, position: type === 'source' ? Position.Right : Position.Left,
    }));
    return {
      ...userNode, selected: node.selected, hidden: false,
      measured: node.width ? { width: node.width, height: node.height } : {},
      internals: {
        positionAbsolute: { x: node.x, y: node.y }, z: node.z ?? 0, userNode,
        handleBounds: node.handles ? { source: bounds(node.handles.source, 'source'), target: bounds(node.handles.target, 'target') } : undefined,
      },
    };
  };
  let state = {
    nodes: [] as unknown[], edges, transform: [0, 0, 1], connection: {}, userSelectionRect: null,
    nodeLookup: new Map(nodes.map(node => [node.id, internal(node)])),
  } as unknown as CanvasSceneState;
  const source: CanvasSceneSource = {
    getState: () => state,
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    scene: createCanvasScene(source),
    replace(next: FixtureNode[]) {
      const previous = state;
      state = { ...state, nodes: [], nodeLookup: new Map(next.map(node => [node.id, internal(node)])) } as unknown as CanvasSceneState;
      listeners.forEach(listener => listener(state, previous));
    },
    moveView() {
      const previous = state;
      state = { ...state, transform: [10, 10, 1] } as unknown as CanvasSceneState;
      listeners.forEach(listener => listener(state, previous));
    },
  };
}

describe('画布场景', () => {
  it('某点下取最上面的节点：层级高的在上，同层靠后的在上，可排除指定节点', () => {
    const { scene } = fixture([
      { id: 'raised', x: 0, y: 0, width: 200, height: 200, z: 5 },
      { id: 'early', x: 100, y: 100, width: 200, height: 200 },
      { id: 'late', x: 150, y: 150, width: 200, height: 200 },
    ]);
    const snapshot = scene.read();
    expect(snapshot.hitNode({ x: 180, y: 180 })?.id).toBe('raised');
    expect(snapshot.hitNode({ x: 250, y: 250 })?.id).toBe('late');
    expect(snapshot.hitNode({ x: 250, y: 250 }, id => id === 'late')?.id).toBe('early');
    expect(snapshot.hitNode({ x: 900, y: 900 })).toBeNull();
  });

  it('没量过尺寸的节点按类型估值占位，照样画得出、点得中', () => {
    const { scene } = fixture([{ id: 'fresh', x: 1000, y: 1000 }]);
    const snapshot = scene.read();
    const node = snapshot.node('fresh');
    expect(node?.sized).toBe(false);
    expect(node?.width).toBeGreaterThan(0);
    expect(snapshot.unsized.map(entry => entry.id)).toEqual(['fresh']);
    expect(snapshot.hitNode({ x: 1010, y: 1010 })?.id).toBe('fresh');
  });

  it('矩形查询跨格子不重复，远处的大矩形也查得全', () => {
    const nodes = Array.from({ length: 400 }, (_, index) => ({ id: `n${index}`, x: (index % 20) * 700, y: Math.floor(index / 20) * 700, width: 600, height: 600 }));
    const { scene } = fixture(nodes);
    const snapshot = scene.read();
    const some = snapshot.nodesInRect({ x: 650, y: 550, width: 100, height: 200 }).map(node => node.id).sort();
    expect(some).toEqual(['n1', 'n21']);
    expect(snapshot.nodesInRect({ x: -1e6, y: -1e6, width: 2e6, height: 2e6 })).toHaveLength(400);
  });

  it('端口位置：量过的用真实位置，没量过的退回两侧中点；连线端点与端口一致', () => {
    const { scene } = fixture([
      { id: 'a', x: 0, y: 0, width: 100, height: 100, handles: { source: [{ id: 'out', x: 96, y: 16 }] } },
      { id: 'b', x: 400, y: 0, width: 100, height: 100 },
    ], [{ id: 'e', source: 'a', target: 'b', sourceHandle: 'out' }]);
    const snapshot = scene.read();
    expect(snapshot.port('a', 'source', 'out')).toMatchObject({ x: 104, y: 20, measured: true });
    expect(snapshot.port('b', 'target', null)).toMatchObject({ x: 400, y: 50, measured: false });
    expect(snapshot.edges[0].points.slice(0, 2)).toEqual([104, 20]);
    expect(snapshot.edges[0].points.slice(6)).toEqual([400, 50]);
    expect(snapshot.edges[0].anchored).toBe(false);
    // 端口有一半伸在节点外框之外：落在框外几个单位也要算中
    expect(snapshot.hitPort({ x: 110, y: 22 }, 14, 'source')).toMatchObject({ nodeId: 'a', handleId: 'out' });
    expect(snapshot.hitPort({ x: 110, y: 22 }, 14, 'target')).toBeNull();
  });

  it('订阅期间内容没变就沿用同一份场景，视口移动不重建，节点变了才重建', () => {
    const { scene, replace, moveView } = fixture([{ id: 'a', x: 0, y: 0, width: 100, height: 100 }]);
    let notified = 0;
    const stop = scene.subscribe(() => { notified += 1; });
    const first = scene.read();
    moveView();
    expect(scene.read()).toBe(first);
    expect(notified).toBe(0);
    replace([{ id: 'a', x: 50, y: 0, width: 100, height: 100 }]);
    expect(notified).toBe(1);
    expect(scene.read().node('a')?.x).toBe(50);
    stop();
  });
});
