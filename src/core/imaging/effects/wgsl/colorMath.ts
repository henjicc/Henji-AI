/** OkLab：Björn Ottosson；保留负值与 HDR，图像调色和剪辑效果共用。 */
export const COLOR_MATH_WGSL = `
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
`
