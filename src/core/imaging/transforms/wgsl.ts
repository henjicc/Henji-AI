/** Consumes packDeformation data; affine basis and triangles are prepared once by the shared CPU kernel. */
export const DEFORMATION_WGSL = /* wgsl */ `
@group(0) @binding(2) var<storage, read> warpData: array<vec4f>;
fn warpLocal(pixel: vec2f) -> vec2f { let m=warpData[1]; let t=warpData[2]; return vec2f(m.x*pixel.x+m.z*pixel.y+t.x,m.y*pixel.x+m.w*pixel.y+t.y); }
fn inverseWarp(pixel: vec2f) -> vec2f {
  let head=warpData[0];
  if(head.x<0.5) { return pixel; }
  let p=pixel/head.yz;
  if(head.x<1.5) {
    let h=vec3f(p,1.0); let w=dot(warpData[5].xyz,h);
    let q=vec2f(dot(warpData[3].xyz,h),dot(warpData[4].xyz,h))/w;
    if(any(q<vec2f(-0.000001)) || any(q>vec2f(1.000001))) { return vec2f(-1e20); }
    return warpLocal(q*head.yz);
  }
  for(var i=0u; i<u32(head.w); i++) {
    let offset=3u+i*4u; let m=warpData[offset]; let t=warpData[offset+1u];
    let uv=vec2f(m.x*p.x+m.z*p.y+t.x,m.y*p.x+m.w*p.y+t.y);
    if(uv.x>=-0.000001 && uv.y>=-0.000001 && uv.x+uv.y<=1.000001) {
      let ab=warpData[offset+2u]; let c=warpData[offset+3u].xy;
      return warpLocal((ab.xy+uv.x*(ab.zw-ab.xy)+uv.y*(c-ab.xy))*head.yz);
    }
  }
  return vec2f(-1e20);
}
`;
