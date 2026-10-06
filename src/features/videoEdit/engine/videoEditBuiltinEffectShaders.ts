/**
 * 内置效果的 WGSL（任务 4.7b）：一个模块、多个片元入口，全部共用同一组绑定。
 * - binding 0 `source`：本道工序的输入；binding 3 `original`：效果的原始输入（锐化、发光叠回原图时用）。
 * - binding 2 是 16 个 float：`size` = (目标宽, 目标高, 输入宽, 输入高)，`a`/`b`/`c` 由 `videoEditBuiltinEffectPasses.ts` 按入口打包。
 * 画面是预乘透明度的 sRGB 编码值；改颜色的入口先还原直通色，曝光与白平衡在线性光里计算。
 * 所有入口不读时间、不用随机数（胶片颗粒的种子来自帧号），同一帧预览与导出结果相同。
 */
export const VIDEO_EDIT_BUILTIN_EFFECT_ENTRIES = ['copy', 'blur', 'line', 'zoom', 'unsharp', 'brightness_contrast', 'gain_linear', 'hue_saturation', 'invert', 'mosaic', 'vignette', 'grain', 'chromatic', 'glow_extract', 'glow_add', 'crop', 'flip', 'chroma_key'] as const
export type VideoEditBuiltinEffectEntry = typeof VIDEO_EDIT_BUILTIN_EFFECT_ENTRIES[number]

export const VIDEO_EDIT_BUILTIN_EFFECT_SHADER = `
struct Params { size: vec4f, a: vec4f, b: vec4f, c: vec4f }
@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var<uniform> u: Params;
@group(0) @binding(3) var original: texture_2d<f32>;
struct Vertex { @builtin(position) position: vec4f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
 let p = array<vec2f, 3>(vec2f(-1, -1), vec2f(3, -1), vec2f(-1, 3))[i];
 return Vertex(vec4f(p, 0, 1));
}
const LUMA = vec3f(0.2126, 0.7152, 0.0722);
fn uvOf(v: Vertex) -> vec2f { return v.position.xy / u.size.xy; }
fn tap(uv: vec2f) -> vec4f { return textureSampleLevel(source, s, uv, 0.0); }
fn tapOriginal(uv: vec2f) -> vec4f { return textureSampleLevel(original, s, uv, 0.0); }
fn inside(uv: vec2f) -> bool { return all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)); }
/** repeat = 0 时画面外是透明（边缘向外渐隐）。 */
fn tapEdge(uv: vec2f, repeat: f32) -> vec4f { if (repeat < 0.5 && !inside(uv)) { return vec4f(0.0); } return tap(uv); }
fn straight(c: vec4f) -> vec3f { if (c.a <= 0.00001) { return vec3f(0.0); } return c.rgb / c.a; }
fn premul(rgb: vec3f, a: f32) -> vec4f { return vec4f(clamp(rgb, vec3f(0.0), vec3f(1.0)) * a, a); }
fn toLinear(c: vec3f) -> vec3f { let x = max(c, vec3f(0.0)); return select(pow((x + 0.055) / 1.055, vec3f(2.4)), x / 12.92, x <= vec3f(0.04045)); }
fn toSrgb(c: vec3f) -> vec3f { let x = max(c, vec3f(0.0)); return select(1.055 * pow(x, vec3f(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3f(0.0031308)); }

/** 直接取样（目标是输入的一半时就是 2×2 平均的降采样，目标更大时是双线性放大）。 */
@fragment fn copy(v: Vertex) -> @location(0) vec4f { return tap(uvOf(v)); }

/** 一维高斯：a = (步长 u, 步长 v, sigma（输入像素）, 半径（取样数）)，b.x 重复边缘。 */
@fragment fn blur(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let n = i32(u.a.w); let k = -0.5 / max(u.a.z * u.a.z, 0.0001);
 var sum = vec4f(0.0); var weight = 0.0;
 for (var i = -n; i <= n; i++) {
  let w = exp(f32(i * i) * k);
  sum += tapEdge(uv + u.a.xy * f32(i), u.b.x) * w; weight += w;
 }
 return sum / weight;
}

/** 等权直线取样（方向模糊）：a = (每步 u, 每步 v, 取样数)，以当前像素为中心。 */
@fragment fn line(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let n = i32(u.a.z); let middle = (u.a.z - 1.0) * 0.5;
 var sum = vec4f(0.0);
 for (var i = 0; i < n; i++) { sum += tap(uv + u.a.xy * (f32(i) - middle)); }
 return sum / u.a.z;
}

/** 朝中心缩放取样（缩放模糊）：a = (中心 u, 中心 v, 每步缩放, 取样数)。 */
@fragment fn zoom(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let n = i32(u.a.w);
 var sum = vec4f(0.0);
 for (var i = 0; i < n; i++) { sum += tap(u.a.xy + (uv - u.a.xy) * (1.0 - u.a.z * f32(i))); }
 return sum / u.a.w;
}

/** 反锐化掩模：source 是模糊后的画面，original 是原画面；a.x 锐化量。 */
@fragment fn unsharp(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let o = tapOriginal(uv); let b = tap(uv);
 let rgb = o.rgb + (o.rgb - b.rgb) * u.a.x;
 return vec4f(clamp(rgb, vec3f(0.0), vec3f(o.a)), o.a);
}

/** a = (亮度偏移, 对比度倍数)。 */
@fragment fn brightness_contrast(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v));
 return premul((straight(c) - 0.5) * u.a.y + 0.5 + u.a.x, c.a);
}

/** 线性光里逐通道增益（曝光、白平衡）：a.rgb。 */
@fragment fn gain_linear(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v));
 return premul(toSrgb(toLinear(straight(c)) * u.a.rgb), c.a);
}

/** a = (cos 色相角, sin 色相角, 饱和度倍数, 明度 -1..1)；黑白就是饱和度 0。 */
@fragment fn hue_saturation(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = straight(c);
 let k = vec3f(0.57735027);
 rgb = rgb * u.a.x + cross(k, rgb) * u.a.y + k * dot(k, rgb) * (1.0 - u.a.x);
 rgb = mix(vec3f(dot(rgb, LUMA)), rgb, u.a.z);
 rgb = select(rgb * (1.0 + u.a.w), rgb + (1.0 - rgb) * u.a.w, u.a.w > 0.0);
 return premul(rgb, c.a);
}

@fragment fn invert(v: Vertex) -> @location(0) vec4f { let c = tap(uvOf(v)); return premul(1.0 - straight(c), c.a); }

/** a = (块宽 u, 块高 v)；块以画面中心对齐，每块取 4×4 个双线性取样的平均。 */
@fragment fn mosaic(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let block = u.a.xy;
 let origin = (floor((uv - 0.5) / block) * block) + 0.5;
 var sum = vec4f(0.0);
 for (var y = 0; y < 4; y++) { for (var x = 0; x < 4; x++) { sum += tap(clamp(origin + block * (vec2f(f32(x), f32(y)) + 0.5) / 4.0, vec2f(0.0), vec2f(1.0))); } }
 return sum / 16.0;
}

/** a = (数量 -1..1, 开始位置, 羽化宽度, 宽高比)；距离按画面形状归一化，角落为 1。 */
@fragment fn vignette(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let c = tap(uv); var rgb = straight(c);
 let q = (uv - 0.5) * vec2f(u.a.w, 1.0);
 let r = length(q) / length(vec2f(u.a.w, 1.0) * 0.5);
 let t = smoothstep(u.a.y - u.a.z * 0.5, u.a.y + u.a.z * 0.5, r);
 rgb = select(rgb * (1.0 - u.a.x * t), rgb + (1.0 - rgb) * (-u.a.x) * t, u.a.x < 0.0);
 return premul(rgb, c.a);
}

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
/** a = (强度, 颗粒大小（目标像素）, 种子, 单色)；中间调最明显，暗部与高光收敛。 */
@fragment fn grain(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let rgb = straight(c);
 let p = v.position.xy / max(u.a.y, 0.5); let seed = u32(u.a.z);
 let mono = noise(p, seed);
 let n = select(vec3f(mono, noise(p, seed + 7919u), noise(p, seed + 15887u)), vec3f(mono), u.a.w > 0.5);
 let l = dot(rgb, LUMA);
 return premul(rgb + n * u.a.x * (0.35 + 2.6 * l * (1.0 - l)), c.a);
}

/** a = (偏移 u, 偏移 v, 从中心向外)。红通道向外、蓝通道向内。 */
@fragment fn chromatic(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v);
 let offset = select(u.a.xy, (uv - 0.5) * 2.0 * u.a.xy, u.a.z > 0.5);
 let r = tap(uv + offset); let g = tap(uv); let b = tap(uv - offset);
 let a = max(max(r.a, g.a), b.a);
 return vec4f(min(vec3f(r.r, g.g, b.b), vec3f(a)), a);
}

/** 提取亮部：a = (阈值, 过渡宽度)。 */
@fragment fn glow_extract(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v));
 return c * smoothstep(u.a.x, u.a.x + u.a.y, dot(straight(c), LUMA));
}
/** 光晕叠回原画面：source 是模糊后的亮部，a.x 强度。 */
@fragment fn glow_add(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let o = tapOriginal(uv); let g = tap(uv) * u.a.x;
 let a = clamp(o.a + g.a * (1.0 - o.a), 0.0, 1.0);
 return vec4f(min(o.rgb + g.rgb, vec3f(a)), a);
}

/** a = (左, 上, 右, 下) 保留区域的边界（uv），b = (羽化 u, 羽化 v)；裁掉部分透明。 */
@fragment fn crop(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let c = tap(uv);
 let x = clamp(min(uv.x - u.a.x, u.a.z - uv.x) / u.b.x, 0.0, 1.0);
 let y = clamp(min(uv.y - u.a.y, u.a.w - uv.y) / u.b.y, 0.0, 1.0);
 return c * (x * y);
}

/** a = (水平, 垂直) 是否翻转。 */
@fragment fn flip(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v);
 return tap(vec2f(select(uv.x, 1.0 - uv.x, u.a.x > 0.5), select(uv.y, 1.0 - uv.y, u.a.y > 0.5)));
}

/** a = (抠像色 Cb, 抠像色 Cr, 容差, 柔化)，b.x 溢色抑制；色度距离（BT.709）决定透明度。 */
@fragment fn chroma_key(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = straight(c);
 let y = dot(rgb, LUMA);
 let chroma = vec2f((rgb.b - y) / 1.8556, (rgb.r - y) / 1.5748);
 let d = distance(chroma, u.a.xy);
 let keep = smoothstep(u.a.z, u.a.z + u.a.w, d);
 let spill = u.b.x * (1.0 - smoothstep(u.a.z, u.a.z + u.a.w + 0.15, d));
 rgb = mix(rgb, vec3f(y), spill);
 return premul(rgb, c.a * keep);
}
`
