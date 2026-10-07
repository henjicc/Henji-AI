/**
 * MIT algorithms adapted from shader-effects-inc/shaders @ dbfd42a (2026 Shader Effects Inc.).
 * See catalog.sourceEffect for the upstream node. Closed, host-owned WGSL; no author interpolation.
 * Uses the builtin ABI (u.size/a/b/c, source/original/sampler) and premultiplied encoded sRGB.
 * Upstream std's broad graph/DOM/feedback features are deliberately absent. See t66 for deviations.
 */
const backgrounds = {
  shader_linear_gradient: 'let f = clamp(p.x * density + 0.5, 0.0, 1.0);',
  shader_radial_gradient: 'let f = clamp(length(p) * density, 0.0, 1.0);',
  shader_conic_gradient: 'let f = fract(atan2(p.y, p.x) / SL_TAU + 0.5);',
  shader_diamond_gradient: 'let f = clamp((abs(p.x) + abs(p.y)) * density, 0.0, 1.0);',
  shader_mesh_gradient: 'let q = uv + 0.12 * sin(vec2f(uv.y, uv.x) * 6.0 + u.a.z); let f = clamp(mix(q.x, 1.0 - q.x, q.y), 0.0, 1.0);',
  shader_flowing_gradient: 'let f = slFbm(p * density * 0.35 + vec2f(u.a.z * 0.08, 0.0));',
  shader_aurora: `var f = 0.0;
    for (var i = 0; i < 4; i++) {
      let layer = f32(i); let offsets = array<f32,4>(0.0,3.1,6.7,9.4); let weights = array<f32,4>(1.0,0.65,0.45,0.3); let t = u.a.z * 0.25 + offsets[i];
      let path = sin(p.x * density * 0.7 + t * 0.4) * 0.15 + sin(p.x * density * 1.6 + t * 0.65) * 0.08 + sin(p.x * density * 2.9 + t * 0.3) * 0.04;
      let h = p.y + 0.25 - layer * 0.07 - path;
      let rays = 0.45 + 0.55 * slNoise(vec2f(p.x * density * 5.0, t));
      f += exp(-abs(h) * 9.0) * rays * weights[i];
    }`,
  shader_perlin_noise: 'let f = slNoise(p * density + vec2f(u.a.z * 0.12, u.a.z * 0.07));',
  shader_fractal_noise: 'let f = slFbm(p * density + vec2f(u.a.z * 0.1, 0.0));',
  shader_plasma: 'let q = p * density; let f = 0.5 + (sin(q.x + u.a.z) + sin(q.y - u.a.z) + sin((q.x + q.y) * 0.7 + u.a.z) + sin(length(q) * 1.5 - u.a.z)) * 0.125;',
  shader_marble: 'let q = p * density; let f = 0.5 + 0.5 * sin(q.x + 10.0 * slFbm(q * 0.4 + u.a.z * 0.05));',
  shader_worley_noise: `let q = p * density; let cell = floor(q); var near = 2.0;
    for (var y = -1; y <= 1; y++) { for (var x = -1; x <= 1; x++) {
      let c = cell + vec2f(f32(x), f32(y)); let h = vec2f(slHash(c), slHash(c + 71.0));
      let point = c + 0.5 + 0.4 * sin(SL_TAU * h + u.a.z * 0.2);
      near = min(near, length(point - q));
    }} let f = clamp(near, 0.0, 1.0);`,
  shader_grid: 'let q = abs(fract(p * density + 0.5) - 0.5); let edge = min(q.x, q.y); let aa = density / u.size.y; let f = 1.0 - smoothstep(0.015, 0.015 + aa, edge);',
  shader_dot_grid: 'let q = fract(p * density) - 0.5; let aa = density / u.size.y; let f = 1.0 - smoothstep(0.12, 0.12 + aa, length(q));',
  shader_checkerboard: 'let cell = floor(p * density); let f = f32((i32(cell.x) + i32(cell.y)) & 1);',
  shader_stripes: 'let f = smoothstep(-0.04, 0.04, sin(p.x * density * SL_TAU + u.a.z));',
  shader_beam: 'let theta = atan2(p.y, p.x); let ray = pow(0.5 + 0.5 * sin(theta * density + u.a.z * 0.15), 8.0); let f = ray * exp(-length(p) * 1.5);',
  shader_sparkle: `let q = p * density * 4.0; let cell = floor(q); let h = slHash(cell); let center = vec2f(slHash(cell + 11.0), slHash(cell + 97.0));
    let r = length(fract(q) - center); let f = select(0.0, exp(-r * r * 500.0) * (0.45 + 0.55 * sin(u.a.z + h * SL_TAU)), h > 0.7);`,
} as const
const filters = {
  shader_chromatic: `let delta = vec2f(cos(u.a.w) / slAspect(), sin(u.a.w)) * u.a.x * 0.02;
    let red = tap(uv + delta); let blue = tap(uv - delta);
    let rgb = vec3f(straight(red).r, straight(base).g, straight(blue).b); return premul(rgb, base.a);`,
  shader_scanlines: 'let wave = 0.5 + 0.5 * cos(uv.y * (40.0 + u.a.y * 12.0) * SL_TAU); return premul(straight(base) * (1.0 - wave * u.a.x * 0.65), base.a);',
  shader_vhs: `let row = floor(uv.y * (40.0 + u.a.y * 10.0)); let tick = floor(u.a.z * 24.0);
    let jitter = (slHash(vec2f(row, tick)) - 0.5) * 0.03 * u.a.x;
    let q = uv + vec2f(jitter, 0.0); let c = tap(q); let r = tap(q + vec2f(u.a.x * 0.006, 0.0));
    let rgb = vec3f(straight(r).r, straight(c).g, straight(c).b) * (1.0 - (0.5 + 0.5 * cos(uv.y * u.size.y * 1.5)) * 0.2 * u.a.x);
    return mix(base, premul(rgb, c.a), u.a.x);`,
  shader_halftone: `let density = 12.0 + u.a.y * 2.0; let p = slRotate((uv - 0.5) * vec2f(slAspect(), 1.0), u.a.w);
    let q = fract(p * density) - 0.5; let lum = dot(straight(base), LUMA); let radius = sqrt(max(0.0, 1.0 - lum)) * 0.7;
    let ink = smoothstep(radius - density / u.size.y, radius + density / u.size.y, length(q));
    return mix(base, premul(vec3f(ink), base.a), u.a.x);`,
  shader_pixelate: `let block = vec2f(1.0 / slAspect(), 1.0) / (8.0 + u.a.y * 2.0);
    let q = (floor(uv / block) + 0.5) * block; return mix(base, tap(q), u.a.x);`,
  shader_ascii: `let count = 12.0 + u.a.y; let grid = vec2f(slAspect(), 1.0) * count;
    let cell = floor(uv * grid); let q = fract(uv * grid) - 0.5; let c = tap((cell + 0.5) / grid); let lum = dot(straight(c), LUMA);
    let tier = floor(lum * 7.0); let aa = count / u.size.y;
    var dist = length(q) - 0.08;
    if (tier >= 2.0) { dist = min(dist, max(abs(q.x) - 0.04, abs(q.y) - 0.3)); }
    if (tier >= 3.0) { dist = min(dist, max(abs(q.y) - 0.04, abs(q.x) - 0.3)); }
    if (tier >= 4.0) { dist = min(dist, max(abs(q.x - q.y) * 0.707 - 0.04, length(q) - 0.4)); }
    if (tier >= 5.0) { dist = min(dist, max(abs(q.x + q.y) * 0.707 - 0.04, length(q) - 0.4)); }
    if (tier >= 6.0) { dist = min(dist, abs(max(abs(q.x), abs(q.y)) - 0.32) - 0.03); }
    let glyph = (1.0 - smoothstep(-aa, aa, dist)) * select(0.0, 1.0, tier >= 1.0);
    return mix(base, premul(straight(c) * glyph, c.a), u.a.x);`,
  shader_glass: `let axis = vec2f(cos(u.a.w), sin(u.a.w)); let p = (uv - 0.5) * vec2f(slAspect(), 1.0);
    let off = sin(dot(p, axis) * (4.0 + u.a.y) * SL_TAU) * u.a.x * 0.03;
    return tap(uv + axis / vec2f(slAspect(), 1.0) * off);`,
  shader_glass_tiles: `let density = 3.0 + u.a.y * 0.35; let p = uv * vec2f(slAspect(), 1.0) * density;
    let q = fract(p) - 0.5; let delta = q * (0.5 - length(q)) * u.a.x * 0.8 / density;
    return tap(uv + delta / vec2f(slAspect(), 1.0));`,
  shader_twirl: `let p = (uv - 0.5) * vec2f(slAspect(), 1.0); let theta = u.a.x * u.a.w * 4.0 * length(p);
    return tap(0.5 + slRotate(p, theta) / vec2f(slAspect(), 1.0));`,
  shader_wave: `let axis = vec2f(cos(u.a.w), sin(u.a.w)); let p = (uv - 0.5) * vec2f(slAspect(), 1.0);
    let wave = sin(dot(p, vec2f(-axis.y, axis.x)) * (1.0 + u.a.y * 0.1) * SL_TAU + u.a.z);
    return tap(uv + axis / vec2f(slAspect(), 1.0) * wave * u.a.x * 0.08);`,
  shader_vignette: 'let radius = length((uv - 0.5) / vec2f(0.7071)); let shade = smoothstep(0.35, 1.0, radius); return premul(straight(base) * (1.0 - shade * u.a.x), base.a);',
  shader_grain: `let q = floor(uv * vec2f(slAspect(), 1.0) * (120.0 + u.a.y * 35.0));
    let noise = slHash(q + vec2f(floor(u.a.z * 24.0), 0.0)) - 0.5;
    return premul(straight(base) + noise * u.a.x * 0.4, base.a);`,
  shader_kaleidoscope: `let p = (uv - 0.5) * vec2f(slAspect(), 1.0); let radius = length(p); let sector = SL_TAU / (2.0 + floor(u.a.y * 0.18));
    let theta = abs(fract((atan2(p.y, p.x) + u.a.w) / sector + 0.5) - 0.5) * sector;
    let q = vec2f(cos(theta), sin(theta)) * radius; return mix(base, tap(0.5 + q / vec2f(slAspect(), 1.0)), u.a.x);`,
} as const
const transitions = {
  shader_noise_dissolve: 'let field = slFbm(p * density); let mask = mix(t, slReveal(field, t, feather), u.a.x); return mix(slOutgoing(uv), slIncoming(uv), mask);',
  shader_block_dissolve: 'let field = slHash(floor(p * density)); let mask = mix(t, slReveal(field, t, feather), u.a.x); return mix(slOutgoing(uv), slIncoming(uv), mask);',
  shader_diamond_wipe: 'let field = (abs(p.x) + abs(p.y)) / ((slAspect() + 1.0) * 0.5); let mask = mix(t, slReveal(field, t, feather), u.a.x); return mix(slOutgoing(uv), slIncoming(uv), mask);',
  shader_linear_wipe: 'let field = dot(p, vec2f(cos(u.a.w), sin(u.a.w))) / (abs(cos(u.a.w)) * slAspect() + abs(sin(u.a.w))) + 0.5; let mask = mix(t, slReveal(field, t, feather), u.a.x); return mix(slOutgoing(uv), slIncoming(uv), mask);',
  shader_light_leak: `let bell = sin(t * 3.14159265); let axis = vec2f(cos(u.a.w), sin(u.a.w)); let pos = dot(p,axis) / (abs(axis.x)*slAspect()+abs(axis.y)) + 0.5;
    let band = exp(-pow((pos - t) * (2.0 + u.a.y * 0.1), 2.0)) * bell * u.a.x;
    let base = mix(slOutgoing(uv), slIncoming(uv), t); let rgb = toSrgb(toLinear(straight(base)) + vec3f(1.0, 0.32, 0.06) * band);
    return premul(rgb, base.a);`,
  shader_ripple_wipe: `let radius = length(p); let ripple = sin(radius * density * SL_TAU - t * 12.0) * sin(t * 3.14159265) * u.a.x * 0.04;
    let q = uv + p / max(radius, 0.001) / vec2f(slAspect(), 1.0) * ripple;
    let mask = slReveal(radius / length(vec2f(slAspect(), 1.0) * 0.5), t, feather);
    return mix(slOutgoing(q), slIncoming(q), mask);`,
} as const
export type ShaderLibraryEntry = keyof typeof backgrounds | keyof typeof filters | keyof typeof transitions | 'sl_glow_extract' | 'sl_glow_down' | 'sl_glow_up' | 'sl_glow_composite'
export const SHADER_LIBRARY_ENTRIES = [...Object.keys(backgrounds), ...Object.keys(filters), ...Object.keys(transitions), 'sl_glow_extract', 'sl_glow_down', 'sl_glow_up', 'sl_glow_composite'] as readonly ShaderLibraryEntry[]

const helpers = `
const SL_TAU = 6.28318530718;
fn slAspect() -> f32 { return u.size.x / u.size.y; }
fn slRotate(p: vec2f, angle: f32) -> vec2f { let c = cos(angle); let s = sin(angle); return vec2f(p.x*c-p.y*s, p.x*s+p.y*c); }
// Integer hash: stable seed, no sin/fract stochastic drift or prior-frame state.
fn slHash(p: vec2f) -> f32 {
  let cell = vec2i(floor(p)); var h = bitcast<u32>(cell.x) * 374761393u + bitcast<u32>(cell.y) * 668265263u + u32(u.b.w) * 1442695041u;
  h = (h ^ (h >> 13u)) * 1274126177u; h = h ^ (h >> 16u); return f32(h & 16777215u) / 16777216.0;
}
fn slGradient(p: vec2f) -> vec2f { let t = slHash(p) * SL_TAU; return vec2f(cos(t), sin(t)); }
fn slNoise(p: vec2f) -> f32 {
  let i = floor(p); let f = fract(p); let w = f*f*f*(f*(f*6.0-15.0)+10.0);
  let a = dot(slGradient(i), f); let b = dot(slGradient(i+vec2f(1.0,0.0)), f-vec2f(1.0,0.0));
  let c = dot(slGradient(i+vec2f(0.0,1.0)), f-vec2f(0.0,1.0)); let d = dot(slGradient(i+1.0), f-1.0);
  return clamp(0.5 + mix(mix(a,b,w.x),mix(c,d,w.x),w.y)*0.7071,0.0,1.0);
}
fn slFbm(p: vec2f) -> f32 { var q=p; var weight=0.5; var sum=0.0; var total=0.0; for(var i=0;i<5;i++){sum+=slNoise(q)*weight; total+=weight; q=q*2.03+vec2f(17.1,9.2); weight*=0.5;} return sum/total; }
fn slBackground(uv: vec2f, field: f32) -> vec4f { let rgb=toSrgb(mix(toLinear(u.b.rgb),toLinear(u.c.rgb),clamp(field,0.0,1.0))); return mix(tap(uv),vec4f(rgb,1.0),u.a.x); }
fn slOutgoing(uv: vec2f) -> vec4f { if(u.c.y>0.5){return vec4f(0.0);} return tap(uv); }
fn slIncoming(uv: vec2f) -> vec4f { if(u.c.z>0.5){return vec4f(0.0);} return tapOriginal(uv); }
fn slReveal(field: f32, t: f32, feather: f32) -> f32 { return 1.0-smoothstep(t*(1.0+2.0*feather)-feather-feather,t*(1.0+2.0*feather),field); }
`
const glow = `
// Glow PRO shares compileDiffusionRecipe (image editor), bright pass and 13/9-tap mip scatter kernels.
@fragment fn sl_glow_extract(v: Vertex) -> @location(0) vec4f {
 let c=tap(uvOf(v)); if(c.a<=0.00001){return vec4f(0.0);} let rgb=toLinear(straight(c)); let peak=max(rgb.r,max(rgb.g,rgb.b));
 let threshold=0.18*exp2(u.a.x); let knee=max(threshold*clamp(u.a.y/2.4,0.1,0.5),0.00001);
 var soft=clamp(peak-threshold+knee,0.0,2.0*knee); soft=soft*soft/(4.0*knee);
 return vec4f(rgb*(max(peak-threshold,soft)/max(peak,0.00001))*u.a.z*c.a,c.a);
}
@fragment fn sl_glow_down(v: Vertex) -> @location(0) vec4f {
 let uv=uvOf(v); let texel=1.0/u.size.zw; var sum=tap(uv)*0.125;
 sum+=(tap(uv+vec2f(texel.x,0.0))+tap(uv-vec2f(texel.x,0.0))+tap(uv+vec2f(0.0,texel.y))+tap(uv-vec2f(0.0,texel.y)))*0.0625;
 sum+=(tap(uv+texel)+tap(uv-texel)+tap(uv+vec2f(texel.x,-texel.y))+tap(uv+vec2f(-texel.x,texel.y)))*0.03125;
 let h=texel*0.5; sum+=(tap(uv+h)+tap(uv-h)+tap(uv+vec2f(h.x,-h.y))+tap(uv+vec2f(-h.x,h.y)))*0.125; return sum;
}
@fragment fn sl_glow_up(v: Vertex) -> @location(0) vec4f {
 let uv=uvOf(v); let texel=1.0/u.size.zw; var low=tap(uv)*0.25;
 low+=(tap(uv+vec2f(texel.x,0.0))+tap(uv-vec2f(texel.x,0.0))+tap(uv+vec2f(0.0,texel.y))+tap(uv-vec2f(0.0,texel.y)))*0.125;
 low+=(tap(uv+texel)+tap(uv-texel)+tap(uv+vec2f(texel.x,-texel.y))+tap(uv+vec2f(-texel.x,texel.y)))*0.0625;
 let high=tapOriginal(uv); return vec4f(high.rgb*u.a.rgb+low.rgb*u.b.rgb,high.a*u.a.g+low.a*u.b.g);
}
fn slGlowShoulder(color:vec3f,knee:f32,bleach:f32)->vec3f {
 let peak=max(color.r,max(color.g,color.b)); if(knee>=1.0||peak<=knee){return color;}
 let range=max(1.0-knee,0.0001); let rolled=knee+range*(1.0-exp(-(peak-knee)/range));
 let scaled=color*(rolled/max(peak,0.00001)); let overflow=clamp((peak-rolled)/max(peak,0.00001),0.0,1.0);
 return mix(scaled,vec3f(rolled),overflow*bleach);
}
fn slGlowEmission(uv: vec2f) -> vec3f {
 let c=tapOriginal(uv); let rgb=toLinear(straight(c)); let peak=max(rgb.r,max(rgb.g,rgb.b));
 let threshold=0.18*exp2(u.b.x); let knee=max(threshold*clamp(u.b.y/2.4,0.1,0.5),0.00001);
 var soft=clamp(peak-threshold+knee,0.0,2.0*knee); soft=soft*soft/(4.0*knee);
 return rgb*(max(peak-threshold,soft)/max(peak,0.00001))*u.b.z*c.a;
}
@fragment fn sl_glow_composite(v: Vertex) -> @location(0) vec4f {
 let uv=uvOf(v); let base=tapOriginal(uv); if(base.a<=0.00001){return vec4f(0.0);} let scatter=tap(uv);
 let step=vec2f(2.0)/vec2f(textureDimensions(original));
 let core=slGlowEmission(uv)*0.5+(slGlowEmission(uv+vec2f(step.x,0.0))+slGlowEmission(uv-vec2f(step.x,0.0))+slGlowEmission(uv+vec2f(0.0,step.y))+slGlowEmission(uv-vec2f(0.0,step.y)))*0.125;
 var scattered=mix(scatter.rgb,core,u.b.w); scattered=mix(scattered,vec3f(dot(scattered,LUMA)),u.c.w)*u.c.rgb;
 var bloom=scattered*u.a.x; let peak=max(bloom.r,max(bloom.g,bloom.b));
 bloom=mix(bloom,vec3f(peak),smoothstep(0.35,1.4,peak)*u.a.w);
 let rgb=slGlowShoulder(toLinear(straight(base))+bloom,u.a.y,u.a.z);
 return premul(toSrgb(rgb),base.a);
}
`
export const SHADER_LIBRARY_WGSL = helpers +
  Object.entries(backgrounds).map(([entry, body]) => `@fragment fn ${entry}(v: Vertex) -> @location(0) vec4f { let uv=uvOf(v); if(u.a.x==0.0){return tap(uv);} let p=slRotate((uv-0.5)*vec2f(slAspect(),1.0),u.a.w); let density=1.0+u.a.y*0.29; ${body} return slBackground(uv,f); }`).join('\n') +
  Object.entries(filters).map(([entry, body]) => `@fragment fn ${entry}(v: Vertex) -> @location(0) vec4f { let uv=uvOf(v); let base=tap(uv); if(u.a.x==0.0){return base;} ${body} }`).join('\n') +
  Object.entries(transitions).map(([entry, body]) => `@fragment fn ${entry}(v: Vertex) -> @location(0) vec4f { let uv=uvOf(v); let t=u.c.x; if(t<=0.0){return slOutgoing(uv);} if(t>=1.0){return slIncoming(uv);} if(u.a.x==0.0){return mix(slOutgoing(uv),slIncoming(uv),t);} let p=(uv-0.5)*vec2f(slAspect(),1.0); let density=3.0+u.a.y*0.3; let feather=max(0.00001,u.b.x*0.002); ${body} }`).join('\n') + glow
