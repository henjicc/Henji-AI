struct Boundary { row0: vec4f, row1: vec4f, row2: vec4f, options: vec4f }
@group(0) @binding(0) var image: texture_2d<f32>;
@group(0) @binding(1) var<uniform> boundary: Boundary;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f { let p=array<vec2f,3>(vec2f(-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1); }
fn encode(x:vec3f)->vec3f { let m=abs(x); return sign(x)*select(1.055*pow(m,vec3f(1.0/2.4))-0.055,12.92*m,m<=vec3f(0.0031308)); }
fn decode(x:vec3f)->vec3f { let m=abs(x); return sign(x)*select(pow((m+0.055)/1.055,vec3f(2.4)),m/12.92,m<=vec3f(0.04045)); }
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {
  let c=textureLoad(image,vec2i(p.xy),0); if(c.a<=0.0){return vec4f(0.0);}
  var rgb=c.rgb/c.a; if(boundary.options.x>0.5){rgb=decode(rgb);}
  rgb=vec3f(dot(boundary.row0.rgb,rgb),dot(boundary.row1.rgb,rgb),dot(boundary.row2.rgb,rgb));
  if(boundary.options.x<0.5){rgb=encode(rgb);} return vec4f(rgb*c.a,c.a);
}
