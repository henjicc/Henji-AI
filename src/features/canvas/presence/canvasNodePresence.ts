import type { ReactFlowState } from '@xyflow/react';
import type { CanvasScene } from '@/features/canvas/scene/canvasScene';

/**
 * 画布节点的按需挂载调度。
 *
 * 大画布上绝大多数节点不挂任何 DOM，画面由远景层（farLayer）常驻绘制；这里决定哪些节点交给
 * ReactFlow 渲染，并把名单写进它的 store（`henjiRenderedNodeIds` / `henjiRenderedEdgeIds`，
 * 由 patches/ 里的 ReactFlow 补丁读取）。被渲染的节点有两种形态：
 * - 正文：视口附近且缩放够大的节点，按每帧时间预算分批挂上、分批卸下；
 * - 壳：只有一个同尺寸的空块。指针停在哪个没挂正文的节点上，哪个节点就是壳，于是点选、拖动、
 *   右键仍由 ReactFlow 原生处理，而同一时刻最多只多出一个空外框。
 * 连线只有两端都挂着正文时才交给 ReactFlow，其余由远景层画。
 *
 * 没量过尺寸的节点（刚新建）不受缩放与数量上限限制，最先挂载一次以取得真实尺寸与端口位置；
 * 量到之前远景层按类型估值画它。
 *
 * 节点的位置、尺寸与“视口附近有谁”一律读画布场景（scene/），不遍历也不量节点元素。
 */

type PresenceState = Pick<ReactFlowState, 'nodes' | 'nodeLookup' | 'edges' | 'transform' | 'width' | 'height' | 'domNode' | 'paneDragging'>;
/** 交给 ReactFlow 的渲染名单；null 表示不干预（全部渲染）。 */
export interface CanvasRenderedIds {
  henjiRenderedNodeIds: string[] | null;
  henjiRenderedEdgeIds: string[] | null;
}
export interface CanvasNodePresenceSource {
  scene: CanvasScene;
  getState(): PresenceState;
  subscribe(listener: () => void): () => void;
  /** 写入渲染名单并通知 ReactFlow 重新渲染节点层。 */
  setState(partial: CanvasRenderedIds): void;
  /** 写入渲染名单但不发通知：只在画布外壳首次渲染、节点层还没挂载时用。 */
  seed(partial: CanvasRenderedIds): void;
}

export interface CanvasNodePresenceOptions {
  /** 正文开始挂载的缩放；低于它全部交给远景层。 */
  getZoomThreshold(): number;
  /** 节点数不超过它时不做按需挂载；默认 ALWAYS_MOUNTED_NODE_LIMIT。 */
  alwaysMountedLimit?: number;
  /** 同步提交一批变更并返回；默认直接执行（测试用），画布里传 flushSync，这样才能量出挂载花了多久。 */
  commit?(apply: () => void): void;
  now?(): number;
  requestFrame?(callback: () => void): number;
  cancelFrame?(handle: number): void;
}

/** 同时挂载正文的节点上限：超过的部分留给远景层，保证 DOM 规模有界。 */
export const MAX_ACTIVE_CANVAS_NODES = 360;
/**
 * 节点数不超过它的画布不做按需挂载，全部节点照常常驻真 DOM：这个规模下常驻挂载本来就流畅，
 * 也就不必承担正文卸载带来的代价（组件内还没写回节点数据的编辑状态随卸载丢失）。
 * 超过之后才启用；回落到它的八成以下才退出，免得在边界上来回切换。
 */
export const ALWAYS_MOUNTED_NODE_LIMIT = 300;
/** 选中着的正文不卸：用户多半正在用它（画遮罩、调视角），这类状态存在组件里。只保这么多个，框选几千个节点不算。 */
const MAX_RETAINED_SELECTED = 24;
/** 视口向外扩多少（占视口边长的比例）开始预挂载，离开多远才卸载。 */
const ACTIVATE_MARGIN = 0.3;
const RELEASE_MARGIN = 0.7;
/** 缩放回落到阈值的这个比例以下才整体退出近景，避免在阈值附近来回挂卸。 */
const FAR_HYSTERESIS = 0.85;
/**
 * 视口在动（平移或缩放）时不挂也不卸正文：挂一个节点连同布局、绘制要十几毫秒，放在运动途中就是掉帧，
 * 而这时画面本来就由远景层画着。停稳这么久之后再按每帧时间预算补挂。
 */
const SETTLE_MS = 110;
/** 帧很慢时两次视口变化之间本来就可能隔过上面的时长，所以还要连续这么多帧没动才算停稳。 */
const SETTLE_FRAMES = 3;
const MOUNT_BUDGET_MS = 8;
/** 退出近景后正文再留这么久才开始卸载：节点层先整体淡出，露出下面的远景画面。 */
const FAR_RELEASE_DELAY_MS = 140;
/** 排队先后（数值越小越先挂）：视口附近的节点在 0 到 2 之间，其后是视口内连线的另一端。 */
const NEIGHBOR_PRIORITY = 3;
/** 正文里有焦点或展开着浮层的节点：不能在用户操作途中卸掉。 */
const BUSY_SELECTOR = '.react-flow__node:focus-within, .react-flow__node:has([aria-expanded="true"])';

export type CanvasNodeBodyMode = 'off' | 'shell' | 'body';

export function createCanvasNodePresence(source: CanvasNodePresenceSource, options: CanvasNodePresenceOptions) {
  const commit = options.commit ?? (apply => apply());
  const mountedLimit = options.alwaysMountedLimit ?? ALWAYS_MOUNTED_NODE_LIMIT;
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestFrame ?? (callback => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? (handle => cancelAnimationFrame(handle));

  /** 按节点订阅形态变化（壳与正文之间切换时，外框不变、里面的内容要换）。 */
  const listeners = new Map<string, Set<() => void>>();
  const stateListeners = new Set<() => void>();
  const active = new Set<string>();
  /** 被点名必须挂着的节点（如正在接收导入文件）及其到期时间。 */
  const pinned = new Map<string, number>();
  let shellId: string | null = null;
  /** 远景层可用（外壳已开启调度且没有被退路关掉） */
  let available = false;
  /** 按需挂载正在生效：远景层可用，且节点数超过了常驻挂载的规模 */
  let enabled = false;
  let near = false;
  let frame: number | null = null;
  let stopSource: (() => void) | undefined;
  let previousTransform: readonly number[] | undefined;
  let publishedEdges: PresenceState['edges'] | undefined;
  /** 上次交出的名单里有节点还没进 ReactFlow（刚被点名的新节点）：它一出现就要补发名单 */
  let publishedIncomplete = false;
  const pinTimers = new Set<ReturnType<typeof setTimeout>>();
  let plannedNodes: PresenceState['nodes'] | undefined;
  let lastMoveAt = Number.NEGATIVE_INFINITY;
  let framesSinceMove = SETTLE_FRAMES;
  let farSince = Number.NEGATIVE_INFINITY;

  function renderedIds(state: PresenceState): CanvasRenderedIds {
    // 沿用节点原有的先后顺序：同层级的节点谁压着谁不因挂载先后而变
    const nodeIds: string[] = [];
    let found = 0;
    for (const id of state.nodeLookup.keys()) {
      if (active.has(id)) found += 1; else if (id !== shellId) continue;
      nodeIds.push(id);
    }
    publishedIncomplete = found < active.size;
    const edgeIds: string[] = [];
    for (const edge of state.edges) if (active.has(edge.source) && active.has(edge.target)) edgeIds.push(edge.id);
    return { henjiRenderedNodeIds: nodeIds, henjiRenderedEdgeIds: edgeIds };
  }

  /** 把当前名单交给 ReactFlow，并通知形态变了的节点。 */
  function publish(changed: Iterable<string>): void {
    commit(() => {
      const state = source.getState();
      publishedEdges = state.edges;
      source.setState(renderedIds(state));
      for (const id of changed) listeners.get(id)?.forEach(listener => listener());
    });
  }

  function notifyState(): void {
    stateListeners.forEach(listener => listener());
  }

  function schedule(): void {
    if (!enabled || frame !== null) return;
    frame = requestFrame(() => { frame = null; reconcile(); });
  }

  /** 正文正被用户操作着的节点（有焦点、展开着浮层）。只在有正文挂着时才查。 */
  function busyNodeIds(state: PresenceState): string[] {
    if (!active.size || !state.domNode) return [];
    const ids: string[] = [];
    state.domNode.querySelectorAll<HTMLElement>(BUSY_SELECTOR).forEach((element) => { if (element.dataset.id) ids.push(element.dataset.id); });
    return ids;
  }

  /** 应当挂载的节点（必须挂的、等着量尺寸的、视口附近由近到远的），以及允许继续保留的范围。 */
  function plan(state: PresenceState, timestamp: number, moving: boolean) {
    const snapshot = source.scene.read();
    const [x, y, zoom] = state.transform;
    const threshold = options.getZoomThreshold();
    const wasNear = near;
    near = near ? zoom >= threshold * FAR_HYSTERESIS : zoom >= threshold;
    if (wasNear && !near) {
      farSince = timestamp;
      // 退到远景后正文不可见：输入焦点留在里面只会让看不见的输入框继续收键盘
      const focused = state.domNode?.ownerDocument.activeElement as HTMLElement | null | undefined;
      if (focused?.closest('.react-flow__node')) focused.blur();
    }
    const centerX = (state.width / 2 - x) / zoom;
    const centerY = (state.height / 2 - y) / zoom;
    const halfWidth = state.width / zoom / 2;
    const halfHeight = state.height / zoom / 2;

    for (const [id, until] of pinned) if (until <= timestamp) pinned.delete(id);
    const forced = new Set(pinned.keys());
    // 正在输入、展开着浮层、正在拖动的正文不能中途卸掉。视口在动时本来就不卸正文，不必每帧去查
    if (near && !moving) for (const id of busyNodeIds(state)) forced.add(id);
    let retainedSelected = 0;
    for (const id of active) {
      const node = state.nodeLookup.get(id);
      if (node?.dragging || (node?.selected && retainedSelected++ < MAX_RETAINED_SELECTED)) forced.add(id);
    }

    const unsized: string[] = [];
    for (const node of snapshot.unsized) if (!forced.has(node.id)) unsized.push(node.id);

    const wanted: Array<{ id: string; distance: number }> = [];
    const retainable = new Set(forced);
    const wantedIds = new Set(forced);
    for (const id of unsized) wantedIds.add(id);
    if (near) {
      const inView = new Set<string>();
      const reach = 1 + RELEASE_MARGIN;
      const candidates = snapshot.nodesInRect({ x: centerX - halfWidth * reach, y: centerY - halfHeight * reach, width: halfWidth * reach * 2, height: halfHeight * reach * 2 });
      for (const node of candidates) {
        if (!node.sized || forced.has(node.id)) continue;
        const dx = Math.max(0, Math.abs(node.x + node.width / 2 - centerX) - node.width / 2);
        const dy = Math.max(0, Math.abs(node.y + node.height / 2 - centerY) - node.height / 2);
        // 归一到“几个视口半径”，横纵取大者：1 以内就是与视口相交
        const distance = Math.max(dx / halfWidth, dy / halfHeight);
        if (distance <= 1) inView.add(node.id);
        if (distance <= reach) retainable.add(node.id);
        if (distance <= 1 + ACTIVATE_MARGIN) { wanted.push({ id: node.id, distance }); wantedIds.add(node.id); }
      }
      // 视口里节点的连线另一端也挂上（排在视口附近的节点之后）：两端都有真实端口，这条线才能由 ReactFlow 画出来、
      // 才点得中、删得掉；另一端在屏幕外，挂上后由布局暂停机制收起，不参与绘制。
      if (inView.size) {
        for (const edge of state.edges) {
          const other = inView.has(edge.source) ? edge.target : inView.has(edge.target) ? edge.source : null;
          if (other === null || wantedIds.has(other) || !snapshot.node(other)) continue;
          wantedIds.add(other);
          retainable.add(other);
          wanted.push({ id: other, distance: NEIGHBOR_PRIORITY });
        }
      }
    }
    wanted.sort((a, b) => a.distance - b.distance);
    const limit = Math.max(0, MAX_ACTIVE_CANVAS_NODES - forced.size);
    // 等着量尺寸的节点排在最前且不占上限：量到就让位，不会被视口附近已挂满的节点挡在门外
    const desired = [...forced, ...unsized, ...wanted.slice(0, limit).map(entry => entry.id)];
    return { desired, retainable, unsizedCount: unsized.length };
  }

  function reconcile(): void {
    if (!enabled) return;
    const started = now();
    const state = source.getState();
    if (!state.width || !state.height) { schedule(); return; }
    // 远景里什么都没挂、节点也没变：视口怎么动都无事可做，不必每帧把全部节点过一遍
    if (!near && active.size === 0 && pinned.size === 0 && state.nodes === plannedNodes
      && state.transform[2] < options.getZoomThreshold()) return;
    const previousNodes = plannedNodes;
    plannedNodes = state.nodes;
    const wasNear = near;
    framesSinceMove += 1;
    // 按住拖动画面期间一律算在动：帧很慢时两次位移之间会隔过停稳时长，那时挂正文只会让它更慢
    const moving = state.paneDragging || started - lastMoveAt < SETTLE_MS || framesSinceMove < SETTLE_FRAMES;
    const { desired, retainable, unsizedCount } = plan(state, started, moving);
    const fadingOut = !near && started - farSince < FAR_RELEASE_DELAY_MS;
    const desiredSet = new Set(desired);
    const budget = MOUNT_BUDGET_MS;

    // 先卸载：正文离开后远景层的画面本来就在下面，卸载比挂载便宜得多
    const release: string[] = [];
    let overflow = active.size - MAX_ACTIVE_CANVAS_NODES - unsizedCount;
    for (const id of active) {
      if (desiredSet.has(id)) continue;
      // 仍在保留范围内的不急着卸，除非已经超出上限
      // 视口在动时一律不卸（哪些正文正被操作着也是停稳后才查的）
      if (state.nodeLookup.has(id) && (moving || ((fadingOut || retainable.has(id)) && overflow <= 0))) continue;
      release.push(id);
      overflow -= 1;
    }
    let pending = false;
    let changed = false;
    for (let index = 0; index < release.length;) {
      const batch = release.slice(index, index + 24);
      batch.forEach(id => active.delete(id));
      publish(batch);
      changed = true;
      index += batch.length;
      if (index < release.length && now() - started >= budget) { pending = true; break; }
    }

    const admit = desired.filter(id => !active.has(id));
    if (moving && (admit.length || active.size)) pending = true;
    for (let index = 0; index < admit.length && !moving;) {
      // 每帧至少挂一个，其后按时间预算决定
      if (index > 0 && now() - started >= budget) { pending = true; break; }
      const batch = admit.slice(index, index + 1);
      batch.forEach(id => active.add(id));
      if (shellId !== null && active.has(shellId)) shellId = null;
      publish(batch);
      changed = true;
      index += batch.length;
    }
    // 新连上的线两端若都挂着正文、被点名的新节点进了 ReactFlow，都要补进名单
    if (!changed && (state.edges !== publishedEdges || (publishedIncomplete && state.nodes !== previousNodes))) publish([]);
    if (changed || wasNear !== near) notifyState();
    if (pending || fadingOut) schedule();
  }

  /** 清掉按需挂载的全部状态（名单另行交还）。 */
  function clearManaged(): void {
    near = false; shellId = null; publishedEdges = undefined; plannedNodes = undefined; publishedIncomplete = false;
    active.clear(); pinned.clear();
    if (frame !== null) cancelFrame(frame);
    frame = null;
  }

  /**
   * 按节点数决定按需挂载是否生效。在 store 变更通知里同步调用：节点刚灌进来、节点层还没渲染时
   * 就要把名单置空，否则几千个节点会先全部挂上一遍。
   */
  function evaluate(): void {
    const count = source.getState().nodeLookup.size;
    const large = count > (enabled ? mountedLimit * 0.8 : mountedLimit);
    const next = available && large;
    if (next === enabled) return;
    enabled = next;
    if (next) {
      // 从常驻挂载切过来时，用户正在用的正文不能被这次切换打断：节点数还在上限以内就把已有节点全部留在名单里，
      // 之后由调度按规则逐步卸；一次多出很多（整份画布灌进来、批量粘贴）时只留正在操作、拖动和选中的。
      const state = source.getState();
      if (count <= MAX_ACTIVE_CANVAS_NODES) {
        for (const id of state.nodeLookup.keys()) active.add(id);
      } else {
        state.domNode?.querySelectorAll<HTMLElement>(BUSY_SELECTOR).forEach((element) => { if (element.dataset.id) active.add(element.dataset.id); });
        for (const node of state.nodeLookup.values()) {
          if (active.size >= MAX_RETAINED_SELECTED) break;
          if (node.dragging || node.selected) active.add(node.id);
        }
      }
      // 切换前的缩放不算数，按当前缩放重新判断远近
      near = source.getState().transform[2] >= options.getZoomThreshold();
      source.setState(renderedIds(source.getState()));
      schedule();
    } else {
      clearManaged();
      source.setState({ henjiRenderedNodeIds: null, henjiRenderedEdgeIds: null });
    }
    for (const set of listeners.values()) set.forEach(listener => listener());
    notifyState();
  }

  function start(): void {
    if (stopSource) return;
    // 订阅着场景，它才会在内容没变时沿用上一次的结果，不必每次调度都重建
    const stopScene = source.scene.subscribe(schedule);
    let knownLookupSize = -1;
    const stopStore = source.subscribe(() => {
      const size = source.getState().nodeLookup.size;
      if (size !== knownLookupSize) { knownLookupSize = size; evaluate(); }
      const transform = source.getState().transform;
      if (transform !== previousTransform) {
        previousTransform = transform;
        lastMoveAt = now();
        framesSinceMove = 0;
      }
      schedule();
    });
    stopSource = () => { stopStore(); stopScene(); };
    schedule();
  }

  function stop(): void {
    stopSource?.(); stopSource = undefined;
    if (frame !== null) cancelFrame(frame);
    frame = null;
    pinTimers.forEach(timer => clearTimeout(timer));
    pinTimers.clear();
  }

  function reset(): void {
    available = false; enabled = false;
    clearManaged();
  }

  return {
    /** 按需挂载是否生效；未生效时全部节点照常渲染（小画布，或远景层不可用时的退路）。 */
    isEnabled: () => enabled,
    /** 远景层能不能用由它自己报告：不能用时退回全部节点常驻挂载。 */
    setEnabled(next: boolean): void {
      if (available === next) return;
      available = next;
      if (next) start();
      commit(evaluate);
    },
    /**
     * 画布外壳渲染时开启调度：大画布在节点层首次渲染之前就把名单置空（不发通知），一开始就不挂任何节点。
     * 此时节点还没灌进来的话，灌进来的那次变更通知里再决定。
     */
    arm(): void {
      if (available) return;
      available = true;
      if (source.getState().nodeLookup.size > mountedLimit) {
        enabled = true;
        source.seed({ henjiRenderedNodeIds: [], henjiRenderedEdgeIds: [] });
      }
      start();
    },
    /** 画布外壳卸载时停掉调度并交还渲染名单。 */
    disarm(): void {
      stop(); reset();
      source.seed({ henjiRenderedNodeIds: null, henjiRenderedEdgeIds: null });
    },
    isActive: (id: string) => !enabled || active.has(id),
    /** 这个节点的正文此刻看得见、点得到（远景里留着的正文既不可见也不接收指针）。 */
    isBodyInteractive: (id: string) => !enabled || (near && active.has(id)),
    modeOf: (id: string): CanvasNodeBodyMode => (!enabled || active.has(id) ? 'body' : id === shellId ? 'shell' : 'off'),
    /** 指针所在的节点设为壳（null 表示指针不在任何未挂正文的节点上）。 */
    setShell(id: string | null): void {
      if (!enabled || id === shellId || (id !== null && active.has(id))) return;
      const previous = shellId;
      shellId = id;
      publish([previous, id].filter((value): value is string => value !== null));
    },
    isNear: () => near,
    activeCount: () => active.size,
    subscribe(id: string, listener: () => void): () => void {
      let set = listeners.get(id);
      if (!set) { set = new Set(); listeners.set(id, set); }
      set.add(listener);
      return () => {
        const current = listeners.get(id);
        if (!current?.delete(listener)) return;
        if (current.size === 0) listeners.delete(id);
      };
    },
    /** 挂载集合或近景状态变化时通知（远景层据此重画）。 */
    subscribeState(listener: () => void): () => void {
      stateListeners.add(listener);
      return () => { stateListeners.delete(listener); };
    },
    /** 立刻挂上某个节点的正文并保持一段时间：给必须由节点组件接住的操作（导入文件、重新上传）用。 */
    pin(id: string, durationMs: number): void {
      if (!enabled) return;
      pinned.set(id, now() + durationMs);
      if (!active.has(id)) {
        active.add(id);
        if (shellId === id) shellId = null;
        publish([id]);
        notifyState();
      }
      // 到期后要有一次调度把它放掉；期间不必每帧空转
      const timer = setTimeout(() => { pinTimers.delete(timer); schedule(); }, durationMs + 20);
      pinTimers.add(timer);
      schedule();
    },
  };
}

export type CanvasNodePresence = ReturnType<typeof createCanvasNodePresence>;
