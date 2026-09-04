struct Params { direction: vec2f, radius: f32, sigma: f32 }
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var source: texture_2d<f32>;
fn weight(offset:i32)->f32 { if(params.sigma<=0.0){return 1.0;} let x=f32(offset); return exp(-(x*x)/(2.0*params.sigma*params.sigma)); }
@fragment fn fs_main(@builtin(position) position:vec4f)->@location(0) vec4f {
  let size=vec2i(textureDimensions(source)); let center=vec2i(position.xy); let radius=i32(params.radius+0.5);
  var sum=vec4f(0); var total=0.0;
  for(var offset=-radius;offset<=radius;offset+=1){
    let w=weight(offset); let delta=vec2i(params.direction*vec2f(f32(offset)));
    sum+=textureLoad(source,clamp(center+delta,vec2i(0),size-vec2i(1)),0)*w; total+=w;
  }
  return sum/max(total,0.000001);
}
