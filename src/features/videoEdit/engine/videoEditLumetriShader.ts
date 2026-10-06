/** Adobe documents section order, not proprietary formulas. Linear WB/exposure, perceptual tone/style/curves/wheels.
 * Straight f32 color, no 8-bit LUT or intermediate upper clamp; retain premultiplied alpha. */
export const VIDEO_EDIT_LUMETRI_SHADER = `
fn lumetriOut(rgb: vec3f, alpha: f32) -> vec4f { return vec4f(rgb * alpha, alpha); }
fn lumetriWeights(rgb: vec3f) -> vec3f {
 let y = clamp(dot(rgb, LUMA), 0.0, 1.0);
 let shadow = 1.0 - smoothstep(0.0, 0.5, y); let high = smoothstep(0.5, 1.0, y);
 return vec3f(shadow, 1.0 - shadow - high, high);
}
fn lumetriTint(hue: f32) -> vec3f {
 let rgb = clamp(abs(fract(vec3f(hue / 360.0) + vec3f(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
 return rgb - vec3f(dot(rgb, LUMA));
}
@fragment fn lumetri_basic(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = toSrgb(toLinear(straight(c)) * u.a.rgb);
 let y = clamp(dot(rgb, LUMA), 0.0, 1.0); let w = lumetriWeights(rgb);
 let offset = u.b.x * w.z * 0.25 + u.b.y * w.x * 0.25 + u.b.z * pow(y, 4.0) * 0.25 + u.b.w * pow(1.0-y, 4.0) * 0.25;
 rgb = (rgb - 0.5) * u.a.w + 0.5 + offset;
 let saturation = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
 rgb = mix(vec3f(dot(rgb, LUMA)), rgb, max(0.0, 1.0 + u.c.x + u.c.y * (1.0 - clamp(saturation, 0.0, 1.0))));
 return lumetriOut(rgb, c.a);
}
@fragment fn lumetri_creative(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = straight(c); let w = lumetriWeights(rgb);
 rgb = mix(rgb, rgb * 0.75 + 0.125, u.a.x);
 rgb += lumetriTint(u.a.y) * u.a.z * w.x * 0.25 + lumetriTint(u.a.w) * u.b.x * w.z * 0.25;
 return lumetriOut(rgb, c.a);
}
fn lumetriLookup(x: f32, n: f32) -> vec3f {
 let at = clamp(x, 0.0, 1.0) * (n - 1.0); let left = u32(floor(at)); let right = min(left + 1u, u32(n) - 1u); let width = textureDimensions(original).x;
 return mix(textureLoad(original, vec2i(i32(left % width), i32(left / width)), 0).rgb, textureLoad(original, vec2i(i32(right % width), i32(right / width)), 0).rgb, fract(at));
}
fn lumetriCurve(x: f32) -> f32 {
 return lumetriLookup(x, f32(textureDimensions(original).x)).r;
}
fn lumetriHue(rgb: vec3f) -> f32 {
 let hi = max(rgb.r, max(rgb.g, rgb.b)); let lo = min(rgb.r, min(rgb.g, rgb.b)); let d = hi - lo;
 if (d < 0.000001) { return 0.0; }
 var h = (rgb.g - rgb.b) / d;
 if (hi == rgb.g) { h = (rgb.b - rgb.r) / d + 2.0; } else if (hi == rgb.b) { h = (rgb.r - rgb.g) / d + 4.0; }
 return fract(h / 6.0 + 1.0);
}
@fragment fn lumetri_hue_curve(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let rgb = straight(c); let mode = u32(u.a.x);
 let hi = max(rgb.r, max(rgb.g, rgb.b)); let lo = min(rgb.r, min(rgb.g, rgb.b)); let chroma = hi - lo;
 let light = (hi + lo) * 0.5; let sat = chroma / max(0.000001, 1.0 - abs(2.0 * light - 1.0));
 let hue = lumetriHue(rgb);
 var x = hue; if (mode == 3u) { x = clamp(light, 0.0, 1.0); } else if (mode == 4u) { x = clamp(sat, 0.0, 1.0); }
 let amount = (lumetriCurve(x) - 0.5) * 2.0;
 var h = hue; var saturation = sat; var l = light;
 if (mode == 1u) { h = fract(h + amount * 0.5 + 1.0); }
 else if (mode == 2u) { l = clamp(l + amount * 0.5 * min(1.0, chroma * 100.0), 0.0, 1.0); }
 else { saturation = clamp(saturation * max(0.0, 1.0 + amount), 0.0, 1.0); }
 let base = clamp(abs(fract(vec3f(h) + vec3f(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
 let outChroma = (1.0 - abs(2.0 * l - 1.0)) * saturation;
 return lumetriOut((base - 0.5) * outChroma + l, c.a);
}
@fragment fn lumetri_lut(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let rgb = straight(c); let n = u.a.z;
 let position = clamp((rgb - u.b.rgb) / u.c.rgb, vec3f(0.0), vec3f(1.0));
 var mapped: vec3f;
 if (u.a.y > 0.5) {
  mapped = vec3f(lumetriLookup(position.r, n).r, lumetriLookup(position.g, n).g, lumetriLookup(position.b, n).b);
 } else {
  let at = position * (n - 1.0); let a = vec3i(floor(at)); let b = min(a + 1, vec3i(i32(n) - 1)); let f = fract(at);
  let z0 = mix(mix(textureLoad(colorLut, a, 0).rgb, textureLoad(colorLut, vec3i(b.x, a.y, a.z), 0).rgb, f.x), mix(textureLoad(colorLut, vec3i(a.x, b.y, a.z), 0).rgb, textureLoad(colorLut, vec3i(b.x, b.y, a.z), 0).rgb, f.x), f.y);
  let z1 = mix(mix(textureLoad(colorLut, vec3i(a.x, a.y, b.z), 0).rgb, textureLoad(colorLut, vec3i(b.x, a.y, b.z), 0).rgb, f.x), mix(textureLoad(colorLut, vec3i(a.x, b.y, b.z), 0).rgb, textureLoad(colorLut, b, 0).rgb, f.x), f.y);
  mapped = mix(z0, z1, f.z);
 }
 return lumetriOut(mix(rgb, mapped, u.a.x), c.a);
}
@fragment fn lumetri_curve(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = straight(c); let channel = i32(u.b.y);
 if (channel == 0) { rgb = vec3f(lumetriCurve(rgb.r), lumetriCurve(rgb.g), lumetriCurve(rgb.b)); }
 else { rgb[channel - 1] = lumetriCurve(rgb[channel - 1]); }
 return lumetriOut(rgb, c.a);
}
@fragment fn lumetri_wheel(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = straight(c); let weight = lumetriWeights(rgb)[u32(u.a.w)];
 rgb += (lumetriTint(u.a.x) * u.a.y * 0.25 + vec3f(u.a.z * 0.25)) * weight;
 return lumetriOut(rgb, c.a);
}
@fragment fn lumetri_vignette(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let p = (uvOf(v) - 0.5) * 2.0;
 let distance = length(p * vec2f(mix(1.0, u.b.x, u.a.z), 1.0)) / 1.41421356;
 let amount = smoothstep(u.a.y * 0.8, u.a.y * 0.8 + max(0.01, u.a.w), distance) * abs(u.a.x);
 let rgb = straight(c); return lumetriOut(select(rgb * (1.0 - amount), rgb + (1.0-rgb) * amount, u.a.x > 0.0), c.a);
}
`
