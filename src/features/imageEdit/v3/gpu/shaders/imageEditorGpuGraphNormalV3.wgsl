struct Params {
  inverseLinear: vec4f,
  inverseTranslation: vec4f,
  options: vec4f,
  maskOptions: vec4f,
}
@group(0) @binding(0) var contentTexture: texture_2d<f32>;
@group(0) @binding(1) var maskTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;
fn loadColor(coord: vec2i) -> vec4f { let s = vec2i(textureDimensions(contentTexture)); if (any(coord < vec2i(0)) || any(coord >= s)) { return vec4f(0.0); } return textureLoad(contentTexture, coord, 0); }
fn sampleColor(point: vec2f) -> vec4f { let p = vec2i(floor(point)); let f = fract(point); return mix(mix(loadColor(p), loadColor(p + vec2i(1, 0)), f.x), mix(loadColor(p + vec2i(0, 1)), loadColor(p + vec2i(1, 1)), f.x), f.y); }
fn loadMask(coord: vec2i) -> f32 { let s = vec2i(textureDimensions(maskTexture)); if (any(coord < vec2i(0)) || any(coord >= s)) { return params.maskOptions.y; } return textureLoad(maskTexture, coord, 0).r; }
fn sampleMask(point: vec2f) -> f32 { if (params.maskOptions.x < 0.5) { return params.maskOptions.y; } let p = vec2i(floor(point)); let f = fract(point); let v = mix(mix(loadMask(p), loadMask(p + vec2i(1, 0)), f.x), mix(loadMask(p + vec2i(0, 1)), loadMask(p + vec2i(1, 1)), f.x), f.y); return select(v, 1.0 - v, params.maskOptions.z > 0.5); }
@vertex fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f { let p = array<vec2f, 3>(vec2f(-1), vec2f(3, -1), vec2f(-1, 3)); return vec4f(p[vi], 0, 1); }
@fragment fn fs_main(@builtin(position) position: vec4f) -> @location(0) vec4f { let m = params.inverseLinear; let point = vec2f(m.x * position.x + m.z * position.y + params.inverseTranslation.x, m.y * position.x + m.w * position.y + params.inverseTranslation.y) - vec2f(0.5); return sampleColor(point) * (params.options.x * sampleMask(point)); }
