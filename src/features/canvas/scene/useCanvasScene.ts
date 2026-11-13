import { useStoreApi, type ReactFlowState } from '@xyflow/react';
import { useEffect } from 'react';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { createCanvasScene, type CanvasScene, type SceneNode, type ScenePoint, type SceneRect } from './canvasScene';

type FlowState = ReactFlowState<CanvasNode, CanvasEdge>;
type FlowGetState = () => FlowState;

/**
 * 画布场景加上屏幕坐标换算：供指针命中、落点和浮层锚定使用。
 * 屏幕位置由视口变换与画布容器的位置算出，不量任何节点元素。
 */
export interface CanvasSceneView {
  readonly scene: CanvasScene;
  /** 屏幕坐标换成画布坐标；画布还没挂上时返回 null。 */
  toScenePoint(client: ScenePoint): ScenePoint | null;
  /** 屏幕上这一点是否落在画布本身（没有被面板、工具栏等界面挡住）。 */
  isCanvasSurfaceAt(client: ScenePoint): boolean;
  /** 屏幕某点下最上面的节点；被界面挡住的位置算作没有节点。 */
  hitNodeAtClient(client: ScenePoint, exclude?: (id: string) => boolean): SceneNode | null;
  /** 若干节点在屏幕上的并集外框。 */
  clientRectOf(ids: Iterable<string>): SceneRect | null;
  /** 画布坐标里的矩形换成屏幕坐标。 */
  toClientRect(rect: SceneRect): SceneRect | null;
  /** 画布容器在屏幕上的位置。 */
  canvasClientRect(): SceneRect | null;
}

const views = new WeakMap<FlowGetState, CanvasSceneView>();
let activeView: CanvasSceneView | null = null;

function createCanvasSceneView(getState: FlowGetState, subscribe: (listener: (state: FlowState, previous: FlowState) => void) => () => void): CanvasSceneView {
  const scene = createCanvasScene({ getState, subscribe });

  function origin(): { left: number; top: number; x: number; y: number; zoom: number; domNode: HTMLDivElement } | null {
    const { domNode, transform } = getState();
    if (!domNode) return null;
    const bounds = domNode.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, x: transform[0], y: transform[1], zoom: transform[2], domNode };
  }

  const view: CanvasSceneView = {
    scene,
    toScenePoint(client) {
      const base = origin();
      return base ? { x: (client.x - base.left - base.x) / base.zoom, y: (client.y - base.top - base.y) / base.zoom } : null;
    },
    isCanvasSurfaceAt(client) {
      const domNode = getState().domNode;
      const top = domNode?.ownerDocument.elementFromPoint(client.x, client.y);
      // 画布内容（空白处、节点、连线）都在渲染容器里；小地图、缩放条等面板在它外面。
      // 节点工具栏虽然挂在渲染容器里，也是盖在画布上的界面。
      return Boolean(top?.closest('.react-flow__renderer') && domNode?.contains(top) && !top.closest('.react-flow__node-toolbar'));
    },
    hitNodeAtClient(client, exclude) {
      if (!view.isCanvasSurfaceAt(client)) return null;
      const point = view.toScenePoint(client);
      return point ? scene.read().hitNode(point, exclude) : null;
    },
    toClientRect(rect) {
      const base = origin();
      if (!base) return null;
      return {
        x: base.left + base.x + rect.x * base.zoom, y: base.top + base.y + rect.y * base.zoom,
        width: rect.width * base.zoom, height: rect.height * base.zoom,
      };
    },
    canvasClientRect() {
      const bounds = getState().domNode?.getBoundingClientRect();
      return bounds ? { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height } : null;
    },
    clientRectOf(ids) {
      const bounds = scene.read().bounds(ids);
      return bounds ? view.toClientRect(bounds) : null;
    },
  };
  return view;
}

/** 同一个 ReactFlow store 共用一份场景；useStoreApi 每次返回新包装，getState 才是稳定标识。 */
export function useCanvasSceneView(): CanvasSceneView {
  const store = useStoreApi<CanvasNode, CanvasEdge>();
  let view = views.get(store.getState);
  if (!view) {
    view = createCanvasSceneView(store.getState, store.subscribe);
    views.set(store.getState, view);
  }
  return view;
}

/** 画布外壳挂载期间把自己的场景登记为当前画布，供不在画布组件树里的调用方（封面截图等）读取。 */
export function useActiveCanvasSceneView(): CanvasSceneView {
  const view = useCanvasSceneView();
  useEffect(() => {
    activeView = view;
    return () => { if (activeView === view) activeView = null; };
  }, [view]);
  return view;
}

/** 当前挂载着的画布的场景；没有画布时为 null。 */
export function getActiveCanvasSceneView(): CanvasSceneView | null {
  return activeView;
}
