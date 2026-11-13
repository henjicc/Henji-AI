import { Position, type InternalNode, type ReactFlowState } from '@xyflow/react';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { CANVAS_NODE_TYPES, type CanvasNodeType } from '@/features/canvas/domain/canvasNodeConstants';
import { getNodeDefinition, resolveCanvasNodeLayoutSize } from '@/features/canvas/domain/nodeRegistry';
import { resolveNodeDisplayName } from '@/features/canvas/domain/nodeDisplay';

/**
 * 画布场景：节点与连线可视数据（几何、层级、标题、摘要、缩略图来源、状态、端口位置）的唯一来源。
 *
 * 远景层照它绘制，按需挂载照它决定哪些节点叠上真 DOM，命中、落点与浮层锚定也都问它。
 * 节点的真 DOM 只是近景的编辑叠加层，多数节点没有 DOM，所以“某点下是哪个节点”
 * “某节点在哪里”“端口在哪里”不能向 DOM 询问。
 *
 * 数据从 ReactFlow store 派生，不另存几何；store 变了只记一个脏标记，下次读取时才重建。
 */

export interface ScenePoint { x: number; y: number }
export interface SceneRect { x: number; y: number; width: number; height: number }

/** 节点在远景里画什么：媒体节点是一张图，其余是标题加几行摘要。 */
export type SceneNodeContent =
  | { kind: 'image' | 'video'; source: string; title: string; summary: string }
  | { kind: 'card'; title: string; summary: string };

export type SceneNodeStatus = 'idle' | 'running' | 'failed';

export interface SceneNode {
  id: string;
  type: string;
  /** 画布坐标里的外框 */
  x: number;
  y: number;
  width: number;
  height: number;
  /** 外框尺寸是否量过；没量过时按节点类型估值，量到后自动换成真实尺寸 */
  sized: boolean;
  z: number;
  selected: boolean;
  /** 分组底板：画在连线与其他节点之下 */
  backdrop: boolean;
  status: SceneNodeStatus;
  content: SceneNodeContent;
  internal: InternalNode<CanvasNode>;
}

export interface ScenePort {
  nodeId: string;
  type: 'source' | 'target';
  handleId: string | null;
  /** 连线接入点（画布坐标） */
  x: number;
  y: number;
  position: Position;
  /** 位置是否来自真实端口；否则取节点左右两侧中点 */
  measured: boolean;
}

export interface SceneEdge {
  id: string;
  source: string;
  target: string;
  /** 起点、两个控制点、终点（画布坐标） */
  points: [number, number, number, number, number, number, number, number];
  selected: boolean;
  /** 两端端口位置都量过 */
  anchored: boolean;
}

export interface SceneSnapshot {
  /** 绘制顺序：靠后的压在上面 */
  readonly nodes: readonly SceneNode[];
  readonly edges: readonly SceneEdge[];
  /** 还没量过尺寸的节点 */
  readonly unsized: readonly SceneNode[];
  node(id: string): SceneNode | undefined;
  /** 某点下最上面的节点 */
  hitNode(point: ScenePoint, exclude?: (id: string) => boolean): SceneNode | null;
  /** 与矩形相交的节点（顺序不定） */
  nodesInRect(rect: SceneRect): SceneNode[];
  /** 离某点最近、且在半径内的端口；同样近时取上面节点的 */
  hitPort(point: ScenePoint, radius: number, type?: 'source' | 'target'): ScenePort | null;
  /** 某个端口的接入点；端口没量过时退回节点侧边中点 */
  port(nodeId: string, type: 'source' | 'target', handleId: string | null | undefined): ScenePort | null;
  /** 若干节点的并集外框 */
  bounds(ids?: Iterable<string>): SceneRect | null;
}

export type CanvasSceneState = Pick<ReactFlowState<CanvasNode, CanvasEdge>, 'nodes' | 'nodeLookup' | 'edges'>;

export interface CanvasSceneSource {
  getState(): CanvasSceneState;
  subscribe(listener: (state: CanvasSceneState, previous: CanvasSceneState) => void): () => void;
}

/** 这些字段的变化不影响场景（视口运动、连线与框选途中、按需挂载的渲染名单、按键与拖动状态）。 */
const UNRELATED_STATE_KEYS = [
  'transform', 'connection', 'userSelectionRect', 'userSelectionActive', 'nodesSelectionActive', 'multiSelectionActive',
  'paneDragging', 'henjiRenderedNodeIds', 'henjiRenderedEdgeIds', 'ariaLiveMessage',
];

/** 空间索引的格子边长（画布单位）：与常见节点同一量级，一个节点通常只落进一到四格。 */
const GRID_CELL = 512;
/** 跨格子数超过它的节点（大分组）不逐格登记，单独放一组，每次查询都比一遍。 */
const LARGE_NODE_CELLS = 64;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 同一份节点数据的可视内容不变：按数据对象缓存。拖动只换节点对象、不换数据对象，不会重算。 */
const contents = new WeakMap<object, { type: string; content: SceneNodeContent }>();

function describeContent(type: string, data: Record<string, unknown>): SceneNodeContent {
  const cached = contents.get(data);
  if (cached && cached.type === type) return cached.content;
  const title = resolveNodeDisplayName(type as CanvasNodeType, data);
  const summary = text(data.prompt) || text(data.content) || text(data.text);
  const media = getNodeDefinition(type as CanvasNodeType).media;
  let content: SceneNodeContent = { kind: 'card', title, summary };
  if (media && media.role !== 'generator') {
    const image = text(data.previewImageUrl) || text(data.imageUrl);
    const video = image ? '' : text(data.videoUrl);
    if (image) content = { kind: 'image', source: image, title, summary };
    else if (video) content = { kind: 'video', source: video, title, summary };
  }
  contents.set(data, { type, content });
  return content;
}

function resolveStatus(data: Record<string, unknown>): SceneNodeStatus {
  if (data.isGenerating === true) return 'running';
  return text(data.generationError) ? 'failed' : 'idle';
}

function controlOffset(distance: number): number {
  // 与 ReactFlow getBezierPath 默认曲率 0.25 相同
  return distance >= 0 ? 0.5 * distance : 0.25 * 25 * Math.sqrt(-distance);
}

function controlPoint(position: Position, x1: number, y1: number, x2: number, y2: number): [number, number] {
  switch (position) {
    case Position.Left: return [x1 - controlOffset(x1 - x2), y1];
    case Position.Right: return [x1 + controlOffset(x2 - x1), y1];
    case Position.Top: return [x1, y1 - controlOffset(y1 - y2)];
    default: return [x1, y1 + controlOffset(y2 - y1)];
  }
}

type HandleBound = NonNullable<NonNullable<InternalNode['internals']['handleBounds']>['source']>[number];

function measuredPort(node: SceneNode, type: 'source' | 'target', handle: HandleBound): ScenePort {
  const position = handle.position ?? (type === 'source' ? Position.Right : Position.Left);
  const dx = position === Position.Right ? handle.x + handle.width : position === Position.Left ? handle.x : handle.x + handle.width / 2;
  const dy = position === Position.Bottom ? handle.y + handle.height : position === Position.Top ? handle.y : handle.y + handle.height / 2;
  return { nodeId: node.id, type, handleId: handle.id ?? null, x: node.x + dx, y: node.y + dy, position, measured: true };
}

function sidePort(node: SceneNode, type: 'source' | 'target', handleId: string | null): ScenePort {
  return type === 'source'
    ? { nodeId: node.id, type, handleId, x: node.x + node.width, y: node.y + node.height / 2, position: Position.Right, measured: false }
    : { nodeId: node.id, type, handleId, x: node.x, y: node.y + node.height / 2, position: Position.Left, measured: false };
}

function resolvePort(node: SceneNode, type: 'source' | 'target', handleId: string | null | undefined): ScenePort {
  const bounds = node.internal.internals.handleBounds?.[type];
  const handle = bounds?.length ? (handleId ? bounds.find(candidate => candidate.id === handleId) : bounds[0]) : undefined;
  return handle ? measuredPort(node, type, handle) : sidePort(node, type, handleId ?? null);
}

/** 节点的全部端口：量过的用真实位置；正文从没挂过的节点按类型声明给出左右两侧各一个。 */
function portsOf(node: SceneNode): ScenePort[] {
  const bounds = node.internal.internals.handleBounds;
  if (bounds?.source?.length || bounds?.target?.length) {
    return [
      ...(bounds.source ?? []).map(handle => measuredPort(node, 'source', handle)),
      ...(bounds.target ?? []).map(handle => measuredPort(node, 'target', handle)),
    ];
  }
  const connectivity = getNodeDefinition(node.type as CanvasNodeType).connectivity;
  const ports: ScenePort[] = [];
  if (connectivity.sourceHandle) ports.push(sidePort(node, 'source', null));
  if (connectivity.targetHandle) ports.push(sidePort(node, 'target', null));
  return ports;
}

function cellKey(cx: number, cy: number): number {
  // 每个方向留 2^20 格（约 ±5 亿画布单位），远超画布实际范围
  return (cx + 0x80000) * 0x100000 + (cy + 0x80000);
}

function createSnapshot(nodes: SceneNode[], edges: SceneEdge[], byId: Map<string, SceneNode>, unsized: SceneNode[]): SceneSnapshot {
  /** 空间索引：格子 → 落在其中的节点下标（即绘制顺序）。第一次查询时才建。 */
  let grid: Map<number, number[]> | null = null;
  let large: number[] = [];
  let stamps = new Uint32Array(0);
  let stamp = 0;

  function ensureGrid(): Map<number, number[]> {
    if (grid) return grid;
    grid = new Map();
    large = [];
    stamps = new Uint32Array(nodes.length);
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index];
      const cx0 = Math.floor(node.x / GRID_CELL), cx1 = Math.floor((node.x + node.width) / GRID_CELL);
      const cy0 = Math.floor(node.y / GRID_CELL), cy1 = Math.floor((node.y + node.height) / GRID_CELL);
      if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > LARGE_NODE_CELLS) { large.push(index); continue; }
      for (let cx = cx0; cx <= cx1; cx += 1) {
        for (let cy = cy0; cy <= cy1; cy += 1) {
          const key = cellKey(cx, cy);
          const cell = grid.get(key);
          if (cell) cell.push(index); else grid.set(key, [index]);
        }
      }
    }
    return grid;
  }

  function contains(node: SceneNode, point: ScenePoint): boolean {
    return point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height;
  }

  function indicesInRect(rect: SceneRect): number[] {
    const index = ensureGrid();
    const cx0 = Math.floor(rect.x / GRID_CELL), cx1 = Math.floor((rect.x + rect.width) / GRID_CELL);
    const cy0 = Math.floor(rect.y / GRID_CELL), cy1 = Math.floor((rect.y + rect.height) / GRID_CELL);
    const right = rect.x + rect.width, bottom = rect.y + rect.height;
    const intersects = (node: SceneNode) => node.x <= right && node.x + node.width >= rect.x && node.y <= bottom && node.y + node.height >= rect.y;
    const found: number[] = [];
    // 查询范围比整张索引还大时逐格查不划算，直接把节点过一遍
    if ((cx1 - cx0 + 1) * (cy1 - cy0 + 1) > index.size) {
      for (let i = 0; i < nodes.length; i += 1) if (intersects(nodes[i])) found.push(i);
      return found;
    }
    stamp += 1;
    for (let cx = cx0; cx <= cx1; cx += 1) {
      for (let cy = cy0; cy <= cy1; cy += 1) {
        const cell = index.get(cellKey(cx, cy));
        if (!cell) continue;
        for (const i of cell) {
          if (stamps[i] === stamp) continue;
          stamps[i] = stamp;
          if (intersects(nodes[i])) found.push(i);
        }
      }
    }
    for (const i of large) if (intersects(nodes[i])) found.push(i);
    return found;
  }

  return {
    nodes, edges, unsized,
    node: id => byId.get(id),

    hitNode(point, exclude) {
      const index = ensureGrid();
      let best = -1;
      const consider = (i: number) => { if (i > best && contains(nodes[i], point) && !exclude?.(nodes[i].id)) best = i; };
      index.get(cellKey(Math.floor(point.x / GRID_CELL), Math.floor(point.y / GRID_CELL)))?.forEach(consider);
      large.forEach(consider);
      return best < 0 ? null : nodes[best];
    },

    nodesInRect: rect => indicesInRect(rect).map(i => nodes[i]),

    hitPort(point, radius, type) {
      let best: ScenePort | null = null;
      let bestDistance = radius;
      let bestIndex = -1;
      for (const i of indicesInRect({ x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2 })) {
        for (const port of portsOf(nodes[i])) {
          if (type && port.type !== type) continue;
          const distance = Math.hypot(port.x - point.x, port.y - point.y);
          if (distance > bestDistance || (distance === bestDistance && i < bestIndex)) continue;
          best = port; bestDistance = distance; bestIndex = i;
        }
      }
      return best;
    },

    port(nodeId, type, handleId) {
      const node = byId.get(nodeId);
      return node ? resolvePort(node, type, handleId) : null;
    },

    bounds(ids) {
      let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      const include = (node: SceneNode | undefined) => {
        if (!node) return;
        left = Math.min(left, node.x); top = Math.min(top, node.y);
        right = Math.max(right, node.x + node.width); bottom = Math.max(bottom, node.y + node.height);
      };
      if (ids) { for (const id of ids) include(byId.get(id)); } else nodes.forEach(include);
      return Number.isFinite(left) ? { x: left, y: top, width: right - left, height: bottom - top } : null;
    },
  };
}

export function createCanvasScene(source: CanvasSceneSource) {
  const listeners = new Set<() => void>();
  let snapshot: SceneSnapshot | null = null;
  let previous = new Map<string, SceneNode>();
  let stopSource: (() => void) | undefined;

  function build(state: CanvasSceneState): SceneSnapshot {
    const nodes: SceneNode[] = [];
    const unsized: SceneNode[] = [];
    const byId = new Map<string, SceneNode>();
    let ordered = true;
    let lastZ = -Infinity;
    for (const internal of state.nodeLookup.values()) {
      if (internal.hidden) continue;
      const position = internal.internals.positionAbsolute;
      const z = internal.internals.z;
      let node = previous.get(internal.id);
      // 节点对象没换、位置没动：整条沿用，拖动一个节点时其余几千个不重新生成
      if (!node || node.internal !== internal || node.x !== position.x || node.y !== position.y || node.z !== z) {
        const measuredWidth = internal.measured.width, measuredHeight = internal.measured.height;
        const sized = Boolean(measuredWidth && measuredHeight);
        const size = sized ? { width: measuredWidth as number, height: measuredHeight as number } : resolveCanvasNodeLayoutSize(internal.internals.userNode);
        const data = (internal.internals.userNode.data ?? {}) as Record<string, unknown>;
        const type = internal.type ?? '';
        node = {
          id: internal.id, type, x: position.x, y: position.y, width: size.width, height: size.height, sized, z,
          selected: Boolean(internal.selected),
          backdrop: type === CANVAS_NODE_TYPES.group,
          status: resolveStatus(data),
          content: describeContent(type, data),
          internal,
        };
      }
      if (z < lastZ) ordered = false;
      lastZ = z;
      nodes.push(node);
      byId.set(node.id, node);
      if (!node.sized) unsized.push(node);
    }
    previous = byId;
    // 与节点层一致：层级高的在上，同层按节点原有先后
    if (!ordered) {
      const order = new Map(nodes.map((node, index) => [node, index]));
      nodes.sort((a, b) => a.z - b.z || (order.get(a) as number) - (order.get(b) as number));
    }

    const edges: SceneEdge[] = [];
    for (const edge of state.edges) {
      if (edge.hidden) continue;
      const sourceNode = byId.get(edge.source);
      const targetNode = byId.get(edge.target);
      if (!sourceNode || !targetNode) continue;
      const from = resolvePort(sourceNode, 'source', edge.sourceHandle);
      const to = resolvePort(targetNode, 'target', edge.targetHandle);
      const [c1x, c1y] = controlPoint(from.position, from.x, from.y, to.x, to.y);
      const [c2x, c2y] = controlPoint(to.position, to.x, to.y, from.x, from.y);
      edges.push({
        id: edge.id, source: edge.source, target: edge.target,
        points: [from.x, from.y, c1x, c1y, c2x, c2y, to.x, to.y],
        selected: Boolean(edge.selected), anchored: from.measured && to.measured,
      });
    }
    return createSnapshot(nodes, edges, byId, unsized);
  }

  function connect(): void {
    stopSource ??= source.subscribe((state, before) => {
      const graphChanged = state.nodes !== before.nodes || state.edges !== before.edges || state.nodeLookup !== before.nodeLookup;
      // 只是视口、连线拖动、框选、渲染名单这些与场景无关的字段在变：不必重建。
      // 其余一律当作可能变了——ReactFlow 就地改完节点的量得尺寸与端口位置后，用一次不带这些字段的通知来广播。
      if (!graphChanged && UNRELATED_STATE_KEYS.some(key => (state as Record<string, unknown>)[key] !== (before as Record<string, unknown>)[key])) return;
      snapshot = null;
      listeners.forEach(listener => listener());
    });
  }

  return {
    /** 当前场景；内容没变时返回同一个对象。 */
    read(): SceneSnapshot {
      // 没人订阅时收不到变更通知，每次都按当前状态重建
      if (!snapshot || !stopSource) snapshot = build(source.getState());
      return snapshot;
    },
    /** 场景内容变了就通知（视口移动不算）。 */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      connect();
      return () => {
        if (!listeners.delete(listener) || listeners.size) return;
        stopSource?.(); stopSource = undefined;
        snapshot = null;
        previous = new Map();
      };
    },
  };
}

export type CanvasScene = ReturnType<typeof createCanvasScene>;
