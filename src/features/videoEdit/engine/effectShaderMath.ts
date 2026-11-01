/*
 * 二维单形噪声改写自 https://github.com/ashima/webgl-noise/blob/master/src/noise2D.glsl 。
 * Copyright (C) 2011 by Ashima Arts (Simplex noise)
 * Copyright (C) 2011-2016 by Stefan Gustavson (Classic noise and others)
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */
/** 内置效果通过 effectShaderPrelude 的具名共享块装配；独立使用时需同时装配色彩数学。 */
export { COLOR_MATH_WGSL } from '@/core/imaging/effects/wgsl/colorMath'
/**
 * 与 WGSL `hash` 同一个无符号 32 位整数散列（不除以 2³²）：规划在 CPU 上从随机种子派生偏移、段号种子时用，
 * 与着色器里的随机同源。JS 位运算是有符号 32 位，每一步转回无符号，负数进着色器转 u32 不会变成 0。
 */
export function effectHash(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x >>> 0, 1664525) + Math.imul(y >>> 0, 1013904223) + Math.imul(seed >>> 0, 2654435769)) >>> 0
  h = (h ^ (h >>> 16)) >>> 0; h = Math.imul(h, 2246822519) >>> 0; h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 3266489917) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}
export const EFFECT_SHADER_MATH_WGSL = `
// WGSL 的 smoothstep 在 e0 ≥ e1 时结果未定义；过渡宽度为 0 时给出确定的阶跃。
fn ramp(e0: f32, e1: f32, x: f32) -> f32 { if (e1 > e0) { return smoothstep(e0, e1, x); } return select(0.0, 1.0, x >= e0); }
fn hash(p: vec2u, seed: u32) -> f32 {
 var h = p.x * 1664525u + p.y * 1013904223u + seed * 2654435769u;
 h ^= h >> 16u; h *= 2246822519u; h ^= h >> 13u; h *= 3266489917u; h ^= h >> 16u;
 return f32(h) / 4294967295.0;
}
fn noise(p: vec2f, seed: u32) -> f32 {
 let i = floor(p); let f = p - i; let w = f * f * (3.0 - 2.0 * f); let cell = vec2u(vec2i(i) + vec2i(1 << 20));
 let a = hash(cell, seed); let b = hash(cell + vec2u(1u, 0u), seed); let c = hash(cell + vec2u(0u, 1u), seed); let d = hash(cell + vec2u(1u, 1u), seed);
 return mix(mix(a, b, w.x), mix(c, d, w.x), w.y) * 2.0 - 1.0;
}
/** 与 noise 同一张格子的值噪声，另给解析梯度（平滑插值 3t² − 2t³ 的导数）：返回 (值 −1..1, ∂/∂x, ∂/∂y)。 */
fn noiseGradient(p: vec2f, seed: u32) -> vec3f {
 let i = floor(p); let f = p - i; let w = f * f * (3.0 - 2.0 * f); let dw = 6.0 * f * (1.0 - f); let cell = vec2u(vec2i(i) + vec2i(1 << 20));
 let a = hash(cell, seed); let b = hash(cell + vec2u(1u, 0u), seed); let c = hash(cell + vec2u(0u, 1u), seed); let d = hash(cell + vec2u(1u, 1u), seed);
 let k = a - b - c + d;
 return vec3f(2.0 * (a + (b - a) * w.x + (c - a) * w.y + k * w.x * w.y) - 1.0, 2.0 * dw * vec2f(b - a + k * w.y, c - a + k * w.x));
}

/** 编码 sRGB 颜色间插值；perceptual 时在 OkLab 中插值，保留超色域结果交给末道输出。 */
fn interpolateColor(a: vec3f, b: vec3f, t: f32, perceptual: bool) -> vec3f {
 if (!perceptual) { return mix(a, b, t); }
 return cgEnc(cgFromOklab(mix(cgOklab(cgLin(a)), cgOklab(cgLin(b)), t)));
}
/** Ashima Arts / Stefan Gustavson 的二维单形噪声，MIT，https://github.com/ashima/webgl-noise 。 */
fn simplexMod289(x: vec3f) -> vec3f { return x - floor(x / 289.0) * 289.0; }
fn simplexPermute(x: vec3f) -> vec3f { return simplexMod289(((x * 34.0) + 10.0) * x); }
fn simplexNoise(p: vec2f) -> f32 {
 let C = vec4f(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
 var i = floor(p + dot(p, C.yy));
 let x0 = p - i + dot(i, C.xx);
 let i1 = select(vec2f(0.0, 1.0), vec2f(1.0, 0.0), x0.x > x0.y);
 let x12 = x0.xyxy + C.xxzz - vec4f(i1, 0.0, 0.0);
 i = i - floor(i / 289.0) * 289.0;
 let perm = simplexPermute(simplexPermute(i.y + vec3f(0.0, i1.y, 1.0)) + i.x + vec3f(0.0, i1.x, 1.0));
 var m = max(0.5 - vec3f(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3f(0.0));
 m = m * m; m = m * m;
 let x = 2.0 * fract(perm * C.www) - 1.0; let h = abs(x) - 0.5; let ox = floor(x + 0.5); let a0 = x - ox;
 m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
 let g = vec3f(a0.x * x0.x + h.x * x0.y, a0.y * x12.x + h.y * x12.y, a0.z * x12.z + h.z * x12.w);
 return 130.0 * dot(m, g);
}
/** Sigg & Hadwiger 2005：三次 B 样条的四个权重。 */
fn bsplineWeights(t: f32) -> vec4f {
 let q = 1.0 - t; let t2 = t * t; let t3 = t2 * t;
 return vec4f(q * q * q, 3.0 * t3 - 6.0 * t2 + 4.0, -3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0, t3) / 6.0;
}
/** 四次双线性完成二维 B 样条，uv 为归一化坐标；由调用方 sampler 决定边缘模式。 */
fn sampleBSpline(image: texture_2d<f32>, filtering: sampler, uv: vec2f) -> vec4f {
 let size = vec2f(textureDimensions(image)); let p = uv * size - 0.5; let cell = floor(p); let f = fract(p);
 let wx = bsplineWeights(f.x); let wy = bsplineWeights(f.y);
 let gx = vec2f(wx.x + wx.y, wx.z + wx.w); let gy = vec2f(wy.x + wy.y, wy.z + wy.w);
 let x = (cell.x + vec2f(-1.0 + wx.y / gx.x, 1.0 + wx.w / gx.y) + 0.5) / size.x;
 let y = (cell.y + vec2f(-1.0 + wy.y / gy.x, 1.0 + wy.w / gy.y) + 0.5) / size.y;
 return textureSampleLevel(image, filtering, vec2f(x.x, y.x), 0.0) * gx.x * gy.x
      + textureSampleLevel(image, filtering, vec2f(x.y, y.x), 0.0) * gx.y * gy.x
      + textureSampleLevel(image, filtering, vec2f(x.x, y.y), 0.0) * gx.x * gy.y
      + textureSampleLevel(image, filtering, vec2f(x.y, y.y), 0.0) * gx.y * gy.y;
}
`
