import { createLogger } from '@/core/logging';
import { toFetchableMediaUrl } from '@/services/imageSource';
import { requestCanvasThumbnail } from '@/features/canvas/application/canvasMediaThumbnail';
import type { SceneNode, SceneNodeContent } from '@/features/canvas/scene/canvasScene';
import { createFarLayerAtlas, type AtlasSlot, type FarLayerAtlas } from './farLayerAtlas';

const logger = createLogger('features.canvas.farLayer.tiles');

/**
 * 每个节点的远景画面，分两级：
 * - 概览级：很小的一格，所有节点常驻，带逐级缩小的副本，缩到很远也不闪；
 * - 清晰级：大一号，只给屏幕上够大的节点，数量有上限、按最近使用淘汰。
 * 画什么由画布场景给出：媒体节点用主进程落盘的缩略图；其余节点自绘（面板底、标题、几行摘要）。
 * 两级都没到之前节点先画成一块面板色，画面到了再淡入，所以任何时刻每个节点都有东西可画。
 */

const OVERVIEW_CELL = 64;
const OVERVIEW_LEVELS = 3;
const DETAIL_CELL = 256;
const PAGE = 2048;
/** 清晰级的格子数：同屏够大的节点远少于这个数 */
const DETAIL_CAPACITY = 512;
/** 节点在屏幕上的长边超过这么多设备像素才值得换清晰级 */
const DETAIL_MIN_SCREEN_PX = OVERVIEW_CELL * 1.25;
const MAX_CONCURRENT_LOADS = 6;
/** 每帧花在自绘与上传上的时间上限 */
const FRAME_BUDGET_MS = 3;

export interface FarLayerPalette {
  panel: string;
  text: string;
  subtle: string;
  fontFamily: string;
  /** 主题变了就加一，自绘画面随之重画 */
  epoch: number;
}

export interface NodeTile {
  overview: AtlasSlot | null;
  /** 概览级画面写入的时刻（秒），着色器据此淡入 */
  overviewAt: number;
  detail: AtlasSlot | null;
  detailAt: number;
}

interface TileState extends NodeTile {
  content: SceneNodeContent;
  /** 画面内容的指纹：变了就重画 */
  signature: string;
  overviewLoading: boolean;
  detailLoading: boolean;
  detailUsedAt: number;
  /** 媒体读不出来时改用自绘 */
  mediaFailed: boolean;
}

type MediaContent = Extract<SceneNodeContent, { kind: 'image' | 'video' }>;

/** 场景里没变的节点沿用同一个对象：指纹按节点对象缓存，不必每次重拼。 */
const signatures = new WeakMap<SceneNode, { epoch: number; signature: string }>();

function signatureOf(node: SceneNode, paletteEpoch: number): string {
  const cached = signatures.get(node);
  if (cached?.epoch === paletteEpoch) return cached.signature;
  const signature = buildSignature(node, paletteEpoch);
  signatures.set(node, { epoch: paletteEpoch, signature });
  return signature;
}

function buildSignature(node: SceneNode, paletteEpoch: number): string {
  const content = node.content;
  // 媒体画面按节点外框的长宽比裁切：比例变了（量到真实尺寸、用户改了尺寸）要重排，否则旧裁切会被拉伸
  if (content.kind !== 'card') return `${content.kind}|${content.source}|${Math.round(node.width / node.height * 24)}`;
  // 自绘画面按节点形状排版，尺寸取整到 16 以内的变化不重画
  const shape = `${Math.round(node.width / 16)}x${Math.round(node.height / 16)}`;
  return `card|${paletteEpoch}|${node.type}|${content.title}|${content.summary.slice(0, 80)}|${shape}`;
}

function fit(width: number, height: number, limit: number): { width: number; height: number } {
  const scale = limit / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function createFarLayerTiles(gl: WebGL2RenderingContext, options: { nodeCapacity: number; onChange(): void; now(): number }) {
  let overview: FarLayerAtlas = createFarLayerAtlas(gl, { cell: OVERVIEW_CELL, page: PAGE, levels: OVERVIEW_LEVELS, capacity: options.nodeCapacity });
  // 清晰级占显存较多，用到才建
  let detail: FarLayerAtlas | null = null;
  const states = new Map<string, TileState>();
  /** 概览级排队：媒体受同时读取数限制，自绘受每帧时间限制，分开排才不会互相堵住 */
  const mediaOverviewQueue = new Set<string>();
  const cardOverviewQueue = new Set<string>();
  const cardDetailQueue = new Set<string>();
  /** 最近一次对齐时的节点与“需要清晰级”名单：缩略图是异步读回来的，写入时按这里的最新状态判断 */
  let latestNodes = new Map<string, SceneNode>();
  let wanted = new Set<string>();
  let activeLoads = 0;
  /** 任何节点可用的画面变了（写入、淘汰、作废）就加一：调用方据此决定要不要重填实例 */
  let revision = 0;
  let disposed = false;
  let palette: FarLayerPalette = { panel: '', text: '', subtle: '', fontFamily: 'sans-serif', epoch: 0 };

  const scratch = [OVERVIEW_CELL, OVERVIEW_CELL / 2, OVERVIEW_CELL / 4].map(size => new OffscreenCanvas(size, size));
  const detailScratch = new OffscreenCanvas(DETAIL_CELL, DETAIL_CELL);

  function context(canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D {
    // 画完立刻整块上传成纹理：留在内存里画，避免每次上传都从显存读回
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('远景自绘画布不可用');
    return ctx;
  }

  function drawCover(ctx: OffscreenCanvasRenderingContext2D, image: CanvasImageSource, sourceWidth: number, sourceHeight: number, width: number, height: number): void {
    const scale = Math.max(width / sourceWidth, height / sourceHeight);
    const drawWidth = sourceWidth * scale, drawHeight = sourceHeight * scale;
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
  }

  /** 简化的节点卡片：面板底、标题、摘要。字小到读不出时改画等宽的色条，远看仍是“有标题、有几行字”的形状。 */
  function drawCard(ctx: OffscreenCanvasRenderingContext2D, content: SceneNodeContent, entry: SceneNode, width: number, height: number): void {
    const scale = width / entry.width;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.panel;
    ctx.fillRect(0, 0, width, height);
    const pad = 14 * scale;
    const titleSize = 20 * scale;
    const bodySize = 13 * scale;
    ctx.textBaseline = 'top';
    if (titleSize >= 7) {
      ctx.fillStyle = palette.text;
      ctx.font = `500 ${titleSize}px ${palette.fontFamily}`;
      ctx.fillText(content.title, pad, pad, width - pad * 2);
    } else {
      ctx.fillStyle = palette.subtle;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(pad, pad, Math.min(width - pad * 2, Math.max(titleSize * 2, content.title.length * titleSize * 0.9)), Math.max(1, titleSize * 0.7));
      ctx.globalAlpha = 1;
    }
    if (!content.summary) return;
    const top = pad + titleSize * 1.7;
    const lineHeight = bodySize * 1.6;
    const available = Math.max(0, Math.floor((height - top - pad) / lineHeight));
    const perLine = Math.max(4, Math.floor((width - pad * 2) / bodySize));
    const rows = Math.min(available, 6, Math.ceil(content.summary.length / perLine));
    ctx.fillStyle = palette.subtle;
    for (let row = 0; row < rows; row += 1) {
      const slice = content.summary.slice(row * perLine, (row + 1) * perLine);
      if (bodySize >= 7) {
        ctx.font = `${bodySize}px ${palette.fontFamily}`;
        ctx.fillText(slice, pad, top + row * lineHeight, width - pad * 2);
      } else {
        ctx.globalAlpha = 0.45;
        ctx.fillRect(pad, top + row * lineHeight, (width - pad * 2) * Math.min(1, slice.length / perLine), Math.max(1, bodySize * 0.6));
        ctx.globalAlpha = 1;
      }
    }
  }

  function writeOverview(state: TileState, entry: SceneNode, paint: (ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) => void): void {
    const index = state.overview?.index ?? overview.allocate();
    if (index === null) return;
    const size = fit(entry.width, entry.height, overview.contentSize);
    scratch.forEach((canvas, level) => paint(context(canvas), Math.max(1, size.width >> level), Math.max(1, size.height >> level)));
    state.overview = overview.write(index, scratch, size.width, size.height);
    state.overviewAt = options.now();
    revision += 1;
  }

  function ensureDetailAtlas(): FarLayerAtlas {
    detail ??= createFarLayerAtlas(gl, { cell: DETAIL_CELL, page: PAGE, levels: 1, capacity: DETAIL_CAPACITY });
    return detail;
  }

  function allocateDetail(): number | null {
    const atlas = ensureDetailAtlas();
    const index = atlas.allocate();
    if (index !== null) return index;
    // 满了：淘汰当前不需要、最久没用的一格
    let victim: TileState | null = null;
    for (const [id, state] of states) {
      if (!state.detail || wanted.has(id)) continue;
      if (!victim || state.detailUsedAt < victim.detailUsedAt) victim = state;
    }
    if (!victim?.detail) return null;
    const reused = victim.detail.index;
    victim.detail = null;
    revision += 1;
    return reused;
  }

  function writeDetail(state: TileState, entry: SceneNode, paint: (ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) => void): void {
    const index = state.detail?.index ?? allocateDetail();
    if (index === null) return;
    const atlas = ensureDetailAtlas();
    const size = fit(entry.width, entry.height, atlas.contentSize);
    paint(context(detailScratch), size.width, size.height);
    state.detail = atlas.write(index, [detailScratch], size.width, size.height);
    state.detailAt = options.now();
    state.detailUsedAt = state.detailAt;
    revision += 1;
  }

  async function loadBitmap(content: MediaContent, limit: number): Promise<ImageBitmap> {
    const request = requestCanvasThumbnail({ kind: content.kind, source: content.source });
    // 缩略图落盘后地址长期有效，拿到就可以归还这次占用
    let url: string | null;
    try { url = await request.promise; } finally { request.release(); }
    if (!url) throw new Error('视频缩略图生成失败');
    const response = await fetch(toFetchableMediaUrl(url));
    if (!response.ok) throw new Error(`缩略图读取失败（${response.status}）`);
    const blob = await response.blob();
    const full = await createImageBitmap(blob);
    if (Math.max(full.width, full.height) <= limit * 2) return full;
    // 远大于目标的图先缩一次，后面逐级画的时候不走大图
    const size = fit(full.width, full.height, limit * 2);
    const reduced = await createImageBitmap(full, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'medium' });
    full.close();
    return reduced;
  }

  function startMediaLoad(id: string, level: 'overview' | 'detail'): void {
    const state = states.get(id);
    if (!state || state.content.kind === 'card') return;
    const content = state.content;
    const signature = state.signature;
    activeLoads += 1;
    if (level === 'overview') state.overviewLoading = true; else state.detailLoading = true;
    void loadBitmap(content, level === 'overview' ? OVERVIEW_CELL : DETAIL_CELL).then((bitmap) => {
      // 读图期间节点可能已删除、换了内容或改了尺寸：一律按当前状态写
      const current = states.get(id);
      const entry = latestNodes.get(id);
      const stale = disposed || !current || !entry || current.signature !== signature;
      if (!stale) {
        const paint = (ctx: OffscreenCanvasRenderingContext2D, width: number, height: number) => drawCover(ctx, bitmap, bitmap.width, bitmap.height, width, height);
        if (level === 'overview') writeOverview(current, entry, paint);
        // 读回来时已经不在屏幕上够大的节点不再占清晰级格子
        else if (wanted.has(id)) writeDetail(current, entry, paint);
      }
      bitmap.close();
    }).catch((error: unknown) => {
      const current = states.get(id);
      if (!current || current.signature !== signature) return;
      logger.debug('远景缩略图读取失败，改用自绘', { error: String(error) });
      current.mediaFailed = true;
      cardOverviewQueue.add(id);
    }).finally(() => {
      activeLoads -= 1;
      const current = states.get(id);
      if (current?.signature === signature) {
        if (level === 'overview') current.overviewLoading = false; else current.detailLoading = false;
      }
      if (!disposed) options.onChange();
    });
  }

  function enqueueOverview(id: string, state: TileState): void {
    if (state.content.kind === 'card' || state.mediaFailed) cardOverviewQueue.add(id); else mediaOverviewQueue.add(id);
  }

  return {
    get overviewTexture() { return overview.texture; },
    get detailTexture() { return detail?.texture ?? null; },
    get(id: string): NodeTile | undefined { return states.get(id); },
    get revision() { return revision; },

    setPalette(next: Omit<FarLayerPalette, 'epoch'>): void {
      if (next.panel === palette.panel && next.text === palette.text && next.subtle === palette.subtle && next.fontFamily === palette.fontFamily) return;
      palette = { ...next, epoch: palette.epoch + 1 };
    },

    /**
     * 对齐节点集合并推进加载。view 给出视口（画布坐标）与每画布单位对应的设备像素，用来排优先级与决定谁要清晰级。
     * 返回是否还有没做完的工作（调用方据此继续安排下一帧）。
     */
    update(nodes: readonly SceneNode[], view: { left: number; top: number; right: number; bottom: number; devicePixelsPerUnit: number }): boolean {
      if (disposed) return false;
      if (nodes.length > overview.capacity) {
        // 节点数超过图集容量：换一张更大的，画面重新排队（先画成面板色，再逐个回来）
        overview.dispose();
        overview = createFarLayerAtlas(gl, { cell: OVERVIEW_CELL, page: PAGE, levels: OVERVIEW_LEVELS, capacity: Math.ceil(nodes.length * 1.5) });
        for (const [id, state] of states) { state.overview = null; enqueueOverview(id, state); }
        revision += 1;
      }
      const byId = new Map<string, SceneNode>();
      const centerX = (view.left + view.right) / 2, centerY = (view.top + view.bottom) / 2;
      const wantedDetail: Array<{ id: string; distance: number }> = [];
      const visibleQueued: string[] = [];
      for (const entry of nodes) {
        if (entry.backdrop) continue;
        byId.set(entry.id, entry);
        const signature = signatureOf(entry, palette.epoch);
        let state = states.get(entry.id);
        if (!state || state.signature !== signature) {
          if (state?.detail) { detail?.release(state.detail.index); revision += 1; }
          // 内容变了：概览格子沿用，新画面写进去之前仍显示旧画面，不退回空白
          state = {
            content: entry.content, signature, overview: state?.overview ?? null, overviewAt: state?.overviewAt ?? 0,
            detail: null, detailAt: 0, overviewLoading: false, detailLoading: false, detailUsedAt: 0, mediaFailed: false,
          };
          states.set(entry.id, state);
          enqueueOverview(entry.id, state);
        }
        const visible = entry.x < view.right && entry.x + entry.width > view.left && entry.y < view.bottom && entry.y + entry.height > view.top;
        if (visible && (mediaOverviewQueue.has(entry.id) || cardOverviewQueue.has(entry.id))) visibleQueued.push(entry.id);
        if (visible && Math.max(entry.width, entry.height) * view.devicePixelsPerUnit >= DETAIL_MIN_SCREEN_PX) {
          wantedDetail.push({ id: entry.id, distance: Math.hypot(entry.x + entry.width / 2 - centerX, entry.y + entry.height / 2 - centerY) });
        }
      }
      for (const [id, state] of states) {
        if (byId.has(id)) continue;
        if (state.overview) overview.release(state.overview.index);
        if (state.detail) detail?.release(state.detail.index);
        states.delete(id); mediaOverviewQueue.delete(id); cardOverviewQueue.delete(id); cardDetailQueue.delete(id);
      }
      latestNodes = byId;

      wantedDetail.sort((a, b) => a.distance - b.distance);
      wanted = new Set(wantedDetail.slice(0, DETAIL_CAPACITY).map(item => item.id));
      const stamp = options.now();
      for (const id of wanted) {
        const state = states.get(id);
        if (!state) continue;
        if (state.detail) { state.detailUsedAt = stamp; continue; }
        if (state.detailLoading) continue;
        if (state.content.kind === 'card' || state.mediaFailed) cardDetailQueue.add(id);
        else if (activeLoads < MAX_CONCURRENT_LOADS) startMediaLoad(id, 'detail');
      }

      // 自绘的时间预算从这里起算：前面对齐全部节点的开销不该挤掉它
      const started = performance.now();
      // 概览级：视口里的先做，其余按排队顺序
      const stepMedia = (id: string): void => {
        const state = states.get(id);
        mediaOverviewQueue.delete(id);
        if (!state || state.overviewLoading) return;
        startMediaLoad(id, 'overview');
      };
      const stepCard = (id: string): void => {
        const state = states.get(id);
        const entry = byId.get(id);
        cardOverviewQueue.delete(id);
        if (!state || !entry) return;
        writeOverview(state, entry, (ctx, width, height) => drawCard(ctx, state.content, entry, width, height));
      };
      const mediaFull = () => activeLoads >= MAX_CONCURRENT_LOADS;
      const cardsOverBudget = () => performance.now() - started > FRAME_BUDGET_MS;
      for (const id of visibleQueued) {
        if (mediaOverviewQueue.has(id)) { if (!mediaFull()) stepMedia(id); } else if (!cardsOverBudget()) stepCard(id);
      }
      for (const id of mediaOverviewQueue) { if (mediaFull()) break; stepMedia(id); }
      for (const id of cardOverviewQueue) { if (cardsOverBudget()) break; stepCard(id); }
      for (const id of [...cardDetailQueue]) {
        if (performance.now() - started > FRAME_BUDGET_MS) break;
        cardDetailQueue.delete(id);
        const state = states.get(id);
        const entry = byId.get(id);
        if (!state || !entry || state.detail || !wanted.has(id)) continue;
        writeDetail(state, entry, (ctx, width, height) => drawCard(ctx, state.content, entry, width, height));
      }
      return cardOverviewQueue.size > 0 || cardDetailQueue.size > 0 || (mediaOverviewQueue.size > 0 && !mediaFull());
    },

    dispose(): void {
      disposed = true;
      overview.dispose();
      detail?.dispose();
      states.clear(); mediaOverviewQueue.clear(); cardOverviewQueue.clear(); cardDetailQueue.clear();
      latestNodes = new Map(); wanted = new Set();
    },
  };
}

export type FarLayerTiles = ReturnType<typeof createFarLayerTiles>;
