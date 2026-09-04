struct Params {
  operation: vec4f,
  maskOptions: vec4f,
  values0: vec4f,
  values1: vec4f,
  values2: vec4f,
  values3: vec4f,
  values4: vec4f,
  values5: vec4f,
  values6: vec4f,
  values7: vec4f,
}
@group(0) @binding(0) var sourceTexture: texture_2d<f32>;
@group(0) @binding(1) var maskTexture: texture_2d<f32>;
@group(0) @binding(2) var<uniform> params: Params;
fn signedPower(value: f32, exponent: f32) -> f32 { return sign(value) * pow(abs(value), exponent); }
fn encodeSrgb(value: f32) -> f32 { let magnitude=abs(value); return sign(value)*select(12.92*magnitude,1.055*pow(magnitude,1.0/2.4)-0.055,magnitude>0.0031308); }
fn decodeSrgb(value: f32) -> f32 { let magnitude=abs(value); return sign(value)*select(magnitude/12.92,pow((magnitude+0.055)/1.055,2.4),magnitude>0.04045); }
fn exposure(rgb: vec3f, p: vec4f) -> vec3f { let multiplier = exp2(p.x); return vec3f(signedPower(rgb.r * multiplier + p.y, 1.0 / p.z), signedPower(rgb.g * multiplier + p.y, 1.0 / p.z), signedPower(rgb.b * multiplier + p.y, 1.0 / p.z)); }
fn positiveModulo(value: f32, divisor: f32) -> f32 { return ((value % divisor) + divisor) % divisor; }
fn adjustUnit(value: f32, amount: f32) -> f32 { return select(value * (1.0 + amount), value + (1.0 - value) * amount, amount >= 0.0); }
fn rgbToHsl(rgb: vec3f) -> vec3f { let maximum = max(rgb.r, max(rgb.g, rgb.b)); let minimum = min(rgb.r, min(rgb.g, rgb.b)); let delta = maximum - minimum; let lightness = (maximum + minimum) * 0.5; if (delta == 0.0) { return vec3f(0, 0, lightness); } var hue = 0.0; if (maximum == rgb.r) { hue = ((rgb.g - rgb.b) / delta) / 6.0; } else if (maximum == rgb.g) { hue = (((rgb.b - rgb.r) / delta) + 2.0) / 6.0; } else { hue = (((rgb.r - rgb.g) / delta) + 4.0) / 6.0; } let saturation = delta / (1.0 - abs(2.0 * lightness - 1.0)); return vec3f(positiveModulo(hue, 1.0), saturation, lightness); }
fn hslToRgb(hsl: vec3f) -> vec3f { let chroma = (1.0 - abs(2.0 * hsl.z - 1.0)) * hsl.y; let sector = hsl.x * 6.0; let second = chroma * (1.0 - abs((sector % 2.0) - 1.0)); var base = vec3f(0); if (sector < 1.0) { base = vec3f(chroma, second, 0); } else if (sector < 2.0) { base = vec3f(second, chroma, 0); } else if (sector < 3.0) { base = vec3f(0, chroma, second); } else if (sector < 4.0) { base = vec3f(0, second, chroma); } else if (sector < 5.0) { base = vec3f(second, 0, chroma); } else { base = vec3f(chroma, 0, second); } return base + vec3f(hsl.z - chroma * 0.5); }
fn hslAdjust(rgb: vec3f, p: vec4f) -> vec3f { let bounded = clamp(rgb, vec3f(0), vec3f(1)); let residual = rgb - bounded; let hsl = rgbToHsl(bounded); return hslToRgb(vec3f(positiveModulo(hsl.x + p.x / 360.0, 1.0), adjustUnit(hsl.y, p.y), adjustUnit(hsl.z, p.z))) + residual; }
fn matrixAdjust(rgb: vec3f) -> vec3f { return vec3f(dot(params.values0.xyz, rgb), dot(params.values1.xyz, rgb), dot(params.values2.xyz, rgb)); }
fn blendChannel(b: f32, s: f32, mode: u32) -> f32 { if (mode == 1u) { return b*s; } if (mode == 2u) { return b+s-b*s; } if (mode == 3u) { return select(2.0*b*s, 1.0-2.0*(1.0-b)*(1.0-s), b>0.5); } if (mode == 4u) { if (s<=0.5) { return b-(1.0-2.0*s)*b*(1.0-b); } let d=select(((16.0*b-12.0)*b+4.0)*b,sqrt(max(0.0,b)),b>0.25); return b+(2.0*s-1.0)*(d-b); } return s; }
fn blendRgb(b: vec3f, s: vec3f, mode: u32) -> vec3f { return vec3f(blendChannel(b.r,s.r,mode),blendChannel(b.g,s.g,mode),blendChannel(b.b,s.b,mode)); }
fn maskAt(coord: vec2i) -> f32 { if (params.maskOptions.x < 0.5) { return params.maskOptions.y; } let size=vec2i(textureDimensions(maskTexture)); var value=params.maskOptions.y; if (all(coord>=vec2i(0)) && all(coord<size)) { value=textureLoad(maskTexture,coord,0).r; } return select(value,1.0-value,params.maskOptions.z>0.5); }
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f { let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[vi],0,1); }
@fragment fn fs_main(@builtin(position) position:vec4f)->@location(0) vec4f {
  let source=textureLoad(sourceTexture,vec2i(position.xy),0); if(source.a<=0.0){return source;} let original=source.rgb/source.a; var adjusted=original; let kind=u32(params.operation.x); let count=u32(params.operation.y);
  if(kind==0u){ if(count>0u){adjusted=exposure(adjusted,params.values0);} if(count>1u){adjusted=exposure(adjusted,params.values1);} if(count>2u){adjusted=exposure(adjusted,params.values2);} if(count>3u){adjusted=exposure(adjusted,params.values3);} if(count>4u){adjusted=exposure(adjusted,params.values4);} if(count>5u){adjusted=exposure(adjusted,params.values5);} if(count>6u){adjusted=exposure(adjusted,params.values6);} if(count>7u){adjusted=exposure(adjusted,params.values7);} }
  else if(kind==1u){adjusted=matrixAdjust(adjusted);} else {
    let perceptual=vec3f(encodeSrgb(original.r),encodeSrgb(original.g),encodeSrgb(original.b));
    let adjustedP=hslAdjust(perceptual,params.values0);
    let maskedP=mix(perceptual,adjustedP,maskAt(vec2i(position.xy)));
    let blendedP=blendRgb(perceptual,maskedP,u32(params.operation.w));
    let outputP=mix(perceptual,blendedP,params.operation.z);
    let output=vec3f(decodeSrgb(outputP.r),decodeSrgb(outputP.g),decodeSrgb(outputP.b));
    return vec4f(output*source.a,source.a);
  }
  let masked=mix(original,adjusted,maskAt(vec2i(position.xy))); let blended=blendRgb(original,masked,u32(params.operation.w)); let output=mix(original,blended,params.operation.z); return vec4f(output*source.a,source.a);
}
