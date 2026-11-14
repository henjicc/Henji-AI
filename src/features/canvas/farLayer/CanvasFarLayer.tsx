import { useEffect, useRef } from 'react';
import { useStoreApi } from '@xyflow/react';
import { createLogger } from '@/core/logging';
import { getPlatform } from '@/platform';
import type { CanvasEdge, CanvasNode } from '@/features/canvas/domain/canvasNodes';
import { useCanvasNodePresence } from '@/features/canvas/presence/useCanvasNodePresence';
import { useCanvasSceneView } from '@/features/canvas/scene/useCanvasScene';
import type { SceneEdge, SceneSnapshot } from '@/features/canvas/scene/canvasScene';
import { createFarLayerBodyProxy } from './farLayerBodyProxy';
import { createFarLayerRenderer, type FarLayerColors, type FarLayerRenderer } from './farLayerRenderer';
import { createFarLayerSnapshots, type FarLayerSnapshots } from './farLayerSnapshots';
import { createFarLayerTiles, type FarLayerTiles } from './farLayerTiles';

const logger = createLogger('features.canvas.farLayer');

/** 画面排队与加载的推进间隔：缩略图陆续回来、视口连续移动时，这么久统一处理一次 */
const TILE_REFRESH_INTERVAL_MS = 90;
/** 绘图上下文丢失后等它自行恢复的时长；过了还没恢复才退回全部节点挂真 DOM */
const CONTEXT_RESTORE_WAIT_MS = 3000;
/** 画面停下这么久之后，才重新判断指针下是哪个节点 */
const SHELL_SETTLE_MS = 130;

function readTriplet(style: CSSStyleDeclaration, name: string): [number, number, number] {
  const parts = style.getPropertyValue(name).trim().split(/[\s,]+/).map(Number);
  return [(parts[0] ?? 0) / 255, (parts[1] ?? 0) / 255, (parts[2] ?? 0) / 255];
}

function readTheme(element: HTMLElement): { colors: FarLayerColors; palette: { panel: string; text: string; subtle: string; fontFamily: string } } {
  const style = getComputedStyle(element);
  const css = (name: string) => `rgb(${style.getPropertyValue(name).trim()})`;
  // 圆角是带 var() 与 calc() 的令牌，借一个临时元素让浏览器算出像素值
  const probe = element.ownerDocument.createElement('div');
  probe.style.borderRadius = 'var(--node-radius)';
  element.parentElement?.appendChild(probe);
  const radius = Number.parseFloat(getComputedStyle(probe).borderTopLeftRadius) || 0;
  probe.remove();
  const subtle = readTriplet(style, '--text3-rgb');
  return {
    colors: {
      panel: readTriplet(style, '--panel-rgb'), border: subtle, edge: subtle,
      accent: readTriplet(style, '--accent-rgb'), danger: readTriplet(style, '--danger-rgb'),
      group: readTriplet(style, '--hover-rgb'), radius,
    },
    palette: { panel: css('--panel-rgb'), text: css('--text1-rgb'), subtle: css('--text3-rgb'), fontFamily: style.fontFamily || 'sans-serif' },
  };
}

/**
 * 画布远景层：铺在节点下面的一块画布，每一帧把画布场景里的所有节点和连线都画出来。
 * 节点正文（真 DOM）只在近景挂载并盖在它上面；正文没挂上、缩放太小或者正在加载时，看到的就是这一层，
 * 所以不管怎么快速缩放，节点都一直在。近景里视口运动时，挂着的正文也藏起来由这一层照存档代画（farLayerBodyProxy）。
 */
export function CanvasFarLayer(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const store = useStoreApi<CanvasNode, CanvasEdge>();
  const presence = useCanvasNodePresence();
  const sceneView = useCanvasSceneView();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const scene = sceneView.scene;
    let renderer: FarLayerRenderer | null = null;
    let tiles: FarLayerTiles | null = null;
    let snapshots: FarLayerSnapshots | null = null;
    let gl: WebGL2RenderingContext | null = null;
    let snapshot: SceneSnapshot = scene.read();
    let theme = readTheme(canvas);
    let frame: number | null = null;
    let sceneDirty = true;
    let tilesDirty = true;
    /** 实例缓冲要重填：场景变了、画面写进或挪出了图集、连线换了由谁画 */
    let instancesDirty = true;
    let viewMovedAt = 0;
    let tilesUpdatedAt = 0;
    let wasFading = false;
    let shellTimer: ReturnType<typeof setTimeout> | null = null;
    let previousTransform = store.getState().transform;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    /** 画布元素的 CSS 尺寸：只在尺寸变化时读，视口每动一帧都要用，不能每次去问布局 */
    let size = { width: 1, height: 1 };
    /** 指针最后所在的屏幕位置：画面自己动了之后据此重新判断指针下是谁 */
    let pointer: { x: number; y: number } | null = null;
    let pointerPressed = false;
    /** 这次按下刚现场补出空外框的节点：紧随其后的鼠标按下事件要转交给它 */
    let redirectedTo: string | null = null;
    /** 按着框选键按在没挂正文的节点上：原地松开（没拉开框）时切换它的选中 */
    let multiSelectPress: string | null = null;
    const seconds = () => performance.now() / 1000;

    function view() {
      const [x, y, zoom] = store.getState().transform;
      return { x, y, zoom, width: size.width, height: size.height, dpr: window.devicePixelRatio || 1 };
    }

    function resize(): void {
      const dpr = window.devicePixelRatio || 1;
      size = { width: Math.max(1, canvas!.clientWidth), height: Math.max(1, canvas!.clientHeight) };
      const width = Math.max(1, Math.round(size.width * dpr));
      const height = Math.max(1, Math.round(size.height * dpr));
      if (canvas!.width !== width || canvas!.height !== height) { canvas!.width = width; canvas!.height = height; }
    }

    /**
     * 指针停在哪个没挂正文的节点上，就让它出一个空外框接住点选、拖动与右键。
     * top 是指针下最上面的元素。
     */
    function updateShell(top: Element | null, client: { x: number; y: number }): void {
      const element = top?.closest<HTMLElement>('.react-flow__node');
      if (element) {
        // 指针已经在某个节点元素上：是当前的壳就保持；是挂着正文的节点，它自己接得住，壳撤掉
        if (presence.modeOf(element.dataset.id ?? '') !== 'shell') presence.setShell(null);
        return;
      }
      // 指针在盖住画布的界面（工具栏、小地图）上时，下面的节点不该有反应
      const onCanvas = Boolean(top?.closest('.react-flow__renderer')) && !top?.closest('.react-flow__node-toolbar');
      const point = onCanvas ? sceneView.toScenePoint(client) : null;
      const hit = point ? scene.read().hitNode(point) : null;
      presence.setShell(hit && !presence.isActive(hit.id) ? hit.id : null);
    }

    /**
     * 指针没动、画面自己变了（缩放、正文卸掉、节点移动）：指针下可能换了节点，壳要跟上，否则下一次按下会落空。
     * 等画面停稳再判：运动途中节点从指针下一个个经过，逐个换壳就是在运动途中挂卸节点元素。
     */
    function refreshShellSoon(): void {
      if (shellTimer !== null) clearTimeout(shellTimer);
      shellTimer = setTimeout(() => {
        shellTimer = null;
        if (disposed || !pointer || pointerPressed || !presence.isEnabled()) return;
        updateShell(canvas!.ownerDocument.elementFromPoint(pointer.x, pointer.y), pointer);
      }, SHELL_SETTLE_MS);
    }

    /** 近景时两端都挂着正文、端口也量过的连线由节点层画，这里不重复画；代画途中节点层的连线藏着，全部由这里画。 */
    function drawnByNodeLayer(edge: SceneEdge): boolean {
      return presence.isNear() && !proxy.isProxying() && edge.anchored && presence.isActive(edge.source) && presence.isActive(edge.target);
    }

    function draw(): boolean {
      // 按需挂载没生效（小画布）时全部节点都挂着真 DOM，这一层不画
      if (!renderer || !tiles || !snapshots || !presence.isEnabled()) return false;
      // 图集里的格子可能刚被别的节点占用：先让实例指向最新的格子，再画
      if (instancesDirty) {
        instancesDirty = false;
        renderer.setNodes(snapshot.nodes, tiles, snapshots);
        renderer.setEdges(snapshot.edges, drawnByNodeLayer);
      }
      return renderer.draw(view(), theme.colors, tiles, snapshots, proxy.showsSnapshots(), seconds());
    }

    function schedule(): void {
      if (disposed || frame !== null) return;
      frame = requestAnimationFrame(runFrame);
    }

    function runFrame(): void {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (disposed) return;
      // 按需挂载没生效时这一层不画，也不必准备画面；生效的那一刻会带着脏标记重新进来。
      // 显隐在每次进来时按当前状态定，不依赖收到过哪一次通知
      canvas!.hidden = !presence.isEnabled();
      if (!renderer || !tiles || !presence.isEnabled()) return;
      if (sceneDirty) {
        sceneDirty = false;
        snapshot = scene.read();
        instancesDirty = true;
        tilesDirty = true;
      }
      // 画面的排队与加载不必每帧推进：缩略图一张张回来、视口连续移动时，隔一小段时间统一处理一次
      const stamp = performance.now();
      const tilesWaiting = tilesDirty || viewMovedAt > tilesUpdatedAt;
      if (tilesWaiting && (tilesUpdatedAt === 0 || stamp - tilesUpdatedAt >= TILE_REFRESH_INTERVAL_MS)) {
        tilesDirty = false;
        tilesUpdatedAt = stamp;
        const current = view();
        const tilesBefore = tiles.revision;
        const more = tiles.update(snapshot.nodes, {
          left: -current.x / current.zoom, top: -current.y / current.zoom,
          right: (current.width - current.x) / current.zoom, bottom: (current.height - current.y) / current.zoom,
          devicePixelsPerUnit: current.zoom * current.dpr,
        });
        if (more) tilesDirty = true;
        // 视口连续移动时这里隔一小段就进来一次：画面没变就不必把全部节点的实例重填一遍
        if (tiles.revision !== tilesBefore) instancesDirty = true;
      }
      const fading = instancesDirty || wasFading ? draw() : false;
      wasFading = fading;
      if (fading || tilesDirty || viewMovedAt > tilesUpdatedAt) schedule();
    }

    function start(): void {
      gl = canvas!.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('当前环境不支持 WebGL2');
      renderer = createFarLayerRenderer(gl);
      tiles = createFarLayerTiles(gl, {
        nodeCapacity: Math.max(1024, Math.ceil(store.getState().nodeLookup.size * 1.5)),
        onChange: () => { tilesDirty = true; instancesDirty = true; schedule(); },
        now: seconds,
      });
      tiles.setPalette(theme.palette);
      snapshots = createFarLayerSnapshots(gl);
      sceneDirty = true; tilesDirty = true; instancesDirty = true; tilesUpdatedAt = 0;
      resize();
      schedule();
    }

    function stop(): void {
      renderer?.dispose(); tiles?.dispose(); snapshots?.dispose();
      renderer = null; tiles = null; snapshots = null;
      proxy.reset();
    }

    /** 远景层画不了时退回全部节点常驻挂真 DOM；放到微任务里，避开 React 提交阶段。 */
    function fallBack(reason: unknown): void {
      logger.warn('画布远景层不可用，改为全部节点常驻挂载', { event: 'canvas.far_layer.unavailable', error: reason });
      queueMicrotask(() => { if (!disposed) presence.setEnabled(false); });
    }

    const flowElement = canvas.closest<HTMLElement>('.react-flow');
    const proxy = createFarLayerBodyProxy({
      getState: store.getState, presence, sceneView,
      flowElement: flowElement ?? canvas,
      snapshots: () => snapshots,
      capture: rect => getPlatform().media.captureWindowRegion(rect),
      invalidate: () => { instancesDirty = true; runFrame(); },
    });

    try { start(); } catch (error) { stop(); fallBack(error); }

    const onContextLost = (event: Event) => {
      event.preventDefault();
      stop();
      // 上下文丢失多半很快自行恢复；立刻退回会把所有节点一次挂上真 DOM，大画布上等于卡死
      restoreTimer ??= setTimeout(() => { restoreTimer = null; fallBack('context lost'); }, CONTEXT_RESTORE_WAIT_MS);
    };
    const onContextRestored = () => {
      if (restoreTimer !== null) { clearTimeout(restoreTimer); restoreTimer = null; }
      try { start(); queueMicrotask(() => { if (!disposed) presence.setEnabled(true); }); } catch (error) { stop(); fallBack(error); }
    };
    canvas.addEventListener('webglcontextlost', onContextLost);
    canvas.addEventListener('webglcontextrestored', onContextRestored);

    const stopStore = store.subscribe((state) => {
      if (state.transform === previousTransform) return;
      previousTransform = state.transform;
      viewMovedAt = performance.now();
      refreshShellSoon();
      proxy.onViewMoved();
      // 与节点层的视口变换同一帧落屏：视口变了立刻用现有实例重画，不等下一帧
      draw();
      schedule();
    });
    const stopScene = scene.subscribe(() => { sceneDirty = true; refreshShellSoon(); proxy.onSceneChanged(); schedule(); });
    // 正文挂上或卸下时连线换了由谁画：与节点层的这次变更同一帧重画，连线不空一帧
    const stopPresence = presence.subscribeState(() => {
      instancesDirty = true;
      refreshShellSoon();
      proxy.onPresenceChanged();
      runFrame();
    });
    const onResize = () => { resize(); draw(); };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvas);
    // 窗口挪到另一块屏幕时设备像素比会变而元素尺寸不变
    window.addEventListener('resize', onResize);
    const themeObserver = new MutationObserver(() => {
      theme = readTheme(canvas);
      tiles?.setPalette(theme.palette);
      // 主题变了，存着的正文画面全部过时
      snapshots?.clear();
      proxy.reset();
      tilesDirty = true; instancesDirty = true;
      schedule();
    });
    themeObserver.observe(canvas.ownerDocument.documentElement, { attributes: true, attributeFilter: ['style', 'class', 'data-theme'] });

    const onPointerMove = (event: PointerEvent) => {
      // 按着键移动是拖动或框选途中，不换目标
      pointerPressed = event.buttons !== 0;
      if (pointerPressed || !(event.target instanceof Element) || !presence.isEnabled()) return;
      pointer = { x: event.clientX, y: event.clientY };
      updateShell(event.target, pointer);
    };
    // 松开之后画面已经停在新位置（平移、拖动节点刚结束），指针下可能换了节点
    const onPointerUp = (event: PointerEvent) => {
      pointerPressed = false;
      const press = multiSelectPress;
      multiSelectPress = null;
      const state = store.getState();
      // 按着框选键时一动就开始拉框（userSelectionActive），没动才是点了一下
      if (event.type === 'pointerup' && press !== null && event.button === 0 && !state.userSelectionActive) {
        const node = state.nodeLookup.get(press);
        if (node) {
          // 画布空白层松开时会把这次当作点在空白处、清空选中：先撤掉它为拉框记下的起点
          store.setState({ userSelectionRect: null, nodesSelectionActive: false });
          if (node.selected) state.unselectNodesAndEdges({ nodes: [node], edges: [] });
          else state.addSelectedNodes([press]);
        }
      }
      if (pointer) pointer = { x: event.clientX, y: event.clientY };
      refreshShellSoon();
    };
    /**
     * 画面自己变了之后要等停稳才重新判断指针下的节点（refreshShellSoon），这之前按下去，目标会落在画布空白上。
     * 这里按画布场景现场补出空外框，并把紧随其后的鼠标按下事件转交给它：拖动、点选、右键仍由 ReactFlow 原生处理。
     */
    const onPointerDown = (event: PointerEvent) => {
      pointerPressed = true;
      redirectedTo = null;
      if (!presence.isEnabled() || event.pointerType !== 'mouse' || (event.button !== 0 && event.button !== 2)) return;
      if (store.getState().userSelectionActive) return;
      if (!(event.target instanceof Element) || event.target.closest('.react-flow__node')) return;
      const hit = sceneView.hitNodeAtClient({ x: event.clientX, y: event.clientY });
      if (!hit || presence.isActive(hit.id)) return;
      // 按着框选键（Ctrl / Cmd）时与挂着正文的节点一样：拖开是拉框（画布空白层已经接住了这次按下），
      // 原地松开是把这个节点加进或移出选中。不转交按下，松开时再判断
      if (event.ctrlKey || event.metaKey) {
        if (event.button === 0) multiSelectPress = hit.id;
        return;
      }
      presence.setShell(hit.id);
      // 右键菜单在松开时才按当时指针下的元素触发，空外框已经在了；左键的按下事件要转交
      if (event.button === 0) redirectedTo = hit.id;
    };
    const onMouseDown = (event: MouseEvent) => {
      const id = redirectedTo;
      redirectedTo = null;
      if (id === null || !event.isTrusted) return;
      // 只把事件交给调度刚挂出来的空外框，不拿节点元素做命中或定位
      const shell = flowElement?.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
      if (!shell) return;
      event.stopPropagation();
      shell.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, composed: true, view: window, detail: event.detail,
        clientX: event.clientX, clientY: event.clientY, screenX: event.screenX, screenY: event.screenY,
        button: event.button, buttons: event.buttons,
        ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey, metaKey: event.metaKey,
      }));
    };
    const onPointerLeave = () => { pointer = null; };
    flowElement?.addEventListener('pointermove', onPointerMove, { passive: true });
    flowElement?.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    flowElement?.addEventListener('mousedown', onMouseDown, { capture: true });
    flowElement?.addEventListener('pointerleave', onPointerLeave, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true, capture: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true, capture: true });

    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      if (restoreTimer !== null) clearTimeout(restoreTimer);
      if (shellTimer !== null) clearTimeout(shellTimer);
      stopStore(); stopScene(); stopPresence(); resizeObserver.disconnect(); themeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      flowElement?.removeEventListener('pointermove', onPointerMove);
      flowElement?.removeEventListener('pointerdown', onPointerDown, { capture: true });
      flowElement?.removeEventListener('mousedown', onMouseDown, { capture: true });
      flowElement?.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onPointerUp, { capture: true });
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      stop();
      proxy.dispose();
    };
  }, [presence, sceneView, store]);

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
