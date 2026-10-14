/** Procedural content graphics in output pixels: no bitmap enlargement, DOM cursor or UI palette. */
export const RECORDING_CURSOR_WGSL = `
fn cursorLine(p: vec2f, a: vec2f, b: vec2f) -> f32 {
 let ab = b-a; return length(p-a-ab*clamp(dot(p-a,ab)/max(dot(ab,ab),0.00001),0.0,1.0));
}
fn cursorBox(p: vec2f, center: vec2f, halfSize: vec2f) -> f32 {
 let q=abs(p-center)-halfSize; return length(max(q,vec2f(0.0)))+min(max(q.x,q.y),0.0);
}
fn cursorTriangle(p: vec2f, a: vec2f, b: vec2f, c: vec2f) -> f32 {
 let d=min(cursorLine(p,a,b),min(cursorLine(p,b,c),cursorLine(p,c,a)));
 let ab=b-a; let bc=c-b; let ca=a-c;
 let pa=p-a; let pb=p-b; let pc=p-c;
 let x=ab.x*pa.y-ab.y*pa.x; let y=bc.x*pb.y-bc.y*pb.x; let z=ca.x*pc.y-ca.y*pc.x;
 return select(d,-d,(x>=0.0 && y>=0.0 && z>=0.0)||(x<=0.0 && y<=0.0 && z<=0.0));
}
fn cursorDistance(p: vec2f, shape: i32) -> f32 {
 if (shape==1) { // text beam, centered at the actual insertion point
   return min(cursorLine(p,vec2f(0.0,-0.45),vec2f(0.0,0.45)),min(cursorLine(p,vec2f(-0.2,-0.45),vec2f(0.2,-0.45)),cursorLine(p,vec2f(-0.2,0.45),vec2f(0.2,0.45))))-0.035;
 }
 if (shape==2) { // pointing hand: fingertip is the hotspot
   return min(cursorBox(p,vec2f(0.14,0.57),vec2f(0.23,0.28)),min(cursorLine(p,vec2f(0.0,0.08),vec2f(0.0,0.55))-0.085,cursorLine(p,vec2f(-0.23,0.45),vec2f(-0.08,0.72))-0.09));
 }
 if (shape==3 || shape==9) {
   return min(cursorLine(p,vec2f(-0.45,0.0),vec2f(0.45,0.0)),cursorLine(p,vec2f(0.0,-0.45),vec2f(0.0,0.45)))-0.035;
 }
 if (shape==4 || shape==5 || shape==10) {
   var d=abs(length(p)-0.3)-0.045;
   if (shape==10) { d=min(d,cursorLine(p,vec2f(-0.22,0.22),vec2f(0.22,-0.22))-0.035); }
   if (shape==5) { d=min(d,cursorLine(p,vec2f(0.0),vec2f(0.0,-0.22))-0.035); }
   return d;
 }
 if (shape>=6 && shape<=8) {
   var q=p;
   if (shape==7) { q=p.yx; }
   if (shape==8) { q=vec2f(p.x+p.y,p.y-p.x)*0.70710678; }
   return min(cursorLine(q,vec2f(-0.35,0.0),vec2f(0.35,0.0))-0.035,min(cursorTriangle(q,vec2f(-0.5,0.0),vec2f(-0.25,-0.18),vec2f(-0.25,0.18)),cursorTriangle(q,vec2f(0.5,0.0),vec2f(0.25,-0.18),vec2f(0.25,0.18))));
 }
 return min(cursorTriangle(p,vec2f(0.0),vec2f(0.02,0.8),vec2f(0.55,0.55)),cursorLine(p,vec2f(0.23,0.52),vec2f(0.43,0.95))-0.07);
}
@fragment fn recording_cursor(v: Vertex) -> @location(0) vec4f {
 let base=textureLoad(source,vec2i(v.position.xy),0);
 let delta=(v.position.xy-u.a.xy)/max(u.a.z,0.001);
 let p=vec2f(delta.x*u.b.x+delta.y*u.b.y,-delta.x*u.b.y+delta.y*u.b.x);
 let d=cursorDistance(p,i32(u.a.w))*u.a.z;
 let edge=clamp(1.0-d,0.0,1.0)*u.b.w;
 let inside=clamp(-d-0.8,0.0,1.0);
 let fill=select(1.0,0.04,u.b.z>0.5); let border=select(0.04,1.0,u.b.z>0.5);
 let rgb=vec3f(mix(border,fill,inside));
 return vec4f(rgb*edge*base.a+base.rgb*(1.0-edge),base.a);
}
@fragment fn recording_click(v: Vertex) -> @location(0) vec4f {
 let base=textureLoad(source,vec2i(v.position.xy),0);
 let d=length(v.position.xy-u.a.xy); let radius=max(u.a.z,1.0);
 let ring=clamp(1.0-abs(d-radius)/max(1.25,radius*0.07),0.0,1.0);
 let fill=select(0.0,0.18*clamp(radius-d,0.0,1.0),u.b.z>0.5);
 let alpha=max(ring,fill)*u.b.w;
 var color=vec3f(0.1,0.55,1.0);
 if (u.c.x>1.5) { color=vec3f(0.7,0.3,1.0); } else if (u.c.x>0.5) { color=vec3f(1.0,0.45,0.08); }
 return vec4f(color*alpha*base.a+base.rgb*(1.0-alpha),base.a);
}
`
