import type { SceneEdge, SceneNode } from '@/features/canvas/scene/canvasScene';
import type { FarLayerTiles } from './farLayerTiles';

/**
 * 远景层的绘制：所有节点一次实例化画完（圆角矩形 + 图集里的缩略图 + 描边），连线同样一次实例化
 * （每条线是着色器里展开的一条三次贝塞尔带）。每帧只更新视口矩阵；节点或连线变了才重填实例缓冲。
 */

export interface FarLayerColors {
  panel: readonly [number, number, number];
  border: readonly [number, number, number];
  accent: readonly [number, number, number];
  danger: readonly [number, number, number];
  edge: readonly [number, number, number];
  group: readonly [number, number, number];
  /** 节点圆角（画布单位） */
  radius: number;
}

export interface FarLayerView {
  x: number; y: number; zoom: number;
  /** 画布元素的 CSS 尺寸 */
  width: number; height: number;
  dpr: number;
}

const NODE_FLOATS = 20;
const EDGE_FLOATS = 10;
const EDGE_SEGMENTS = 24;
/** 画面写入后淡入的时长（秒） */
const TILE_FADE_SECONDS = 0.18;

const NODE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 iRect;
layout(location=2) in vec4 iOverviewUv;
layout(location=3) in vec4 iDetailUv;
layout(location=4) in vec4 iTile;   // 概览层号、清晰层号、概览写入时刻、清晰写入时刻（层号为负表示没有）
layout(location=5) in vec4 iStyle;  // 是否分组、是否选中、状态（1 运行中、2 失败）、保留
uniform vec3 uView;
uniform vec2 uViewport;
uniform float uDpr;
out vec2 vLocal;
out vec2 vHalf;
out vec2 vUnit;
out vec4 vOverviewUv;
out vec4 vDetailUv;
out vec4 vTile;
out vec4 vStyle;
void main() {
  // 外扩一点给描边与抗锯齿留位置（屏幕像素）
  float pad = 2.0;
  vec2 size = iRect.zw * uView.z;
  vec2 origin = iRect.xy * uView.z + uView.xy;
  vec2 position = origin - pad + aCorner * (size + pad * 2.0);
  vHalf = size * 0.5;
  vLocal = position - (origin + vHalf);
  vUnit = (position - origin) / max(size, vec2(0.0001));
  vOverviewUv = iOverviewUv; vDetailUv = iDetailUv; vTile = iTile; vStyle = iStyle;
  vec2 clip = position / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const NODE_FRAGMENT = `#version 300 es
precision highp float;
precision highp sampler2DArray;
in vec2 vLocal;
in vec2 vHalf;
in vec2 vUnit;
in vec4 vOverviewUv;
in vec4 vDetailUv;
in vec4 vTile;
in vec4 vStyle;
uniform sampler2DArray uOverview;
uniform sampler2DArray uDetail;
uniform vec3 uView;
uniform float uDpr;
uniform float uTime;
uniform float uRadius;
uniform vec3 uPanel;
uniform vec3 uBorder;
uniform vec3 uAccent;
uniform vec3 uDanger;
uniform vec3 uGroup;
out vec4 outColor;
const float FADE = ${TILE_FADE_SECONDS.toFixed(2)};
float roundedBox(vec2 point, vec2 halfSize, float radius) {
  vec2 q = abs(point) - halfSize + radius;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}
void main() {
  float radius = min(uRadius * uView.z, min(vHalf.x, vHalf.y));
  float distance = roundedBox(vLocal, vHalf, radius);
  float coverage = clamp(0.5 - distance * uDpr, 0.0, 1.0);
  bool group = vStyle.x > 0.5;
  bool selected = vStyle.y > 0.5;
  vec2 unit = clamp(vUnit, 0.0, 1.0);
  // 采样放在分支外：分支里取纹理没有可用的导数，逐级缩小的副本会选错
  vec4 overview = texture(uOverview, vec3(mix(vOverviewUv.xy, vOverviewUv.zw, unit), max(vTile.x, 0.0)));
  vec4 detail = texture(uDetail, vec3(mix(vDetailUv.xy, vDetailUv.zw, unit), max(vTile.y, 0.0)));
  float overviewMix = step(0.0, vTile.x) * clamp((uTime - vTile.z) / FADE, 0.0, 1.0) * overview.a;
  float detailMix = step(0.0, vTile.y) * clamp((uTime - vTile.w) / FADE, 0.0, 1.0) * detail.a;
  vec4 fill = vec4(uPanel, 1.0);
  fill = mix(fill, vec4(overview.rgb / max(overview.a, 0.001), 1.0), overviewMix);
  fill = mix(fill, vec4(detail.rgb / max(detail.a, 0.001), 1.0), detailMix);
  if (group) fill = vec4(uGroup, 1.0) * 0.4;
  // 描边：与正文的 1 单位描边一致，缩得很小时保底 1 个设备像素并相应变淡
  // 运行中、失败的节点用状态色描边，缩得再小也看得出哪些在跑、哪些出了错；选中优先
  bool running = vStyle.z > 0.5 && vStyle.z < 1.5;
  bool failed = vStyle.z > 1.5;
  bool marked = selected || running || failed;
  float borderWidth = marked ? max(1.5 * uView.z, 1.5 / uDpr) : max(uView.z, 1.0 / uDpr);
  float borderAlpha = marked ? 1.0 : 0.3 * clamp(uView.z * uDpr, 0.35, 1.0);
  float inner = clamp(0.5 - (distance + borderWidth) * uDpr, 0.0, 1.0);
  vec3 borderColor = selected ? uAccent : failed ? uDanger : running ? mix(uBorder, uAccent, 0.6) : uBorder;
  vec4 bordered = vec4(borderColor * borderAlpha, borderAlpha) + fill * (1.0 - borderAlpha);
  vec4 color = mix(bordered, fill, inner);
  outColor = color * coverage;
}`;

const EDGE_VERTEX = `#version 300 es
precision highp float;
layout(location=0) in vec2 aStrip; // 沿线参数、左右侧（±1）
layout(location=1) in vec4 iStart; // 起点、控制点一
layout(location=2) in vec4 iEnd;   // 控制点二、终点
layout(location=3) in vec2 iStyle; // 是否选中、不透明度
uniform vec3 uView;
uniform vec2 uViewport;
uniform float uDpr;
out float vSide;
out float vHalfWidth;
out vec2 vStyle;
vec2 bezier(float t) {
  float s = 1.0 - t;
  return s * s * s * iStart.xy + 3.0 * s * s * t * iStart.zw + 3.0 * s * t * t * iEnd.xy + t * t * t * iEnd.zw;
}
vec2 tangent(float t) {
  float s = 1.0 - t;
  return 3.0 * s * s * (iStart.zw - iStart.xy) + 6.0 * s * t * (iEnd.xy - iStart.zw) + 3.0 * t * t * (iEnd.zw - iEnd.xy);
}
void main() {
  vec2 point = bezier(aStrip.x) * uView.z + uView.xy;
  vec2 direction = tangent(aStrip.x);
  // 控制点与端点重合时切线为零，退回首尾连线方向
  if (dot(direction, direction) < 1e-6) direction = iEnd.zw - iStart.xy;
  vec2 normal = normalize(vec2(-direction.y, direction.x) + vec2(1e-6, 0.0));
  float width = (iStyle.x > 0.5 ? 2.4 : 1.9) * uView.z;
  // 线再细也至少画满 1 个设备像素，外加半个像素的抗锯齿边
  vHalfWidth = max(width, 1.0 / uDpr) * 0.5;
  float extent = vHalfWidth + 0.5 / uDpr;
  vec2 position = point + normal * aStrip.y * extent;
  vSide = aStrip.y * extent;
  vStyle = vec2(iStyle.x, iStyle.y * clamp(width * uDpr, 0.45, 1.0));
  vec2 clip = position / uViewport * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const EDGE_FRAGMENT = `#version 300 es
precision highp float;
in float vSide;
in float vHalfWidth;
in vec2 vStyle;
uniform float uDpr;
uniform vec3 uEdge;
uniform vec3 uAccent;
out vec4 outColor;
void main() {
  float coverage = clamp(0.5 + (vHalfWidth - abs(vSide)) * uDpr, 0.0, 1.0);
  vec3 color = vStyle.x > 0.5 ? uAccent : uEdge;
  outColor = vec4(color, 1.0) * coverage * vStyle.y;
}`;

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('远景层着色程序创建失败');
  for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('远景层着色器创建失败');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`远景层着色器编译失败：${gl.getShaderInfoLog(shader) ?? ''}`);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`远景层着色程序链接失败：${gl.getProgramInfoLog(program) ?? ''}`);
  return program;
}

function uniforms<T extends string>(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly T[]): Record<T, WebGLUniformLocation | null> {
  return Object.fromEntries(names.map(name => [name, gl.getUniformLocation(program, name)])) as Record<T, WebGLUniformLocation | null>;
}

export function createFarLayerRenderer(gl: WebGL2RenderingContext) {
  const nodeProgram = compile(gl, NODE_VERTEX, NODE_FRAGMENT);
  const edgeProgram = compile(gl, EDGE_VERTEX, EDGE_FRAGMENT);
  const nodeUniforms = uniforms(gl, nodeProgram, ['uView', 'uViewport', 'uDpr', 'uTime', 'uRadius', 'uPanel', 'uBorder', 'uAccent', 'uDanger', 'uGroup', 'uOverview', 'uDetail'] as const);
  const edgeUniforms = uniforms(gl, edgeProgram, ['uView', 'uViewport', 'uDpr', 'uEdge', 'uAccent'] as const);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);

  const strip = gl.createBuffer();
  const stripData = new Float32Array((EDGE_SEGMENTS + 1) * 4);
  for (let index = 0; index <= EDGE_SEGMENTS; index += 1) {
    stripData.set([index / EDGE_SEGMENTS, -1, index / EDGE_SEGMENTS, 1], index * 4);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, strip);
  gl.bufferData(gl.ARRAY_BUFFER, stripData, gl.STATIC_DRAW);

  function instancedLayout(vertexBuffer: WebGLBuffer | null, instanceBuffer: WebGLBuffer | null, stride: number, layout: readonly number[]): WebGLVertexArrayObject | null {
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    let offset = 0;
    layout.forEach((size, index) => {
      gl.enableVertexAttribArray(index + 1);
      gl.vertexAttribPointer(index + 1, size, gl.FLOAT, false, stride * 4, offset * 4);
      gl.vertexAttribDivisor(index + 1, 1);
      offset += size;
    });
    gl.bindVertexArray(null);
    return vao;
  }

  const nodeBuffer = gl.createBuffer();
  const groupBuffer = gl.createBuffer();
  const edgeBuffer = gl.createBuffer();
  const nodeLayout = [4, 4, 4, 4, 4] as const;
  const nodeVao = instancedLayout(quad, nodeBuffer, NODE_FLOATS, nodeLayout);
  const groupVao = instancedLayout(quad, groupBuffer, NODE_FLOATS, nodeLayout);
  const edgeVao = instancedLayout(strip, edgeBuffer, EDGE_FLOATS, [4, 4, 2]);

  let nodeData = new Float32Array(0);
  let groupData = new Float32Array(0);
  let edgeData = new Float32Array(0);
  let nodeCount = 0, groupCount = 0, edgeCount = 0;
  /** 最近一次写入画面的时刻：在它之后的淡入时长内需要持续重画 */
  let latestTileAt = 0;

  function grow(current: Float32Array<ArrayBuffer>, floats: number): Float32Array<ArrayBuffer> {
    return current.length >= floats ? current : new Float32Array(Math.ceil(floats * 1.25));
  }

  return {
    /** 重填节点实例。tiles 提供每个节点当前可用的画面。 */
    setNodes(nodes: readonly SceneNode[], tiles: FarLayerTiles): void {
      nodeData = grow(nodeData, nodes.length * NODE_FLOATS);
      groupData = grow(groupData, nodes.length * NODE_FLOATS);
      nodeCount = 0; groupCount = 0;
      for (const entry of nodes) {
        const target = entry.backdrop ? groupData : nodeData;
        const offset = (entry.backdrop ? groupCount++ : nodeCount++) * NODE_FLOATS;
        const tile = entry.backdrop ? undefined : tiles.get(entry.id);
        const overview = tile?.overview, detail = tile?.detail;
        target[offset] = entry.x; target[offset + 1] = entry.y; target[offset + 2] = entry.width; target[offset + 3] = entry.height;
        target[offset + 4] = overview?.u0 ?? 0; target[offset + 5] = overview?.v0 ?? 0; target[offset + 6] = overview?.u1 ?? 0; target[offset + 7] = overview?.v1 ?? 0;
        target[offset + 8] = detail?.u0 ?? 0; target[offset + 9] = detail?.v0 ?? 0; target[offset + 10] = detail?.u1 ?? 0; target[offset + 11] = detail?.v1 ?? 0;
        target[offset + 12] = overview ? overview.layer : -1; target[offset + 13] = detail ? detail.layer : -1;
        target[offset + 14] = tile?.overviewAt ?? 0; target[offset + 15] = tile?.detailAt ?? 0;
        target[offset + 16] = entry.backdrop ? 1 : 0; target[offset + 17] = entry.selected ? 1 : 0;
        target[offset + 18] = entry.status === 'running' ? 1 : entry.status === 'failed' ? 2 : 0; target[offset + 19] = 0;
        if (tile) latestTileAt = Math.max(latestTileAt, tile.overviewAt, tile.detailAt);
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, nodeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, nodeData.subarray(0, nodeCount * NODE_FLOATS), gl.DYNAMIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, groupBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, groupData.subarray(0, groupCount * NODE_FLOATS), gl.DYNAMIC_DRAW);
    },

    /** 重填连线实例。skip 返回真的线不画（节点层自己画着的线）。 */
    setEdges(edges: readonly SceneEdge[], skip: (edge: SceneEdge) => boolean): void {
      edgeData = grow(edgeData, edges.length * EDGE_FLOATS);
      edgeCount = 0;
      for (const edge of edges) {
        if (skip(edge)) continue;
        const offset = edgeCount++ * EDGE_FLOATS;
        edgeData.set(edge.points, offset);
        edgeData[offset + 8] = edge.selected ? 1 : 0;
        edgeData[offset + 9] = 1;
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, edgeBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, edgeData.subarray(0, edgeCount * EDGE_FLOATS), gl.DYNAMIC_DRAW);
    },

    /** 画一帧；返回画面是否还在淡入（需要继续安排下一帧）。 */
    draw(view: FarLayerView, colors: FarLayerColors, tiles: FarLayerTiles, time: number): boolean {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

      const drawNodes = (vao: WebGLVertexArrayObject | null, count: number) => {
        if (!count) return;
        gl.useProgram(nodeProgram);
        gl.uniform3f(nodeUniforms.uView, view.x, view.y, view.zoom);
        gl.uniform2f(nodeUniforms.uViewport, view.width, view.height);
        gl.uniform1f(nodeUniforms.uDpr, view.dpr);
        gl.uniform1f(nodeUniforms.uTime, time);
        gl.uniform1f(nodeUniforms.uRadius, colors.radius);
        gl.uniform3fv(nodeUniforms.uPanel, colors.panel);
        gl.uniform3fv(nodeUniforms.uBorder, colors.border);
        gl.uniform3fv(nodeUniforms.uAccent, colors.accent);
        gl.uniform3fv(nodeUniforms.uDanger, colors.danger);
        gl.uniform3fv(nodeUniforms.uGroup, colors.group);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tiles.overviewTexture);
        gl.uniform1i(nodeUniforms.uOverview, 0);
        gl.activeTexture(gl.TEXTURE1);
        // 清晰级还没建时绑概览纹理占位：实例里清晰层号为负，不会采样到
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, tiles.detailTexture ?? tiles.overviewTexture);
        gl.uniform1i(nodeUniforms.uDetail, 1);
        gl.bindVertexArray(vao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
      };

      drawNodes(groupVao, groupCount);
      if (edgeCount) {
        gl.useProgram(edgeProgram);
        gl.uniform3f(edgeUniforms.uView, view.x, view.y, view.zoom);
        gl.uniform2f(edgeUniforms.uViewport, view.width, view.height);
        gl.uniform1f(edgeUniforms.uDpr, view.dpr);
        gl.uniform3fv(edgeUniforms.uEdge, colors.edge);
        gl.uniform3fv(edgeUniforms.uAccent, colors.accent);
        gl.bindVertexArray(edgeVao);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, (EDGE_SEGMENTS + 1) * 2, edgeCount);
      }
      drawNodes(nodeVao, nodeCount);
      gl.bindVertexArray(null);
      return time - latestTileAt < TILE_FADE_SECONDS;
    },

    dispose(): void {
      for (const buffer of [quad, strip, nodeBuffer, groupBuffer, edgeBuffer]) gl.deleteBuffer(buffer);
      for (const vao of [nodeVao, groupVao, edgeVao]) gl.deleteVertexArray(vao);
      gl.deleteProgram(nodeProgram);
      gl.deleteProgram(edgeProgram);
    },
  };
}

export type FarLayerRenderer = ReturnType<typeof createFarLayerRenderer>;
