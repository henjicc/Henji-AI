/**
 * 远景缩略图图集：一张二维纹理数组，按固定格子切分，每个节点占一格。
 * 格子内容按节点长宽比贴着左上角放，四周留空边（最小一级副本里仍有 1 像素），采样范围随内容收窄，相邻格子互不渗色。
 */

export interface AtlasSlot {
  index: number;
  layer: number;
  /** 内容在整页里的归一化范围 */
  u0: number; v0: number; u1: number; v1: number;
  width: number;
  height: number;
}


export interface FarLayerAtlas {
  readonly texture: WebGLTexture;
  readonly cell: number;
  readonly levels: number;
  readonly capacity: number;
  /** 格子里放得下的最大内容边长 */
  readonly contentSize: number;
  allocate(): number | null;
  release(index: number): void;
  /** 把各级画面（第 0 级在前，逐级减半）写进格子，返回采样范围。 */
  write(index: number, sources: readonly TexImageSource[], width: number, height: number): AtlasSlot;
  dispose(): void;
}

export function createFarLayerAtlas(gl: WebGL2RenderingContext, options: { cell: number; page: number; levels: number; capacity: number }): FarLayerAtlas {
  const { cell, page, levels } = options;
  // 每缩小一级空边减半：按最小一级还剩 1 像素来定
  const gutter = 1 << (levels - 1);
  const perRow = Math.floor(page / cell);
  const perPage = perRow * perRow;
  const pages = Math.max(1, Math.ceil(options.capacity / perPage));
  const capacity = pages * perPage;
  const texture = gl.createTexture();
  if (!texture) throw new Error('远景图集纹理创建失败');
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.RGBA8, page, page, pages);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, levels - 1);

  const free: number[] = [];
  /** 写入新内容前先把整格清空用的零数据 */
  const blank = new Uint8Array(cell * cell * 4);
  let next = 0;

  return {
    texture, cell, levels, capacity,
    contentSize: cell - gutter * 2,
    allocate() {
      const reused = free.pop();
      if (reused !== undefined) return reused;
      return next < capacity ? next++ : null;
    },
    release(index) { free.push(index); },
    write(index, sources, width, height) {
      const layer = Math.floor(index / perPage);
      const within = index % perPage;
      const x = (within % perRow) * cell + gutter;
      const y = Math.floor(within / perRow) * cell + gutter;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      for (let level = 0; level < Math.min(levels, sources.length); level += 1) {
        // 格子会被别的节点复用：新内容比旧内容小时，不清就会在边缘露出上一个节点的画面
        const cellSize = cell >> level;
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, (x - gutter) >> level, (y - gutter) >> level, layer, cellSize, cellSize, 1, gl.RGBA, gl.UNSIGNED_BYTE, blank.subarray(0, cellSize * cellSize * 4));
        const levelWidth = Math.max(1, width >> level);
        const levelHeight = Math.max(1, height >> level);
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, level, x >> level, y >> level, layer, levelWidth, levelHeight, 1, gl.RGBA, gl.UNSIGNED_BYTE, sources[level]);
      }
      // 采样范围向内收半个像素，线性过滤不取到空边
      return {
        index, layer, width, height,
        u0: (x + 0.5) / page, v0: (y + 0.5) / page,
        u1: (x + width - 0.5) / page, v1: (y + height - 0.5) / page,
      };
    },
    dispose() { gl.deleteTexture(texture); },
  };
}
