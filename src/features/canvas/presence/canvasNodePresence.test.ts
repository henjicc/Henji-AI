import { describe, expect, it } from 'vitest';
import { createCanvasScene, type CanvasSceneSource } from '@/features/canvas/scene/canvasScene';
import { createCanvasNodePresence, MAX_ACTIVE_CANVAS_NODES, type CanvasNodePresenceSource } from './canvasNodePresence';

interface FixtureNode { id: string; x: number; y: number; measured?: boolean }

function fixture(nodes: FixtureNode[], zoom: number, alwaysMountedLimit = 0) {
  const listeners = new Set<() => void>();
  const rendered: { henjiRenderedNodeIds?: string[] | null } = {};
  const state = {
    transform: [0, 0, zoom] as [number, number, number],
    width: 1000,
    height: 800,
    domNode: null,
    nodes: [] as unknown[],
    edges: [] as Array<{ id: string; source: string; target: string }>,
    nodeLookup: new Map(nodes.map(node => [node.id, {
      id: node.id, type: 'uploadNode', hidden: false, dragging: false,
      measured: node.measured === false ? {} : { width: 100, height: 100 },
      internals: { positionAbsolute: { x: node.x, y: node.y }, z: 0, userNode: { id: node.id, type: 'uploadNode', data: {} } },
    }])),
  };
  const source = {
    // 夹具里节点不变：场景建一次即可，不需要变更通知
    scene: createCanvasScene({ getState: () => state, subscribe: () => () => undefined } as unknown as CanvasSceneSource),
    getState: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    setState: (ids: object) => { Object.assign(rendered, ids); },
    seed: (ids: object) => { Object.assign(rendered, ids); },
  } as unknown as CanvasNodePresenceSource;
  let clock = 0;
  const frames: Array<() => void> = [];
  const presence = createCanvasNodePresence(source, {
    getZoomThreshold: () => 0.4,
    alwaysMountedLimit,
    now: () => clock,
    requestFrame: (callback) => { frames.push(callback); return frames.length; },
    cancelFrame: () => undefined,
  });
  return {
    presence,
    rendered,
    setZoom(next: number) { state.transform = [0, 0, next]; listeners.forEach(listener => listener()); },
    /** 推进若干帧；每帧时钟走 16ms，时间预算因此每帧都用得完一批。 */
    run(count = 1) { for (let i = 0; i < count && frames.length; i += 1) { clock += 16; frames.shift()?.(); } },
    advance(ms: number) { clock += ms; },
    addNode(node: FixtureNode) {
      state.nodeLookup.set(node.id, {
        id: node.id, type: 'uploadNode', hidden: false, dragging: false, measured: { width: 100, height: 100 },
        internals: { positionAbsolute: { x: node.x, y: node.y }, z: 0, userNode: { id: node.id, type: 'uploadNode', data: {} } },
      });
      listeners.forEach(listener => listener());
    },
    pendingFrames: () => frames.length,
  };
}

describe('节点正文挂载调度', () => {
  it('近景只挂视口附近的节点，远景全部交给远景层，没量过尺寸的节点不论缩放都要挂一次', () => {
    const { presence, setZoom, run, advance } = fixture([
      { id: 'inside', x: 100, y: 100 },
      { id: 'faraway', x: 50_000, y: 50_000 },
      { id: 'fresh', x: 90_000, y: 0, measured: false },
    ], 1);
    presence.arm();
    run(8);
    expect(presence.modeOf('inside')).toBe('body');
    expect(presence.modeOf('faraway')).toBe('off');
    expect(presence.modeOf('fresh')).toBe('body');

    setZoom(0.1);
    run(1);
    // 视口刚动过：正文先留着（节点层同时在淡出），停稳后才卸
    expect(presence.modeOf('inside')).toBe('body');
    advance(200);
    run(4);
    expect(presence.modeOf('inside')).toBe('off');
    expect(presence.modeOf('fresh')).toBe('body');
  });

  it('同时挂载的正文有上限，离视口中心近的优先', () => {
    const nodes = Array.from({ length: MAX_ACTIVE_CANVAS_NODES + 200 }, (_, index) => ({ id: `n${index}`, x: 500 + index, y: 400 }));
    const { presence, run } = fixture(nodes, 1);
    presence.arm();
    run(2000);
    expect(presence.activeCount()).toBeLessThanOrEqual(MAX_ACTIVE_CANVAS_NODES);
    expect(presence.modeOf('n0')).toBe('body');
    expect(presence.modeOf(`n${nodes.length - 1}`)).toBe('off');
  });

  it('视口附近挂满时，没量过尺寸的节点照样挂得上', () => {
    const nodes = [
      ...Array.from({ length: MAX_ACTIVE_CANVAS_NODES + 50 }, (_, index) => ({ id: `n${index}`, x: 500 + index, y: 400 })),
      { id: 'fresh', x: 90_000, y: 0, measured: false },
    ];
    const { presence, run } = fixture(nodes, 1);
    presence.arm();
    run(2000);
    expect(presence.modeOf('fresh')).toBe('body');
    expect(presence.modeOf('n0')).toBe('body');
  });

  it('远景里留着的正文不算可交互', () => {
    const { presence, run } = fixture([{ id: 'a', x: 0, y: 0 }], 0.1);
    presence.arm();
    run(2);
    presence.pin('a', 1000);
    expect(presence.modeOf('a')).toBe('body');
    expect(presence.isBodyInteractive('a')).toBe(false);
  });

  it('指针所在的节点成为壳；被点名的节点立刻挂上正文；调度停用后一律按正文', () => {
    const { presence, rendered, run } = fixture([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 300, y: 0 }], 0.1);
    presence.arm();
    run(2);
    expect(presence.modeOf('a')).toBe('off');
    expect(rendered.henjiRenderedNodeIds).toEqual([]);
    presence.setShell('a');
    expect(presence.modeOf('a')).toBe('shell');
    expect(rendered.henjiRenderedNodeIds).toEqual(['a']);
    presence.setShell('b');
    expect(presence.modeOf('a')).toBe('off');
    presence.pin('a', 1000);
    expect(presence.modeOf('a')).toBe('body');
    presence.setEnabled(false);
    expect(presence.modeOf('b')).toBe('body');
    expect(rendered.henjiRenderedNodeIds).toBeNull();
  });

  it('节点数越过界限、开始按需挂载的那一刻，已经挂着的正文不被清空', () => {
    const { presence, rendered, addNode } = fixture([{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 200, y: 0 }], 1, 2);
    presence.arm();
    expect(presence.isEnabled()).toBe(false);
    addNode({ id: 'c', x: 400, y: 0 });
    expect(presence.isEnabled()).toBe(true);
    expect(rendered.henjiRenderedNodeIds).toEqual(['a', 'b', 'c']);
    expect(presence.modeOf('a')).toBe('body');
  });

  it('节点数不多的画布不做按需挂载，全部节点照常渲染', () => {
    const nodes = [{ id: 'a', x: 0, y: 0 }, { id: 'far', x: 90_000, y: 0 }];
    const { presence, rendered, run } = fixture(nodes, 0.1, 10);
    presence.arm();
    run(2);
    expect(presence.isEnabled()).toBe(false);
    expect(presence.modeOf('far')).toBe('body');
    expect(rendered.henjiRenderedNodeIds).toBeUndefined();
  });
});
