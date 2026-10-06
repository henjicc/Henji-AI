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
fn lumetriCurve(x: f32) -> f32 {
 let points = array<f32, 5>(u.a.x, u.a.y, u.a.z, u.a.w, u.b.x);
 let segment = u32(clamp(floor(x * 4.0), 0.0, 3.0));
 return mix(points[segment], points[segment+1u], x * 4.0 - f32(segment));
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
