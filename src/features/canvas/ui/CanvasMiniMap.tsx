import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  Panel,
  useReactFlow,
  useStore,
  useStoreApi,
  type InternalNode,
  type Node,
} from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import { useNonPassiveWheel } from '@/hooks/useNonPassiveWheel';

import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { CANVAS_MINIMAP_Z_INDEX } from '@/features/canvas/canvasUtils';
import { UI_FLOATING_EDGE_CLASS } from '@/components/ui/styleTokens'

const MINI_MAP_WIDTH = 176;
const MINI_MAP_HEIGHT = 112;
const MINI_MAP_OFFSET_SCALE = 5;
/**
 * 节点数超过它时节点块改画在一块画布上：几千个 SVG 矩形在视口框每动一下、节点每拖一下时都要整个重画、重新对比。
 * 不超过时仍是逐个的 SVG 矩形（节点测量的核对脚本要逐个读它们）。
 */
const MINI_MAP_ELEMENT_LIMIT = 300;

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

/** 把节点块一次画到画布上；只在节点或取景范围变了时重画，视口框移动不碰它。 */
const MiniMapNodeCanvas = memo(({ rects, viewBox }: { rects: readonly MiniMapRect[]; viewBox: Bounds }): JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [redrawRevision, setRedrawRevision] = useState(0);
  useEffect(() => {
    // 节点块的颜色取自样式，主题变了要重画；窗口挪到另一块屏幕后像素比变了也要按新的密度重画
    const redraw = () => setRedrawRevision(value => value + 1);
    const observer = new MutationObserver(redraw);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });
    window.addEventListener('resize', redraw);
    return () => { observer.disconnect(); window.removeEventListener('resize', redraw); };
  }, []);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(MINI_MAP_WIDTH * ratio), height = Math.round(MINI_MAP_HEIGHT * ratio);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    context.clearRect(0, 0, width, height);
    context.fillStyle = getComputedStyle(canvas).color;
    // 与上面那层 SVG 的取景一致：等比缩放、居中
    const scale = Math.min(width / viewBox.width, height / viewBox.height);
    const left = (width - viewBox.width * scale) / 2 - viewBox.x * scale;
    const top = (height - viewBox.height * scale) / 2 - viewBox.y * scale;
    for (const rect of rects) {
      context.fillRect(left + rect.x * scale, top + rect.y * scale, Math.max(1, rect.width * scale), Math.max(1, rect.height * scale));
    }
  }, [rects, viewBox.x, viewBox.y, viewBox.width, viewBox.height, redrawRevision]);
  return <canvas ref={canvasRef} aria-hidden className="canvas-minimap-nodes pointer-events-none absolute left-0 top-0" style={{ width: MINI_MAP_WIDTH, height: MINI_MAP_HEIGHT }} />;
});

MiniMapNodeCanvas.displayName = 'MiniMapNodeCanvas';

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
  const { t } = useTranslation();
  const titleId = useId();
  const activePointerIdRef = useRef<number | null>(null);
  const previousPointerRef = useRef({ x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);

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

  // 滚轮缩放要拦住页面与画布的默认滚动，走非被动原生监听（React 的 onWheel 是被动的，
  // 在里面 preventDefault 会被浏览器忽略并报警）。监听只绑一次，取值一律读 store 现值。
  const handleWheel = useCallback((event: WheelEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    const { transform: [x, y, currentZoom], width, height, minZoom, maxZoom } = store.getState();
    const wheelScale = event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002;
    const nextZoom = Math.min(
      maxZoom,
      Math.max(minZoom, currentZoom * Math.pow(2, -event.deltaY * wheelScale)),
    );
    if (nextZoom === currentZoom) return;
    const centerX = (width / 2 - x) / currentZoom;
    const centerY = (height / 2 - y) / currentZoom;
    void reactFlow.setViewport({
      x: width / 2 - centerX * nextZoom,
      y: height / 2 - centerY * nextZoom,
      zoom: nextZoom,
    });
  }, [reactFlow, store]);
  useNonPassiveWheel(svgRef, handleWheel);

  const drawOnCanvas = nodeRects.length > MINI_MAP_ELEMENT_LIMIT;
  const maskPath = `M${viewBox.x - viewBox.offset},${viewBox.y - viewBox.offset}`
    + `h${viewBox.width + viewBox.offset * 2}v${viewBox.height + viewBox.offset * 2}`
    + `h${-viewBox.width - viewBox.offset * 2}z `
    + `M${viewportBounds.x},${viewportBounds.y}h${viewportBounds.width}`
    + `v${viewportBounds.height}h${-viewportBounds.width}z`;

  return (
    <Panel
      position="bottom-right"
      className={`canvas-minimap react-flow__minimap nopan nowheel !m-3 !bg-panel/90 ${UI_FLOATING_EDGE_CLASS}`}
      style={{ pointerEvents: 'all', zIndex: CANVAS_MINIMAP_Z_INDEX }}
      data-testid="rf__minimap"
    >
      {drawOnCanvas && <MiniMapNodeCanvas rects={nodeRects} viewBox={viewBox} />}
      {/* icon-token-allow：节点矩形与 viewport mask 是随画布数据生成的小地图，不是图标 */}
      <svg
        ref={svgRef}
        width={MINI_MAP_WIDTH}
        height={MINI_MAP_HEIGHT}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
        className="react-flow__minimap-svg relative"
        role="img"
        aria-labelledby={titleId}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerGesture}
        onPointerCancel={finishPointerGesture}
      >
        <title id={titleId}>{t('canvas.minimap')}</title>
        {!drawOnCanvas && <MiniMapNodes rects={nodeRects} />}
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
