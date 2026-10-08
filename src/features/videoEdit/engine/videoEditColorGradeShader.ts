/** Linear WB/exposure and HSL secondary correction, perceptual tone/style/curves/wheels.
 * Straight f32 color, no 8-bit LUT or intermediate upper clamp; retain premultiplied alpha. */
export const VIDEO_EDIT_COLOR_GRADE_SHADER = `
// HSL selection is perceptual, using straight encoded RGB. Color corrections and
// mask-weighted mixing use linear light, returning the same premultiplied sRGB ABI.
fn colorGradeRange(x: f32, lo: f32, hi: f32, feather: f32) -> f32 {
 if (x >= lo && x <= hi) { return 1.0; }
 if (feather <= 0.0) { return 0.0; }
 let distance = max(lo - x, x - hi);
 return 1.0 - smoothstep(0.0, feather, distance);
}
fn colorGradeHueRange(hue: f32, lo: f32, hi: f32, feather: f32) -> f32 {
 if (lo == 0.0 && hi == 1.0) { return 1.0; }
 let h = fract(hue - lo + 1.0); let span = fract(hi - lo + 1.0);
 if (h <= span) { return 1.0; }
 if (feather <= 0.0) { return 0.0; }
 return 1.0 - smoothstep(0.0, feather, min(h - span, 1.0 - h));
}
@fragment fn color_grade_hsl_key(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let rgb = clamp(straight(c), vec3f(0.0), vec3f(1.0));
 let hi = max(rgb.r, max(rgb.g, rgb.b)); let lo = min(rgb.r, min(rgb.g, rgb.b)); let chroma = hi - lo;
 let light = (hi + lo) * 0.5; let sat = chroma / max(0.000001, 1.0 - abs(2.0 * light - 1.0));
 var weight = colorGradeHueRange(colorGradeHue(rgb), u.a.x, u.a.y, u.a.z)
   * colorGradeRange(sat, u.b.x, u.b.y, u.b.z) * colorGradeRange(light, u.c.x, u.c.y, u.c.z);
 // Hue is undefined for gray: exclude it from restricted hue keys instead of calling it red.
 if (chroma < 0.000001 && !(u.a.x == 0.0 && u.a.y == 1.0)) { weight = 0.0; }
 if (u.a.w > 0.5) { weight = 1.0 - weight; }
 if (c.a <= 0.00001) { weight = 0.0; }
 return vec4f(vec3f(weight), 1.0);
}
@fragment fn color_grade_hsl_correct(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let c = tap(uv); let weight = clamp(tapOriginal(uv).r, 0.0, 1.0);
 if (u.c.x > 0.5) { return vec4f(vec3f(weight * c.a), c.a); }
 if (weight <= 0.0 || c.a <= 0.00001) { return c; }
 let base = toLinear(straight(c)); var rgb = base * u.a.rgb;
 let pivot = 0.21404114; rgb = (rgb - pivot) * u.a.w + pivot;
 rgb = mix(vec3f(dot(rgb, LUMA)), rgb, max(0.0, 1.0 + u.b.x));
 let midtone = colorGradeWeights(straight(c)).y;
 rgb += (colorGradeTint(u.b.y) * u.b.z + vec3f(u.b.w)) * 0.25 * midtone;
 return colorGradeOut(toSrgb(mix(base, rgb, weight)), c.a);
}
@fragment fn color_grade_linear(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); return vec4f(toLinear(straight(c)) * c.a, c.a);
}
@fragment fn color_grade_hsl_sharpen(v: Vertex) -> @location(0) vec4f {
 let uv = uvOf(v); let c = tapOriginal(uv); let weight = clamp(textureSampleLevel(gradeMask, s, uv, 0.0).r, 0.0, 1.0);
 if (weight <= 0.0 || c.a <= 0.00001) { return c; }
 let rgb = toLinear(straight(c)); let blurred = straight(tap(uv));
 return colorGradeOut(toSrgb(rgb + (rgb - blurred) * u.a.x * weight), c.a);
}
fn colorGradeOut(rgb: vec3f, alpha: f32) -> vec4f { return vec4f(rgb * alpha, alpha); }
fn colorGradeWeights(rgb: vec3f) -> vec3f {
 let y = clamp(dot(rgb, LUMA), 0.0, 1.0);
 let shadow = 1.0 - smoothstep(0.0, 0.5, y); let high = smoothstep(0.5, 1.0, y);
 return vec3f(shadow, 1.0 - shadow - high, high);
}
fn colorGradeTint(hue: f32) -> vec3f {
 let rgb = clamp(abs(fract(vec3f(hue / 360.0) + vec3f(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
 return rgb - vec3f(dot(rgb, LUMA));
}
@fragment fn color_grade_basic(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = toSrgb(toLinear(straight(c)) * u.a.rgb);
 let y = clamp(dot(rgb, LUMA), 0.0, 1.0); let w = colorGradeWeights(rgb);
 let offset = u.b.x * w.z * 0.25 + u.b.y * w.x * 0.25 + u.b.z * pow(y, 4.0) * 0.25 + u.b.w * pow(1.0-y, 4.0) * 0.25;
 rgb = (rgb - 0.5) * u.a.w + 0.5 + offset;
 let saturation = max(rgb.r, max(rgb.g, rgb.b)) - min(rgb.r, min(rgb.g, rgb.b));
 rgb = mix(vec3f(dot(rgb, LUMA)), rgb, max(0.0, 1.0 + u.c.x + u.c.y * (1.0 - clamp(saturation, 0.0, 1.0))));
 return colorGradeOut(rgb, c.a);
}
@fragment fn color_grade_creative(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = straight(c); let w = colorGradeWeights(rgb);
 rgb = mix(rgb, rgb * 0.75 + 0.125, u.a.x);
 rgb += colorGradeTint(u.a.y) * u.a.z * w.x * 0.25 + colorGradeTint(u.a.w) * u.b.x * w.z * 0.25;
 return colorGradeOut(rgb, c.a);
}
fn colorGradeLookup(x: f32, n: f32) -> vec3f {
 let at = clamp(x, 0.0, 1.0) * (n - 1.0); let left = u32(floor(at)); let right = min(left + 1u, u32(n) - 1u); let width = textureDimensions(original).x;
 return mix(textureLoad(original, vec2i(i32(left % width), i32(left / width)), 0).rgb, textureLoad(original, vec2i(i32(right % width), i32(right / width)), 0).rgb, fract(at));
}
fn colorGradeCurve(x: f32) -> f32 {
 return colorGradeLookup(x, f32(textureDimensions(original).x)).r;
}
fn colorGradeHue(rgb: vec3f) -> f32 {
 let hi = max(rgb.r, max(rgb.g, rgb.b)); let lo = min(rgb.r, min(rgb.g, rgb.b)); let d = hi - lo;
 if (d < 0.000001) { return 0.0; }
 var h = (rgb.g - rgb.b) / d;
 if (hi == rgb.g) { h = (rgb.b - rgb.r) / d + 2.0; } else if (hi == rgb.b) { h = (rgb.r - rgb.g) / d + 4.0; }
 return fract(h / 6.0 + 1.0);
}
@fragment fn color_grade_hue_curve(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let rgb = straight(c); let mode = u32(u.a.x);
 let hi = max(rgb.r, max(rgb.g, rgb.b)); let lo = min(rgb.r, min(rgb.g, rgb.b)); let chroma = hi - lo;
 let light = (hi + lo) * 0.5; let sat = chroma / max(0.000001, 1.0 - abs(2.0 * light - 1.0));
 let hue = colorGradeHue(rgb);
 var x = hue; if (mode == 3u) { x = clamp(light, 0.0, 1.0); } else if (mode == 4u) { x = clamp(sat, 0.0, 1.0); }
 let amount = (colorGradeCurve(x) - 0.5) * 2.0;
 var h = hue; var saturation = sat; var l = light;
 if (mode == 1u) { h = fract(h + amount * 0.5 + 1.0); }
 else if (mode == 2u) { l = clamp(l + amount * 0.5 * min(1.0, chroma * 100.0), 0.0, 1.0); }
 else { saturation = clamp(saturation * max(0.0, 1.0 + amount), 0.0, 1.0); }
 let base = clamp(abs(fract(vec3f(h) + vec3f(0.0, 2.0/3.0, 1.0/3.0)) * 6.0 - 3.0) - 1.0, vec3f(0.0), vec3f(1.0));
 let outChroma = (1.0 - abs(2.0 * l - 1.0)) * saturation;
 return colorGradeOut((base - 0.5) * outChroma + l, c.a);
}
@fragment fn color_grade_lut(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let rgb = straight(c); let n = u.a.z;
 let position = clamp((rgb - u.b.rgb) / u.c.rgb, vec3f(0.0), vec3f(1.0));
 var mapped: vec3f;
 if (u.a.y > 0.5) {
  mapped = vec3f(colorGradeLookup(position.r, n).r, colorGradeLookup(position.g, n).g, colorGradeLookup(position.b, n).b);
 } else {
  let at = position * (n - 1.0); let a = vec3i(floor(at)); let b = min(a + 1, vec3i(i32(n) - 1)); let f = fract(at);
  let z0 = mix(mix(textureLoad(colorLut, a, 0).rgb, textureLoad(colorLut, vec3i(b.x, a.y, a.z), 0).rgb, f.x), mix(textureLoad(colorLut, vec3i(a.x, b.y, a.z), 0).rgb, textureLoad(colorLut, vec3i(b.x, b.y, a.z), 0).rgb, f.x), f.y);
  let z1 = mix(mix(textureLoad(colorLut, vec3i(a.x, a.y, b.z), 0).rgb, textureLoad(colorLut, vec3i(b.x, a.y, b.z), 0).rgb, f.x), mix(textureLoad(colorLut, vec3i(a.x, b.y, b.z), 0).rgb, textureLoad(colorLut, b, 0).rgb, f.x), f.y);
  mapped = mix(z0, z1, f.z);
 }
 return colorGradeOut(mix(rgb, mapped, u.a.x), c.a);
}
@fragment fn color_grade_curve(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = straight(c); let channel = i32(u.b.y);
 if (channel == 0) { rgb = vec3f(colorGradeCurve(rgb.r), colorGradeCurve(rgb.g), colorGradeCurve(rgb.b)); }
 else { rgb[channel - 1] = colorGradeCurve(rgb[channel - 1]); }
 return colorGradeOut(rgb, c.a);
}
@fragment fn color_grade_wheel(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = straight(c); let weight = colorGradeWeights(rgb)[u32(u.a.w)];
 rgb += (colorGradeTint(u.a.x) * u.a.y * 0.25 + vec3f(u.a.z * 0.25)) * weight;
 return colorGradeOut(rgb, c.a);
}
@fragment fn color_grade_vignette(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); let p = (uvOf(v) - 0.5) * 2.0;
 let distance = length(p * vec2f(mix(1.0, u.b.x, u.a.z), 1.0)) / 1.41421356;
 let amount = smoothstep(u.a.y * 0.8, u.a.y * 0.8 + max(0.01, u.a.w), distance) * abs(u.a.x);
 let rgb = straight(c); return colorGradeOut(select(rgb * (1.0 - amount), rgb + (1.0-rgb) * amount, u.a.x > 0.0), c.a);
}
`
