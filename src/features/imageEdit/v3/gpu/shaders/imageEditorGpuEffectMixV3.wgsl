struct Params { options: vec4f, maskOptions: vec4f }
@group(0) @binding(0) var originalTexture: texture_2d<f32>;
@group(0) @binding(1) var processedTexture: texture_2d<f32>;
@group(0) @binding(2) var maskTexture: texture_2d<f32>;
@group(0) @binding(3) var<uniform> params: Params;
@vertex fn vs_main(@builtin(vertex_index) vi:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[vi],0,1);}
@fragment fn fs_main(@builtin(position) position:vec4f)->@location(0) vec4f {
  let coord=vec2i(position.xy); let original=textureLoad(originalTexture,coord,0); let processed=textureLoad(processedTexture,coord,0);
  var mask=params.maskOptions.y; if(params.maskOptions.x>0.5){mask=textureLoad(maskTexture,coord,0).r;} if(params.maskOptions.z>0.5){mask=1.0-mask;}
  mask = 1.0 - params.maskOptions.w * (1.0 - mask);
  let masked=mix(original,processed,clamp(mask,0.0,1.0));
  let alpha=mix(original.a,masked.a,params.options.x); let o=select(vec3f(0),original.rgb/original.a,original.a>0.0); let s=select(vec3f(0),masked.rgb/masked.a,masked.a>0.0);
  let blended=blendRgb(o,s,u32(params.options.y)); let rgb=mix(original.rgb,blended*alpha,params.options.x); return vec4f(rgb,alpha);
}
