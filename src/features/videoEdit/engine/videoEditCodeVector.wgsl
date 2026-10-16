struct V {
 @builtin(position) position:vec4f,
 @location(0) point:vec2f,
 @location(1) @interpolate(flat, either) style:vec4f,
 @location(2) @interpolate(flat, either) shape:vec4f,
 @location(3) @interpolate(flat, either) radii:vec4f,
 @location(4) @interpolate(flat, either) refs:vec4f,
 @location(5) @interpolate(flat, either) edges:vec4f,
}
@group(0) @binding(0) var<storage,read> data:array<vec4f>;
@vertex fn vs(@builtin(vertex_index) i:u32,
 @location(0) box:vec4f, @location(1) matrix0:vec4f, @location(2) matrix1:vec4f,
 @location(3) style:vec4f, @location(4) shape:vec4f, @location(5) radii:vec4f,
 @location(6) refs:vec4f, @location(7) edges:vec4f)->V {
 let uv=array<vec2f,6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1))[i];
 var p=box.xy+uv*box.zw;
 if(style.y==2.0) {
   let delta=shape.zw-shape.xy; let len=length(delta); let axis=delta/max(len,.000001);
   p=shape.xy+axis*p.x+vec2f(-axis.y,axis.x)*p.y;
 }
 let q=vec2f(matrix0.x*p.x+matrix0.z*p.y+matrix1.x,matrix0.y*p.x+matrix0.w*p.y+matrix1.y)/matrix1.zw;
 return V(vec4f(q.x*2-1,1-q.y*2,0,1),p,style,shape,radii,refs,edges);
}
fn paint(index:u32, p:vec2f)->vec4f {
 let h=data[index]; let g=data[index+1u];
 if(h.x==0.0) { return g; }
 var t=0.0;
 if(h.x==1.0) { let delta=g.zw-g.xy; if(dot(delta,delta)==0.0) { return vec4f(0); } t=dot(p-g.xy,delta)/dot(delta,delta); }
 if(h.x==2.0) { if(g.z==0.0) { return vec4f(0); } t=length(p-g.xy)/g.z; }
 if(h.x==3.0) { t=fract(atan2(p.y-g.y,p.x-g.x)/6.283185307179586-g.z); }
 let count=u32(h.y); var color=data[index+3u]; var at=data[index+2u].x;
 for(var i=1u;i<count;i++) {
   let offset=data[index+2u+i*2u].x; let next=data[index+3u+i*2u];
   if(t<offset) { return mix(color,next,clamp((t-at)/max(offset-at,.0000001),0.0,1.0)); }
   at=offset; color=next;
 }
 return color;
}
fn rectangle(p:vec2f,box:vec4f,radii:vec4f)->f32 {
 let half=box.zw*.5; let point=p-box.xy-half;
 // An asymmetric corner can extend past the center; quadrant selection alone clips it.
 if(any(radii>vec4f(min(half.x,half.y)))) {
   let q=abs(point)-half; var d=length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0);
   let centers=array<vec2f,4>(box.xy+vec2f(radii.x),box.xy+vec2f(box.z-radii.y,radii.y),box.xy+box.zw-vec2f(radii.z),box.xy+vec2f(radii.w,box.w-radii.w));
   let signs=array<vec2f,4>(vec2f(-1,-1),vec2f(1,-1),vec2f(1,1),vec2f(-1,1));
   for(var i=0u;i<4u;i++) { let delta=p-centers[i]; if(all(delta*signs[i]>vec2f(0))) { d=max(d,length(delta)-radii[i]); } }
   return d;
 }
 var r=select(radii.x,radii.y,point.x>0.0);
 if(point.y>0.0) { r=select(radii.w,radii.z,point.x>0.0); }
 let q=abs(point)-half+vec2f(r);
 return length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0)-r;
}
fn ellipse(p:vec2f,box:vec4f)->f32 {
 let r=max(box.zw*.5,vec2f(.000001)); let q=abs(p-box.xy-r);
 // Closest-point Newton iteration, not the min-radius approximation (wrong for eccentric strokes).
 var angle=0.0; var best=1e30;
 for(var i=0u;i<=8u;i++) {
   let a=f32(i)*1.57079632679/8.0; let delta=q-vec2f(r.x*cos(a),r.y*sin(a));
   if(dot(delta,delta)<best) { best=dot(delta,delta); angle=a; }
 }
 for(var i=0u;i<6u;i++) {
   let c=cos(angle); let s=sin(angle); let v=vec2f(r.x*c,r.y*s); let tangent=vec2f(-r.x*s,r.y*c);
   let second=-v; let denom=dot(tangent,tangent)+dot(v-q,second);
   angle=clamp(angle-clamp(dot(v-q,tangent)/max(denom,.000001),-.2,.2),0.0,1.57079632679);
 }
 let distance=min(length(q-vec2f(r.x*cos(angle),r.y*sin(angle))),min(length(q-vec2f(r.x,0)),length(q-vec2f(0,r.y))));
 return select(distance,-distance,dot(q/r,q/r)<1.0);
}
fn winding(p:vec2f,start:u32,count:u32)->i32 {
 var result=0;
 for(var i=0u;i<count;i++) {
   let edge=data[start+i]; let a=edge.xy; let b=edge.zw;
   let cross=(b.x-a.x)*(p.y-a.y)-(p.x-a.x)*(b.y-a.y);
   if(a.y<=p.y && b.y>p.y && cross>0.0) { result++; }
   if(a.y>p.y && b.y<=p.y && cross<0.0) { result--; }
 }
 return result;
}
fn pathCoverage(p:vec2f,start:u32,count:u32,dx:vec2f,dy:vec2f)->f32 {
 if(count==0u) { return 0.0; }
 var distance=1e20;
 for(var i=0u;i<count;i++) {
   let edge=data[start+i]; let delta=edge.zw-edge.xy;
   distance=min(distance,length(p-edge.xy-delta*clamp(dot(p-edge.xy,delta)/max(dot(delta,delta),.0000001),0.0,1.0)));
 }
 if(distance>(length(dx)+length(dy))*.5) { return select(0.0,1.0,winding(p,start,count)!=0); }
 // Pixel-area coverage at boundaries only. Interior shared tessellation edges cannot create seams.
 var coverage=0.0;
 for(var y=0u;y<8u;y++) { for(var x=0u;x<8u;x++) {
   let sample=p+dx*((f32(x)+.5)/8.0-.5)+dy*((f32(y)+.5)/8.0-.5);
   coverage+=select(0.0,1.0,winding(sample,start,count)!=0);
 } }
 return coverage/64.0;
}
fn coverage(d:f32,dx:f32,dy:f32)->f32 {
 // Analytic area of a locally straight boundary over a square pixel (box-filtered AA).
 let a=max(abs(dx),abs(dy)); let b=min(abs(dx),abs(dy)); let x=-d+(a+b)*.5;
 if(b<.00001) { return clamp(x/max(a,.00001),0.0,1.0); }
 if(x<b) { return clamp(x,0.0,b)*clamp(x,0.0,b)/(2.0*a*b); }
 if(x<a) { return (x-b*.5)/a; }
 let tail=clamp(a+b-x,0.0,b); return 1.0-tail*tail/(2.0*a*b);
}
fn distance(p:vec2f,v:V)->f32 {
 if(v.style.y==0.0) { return rectangle(p,v.shape,v.radii); }
 if(v.style.y==1.0) { return ellipse(p,v.shape); }
 return 1e10;
}
fn lineArea(v:V,dx:vec2f,dy:vec2f)->f32 {
 let delta=v.shape.zw-v.shape.xy; let len=length(delta); let axis=delta/max(len,.000001); let n=vec2f(-axis.y,axis.x);
 let along=dot(v.point-v.shape.xy,axis); let side=dot(v.point-v.shape.xy,n);
 var result=coverage(side-v.style.z,dot(n,dx),dot(n,dy))-coverage(side+v.style.z,dot(n,dx),dot(n,dy));
 if(v.style.z<=.5) { result=2.0*v.style.z*clamp(1.0-abs(side)/max(abs(n.x),abs(n.y)),0.0,1.0); }
 if(v.style.w==1.0) {
   if(along<0.0 || along>len) {
     let q=v.point-(v.shape.xy+axis*clamp(along,0.0,len)); let lengthQ=length(q); let normalQ=q/max(lengthQ,.000001);
     result=coverage(lengthQ-v.style.z,dot(normalQ,dx),dot(normalQ,dy));
   }
 } else {
   let extension=select(0.0,v.style.z,v.style.w==2.0);
   result*=coverage(-along-extension,dot(axis,dx),dot(axis,dy))*coverage(along-len-extension,dot(axis,dx),dot(axis,dy));
 }
 return result;
}
// Keep common instances out of the winding/Newton shader's register and instruction footprint.
// Consecutive compatible shapes still share one instanced draw; ordering is never changed.
@fragment fn fastFs(v:V)->@location(0) vec4f {
 let dx=dpdx(v.point); let dy=dpdy(v.point);
 if(v.style.y==2.0) {
   let color=paint(u32(v.refs.y),v.point);
   return vec4f(color.rgb*color.a,color.a)*lineArea(v,dx,dy)*v.style.x;
 }
 let half=v.shape.zw*.5; let point=v.point-v.shape.xy-half;
 var fill=0.0;
 if(v.style.y==5.0) { fill=clamp(.5-(length(point/max(half,vec2f(.000001)))-1.0)*min(half.x,half.y),0.0,1.0); }
 else if(v.style.y==4.0) {
   let q=abs(point)-half+vec2f(v.radii.x); let d=length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0)-v.radii.x;
   fill=clamp(.5-d,0.0,1.0);
 } else {
   let edge=clamp(half-abs(point)+vec2f(.5),vec2f(0),vec2f(1)); fill=edge.x*edge.y;
 }
 let color=paint(u32(v.refs.x),v.point); return vec4f(color.rgb*color.a,color.a)*fill*v.style.x;
}
@fragment fn fs(v:V)->@location(0) vec4f {
 let dx=dpdx(v.point); let dy=dpdy(v.point);
 if(v.style.y==2.0) {
   let color=paint(u32(v.refs.y),v.point);
   return vec4f(color.rgb*color.a,color.a)*lineArea(v,dx,dy)*v.style.x;
 }
 if((v.style.y==0.0 || v.style.y==4.0) && v.style.z==0.0 && all(v.radii==vec4f(0))) {
   let margin=min(v.point-v.shape.xy,v.shape.xy+v.shape.zw-v.point);
   if(all(margin>vec2f(length(dx)+length(dy)))) {
     let color=paint(u32(v.refs.x),v.point); return vec4f(color.rgb*color.a,color.a)*v.style.x;
   }
 }
 let d=distance(v.point,v);
 let epsilon=.01;
 let normal=vec2f(distance(v.point+vec2f(epsilon,0),v)-distance(v.point-vec2f(epsilon,0),v),distance(v.point+vec2f(0,epsilon),v)-distance(v.point-vec2f(0,epsilon),v))/(2.0*epsilon);
 let ddx=dot(normal,dx); let ddy=dot(normal,dy);
 var fill=coverage(d,ddx,ddy); var stroke=0.0;
 // Preserve the original simple-shape SDF byte-for-byte while batching it with vectors.
 if(v.style.y==4.0) { fill=clamp(.5-rectangle(v.point,v.shape,v.radii),0.0,1.0); }
 if(v.style.y==5.0) {
   let half=v.shape.zw*.5; let q=v.point-v.shape.xy-half;
   fill=clamp(.5-(length(q/max(half,vec2f(.000001)))-1.0)*min(half.x,half.y),0.0,1.0);
 }
 if(v.style.y==3.0) { fill=pathCoverage(v.point,u32(v.refs.z),u32(v.refs.w),dx,dy); }
 if(v.edges.z==1.0) {
   for(var i=0u;i<u32(v.edges.y);i++) { var segment=v; segment.shape=data[u32(v.edges.x)+i]; stroke=max(stroke,lineArea(segment,dx,dy)); }
 }
 else if(v.edges.y>0.0) { stroke=pathCoverage(v.point,u32(v.edges.x),u32(v.edges.y),dx,dy); }
 else if(v.style.y<2.0 && v.style.z>0.0) {
   stroke=coverage(d-v.style.z,ddx,ddy)-coverage(d+v.style.z,ddx,ddy);
 }
 let f=paint(u32(v.refs.x),v.point); let s=paint(u32(v.refs.y),v.point);
 let foreground=vec4f(s.rgb*s.a,s.a)*stroke;
 return (foreground+vec4f(f.rgb*f.a,f.a)*fill*(1.0-foreground.a))*v.style.x;
}
