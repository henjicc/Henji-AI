import type { SceneNode, SceneRect } from '@/features/canvas/scene/canvasScene';

/**
 * 节点正文的画面存档：正文（真 DOM）挂着并停稳时，把画布区域整块截下来存成纹理，记下每个节点在其中的位置。
 * 视口运动时远景层照这份存档画节点，浏览器就不必逐帧重画真 DOM；同一缩放下它与正文逐像素一致。
 *
 * 存档按整张截图保存（最近几张轮换），不逐节点裁切：一次上传，节点只记采样范围。
 * 节点画在外框之外的部分（浮动标题、端口）也在存档里，所以存档范围比外框大一圈。
 * 节点在截图时只露出一部分的，只有露出的那部分有存档，其余部分仍由缩略图画。
 * 节点的数据、尺寸或选中状态变了，它的存档就作废。截图里还烘进了经过的连线与相邻节点，
 * 它们在存档范围里变了（dropIntersecting）也要作废。
 */

/** 保留最近几张截图：平移过的地方回头再经过时，存档还在 */
const LAYERS = 4;

export interface NodeSnapshot {
  layer: number;
  /** 节点整个外框在截图里的采样范围（露出一部分时会超出 0 到 1） */
  u0: number; v0: number; u1: number; v1: number;
  /** 有存档的范围（按外框归一化；外框之外的绘制余量在 0 到 1 以外） */
  left: number; top: number; right: number; bottom: number;
  /** 截图时的缩放：缩得比它小很多时不用存档，改用缩略图 */
  zoom: number;
}

interface Entry extends NodeSnapshot {
  data: unknown;
  width: number;
  height: number;
  selected: boolean;
  full: boolean;
  /** 存档覆盖的画布范围（外框加绘制余量） */
  rect: SceneRect;
}

export interface SnapshotCapture {
  /** 截图（设备像素尺寸） */
  image: ImageBitmap;
  zoom: number;
  /** 节点画在外框之外的余量（画布单位） */
  margin: { top: number; right: number; bottom: number; left: number };
  /** 截图里的节点，以及各自外框在截图里的位置（设备像素，可以超出截图范围） */
  items: ReadonlyArray<{ node: SceneNode; x: number; y: number; width: number; height: number }>;
}

/** 按外框归一化的矩形 */
export interface UnitRect { left: number; top: number; right: number; bottom: number }

const COVER_TOLERANCE = 0.004;

function dataOf(node: SceneNode): unknown {
  return node.internal.internals.userNode.data;
}

export function createFarLayerSnapshots(gl: WebGL2RenderingContext) {
  let texture: WebGLTexture | null = null;
  let size = { width: 0, height: 0 };
  const entries = new Map<string, Entry>();
  /** 每张截图最近一次写入的序号：轮换时先用没人引用的，再用最早写的 */
  const writtenAt = new Array<number>(LAYERS).fill(0);
  let sequence = 0;

  function ensureTexture(width: number, height: number): WebGLTexture {
    if (texture && size.width === width && size.height === height) return texture;
    if (texture) gl.deleteTexture(texture);
    entries.clear();
    writtenAt.fill(0);
    texture = gl.createTexture();
    if (!texture) throw new Error('正文画面存档纹理创建失败');
    size = { width, height };
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(Math.max(width, height))) + 1, gl.RGBA8, width, height, LAYERS);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function valid(node: SceneNode): Entry | undefined {
    const entry = entries.get(node.id);
    if (!entry) return undefined;
    if (entry.data !== dataOf(node) || entry.selected !== node.selected
      || Math.abs(entry.width - node.width) > 0.5 || Math.abs(entry.height - node.height) > 0.5) {
      entries.delete(node.id);
      return undefined;
    }
    return entry;
  }

  function pickLayer(): number {
    const used = new Array<number>(LAYERS).fill(0);
    for (const entry of entries.values()) used[entry.layer] += 1;
    let best = 0;
    for (let layer = 1; layer < LAYERS; layer += 1) {
      const emptier = (used[layer] === 0) !== (used[best] === 0) ? used[layer] === 0 : writtenAt[layer] < writtenAt[best];
      if (emptier) best = layer;
    }
    return best;
  }

  return {
    get texture() { return texture; },

    /** 节点当前可用的存档；节点变了就没有。 */
    get(node: SceneNode): NodeSnapshot | undefined {
      return valid(node);
    },

    /** 这个节点是否存着画面（不核对是否仍然有效）。 */
    has(id: string): boolean {
      return entries.has(id);
    },

    /** 节点的这一部分（按外框归一化）是否都有存档。 */
    covers(node: SceneNode, part: UnitRect): boolean {
      const entry = valid(node);
      return Boolean(entry) && entry!.left <= part.left + COVER_TOLERANCE && entry!.top <= part.top + COVER_TOLERANCE
        && entry!.right >= part.right - COVER_TOLERANCE && entry!.bottom >= part.bottom - COVER_TOLERANCE;
    },

    /** 存入一张截图；返回存下了多少个节点的画面。 */
    write(capture: SnapshotCapture): number {
      const { width: imageWidth, height: imageHeight } = capture.image;
      if (!imageWidth || !imageHeight || !capture.items.length) return 0;
      const target = ensureTexture(imageWidth, imageHeight);
      const { margin } = capture;
      const placed = capture.items.flatMap(({ node, x, y, width, height }) => {
        if (width <= 0 || height <= 0) return [];
        // 存档范围：外框加绘制余量，再裁到截图之内；向内收半个像素，线性过滤不取到截图边缘之外
        const wanted = { left: -margin.left / node.width, top: -margin.top / node.height, right: 1 + margin.right / node.width, bottom: 1 + margin.bottom / node.height };
        const left = Math.max(wanted.left, (0.5 - x) / width), top = Math.max(wanted.top, (0.5 - y) / height);
        const right = Math.min(wanted.right, (imageWidth - 0.5 - x) / width), bottom = Math.min(wanted.bottom, (imageHeight - 0.5 - y) / height);
        if (right <= left || bottom <= top) return [];
        const full = left === wanted.left && top === wanted.top && right === wanted.right && bottom === wanted.bottom;
        // 已有完整存档、清晰度也够的节点，这次只截到一部分时保留原来那份
        const existing = valid(node);
        if (!full && existing?.full && existing.zoom >= capture.zoom * 0.7) return [];
        return [{ node, x, y, width, height, left, top, right, bottom, full }];
      });
      if (!placed.length) return 0;
      const layer = pickLayer();
      for (const [id, entry] of entries) if (entry.layer === layer) entries.delete(id);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, target);
      // 缩略图图集上传时开着预乘（上下文全局状态）；截图不透明，不需要
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      while (gl.getError() !== gl.NO_ERROR) { /* 清掉之前留下的错误标记，下面只看这次上传 */ }
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, imageWidth, imageHeight, 1, gl.RGBA, gl.UNSIGNED_BYTE, capture.image);
      // 上传没成功就不登记：否则代画时会照着一张空纹理画
      if (gl.getError() !== gl.NO_ERROR) return 0;
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      writtenAt[layer] = ++sequence;
      for (const { node, x, y, width, height, left, top, right, bottom, full } of placed) {
        entries.set(node.id, {
          layer, zoom: capture.zoom,
          u0: x / imageWidth, v0: y / imageHeight, u1: (x + width) / imageWidth, v1: (y + height) / imageHeight,
          left, top, right, bottom, full,
          data: dataOf(node), width: node.width, height: node.height, selected: node.selected,
          rect: { x: node.x - margin.left, y: node.y - margin.top, width: node.width + margin.left + margin.right, height: node.height + margin.top + margin.bottom },
        });
      }
      return placed.length;
    },

    /** 丢掉某个节点的存档（它的画面变了而数据没变，例如指针移开后悬停样式消失）。 */
    drop(id: string): void {
      entries.delete(id);
    },

    /** 丢掉存档范围与这些画布区域相交的存档（那里的连线、节点变了）；返回丢掉的节点。 */
    dropIntersecting(regions: readonly SceneRect[]): string[] {
      if (!regions.length || !entries.size) return [];
      const dropped: string[] = [];
      for (const [id, { rect }] of entries) {
        const hit = regions.some(region => region.x < rect.x + rect.width && rect.x < region.x + region.width
          && region.y < rect.y + rect.height && rect.y < region.y + region.height);
        if (hit) { entries.delete(id); dropped.push(id); }
      }
      return dropped;
    },

    /** 存着画面的节点数。 */
    get size() { return entries.size; },

    /** 丢掉全部存档（主题这类影响所有正文的东西变了）。 */
    clear(): void {
      entries.clear();
    },

    dispose(): void {
      if (texture) gl.deleteTexture(texture);
      texture = null;
      entries.clear();
    },
  };
}

export type FarLayerSnapshots = ReturnType<typeof createFarLayerSnapshots>;
