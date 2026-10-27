import { COLOR_GRADE_TABLE_WIDTH, PERCEPTUAL_MIDDLE_GRAY, SLOT } from '../../adjustments/unifiedGrade'
import { DISPLAY_HUE_ANCHORS } from '../../adjustments/colorScience'

/** Unified pointwise grade; mirrors `unifiedGrade.ts::gradeStageA/gradeStageB` line for line. The parameter/curve table is bound as `original`.
 * u.a.x: 1 = stage A, 2 = stage B, 3 = both. Straight encoded RGB in and out; values stay signed (no clamp). */
export const COLOR_GRADE_UNIFIED_WGSL = `
const CG_W: i32 = ${COLOR_GRADE_TABLE_WIDTH};
fn cgP(i: i32) -> vec4f { return textureLoad(original, vec2i(i, 0), 0); }
fn cgCurve(row: i32, x: f32) -> f32 {
 let at = clamp(x, 0.0, 1.0) * f32(CG_W - 1); let left = i32(floor(at)); let right = min(left + 1, CG_W - 1);
 return mix(textureLoad(original, vec2i(left, row), 0).r, textureLoad(original, vec2i(right, row), 0).r, at - f32(left));
}
fn cgLin1(x: f32) -> f32 { let a = abs(x); return sign(x) * select(pow((a + 0.055) / 1.055, 2.4), a / 12.92, a <= 0.04045); }
fn cgEnc1(x: f32) -> f32 { let a = abs(x); return sign(x) * select(1.055 * pow(a, 1.0 / 2.4) - 0.055, a * 12.92, a <= 0.0031308); }
fn cgLin(c: vec3f) -> vec3f { return vec3f(cgLin1(c.r), cgLin1(c.g), cgLin1(c.b)); }
fn cgEnc(c: vec3f) -> vec3f { return vec3f(cgEnc1(c.r), cgEnc1(c.g), cgEnc1(c.b)); }
fn cgCbrt(x: f32) -> f32 { return sign(x) * pow(abs(x), 1.0 / 3.0); }
fn cgPow3(x: f32) -> f32 { return x * x * x; }
fn cgOklab(c: vec3f) -> vec3f {
 let l = cgCbrt(0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b);
 let m = cgCbrt(0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b);
 let s = cgCbrt(0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b);
 return vec3f(0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s);
}
fn cgFromOklab(c: vec3f) -> vec3f {
 let l = cgPow3(c.x + 0.3963377774 * c.y + 0.2158037573 * c.z); let m = cgPow3(c.x - 0.1055613458 * c.y - 0.0638541728 * c.z); let s = cgPow3(c.x - 0.0894841775 * c.y - 1.291485548 * c.z);
 return vec3f(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
}
const CG_ANCHORS = array<f32, 6>(${DISPLAY_HUE_ANCHORS.map(value => value.toFixed(6)).join(', ')});
fn cgAnchor(i: i32) -> f32 { return CG_ANCHORS[i % 6]; }
fn cgDisplayHue(hue: f32) -> f32 {
 for (var i = 0; i < 6; i++) {
  let lo = cgAnchor(i); var hi = cgAnchor(i + 1); if (i == 5) { hi += 360.0; }
  var h = hue; if (h < lo) { h += 360.0; }
  if (h >= lo && h < hi) { return (f32(i) * 60.0 + (h - lo) / (hi - lo) * 60.0) % 360.0; }
 }
 return 0.0;
}
fn cgOklabHue(display: f32) -> f32 {
 let d = ((display % 360.0) + 360.0) % 360.0; let i = min(5, i32(floor(d / 60.0)));
 let lo = cgAnchor(i); var hi = cgAnchor(i + 1); if (i == 5) { hi += 360.0; }
 return (lo + (d - f32(i) * 60.0) / 60.0 * (hi - lo)) % 360.0;
}
fn cgKnee(x: f32, limit: f32) -> f32 { let a = abs(x); let k = 0.8 * limit; return sign(x) * select(limit - 0.2 * limit * exp(-(a - k) / (0.2 * limit)), a, a <= k); }
fn cgToned(x: f32, slope: f32) -> f32 {
 let p0 = ${PERCEPTUAL_MIDDLE_GRAY}; let d = (x - p0) * slope;
 if (slope > 1.0) { return p0 + cgKnee(d, select(p0, 1.0 - p0, d > 0.0)); }
 return p0 + d;
}
fn cgContrast(p: f32, slope: f32) -> f32 { if (slope == 1.0) { return p; } if (p > 1.0) { return cgToned(1.0, slope) + (p - 1.0); } return cgToned(p, slope); }
fn cgBump(y: f32, center: f32) -> f32 { let d = abs(y - center); if (d >= 0.25) { return 0.0; } let c = cos(3.14159265358979 * d / 0.5); return c * c; }
fn cgTone(p: f32, tone: vec4f, tone2: vec4f, color: vec4f) -> f32 {
 let y = clamp(p, 0.0, 1.0); let shadow = 1.0 - smoothstep(0.0, 0.5, y); let high = smoothstep(0.5, 1.0, y);
 var value = p + 0.25 * (tone.y * high + tone.z * shadow + tone.w * pow(y, 4.0) + tone2.x * pow(1.0 - y, 4.0));
 let envelope = min(1.0, 4.0 * y) * min(1.0, 4.0 * (1.0 - y));
 value += 0.15 * envelope * (tone2.y * cgBump(y, 0.875) + tone2.z * cgBump(y, 0.625) + tone2.w * cgBump(y, 0.375) + color.x * cgBump(y, 0.125));
 return value;
}
fn cgHueDistance(a: f32, b: f32) -> f32 { let d = abs(a - b) % 360.0; return select(d, 360.0 - d, d > 180.0); }
fn cgContrastSlope(p: f32, slope: f32) -> f32 {
 if (slope <= 1.0) { return slope; }
 let p0 = ${PERCEPTUAL_MIDDLE_GRAY}; let d = (min(p, 1.0) - p0) * slope; let limit = select(p0, 1.0 - p0, d > 0.0); let k = 0.8 * limit;
 if (abs(d) <= k) { return slope; }
 return slope * exp(-(abs(d) - k) / (0.2 * limit));
}
fn cgStageA(rgb: vec3f) -> vec3f {
 let flags = cgP(${SLOT.flags});
 if (flags.x < 0.5 && flags.y < 0.5 && flags.z < 0.5) { return rgb; }
 var lin = cgLin(rgb);
 if (flags.x > 0.5) { lin = vec3f(dot(cgP(${SLOT.matrix}).xyz, lin), dot(cgP(${SLOT.matrix + 1}).xyz, lin), dot(cgP(${SLOT.matrix + 2}).xyz, lin)); }
 if (flags.y < 0.5 && flags.z < 0.5) { return cgEnc(lin); }
 let tone = cgP(${SLOT.tone}); let tone2 = cgP(${SLOT.tone2}); let color = cgP(${SLOT.color});
 let lab = cgOklab(lin);
 var lightness = lab.x; var chromaScale = 1.0;
 if (flags.y > 0.5) {
  let y = dot(lin, LUMA); let perceptual = cgEnc1(max(0.0, y));
  let graded = cgLin1(cgTone(cgContrast(perceptual, tone.x), tone, tone2, color));
  chromaScale = cgContrastSlope(perceptual, tone.x);
  if (y > 0.000001) { lightness = lab.x * cgCbrt(graded / y); } else { lightness = cgOklab(lin + vec3f(graded - y)).x; }
 }
 if (flags.z > 0.5) {
  let c = length(lab.yz) * chromaScale;
  chromaScale *= max(0.0, 1.0 + color.y);
  if (color.z != 0.0) {
   var skin = 1.0;
   if (color.z > 0.0 && c > 0.000001) { var h = degrees(atan2(lab.z, lab.y)); if (h < 0.0) { h += 360.0; } let q = cgHueDistance(h, 55.0) / 22.0; skin = 1.0 - 0.6 * exp(-(q * q)); }
   chromaScale *= max(0.0, 1.0 + color.z * (1.0 - smoothstep(0.0, 0.25, c)) * skin);
  }
 }
 lin = cgFromOklab(vec3f(lightness, lab.yz * chromaScale));
 return cgEnc(lin);
}
fn cgStageB(rgb: vec3f) -> vec3f {
 let flags = cgP(${SLOT.flags}); let color = cgP(${SLOT.color}); let wheel = cgP(${SLOT.wheel});
 let cf1 = cgP(${SLOT.curveFlags}); let cf2 = cgP(${SLOT.curveFlags + 1}); let cf3 = cgP(${SLOT.curveFlags + 2});
 var e = rgb;
 if (color.w != 0.0) { e = e + (e * 0.75 + vec3f(0.125) - e) * color.w; }
 if (cf1.x > 0.5) { e = vec3f(cgCurve(1, e.r), cgCurve(1, e.g), cgCurve(1, e.b)); }
 if (cf1.y > 0.5) { e.r = cgCurve(2, e.r); }
 if (cf1.z > 0.5) { e.g = cgCurve(3, e.g); }
 if (cf1.w > 0.5) { e.b = cgCurve(4, e.b); }
 if (flags.w > 0.5 || cf2.x > 0.5 || cf2.y > 0.5 || cf2.z > 0.5 || cf2.w > 0.5 || cf3.x > 0.5) {
  let lab = cgOklab(cgLin(e)); let c = length(lab.yz);
  var hue = degrees(atan2(lab.z, lab.y)); if (hue < 0.0) { hue += 360.0; }
  let dh = cgDisplayHue(hue);
  var shift = 0.0; var chromaScale = 1.0; var lightScale = 1.0;
  if (flags.w > 0.5) {
   let weight = smoothstep(0.0, 0.06, c); var hueValue = 0.0; var sat = 0.0; var lum = 0.0;
   for (var i = 0; i < 8; i++) {
    let a = cgP(${SLOT.mixer} + i); let b = cgP(${SLOT.mixer} + (i + 1) % 8);
    let span = (b.w - a.w + 360.0) % 360.0; let t = ((dh - a.w + 360.0) % 360.0) / span;
    if (t >= 1.0) { continue; }
    hueValue = (1.0 - t) * a.x + t * b.x; sat = (1.0 - t) * a.y + t * b.y; lum = (1.0 - t) * a.z + t * b.z;
    break;
   }
   shift += hueValue * 30.0 * weight; chromaScale *= max(0.0, 1.0 + sat * weight); lightScale *= exp2(0.8 * lum * weight);
  }
  let weight = smoothstep(0.0, 0.04, c); let hueX = dh / 360.0;
  if (cf2.x > 0.5) { chromaScale *= max(0.0, 1.0 + (cgCurve(5, hueX) - 0.5) * 2.0 * weight); }
  if (cf2.w > 0.5) { chromaScale *= max(0.0, 1.0 + (cgCurve(8, clamp(lab.x, 0.0, 1.0)) - 0.5) * 2.0); }
  if (cf3.x > 0.5) { chromaScale *= max(0.0, 1.0 + (cgCurve(9, clamp(c / 0.32, 0.0, 1.0)) - 0.5) * 2.0); }
  if (cf2.y > 0.5) { shift += (cgCurve(6, hueX) - 0.5) * 2.0 * 180.0 * weight; }
  if (cf2.z > 0.5) { lightScale *= max(0.0, 1.0 + (cgCurve(7, hueX) - 0.5) * 2.0 * 0.5 * weight); }
  var ab = lab.yz * chromaScale;
  if (shift != 0.0 && c > 0.000001) { let h = radians(cgOklabHue(dh + shift)); ab = c * chromaScale * vec2f(cos(h), sin(h)); }
  e = cgEnc(cgFromOklab(vec3f(lab.x * lightScale, ab)));
 }
 if (wheel.w > 0.5) {
  let s = cgP(${SLOT.wheels}).xyz; let m = cgP(${SLOT.wheels + 1}).xyz; let h = cgP(${SLOT.wheels + 2}).xyz; let g = cgP(${SLOT.wheels + 3}).xyz;
  if (wheel.x > 0.5) {
   var v = e * (vec3f(1.0) + h) + 0.25 * s * (vec3f(1.0) - e);
   v = sign(v) * pow(abs(v), exp2(-m));
   e = v + 0.25 * g;
  } else {
   let y = clamp(dot(e, LUMA), 0.0, 1.0);
   let shadow = 1.0 - smoothstep(wheel.z - wheel.y, wheel.z, y); let high = smoothstep(wheel.z, wheel.z + wheel.y, y); let mid = 1.0 - shadow - high;
   e = e + s * shadow + m * mid + h * high + g;
  }
 }
 return e;
}
@fragment fn color_grade_unified(v: Vertex) -> @location(0) vec4f {
 let c = tap(uvOf(v)); var rgb = straight(c); let stage = u32(u.a.x);
 if ((stage & 1u) != 0u) { rgb = cgStageA(rgb); }
 if ((stage & 2u) != 0u) { rgb = cgStageB(rgb); }
 return colorGradeOut(rgb, c.a);
}
`
