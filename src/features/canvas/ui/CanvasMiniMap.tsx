import {
  memo,
  useCallback,
  useId,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import {
  Panel,
  useReactFlow,
  useStore,
  useStoreApi,
  type InternalNode,
  type Node,
} from '@xyflow/react';

import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { CANVAS_MINIMAP_Z_INDEX } from '@/features/canvas/canvasUtils';

const MINI_MAP_WIDTH = 200;
const MINI_MAP_HEIGHT = 150;
const MINI_MAP_OFFSET_SCALE = 5;

interface MiniMapRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MiniMapViewBox extends Bounds {
  scale: number;
  offset: number;
}

function resolveNodeRects(
  nodes: readonly Node[],
  getInternalNode: (nodeId: string) => InternalNode<CanvasNode> | undefined,
): MiniMapRect[] {
  const rects: MiniMapRect[] = [];

  for (const node of nodes) {
    const internalNode = getInternalNode(node.id);
    if (!internalNode || internalNode.hidden) continue;
    const width = internalNode.measured.width ?? internalNode.width ?? 0;
    const height = internalNode.measured.height ?? internalNode.height ?? 0;
    if (width <= 0 || height <= 0) continue;
    rects.push({
      id: node.id,
      x: internalNode.internals.positionAbsolute.x,
      y: internalNode.internals.positionAbsolute.y,
      width,
      height,
    });
  }

  return rects;
}

function getRectsBounds(rects: readonly MiniMapRect[]): Bounds | null {
  if (rects.length === 0) return null;
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;

  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

function unionBounds(first: Bounds, second: Bounds): Bounds {
  const left = Math.min(first.x, second.x);
  const top = Math.min(first.y, second.y);
  const right = Math.max(first.x + first.width, second.x + second.width);
  const bottom = Math.max(first.y + first.height, second.y + second.height);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function getMiniMapViewBox(bounds: Bounds): MiniMapViewBox {
  const scale = Math.max(
    bounds.width / MINI_MAP_WIDTH,
    bounds.height / MINI_MAP_HEIGHT,
    Number.EPSILON,
  );
  const viewWidth = scale * MINI_MAP_WIDTH;
  const viewHeight = scale * MINI_MAP_HEIGHT;
  const offset = MINI_MAP_OFFSET_SCALE * scale;
  return {
    x: bounds.x - (viewWidth - bounds.width) / 2 - offset,
    y: bounds.y - (viewHeight - bounds.height) / 2 - offset,
    width: viewWidth + offset * 2,
    height: viewHeight + offset * 2,
    scale,
    offset,
  };
}

const MiniMapNodes = memo(({ rects }: { rects: readonly MiniMapRect[] }): JSX.Element => (
  <>
    {rects.map((rect) => (
      <rect
        key={rect.id}
        className="react-flow__minimap-node"
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        rx={5}
        ry={5}
        shapeRendering="geometricPrecision"
      />
    ))}
  </>
));

MiniMapNodes.displayName = 'MiniMapNodes';

/**
 * 针对大画布的轻量小地图。
 *
 * React Flow 原生 MiniMap 会在每次 viewport transform 更新时重新遍历全部节点计算边界。
 * 这里把节点矩形/边界订阅到 nodes 引用，仅在节点变化时 O(N) 更新；平移与缩放帧只更新
 * viewport mask 和 viewBox，工作量保持 O(1)。
 */
export function CanvasMiniMap(): JSX.Element {
  const store = useStoreApi<CanvasNode, CanvasEdge>();
  const reactFlow = useReactFlow<CanvasNode, CanvasEdge>();
  const nodeRevision = useStore((state) => state.nodes);
  const transform = useStore((state) => state.transform);
  const flowWidth = useStore((state) => state.width);
  const flowHeight = useStore((state) => state.height);
  const minZoom = useStore((state) => state.minZoom);
  const maxZoom = useStore((state) => state.maxZoom);
  const titleId = useId();
  const activePointerIdRef = useRef<number | null>(null);
  const previousPointerRef = useRef({ x: 0, y: 0 });

  const nodeRects = useMemo(() => {
    const nodeLookup = store.getState().nodeLookup;
    return resolveNodeRects(nodeRevision, (nodeId) => nodeLookup.get(nodeId));
  }, [nodeRevision, store]);
  const graphBounds = useMemo(() => getRectsBounds(nodeRects), [nodeRects]);

  const [translateX, translateY, zoom] = transform;
  const viewportBounds = useMemo<Bounds>(() => ({
    x: -translateX / zoom,
    y: -translateY / zoom,
    width: flowWidth / zoom,
    height: flowHeight / zoom,
  }), [flowHeight, flowWidth, translateX, translateY, zoom]);
  const combinedBounds = graphBounds ? unionBounds(graphBounds, viewportBounds) : viewportBounds;
  const viewBox = getMiniMapViewBox(combinedBounds);

  const handlePointerDown = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    activePointerIdRef.current = event.pointerId;
    previousPointerRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handlePointerMove = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const previous = previousPointerRef.current;
    const deltaX = event.clientX - previous.x;
    const deltaY = event.clientY - previous.y;
    previousPointerRef.current = { x: event.clientX, y: event.clientY };
    const currentTransform = store.getState().transform;
    const moveScale = viewBox.scale * currentTransform[2];
    void reactFlow.setViewport({
      x: currentTransform[0] - deltaX * moveScale,
      y: currentTransform[1] - deltaY * moveScale,
      zoom: currentTransform[2],
    });
  }, [reactFlow, store, viewBox.scale]);

  const finishPointerGesture = useCallback((event: ReactPointerEvent<SVGSVGElement>): void => {
    if (activePointerIdRef.current !== event.pointerId) return;
    activePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const handleWheel = useCallback((event: ReactWheelEvent<SVGSVGElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const current = store.getState();
    const [x, y, currentZoom] = current.transform;
    const wheelScale = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
    const nextZoom = Math.min(
      maxZoom,
      Math.max(minZoom, currentZoom * Math.pow(2, -event.deltaY * wheelScale)),
    );
    if (nextZoom === currentZoom) return;
    const centerX = (flowWidth / 2 - x) / currentZoom;
    const centerY = (flowHeight / 2 - y) / currentZoom;
    void reactFlow.setViewport({
      x: flowWidth / 2 - centerX * nextZoom,
      y: flowHeight / 2 - centerY * nextZoom,
      zoom: nextZoom,
    });
  }, [flowHeight, flowWidth, maxZoom, minZoom, reactFlow, store]);

  const maskPath = `M${viewBox.x - viewBox.offset},${viewBox.y - viewBox.offset}`
    + `h${viewBox.width + viewBox.offset * 2}v${viewBox.height + viewBox.offset * 2}`
    + `h${-viewBox.width - viewBox.offset * 2}z `
    + `M${viewportBounds.x},${viewportBounds.y}h${viewportBounds.width}`
    + `v${viewportBounds.height}h${-viewportBounds.width}z`;

  return (
    <Panel
      position="bottom-right"
      className="canvas-minimap react-flow__minimap nopan nowheel !border-border-dark !bg-surface-dark"
      style={{ pointerEvents: 'all', zIndex: CANVAS_MINIMAP_Z_INDEX }}
      data-testid="rf__minimap"
    >
      {/* icon-token-allow：节点矩形与 viewport mask 是随画布数据生成的小地图，不是图标 */}
      <svg
        width={MINI_MAP_WIDTH}
        height={MINI_MAP_HEIGHT}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className="react-flow__minimap-svg"
        role="img"
        aria-labelledby={titleId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={finishPointerGesture}
        onWheel={handleWheel}
      >
        <title id={titleId}>画布小地图</title>
        <MiniMapNodes rects={nodeRects} />
        <path
          className="react-flow__minimap-mask"
          d={maskPath}
          fillRule="evenodd"
          pointerEvents="none"
        />
      </svg>
    </Panel>
  );
}
