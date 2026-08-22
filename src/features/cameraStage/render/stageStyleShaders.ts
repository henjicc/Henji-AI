/**
 * 样式渲染的合成着色器：读取深度缓冲（RGBA 打包）与法线缓冲，合成出最终画面。
 *
 * 输出**不做任何色彩空间与色调映射转换**：深度/线稿是数据不是照片，画布预览与离屏导出
 * 都直接写这里算出的灰度值，两条路径才能得到逐字节一致的结果。
 */

export type StageStyleModeCode = 1 | 2 | 3 | 4

/** 与合成着色器 uMode 对应的模式码 */
export const STAGE_STYLE_MODE_CODES = {
  depth: 1,
  normal: 2,
  lineart: 3,
  silhouette: 4,
} as const satisfies Record<string, StageStyleModeCode>

export const STAGE_STYLE_VERTEX_SHADER = `
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const STAGE_STYLE_FRAGMENT_SHADER = `
#include <packing>

uniform sampler2D uDepthBuffer;
uniform sampler2D uNormalBuffer;
uniform vec2 uTexel;
uniform float uCameraNear;
uniform float uCameraFar;
uniform float uRangeNear;
uniform float uRangeFar;
uniform float uLineScale;
uniform int uMode;

varying vec2 vUv;

/* 清屏值 1.0 表示这里没有几何体；真实几何的非线性深度离 1.0 还很远（远平面 1000 时约 333 单位外才逼近）。 */
const float BACKGROUND_DEPTH = 0.9999;
/* 逆深度二阶差分：平面恒为 0，越过遮挡边界才跳起来 */
const float DEPTH_EDGE_MIN = 0.01;
const float DEPTH_EDGE_MAX = 0.04;
/* 法线夹角差（1 - cos）：折边判定 */
const float NORMAL_EDGE_MIN = 0.12;
const float NORMAL_EDGE_MAX = 0.35;

/** 返回视距；背景返回 -1 */
float viewDistanceAt(vec2 uv) {
  float clipZ = unpackRGBAToDepth(texture2D(uDepthBuffer, uv));
  if (clipZ >= BACKGROUND_DEPTH) return -1.0;
  return -perspectiveDepthToViewZ(clipZ, uCameraNear, uCameraFar);
}

vec3 viewNormalAt(vec2 uv) {
  return normalize(texture2D(uNormalBuffer, uv).rgb * 2.0 - 1.0);
}

/**
 * 边缘强度：轮廓靠进深、折边靠法线。
 *
 * 进深不能直接比差值，也不能比相对差值：一路铺到远处的地面每跨一个像素进深就翻一截，
 * 按差值判定会把整片地面刷成线。透视投影下**逆深度（1/视距）在屏幕上是线性的**，
 * 于是任何平面的二阶差分恒为 0，无论它相对视线多掠射；只有跨过遮挡边界或曲面转折时才跳起来。
 */
float lineStrength(vec2 uv, float centerDistance, bool centerIsBackground) {
  vec2 offset = uTexel * uLineScale;
  float left = viewDistanceAt(uv - vec2(offset.x, 0.0));
  float right = viewDistanceAt(uv + vec2(offset.x, 0.0));
  float down = viewDistanceAt(uv - vec2(0.0, offset.y));
  float up = viewDistanceAt(uv + vec2(0.0, offset.y));
  bool neighbourBackground = left < 0.0 || right < 0.0 || down < 0.0 || up < 0.0;
  bool neighbourForeground = left >= 0.0 || right >= 0.0 || down >= 0.0 || up >= 0.0;

  if (centerIsBackground) return neighbourForeground ? 1.0 : 0.0;
  if (neighbourBackground) return 1.0;

  float centerInverse = 1.0 / max(centerDistance, 0.001);
  float horizontal = abs(2.0 * centerInverse - 1.0 / left - 1.0 / right);
  float vertical = abs(2.0 * centerInverse - 1.0 / down - 1.0 / up);
  float depthEdge = smoothstep(DEPTH_EDGE_MIN, DEPTH_EDGE_MAX, (horizontal + vertical) / centerInverse);

  vec3 centerNormal = viewNormalAt(uv);
  float normalDelta = 1.0 - dot(centerNormal, viewNormalAt(uv - vec2(offset.x, 0.0)));
  normalDelta = max(normalDelta, 1.0 - dot(centerNormal, viewNormalAt(uv + vec2(offset.x, 0.0))));
  normalDelta = max(normalDelta, 1.0 - dot(centerNormal, viewNormalAt(uv - vec2(0.0, offset.y))));
  normalDelta = max(normalDelta, 1.0 - dot(centerNormal, viewNormalAt(uv + vec2(0.0, offset.y))));
  float normalEdge = smoothstep(NORMAL_EDGE_MIN, NORMAL_EDGE_MAX, normalDelta);

  return clamp(max(depthEdge, normalEdge), 0.0, 1.0);
}

void main() {
  float viewDistance = viewDistanceAt(vUv);
  bool isBackground = viewDistance < 0.0;
  vec3 color = vec3(1.0);

  if (uMode == 1) {
    float normalized = clamp(
      (viewDistance - uRangeNear) / max(0.0001, uRangeFar - uRangeNear),
      0.0,
      1.0
    );
    color = isBackground ? vec3(0.0) : vec3(1.0 - normalized);
  } else if (uMode == 2) {
    color = isBackground ? vec3(0.5, 0.5, 1.0) : texture2D(uNormalBuffer, vUv).rgb;
  } else if (uMode == 4) {
    color = isBackground ? vec3(1.0) : vec3(0.0);
  } else {
    color = vec3(1.0 - lineStrength(vUv, viewDistance, isBackground));
  }

  gl_FragColor = vec4(color, 1.0);
}
`
