/**
 * 录屏自动缩放与录屏画框的着色器（与内置效果共用绑定，见 videoEditBuiltinEffectShaders.ts）。
 * 放大用 Catmull-Rom 双三次取样（9 次双线性取样），文字放大到 5 倍仍保持边缘清晰；缩小内容按覆盖范围多点平均，避免细字闪烁。
 */
export const RECORDING_ZOOM_WGSL = `
fn zoomBicubic(uv: vec2f) -> vec4f {
 let size = vec2f(textureDimensions(source));
 let p = uv * size - 0.5; let f = fract(p); let base = floor(p);
 let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
 let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
 let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
 let w3 = f * f * (-0.5 + 0.5 * f);
 let w12 = w1 + w2;
 let t0 = (base - 0.5) / size; let t3 = (base + 2.5) / size; let t12 = (base + 0.5 + w2 / w12) / size;
 let c = (tap(vec2f(t0.x, t0.y)) * w0.x + tap(vec2f(t12.x, t0.y)) * w12.x + tap(vec2f(t3.x, t0.y)) * w3.x) * w0.y
  + (tap(vec2f(t0.x, t12.y)) * w0.x + tap(t12) * w12.x + tap(vec2f(t3.x, t12.y)) * w3.x) * w12.y
  + (tap(vec2f(t0.x, t3.y)) * w0.x + tap(vec2f(t12.x, t3.y)) * w12.x + tap(vec2f(t3.x, t3.y)) * w3.x) * w3.y;
 let a = clamp(c.a, 0.0, 1.0);
 return vec4f(clamp(c.rgb, vec3f(0.0), vec3f(a)), a);
}
/** a、b.xy = 输出 → 取样位置的仿射；c、b.zw = 输出 → 片段画面坐标的仿射（片段范围外透明，边缘按像素抗锯齿）。 */
@fragment fn recording_zoom(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v);
 let q = vec2f(dot(u.c.xy, uv), dot(u.c.zw, uv)) + u.b.zw;
 let w = max(fwidth(q), vec2f(0.000001));
 let edge = min(min(q.x, 1.0 - q.x) / w.x, min(q.y, 1.0 - q.y) / w.y);
 let cover = clamp(edge + 0.5, 0.0, 1.0);
 let p = vec2f(dot(u.a.xy, uv), dot(u.a.zw, uv)) + u.b.xy;
 return zoomBicubic(p) * cover;
}
/** a = 内容放置矩形（归一化 x0,y0,x1,y1）；b = 取样的内容矩形；c = (圆角像素, 每个输出像素覆盖的输入像素数)。 */
@fragment fn recording_frame_content(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v);
 let lo = u.a.xy * u.size.xy; let hi = u.a.zw * u.size.xy;
 let halfSize = max((hi - lo) * 0.5, vec2f(0.0)); let center = (lo + hi) * 0.5;
 let r = min(u.c.x, min(halfSize.x, halfSize.y));
 let q = abs(v.position.xy - center) - halfSize + r;
 let d = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - r;
 let cover = clamp(0.5 - d, 0.0, 1.0);
 let local = (uv - u.a.xy) / max(u.a.zw - u.a.xy, vec2f(0.000001));
 let p = mix(u.b.xy, u.b.zw, local);
 let o = vec2f(max(u.c.y, 1.0) * 0.25) / u.size.zw;
 let c = (tap(p + vec2f(-o.x, -o.y)) + tap(p + vec2f(o.x, -o.y)) + tap(p + vec2f(-o.x, o.y)) + tap(p + o)) * 0.25;
 return c * cover;
}
/** source = 模糊后的内容（取透明度作投影），original = 摆好的内容；a = (渐变起点色, 投影浓度)；b = (渐变终点色, 投影下移)；c.xy = 渐变方向。 */
@fragment fn recording_frame_compose(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v);
 let reach = abs(u.c.x) * 0.5 + abs(u.c.y) * 0.5;
 let t = smoothstep(0.0, 1.0, clamp(dot(uv - 0.5, u.c.xy) / max(reach, 0.000001) * 0.5 + 0.5, 0.0, 1.0));
 let shadow = tap(uv - vec2f(0.0, u.b.w)).a * u.a.w;
 let background = mix(u.a.rgb, u.b.rgb, t) * (1.0 - shadow);
 let content = tapOriginal(uv);
 return vec4f(content.rgb + background * (1.0 - content.a), 1.0);
}
`
