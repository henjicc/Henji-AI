import { createLogger } from '@/core/logging';
import { UI_DURATION } from '@/components/ui/motion';
import { CANVAS_NODE_BUSY_SELECTOR, type CanvasNodePresence } from '@/features/canvas/presence/canvasNodePresence';
import type { SceneNode, SceneRect, SceneSnapshot } from '@/features/canvas/scene/canvasScene';
import type { CanvasSceneView } from '@/features/canvas/scene/useCanvasScene';
import type { FarLayerSnapshots, UnitRect } from './farLayerSnapshots';

const logger = createLogger('features.canvas.farLayer.bodyProxy');

/**
 * 近景里视口运动时的正文代画。
 *
 * 平移、缩放时浏览器要逐帧重画所有挂着的节点正文（真 DOM），一百来个就掉到二三十帧。这里在正文停稳时
 * 把画布区域截下来存进远景层（farLayerSnapshots），视口一动就把有存档的正文藏起来，由远景层照存档画；
 * 停稳后正文淡入盖回去。存档就是正文在同一缩放下的截图，所以藏起来那一刻看不出切换。
 *
 * 没有存档、存档盖不住当前露出部分的正文不藏（宁可慢也不跳变）；用户正在操作的正文也不藏。
 * 远景层整个铺在真 DOM 之下，所以一个正文只有在它压着的正文也都藏起来时才能藏，否则会被下面那个盖住；
 * 分组底板不代画，压在分组上的节点因此都留着真正文。
 * 藏起来的正文只是里面的内容不画，外框照旧接收指针：点选、拖动、右键与平时一样。
 * 指针下的正文始终是真 DOM（视口在指针下移过节点时随即换回），停稳前按下去也按得到里面的控件。
 */

interface ScreenRect { x: number; y: number; width: number; height: number }

export interface BodyProxyHost {
  getState(): { transform: [number, number, number]; paneDragging: boolean; connection: { inProgress: boolean }; userSelectionActive: boolean };
  presence: CanvasNodePresence;
  sceneView: CanvasSceneView;
  flowElement: HTMLElement;
  /** 当前可用的画面存档；远景层还没起来时为 null */
  snapshots(): FarLayerSnapshots | null;
  /** 截取页面里一块区域（CSS 像素）；rect 是实际截到的范围，jpeg 是设备像素尺寸的画面 */
  capture(rect: ScreenRect): Promise<{ rect: ScreenRect; jpeg: Uint8Array }>;
  /** 存档或代画范围变了：远景层重填实例并在同一帧重画 */
  invalidate(): void;
}

/** 视口停下这么久之后正文才盖回来 */
const SETTLE_MS = 140;
/** 正文与画布安静这么久之后才截图：等淡入、布局、挂载都结束 */
const CAPTURE_IDLE_MS = 320;
/** 存档截取时的缩放与当前缩放之比在这个范围内才算合用：差太多时照它画会明显变糊或变粗 */
const SNAPSHOT_ZOOM_RANGE = [0.8, 1.3] as const;
/** 两次截图至少隔这么久：节点数据持续在变（生成进度）时不跟着每次变化都截 */
const CAPTURE_MIN_INTERVAL_MS = 600;
/** 连线在贝塞尔控制点外框之外最多伸出这么多（画布单位）：选中时加粗、发光，以及中点的断开按钮 */
const EDGE_PAD = 24;
/** 藏起来的正文与连线层的样式类（storyboard.css） */
const PROXIED_CLASS = 'canvas-node-proxied';
const PROXY_VIEW_CLASS = 'canvas-proxy-view';
/**
 * 节点画在外框之外的部分（浮动标题、端口、缩放手柄）也要存进存档：与绘制隔离层
 * `.canvas-node-paint-frame` 的默认余量一致（画布单位，上右下左）。
 */
export const BODY_PAINT_MARGIN = { top: 36, right: 24, bottom: 28, left: 24 } as const;

function intersect(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

export function createFarLayerBodyProxy(host: BodyProxyHost) {
  const { presence, sceneView, flowElement } = host;
  const proxied = new Set<string>();
  let proxying = false;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 正文淡入盖回来的这段时间里，下面仍要画着存档 */
  let revealTimer: ReturnType<typeof setTimeout> | null = null;
  let captureTimer: ReturnType<typeof setTimeout> | null = null;
  let capturing = false;
  let capturedAt = Number.NEGATIVE_INFINITY;
  /** 有存档被作废就加一：截图等待期间发生过作废，这张截图里可能还是作废前的画面，整张不存 */
  let invalidations = 0;
  let disposed = false;
  let pointerPressed = false;
  /** 指针所在的节点，以及存档里带着悬停样式的那个节点 */
  let hoveredId: string | null = null;
  let hoverBaked: string | null = null;
  /** 指针在屏幕上的位置（没按着键移动时记下；离开画布为 null） */
  let pointerPoint: { x: number; y: number } | null = null;
  /** 代画途中因为来到指针下而换回真正文的节点 */
  const revealed = new Set<string>();
  /** 上次比对过的场景：场景变了就比出变了的区域，作废落在那里的存档 */
  let knownScene: SceneSnapshot | null = null;

  function canvasRect(): ScreenRect | null {
    return sceneView.canvasClientRect();
  }

  /** 节点外框在屏幕上的位置。 */
  function boxRect(node: SceneNode, canvas: ScreenRect, transform: readonly number[]): ScreenRect {
    const [x, y, zoom] = transform;
    return { x: canvas.x + x + node.x * zoom, y: canvas.y + y + node.y * zoom, width: node.width * zoom, height: node.height * zoom };
  }

  /** 节点连同外框之外的绘制余量在屏幕上的位置。 */
  function paintRect(node: SceneNode, canvas: ScreenRect, transform: readonly number[]): ScreenRect {
    const box = boxRect(node, canvas, transform);
    const zoom = transform[2];
    return {
      x: box.x - BODY_PAINT_MARGIN.left * zoom, y: box.y - BODY_PAINT_MARGIN.top * zoom,
      width: box.width + (BODY_PAINT_MARGIN.left + BODY_PAINT_MARGIN.right) * zoom,
      height: box.height + (BODY_PAINT_MARGIN.top + BODY_PAINT_MARGIN.bottom) * zoom,
    };
  }

  /** 屏幕上的一块区域换成按节点外框归一化的范围。 */
  function unitRect(node: SceneNode, part: ScreenRect, canvas: ScreenRect, transform: readonly number[]): UnitRect {
    const box = boxRect(node, canvas, transform);
    return { left: (part.x - box.x) / box.width, top: (part.y - box.y) / box.height, right: (part.x + part.width - box.x) / box.width, bottom: (part.y + part.height - box.y) / box.height };
  }

  /** 正文在页面里的元素：节点外框，以及渲染在视口浮层里的浮动标题。只用来切换显隐，不拿它们做命中或定位。 */
  function bodyElements(): Array<{ id: string; element: HTMLElement }> {
    const found: Array<{ id: string; element: HTMLElement }> = [];
    const container = flowElement.querySelector('.react-flow__nodes');
    if (container) for (const element of Array.from(container.children) as HTMLElement[]) found.push({ id: element.dataset.id ?? '', element });
    flowElement.querySelectorAll<HTMLElement>('.react-flow__viewport-portal [data-node-header-drag-surface]').forEach((surface) => {
      if (surface.parentElement) found.push({ id: surface.dataset.nodeHeaderDragSurface ?? '', element: surface.parentElement });
    });
    return found;
  }

  /** 存档合用：盖得住露出来的部分，截取时的缩放也与现在相近。进入代画、决定要不要重截时用。 */
  function usableSnapshot(node: SceneNode, snapshots: FarLayerSnapshots, canvas: ScreenRect, transform: readonly number[]): boolean {
    if (!coveredBySnapshot(node, snapshots, canvas, transform)) return false;
    const snapshot = snapshots.get(node);
    // 整个在视口外的节点没有存档也算盖得住
    if (!snapshot) return true;
    const relative = snapshot.zoom / transform[2];
    return relative >= SNAPSHOT_ZOOM_RANGE[0] && relative <= SNAPSHOT_ZOOM_RANGE[1];
  }

  /** 这个正文此刻露出来的部分是否都能由存档画出来（缩放途中存档会被放大缩小，这里不看清晰度）。 */
  function coveredBySnapshot(node: SceneNode, snapshots: FarLayerSnapshots, canvas: ScreenRect, transform: readonly number[]): boolean {
    const visible = intersect(paintRect(node, canvas, transform), canvas);
    // 整个在视口外：藏起来没有任何画面损失
    if (!visible) return true;
    return snapshots.covers(node, unitRect(node, visible, canvas, transform));
  }

  function paintReach(node: SceneNode): SceneRect {
    return { x: node.x - BODY_PAINT_MARGIN.left, y: node.y - BODY_PAINT_MARGIN.top, width: node.width + BODY_PAINT_MARGIN.left + BODY_PAINT_MARGIN.right, height: node.height + BODY_PAINT_MARGIN.top + BODY_PAINT_MARGIN.bottom };
  }

  function setProxiedClass(ids: ReadonlySet<string>, on: boolean): void {
    for (const { id, element } of bodyElements()) if (ids.has(id)) element.classList.toggle(PROXIED_CLASS, on);
  }

  /**
   * 代画途中让指针下的正文换回真 DOM：视口在静止的指针下移过节点时，用户随时可能按下去。
   * 远景层铺在 DOM 之下，所以压在它上面的正文也一并换回；指针离开后、存档仍合用时再藏回去。
   */
  function syncPointerReveal(): void {
    if (!proxying) return;
    const scene = sceneView.scene.read();
    const point = pointerPoint ? sceneView.toScenePoint(pointerPoint) : null;
    const hit = point ? scene.hitNode(point) : null;
    const order = new Map<SceneNode, number>();
    const rankOf = (node: SceneNode): number => {
      if (!order.size) scene.nodes.forEach((entry, index) => order.set(entry, index));
      return order.get(node) ?? -1;
    };
    const show = new Set<string>();
    if (hit && (proxied.has(hit.id) || revealed.has(hit.id))) {
      const queue = [hit];
      show.add(hit.id);
      for (let index = 0; index < queue.length; index += 1) {
        const below = queue[index];
        const rank = rankOf(below);
        for (const above of scene.nodesInRect(paintReach(below))) {
          if (show.has(above.id) || !(proxied.has(above.id) || revealed.has(above.id)) || rankOf(above) < rank) continue;
          show.add(above.id);
          queue.push(above);
        }
      }
    }
    const unhide = new Set<string>();
    for (const id of show) if (proxied.delete(id)) { revealed.add(id); unhide.add(id); }
    // 离开指针的换回去：自下而上，只有存档仍合用、压着的正文也都藏着时才藏
    const rehide = new Set<string>();
    const snapshots = host.snapshots();
    const canvas = canvasRect();
    if (snapshots && canvas) {
      const candidates = [...revealed].filter(id => !show.has(id)).map(id => scene.node(id)).filter((node): node is SceneNode => Boolean(node));
      candidates.sort((a, b) => rankOf(a) - rankOf(b));
      const transform = host.getState().transform;
      for (const node of candidates) {
        if (!usableSnapshot(node, snapshots, canvas, transform)) continue;
        const rank = rankOf(node);
        const coveredBelow = scene.nodesInRect(paintReach(node)).every(other => other === node || rankOf(other) > rank || proxied.has(other.id));
        if (!coveredBelow) continue;
        revealed.delete(node.id);
        proxied.add(node.id);
        rehide.add(node.id);
      }
    }
    if (!unhide.size && !rehide.size) return;
    if (unhide.size) setProxiedClass(unhide, false);
    if (rehide.size) setProxiedClass(rehide, true);
    // 全部换回了也不退出代画：视口还在动，下一帧再进出一次代价更大；停稳时照常收尾
    host.invalidate();
  }

  /**
   * 场景变了：比出变了的节点与连线所在的画布区域（变化前后都算），落在那里的存档都作废。
   * 返回有没有变化区域（截图进行中时，有变化就整张不存）。
   */
  function expireChangedRegions(scene: SceneSnapshot, snapshots: FarLayerSnapshots | null): boolean {
    const previous = knownScene;
    knownScene = scene;
    if (!previous || previous === scene || !snapshots || (!snapshots.size && !capturing)) return false;
    const regions: SceneRect[] = [];
    for (const node of scene.nodes) {
      const before = previous.node(node.id);
      if (before === node) continue;
      regions.push(paintReach(node));
      if (before) regions.push(paintReach(before));
    }
    for (const node of previous.nodes) if (!scene.node(node.id)) regions.push(paintReach(node));
    const edgeBounds = (points: readonly number[]): SceneRect => {
      const xs = [points[0], points[2], points[4], points[6]], ys = [points[1], points[3], points[5], points[7]];
      const x = Math.min(...xs) - EDGE_PAD, y = Math.min(...ys) - EDGE_PAD;
      return { x, y, width: Math.max(...xs) + EDGE_PAD - x, height: Math.max(...ys) + EDGE_PAD - y };
    };
    if (previous.edges !== scene.edges) {
      const beforeEdges = new Map(previous.edges.map(edge => [edge.id, edge]));
      for (const edge of scene.edges) {
        const before = beforeEdges.get(edge.id);
        beforeEdges.delete(edge.id);
        if (before && before.selected === edge.selected && before.points.every((value, index) => value === edge.points[index])) continue;
        regions.push(edgeBounds(edge.points));
        if (before) regions.push(edgeBounds(before.points));
      }
      for (const removed of beforeEdges.values()) regions.push(edgeBounds(removed.points));
    }
    snapshots.dropIntersecting(regions);
    return regions.length > 0;
  }

  function enter(): void {
    const snapshots = host.snapshots();
    const state = host.getState();
    const canvas = canvasRect();
    // 正在连线、框选、拖节点（拖到边缘会带着视口走）时不代画：这些操作要看着真正文做
    if (!snapshots || !canvas || state.connection.inProgress || state.userSelectionActive) return;
    const scene = sceneView.scene.read();
    const busy = new Set<string>();
    flowElement.querySelectorAll<HTMLElement>(CANVAS_NODE_BUSY_SELECTOR).forEach((element) => { if (element.dataset.id) busy.add(element.dataset.id); });
    // 正在播放的视频每帧都在变，存档只是其中一帧
    flowElement.querySelectorAll<HTMLVideoElement>('.react-flow__node video').forEach((video) => {
      const id = video.paused ? undefined : video.closest<HTMLElement>('.react-flow__node')?.dataset.id;
      if (id) busy.add(id);
    });
    /** 留着真正文的节点 */
    const kept: SceneNode[] = [];
    for (const id of presence.activeIds()) {
      const node = scene.node(id);
      if (!node) continue;
      if (node.internal.dragging) { proxied.clear(); return; }
      // 指针下的正文带着悬停样式，存档里没有就不藏
      const keep = node.backdrop || busy.has(id) || (id === hoveredId && hoverBaked !== id) || !usableSnapshot(node, snapshots, canvas, state.transform);
      if (keep) kept.push(node); else proxied.add(id);
    }
    // 藏起来的正文改由铺在最下面的远景层画：它压着的正文若还留着，就会反过来盖住它。逐层把这样的也留下
    if (kept.length && proxied.size) {
      const order = new Map<SceneNode, number>();
      scene.nodes.forEach((node, index) => order.set(node, index));
      for (let index = 0; index < kept.length && proxied.size; index += 1) {
        const below = kept[index];
        const rank = order.get(below) ?? -1;
        const reach = { x: below.x - BODY_PAINT_MARGIN.left, y: below.y - BODY_PAINT_MARGIN.top, width: below.width + BODY_PAINT_MARGIN.left + BODY_PAINT_MARGIN.right, height: below.height + BODY_PAINT_MARGIN.top + BODY_PAINT_MARGIN.bottom };
        for (const above of scene.nodesInRect(reach)) {
          if (!proxied.has(above.id) || (order.get(above) ?? -1) < rank) continue;
          proxied.delete(above.id);
          kept.push(above);
        }
      }
    }
    if (!proxied.size) return;
    proxying = true;
    setProxiedClass(proxied, true);
    flowElement.classList.add(PROXY_VIEW_CLASS);
    host.invalidate();
  }

  /** 把藏着的正文盖回来。reveal 为真时淡入（停稳后）；用户已经按下去时直接出现。 */
  function leave(reveal: boolean): void {
    for (const { element } of bodyElements()) {
      if (!element.classList.contains(PROXIED_CLASS)) continue;
      element.classList.remove(PROXIED_CLASS);
      if (reveal && typeof element.animate === 'function') element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: UI_DURATION.fast, easing: 'ease-out' });
    }
    proxied.clear();
    revealed.clear();
    if (!proxying) return;
    proxying = false;
    if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
    flowElement.classList.remove(PROXY_VIEW_CLASS);
    if (revealTimer !== null) { clearTimeout(revealTimer); revealTimer = null; }
    if (reveal) holdSnapshots();
    host.invalidate();
    scheduleCapture(CAPTURE_IDLE_MS);
  }

  function armSettle(): void {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      // 按住画面没松手时还会接着动
      if (host.getState().paneDragging) armSettle(); else leave(true);
    }, SETTLE_MS);
  }

  /** 接下来这一小段时间远景层继续照存档画：正文正在淡入，下面不能先换成简化画面。 */
  function holdSnapshots(): void {
    if (revealTimer !== null) clearTimeout(revealTimer);
    revealTimer = setTimeout(() => { revealTimer = null; host.invalidate(); }, UI_DURATION.fast + 40);
  }

  /** 安排一次截图；到时只有还有正文没有合用的存档才真的截，在同一片区域来回平移不会反复截图。 */
  function scheduleCapture(delay: number): void {
    if (disposed) return;
    if (captureTimer !== null) clearTimeout(captureTimer);
    const wait = Math.max(delay, capturedAt + CAPTURE_MIN_INTERVAL_MS - performance.now());
    captureTimer = setTimeout(() => { captureTimer = null; void capture(); }, wait);
  }

  /**
   * 某个正文的画面变了而节点数据没变（图片加载出来、焦点或悬停离开）：它的存档作废。
   * 正被代画着就整体换回真正文；之后它没有存档，停稳时自然会重截。
   */
  function expire(id: string): void {
    const snapshots = host.snapshots();
    // 正文刚挂上时图片一张张加载出来，那时它还没有存档：只需保证稍后会截
    invalidations += 1;
    if (snapshots?.has(id)) {
      snapshots.drop(id);
      if (proxying && proxied.has(id)) { leave(false); return; }
      host.invalidate();
    }
    if (!proxying) scheduleCapture(CAPTURE_IDLE_MS);
  }

  function nodeIdOf(target: EventTarget | null): string | null {
    return target instanceof Element ? target.closest<HTMLElement>('.react-flow__node')?.dataset.id ?? null : null;
  }

  /** 这块区域有没有被盖在画布上的界面（面板、工具栏、小地图）挡住：挡住的正文截下来是错的。 */
  function occluded(rect: ScreenRect): boolean {
    const inset = Math.min(3, rect.width / 4, rect.height / 4);
    const xs = [rect.x + inset, rect.x + rect.width / 2, rect.x + rect.width - inset];
    const ys = [rect.y + inset, rect.y + rect.height / 2, rect.y + rect.height - inset];
    for (const x of xs) for (const y of ys) if (!sceneView.isCanvasSurfaceAt({ x, y })) return true;
    return false;
  }

  async function capture(): Promise<void> {
    if (disposed || capturing || proxying || !presence.isEnabled() || !presence.isNear() || flowElement.ownerDocument.hidden) return;
    const snapshots = host.snapshots();
    const canvas = canvasRect();
    if (!snapshots || !canvas) return;
    const state = host.getState();
    // 操作途中、正文还在淡入时的画面不是它平时的样子，等结束
    if (revealTimer !== null || pointerPressed || state.paneDragging || state.connection.inProgress || state.userSelectionActive) { scheduleCapture(CAPTURE_IDLE_MS); return; }
    if (canvas.width < 16 || canvas.height < 16) return;
    const transform = state.transform;
    const scene = sceneView.scene.read();
    // 有焦点、展开着浮层的正文带着焦点环、光标、弹层，不是它平时的样子；分组底板不代画
    const busy = new Set<string>();
    flowElement.querySelectorAll<HTMLElement>(CANVAS_NODE_BUSY_SELECTOR).forEach((element) => { if (element.dataset.id) busy.add(element.dataset.id); });
    const items: SceneNode[] = [];
    let needed = false;
    for (const id of presence.activeIds()) {
      const node = scene.node(id);
      if (!node?.sized || node.backdrop || busy.has(id)) continue;
      const visible = intersect(paintRect(node, canvas, transform), canvas);
      if (!visible || visible.width < 4 || visible.height < 4 || occluded(visible)) continue;
      items.push(node);
      needed = needed || !usableSnapshot(node, snapshots, canvas, transform);
    }
    if (!items.length || !needed) return;
    const hoveredAtCapture = hoveredId;
    const invalidationsAtCapture = invalidations;
    capturing = true;
    capturedAt = performance.now();
    let image: ImageBitmap | null = null;
    try {
      const shot = await host.capture(canvas);
      // 解码在后台线程做，不占这里
      image = await createImageBitmap(new Blob([shot.jpeg as BlobPart], { type: 'image/jpeg' }), { colorSpaceConversion: 'none' });
      // 截图期间视口动过或已经开始代画：画面与记下的位置对不上
      if (disposed || proxying || host.getState().transform !== transform || host.snapshots() !== snapshots) return;
      if (invalidations !== invalidationsAtCapture) { scheduleCapture(CAPTURE_IDLE_MS); return; }
      // 截图期间变过的节点（挪了位置、换了内容）同理，这次不存
      const current = sceneView.scene.read();
      const steady = items.filter(node => current.node(node.id) === node);
      // 实际截到的范围由主进程按界面缩放取整后交还：节点位置按它换算成截图里的设备像素
      const region = shot.rect;
      const scaleX = image.width / region.width, scaleY = image.height / region.height;
      const received = performance.now();
      const stored = snapshots.write({
        image, zoom: transform[2],
        margin: BODY_PAINT_MARGIN,
        items: steady.map((node) => {
          const rect = boxRect(node, canvas, transform);
          return { node, x: (rect.x - region.x) * scaleX, y: (rect.y - region.y) * scaleY, width: rect.width * scaleX, height: rect.height * scaleY };
        }),
      });
      logger.debug('正文画面已存档', { context: { nodes: stored, width: image.width, height: image.height, captureMs: Math.round(received - capturedAt), storeMs: Math.round(performance.now() - received) } });
      // 截图那一刻指针下的正文带着悬停样式：指针还在它上面就记下，已经离开则这份存档不能用
      if (hoveredAtCapture !== null && hoveredAtCapture !== hoveredId) snapshots.drop(hoveredAtCapture);
      hoverBaked = hoveredAtCapture !== null && hoveredAtCapture === hoveredId && snapshots.has(hoveredAtCapture) ? hoveredAtCapture : null;
      host.invalidate();
    } catch (error) {
      logger.debug('正文画面截取失败，这次不存档', { error: String(error) });
    } finally {
      capturing = false;
      image?.close();
    }
  }

  /** 正文里的图片、视频封面加载出来了。 */
  const onMediaLoaded = (event: Event) => {
    const id = nodeIdOf(event.target);
    if (id !== null) expire(id);
  };
  const onPointerDown = (event: PointerEvent) => {
    pointerPressed = true;
    // 按在节点或它的浮动标题上就是要操作它：立刻换回真正文（画面与存档一致，看不出切换）
    if (proxying && event.target instanceof Element && event.target.closest('.react-flow__node, .react-flow__viewport-portal')) leave(false);
  };
  const onPointerUp = () => { pointerPressed = false; };
  const onKeyDown = (event: KeyboardEvent) => {
    if (proxying && nodeIdOf(event.target) !== null) leave(false);
  };
  /** 指针换了所在的节点：存档里带着悬停样式的那个，指针一离开画面就不对了。 */
  function setHovered(next: string | null): void {
    if (next === hoveredId) return;
    hoveredId = next;
    if (hoverBaked === null || hoverBaked === next) return;
    const stale = hoverBaked;
    hoverBaked = null;
    expire(stale);
  }
  const onPointerMove = (event: PointerEvent) => {
    if (event.buttons !== 0) return;
    pointerPoint = { x: event.clientX, y: event.clientY };
    setHovered(nodeIdOf(event.target));
    syncPointerReveal();
  };
  const onPointerLeave = () => {
    pointerPoint = null;
    setHovered(null);
    syncPointerReveal();
  };
  /** 焦点离开正文：焦点环、光标没了。 */
  const onFocusOut = (event: FocusEvent) => {
    const id = nodeIdOf(event.target);
    if (id !== null) expire(id);
  };
  flowElement.addEventListener('load', onMediaLoaded, true);
  flowElement.addEventListener('loadeddata', onMediaLoaded, true);
  flowElement.addEventListener('focusout', onFocusOut, { passive: true });
  flowElement.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
  flowElement.addEventListener('keydown', onKeyDown, { passive: true, capture: true });
  flowElement.addEventListener('pointermove', onPointerMove, { passive: true });
  flowElement.addEventListener('pointerleave', onPointerLeave, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true, capture: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true, capture: true });

  return {
    isProxying: () => proxying,
    /** 远景层此刻是否该用存档画节点：代画途中，以及正文淡入的那一小段。 */
    showsSnapshots: () => proxying || revealTimer !== null,

    /** 视口变了（在远景层重画之前调用）。 */
    onViewMoved(): void {
      if (captureTimer !== null) { clearTimeout(captureTimer); captureTimer = null; }
      if (!presence.isEnabled() || !presence.isNear()) { if (proxying) leave(false); return; }
      if (!proxying) enter();
      // 按着画面拖动时指针下一直是被拖着走的画面，不必换回；松手后由停稳把正文盖回
      if (!host.getState().paneDragging) syncPointerReveal();
      // 没能代画（还没有存档、正在操作）：停下来之后要补上存档
      if (proxying) armSettle(); else scheduleCapture(CAPTURE_IDLE_MS);
    },

    /** 节点或连线变了。 */
    onSceneChanged(): void {
      const snapshots = host.snapshots();
      const state = host.getState();
      const scene = sceneView.scene.read();
      // 截图里烘进了经过的连线与相邻节点：连线增删改道、相邻节点变了，落在那里的存档作废
      // （连线也改变两端正文的画面：端口常显、上游缩略图，两端都在连线的外框里）
      if (expireChangedRegions(scene, snapshots)) invalidations += 1;
      if (!proxying) { scheduleCapture(CAPTURE_IDLE_MS); return; }
      // 代画途中有正文的存档作废了（生成完成、被选中）：整体换回真正文
      const canvas = canvasRect();
      if (!snapshots || !canvas) { leave(false); return; }
      for (const id of proxied) {
        const node = scene.node(id);
        if (!node || !coveredBySnapshot(node, snapshots, canvas, state.transform)) { leave(false); return; }
      }
    },

    /** 正文挂上或卸下了。 */
    onPresenceChanged(): void {
      if (!presence.isEnabled() || !presence.isNear()) { if (proxying) leave(false); return; }
      if (!proxying) scheduleCapture(CAPTURE_IDLE_MS);
    },

    /** 存档整体作废（主题变了、绘图上下文重建）。 */
    reset(): void {
      leave(false);
      hoverBaked = null;
      invalidations += 1;
      scheduleCapture(CAPTURE_IDLE_MS);
    },

    dispose(): void {
      leave(false);
      disposed = true;
      if (captureTimer !== null) clearTimeout(captureTimer);
      if (settleTimer !== null) clearTimeout(settleTimer);
      if (revealTimer !== null) clearTimeout(revealTimer);
      flowElement.removeEventListener('load', onMediaLoaded, true);
      flowElement.removeEventListener('loadeddata', onMediaLoaded, true);
      flowElement.removeEventListener('focusout', onFocusOut);
      flowElement.removeEventListener('pointerdown', onPointerDown, { capture: true });
      flowElement.removeEventListener('keydown', onKeyDown, { capture: true });
      flowElement.removeEventListener('pointermove', onPointerMove);
      flowElement.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerUp, { capture: true });
    },
  };
}

export type FarLayerBodyProxy = ReturnType<typeof createFarLayerBodyProxy>;
