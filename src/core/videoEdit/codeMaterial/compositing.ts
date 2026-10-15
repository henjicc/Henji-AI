import { blendChannel } from '../../imaging/compositing'
import type { CodeBlend, CodeColor } from './contract'

/** Existing neutral-kernel indices 0–4 stay unchanged. W3C Compositing Level 1,
 * section 10 supplies the additional modes; no new raster library is needed. */
export const CODE_BLEND_INDICES: Record<CodeBlend, number> = { normal: 0, multiply: 1, screen: 2, overlay: 3, 'soft-light': 4, add: 5, lighten: 6, darken: 7, difference: 8, exclusion: 9, 'hard-light': 10, 'color-dodge': 11, 'color-burn': 12, hue: 13, saturation: 14, color: 15, luminosity: 16 }
type Rgb = [number, number, number]
const lum = (c: Rgb): number => .3 * c[0] + .59 * c[1] + .11 * c[2]
const sat = (c: Rgb): number => Math.max(...c) - Math.min(...c)
function setLum(c: Rgb, l: number): Rgb {
  const delta = l - lum(c); let v = c.map(x => x + delta) as Rgb
  const lo = Math.min(...v); const hi = Math.max(...v)
  if (lo < 0) v = v.map(x => l + (x - l) * l / (l - lo)) as Rgb
  if (hi > 1) v = v.map(x => l + (x - l) * (1 - l) / (hi - l)) as Rgb
  return v
}
function setSat(c: Rgb, s: number): Rgb {
  const lo = Math.min(...c); const delta = sat(c)
  return c.map(x => delta > 0 ? (x - lo) * s / delta : 0) as Rgb
}
export function codeBlendRgb(b: Rgb, s: Rgb, mode: CodeBlend): Rgb {
  if (mode === 'hue') return setLum(setSat(s, sat(b)), lum(b))
  if (mode === 'saturation') return setLum(setSat(b, sat(s)), lum(b))
  if (mode === 'color') return setLum(s, lum(b))
  if (mode === 'luminosity') return setLum(b, lum(s))
  return b.map((d, i) => {
    const a = s[i]
    switch (mode) {
      case 'add': return Math.min(1, d + a)
      case 'lighten': return Math.max(d, a)
      case 'darken': return Math.min(d, a)
      case 'difference': return Math.abs(d - a)
      case 'exclusion': return d + a - 2 * d * a
      case 'hard-light': return a <= .5 ? 2 * d * a : 1 - 2 * (1 - d) * (1 - a)
      case 'color-dodge': return d === 0 ? 0 : a === 1 ? 1 : Math.min(1, d / (1 - a))
      case 'color-burn': return d === 1 ? 1 : a === 0 ? 0 : 1 - Math.min(1, (1 - d) / a)
      default: return blendChannel(d, a, mode)
    }
  }) as Rgb
}
/** Premultiplied RGBA, matching GPU attachments and source-over. */
export function codeCompositePixel(b: CodeColor, s: CodeColor, mode: CodeBlend = 'normal'): CodeColor {
  const rgb = codeBlendRgb(b.slice(0, 3).map(x => b[3] ? x / b[3] : 0) as Rgb, s.slice(0, 3).map(x => s[3] ? x / s[3] : 0) as Rgb, mode)
  return [...rgb.map((x, i) => (1 - s[3]) * b[i] + (1 - b[3]) * s[i] + b[3] * s[3] * x), s[3] + b[3] * (1 - s[3])] as CodeColor
}
/** Luma uses Rec.709 coefficients on the premultiplied mask, so transparency
 * contributes zero coverage. Inversion includes the area outside its geometry. */
export function codeMaskCoverage(mask: CodeColor, mode: 'alpha' | 'luma', invert = false): number {
  const a = Math.min(1, Math.max(0, mode === 'alpha' ? mask[3] : .2126 * mask[0] + .7152 * mask[1] + .0722 * mask[2]))
  return invert ? 1 - a : a
}
export const CODE_BLEND_WGSL = `
fn codeLum(c:vec3f)->f32 { return dot(c,vec3f(.3,.59,.11)); }
fn codeSat(c:vec3f)->f32 { return max(c.r,max(c.g,c.b))-min(c.r,min(c.g,c.b)); }
fn codeSetLum(c:vec3f,l:f32)->vec3f {
 var v=c+vec3f(l-codeLum(c)); let lo=min(v.r,min(v.g,v.b)); let hi=max(v.r,max(v.g,v.b));
 if(lo<0.0) { v=vec3f(l)+(v-vec3f(l))*l/(l-lo); }
 if(hi>1.0) { v=vec3f(l)+(v-vec3f(l))*(1.0-l)/(hi-l); } return v;
}
fn codeSetSat(c:vec3f,s:f32)->vec3f {
 let d=codeSat(c); if(d==0.0) { return vec3f(0); } return (c-vec3f(min(c.r,min(c.g,c.b))))*s/d;
}
fn codeBlendChannel(d:f32,s:f32,m:u32)->f32 {
 if(m==5u) { return min(1.0,d+s); } if(m==6u) { return max(d,s); } if(m==7u) { return min(d,s); }
 if(m==8u) { return abs(d-s); } if(m==9u) { return d+s-2.0*d*s; }
 if(m==10u) { return select(2.0*d*s,1.0-2.0*(1.0-d)*(1.0-s),s>.5); }
 if(m==11u) { if(d==0.0) { return 0.0; } if(s==1.0) { return 1.0; } return min(1.0,d/(1.0-s)); }
 if(m==12u) { if(d==1.0) { return 1.0; } if(s==0.0) { return 0.0; } return 1.0-min(1.0,(1.0-d)/s); }
 return blendChannel(d,s,m);
}
fn codeBlendRgb(b:vec3f,s:vec3f,m:u32)->vec3f {
 if(m==13u) { return codeSetLum(codeSetSat(s,codeSat(b)),codeLum(b)); }
 if(m==14u) { return codeSetLum(codeSetSat(b,codeSat(s)),codeLum(b)); }
 if(m==15u) { return codeSetLum(s,codeLum(b)); } if(m==16u) { return codeSetLum(b,codeLum(s)); }
 return vec3f(codeBlendChannel(b.r,s.r,m),codeBlendChannel(b.g,s.g,m),codeBlendChannel(b.b,s.b,m));
}
`
