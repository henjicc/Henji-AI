struct Params { options: vec4f, maskOptions: vec4f }
@group(0) @binding(0) var originalTexture: texture_2d<f32>;
@group(0) @binding(1) var processedTexture: texture_2d<f32>;
@group(0) @binding(2) var maskTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: Params;
fn blendChannel(b:f32,s:f32,m:u32)->f32 { if(m==1u){return b*s;} if(m==2u){return b+s-b*s;} if(m==3u){return select(2.0*b*s,1.0-2.0*(1.0-b)*(1.0-s),b>0.5);} if(m==4u){if(s<=0.5){return b-(1.0-2.0*s)*b*(1.0-b);} let d=select(((16.0*b-12.0)*b+4.0)*b,sqrt(max(0.0,b)),b>0.25);return b+(2.0*s-1.0)*(d-b);} return s; }
fn blendRgb(b:vec3f,s:vec3f,m:u32)->vec3f{return vec3f(blendChannel(b.r,s.r,m),blendChannel(b.g,s.g,m),blendChannel(b.b,s.b,m));}
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
@fragment fn fs_main(@builtin(position) position:vec4f)->@location(0) vec4f {
  let coord=vec2i(position.xy); let original=textureLoad(originalTexture,coord,0); let processed=textureLoad(processedTexture,coord,0);
  var mask=params.maskOptions.y; if(params.maskOptions.x>0.5){mask=textureLoad(maskTexture,coord,0).r;} if(params.maskOptions.z>0.5){mask=1.0-mask;}
  let masked=mix(original,processed,clamp(mask,0.0,1.0));
  let alpha=mix(original.a,masked.a,params.options.x); let o=select(vec3f(0),original.rgb/original.a,original.a>0.0); let s=select(vec3f(0),masked.rgb/masked.a,masked.a>0.0);
  let blended=blendRgb(o,s,u32(params.options.y)); let rgb=mix(original.rgb,blended*alpha,params.options.x); return vec4f(rgb,alpha);
}
