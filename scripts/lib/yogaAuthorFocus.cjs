// Original CUDA algorithm port used by the verified candidate; tables come from the actual PR bundle.
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
function focusShader(original) {
 const source=original.gpu.passes.at(-1).source
 // The numeric appearance constants below belong to this exact emitted CUDA version.
 const hash = createHash('sha256').update(source).digest('hex')
 const trial = hash === '373cb297a269b937fabf011e088d1fe6284264506d59258c67f4519fd1f0b686'
 assert.ok(trial || hash === '2888e2223872b69f4fca3708cfcebf58056eef07d772c92de0aa6c9b179780eb', '聚焦原算法已改变，须重新核对 WGSL 常数')
 const rows=name=>{const block=new RegExp(name+'\\[[^\\]]+\\]\\[\\d+\\]=\\{([\\s\\S]*?)\\};').exec(source)?.[1];assert.ok(block,'缺少原聚焦表 '+name);return [...block.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1].split(',').map(v=>Number(v.replace(/f/g,''))))}
 const cuts=/CUT\[K\]=\{([^}]+)\}/.exec(source);assert.ok(cuts,'缺少硬切表')
 const D={SHOT:rows('SHOT'),CAMERA:rows('CAMERA'),TRACK:rows('TRACK'),CUT:cuts[1].split(',').map(v=>Number(v.replace(/f/g,''))),focus:{boxOut:.25,boxIn:.3,grow:24,chamfer:22,stroke:2.5,strokeAlpha:.85,strokeColor:[.95,.955,.945],tick:{offset:7,width:3,color:[.4627,.7255,0]}},curves:{move:[.32,0,.12,1],rise:[.2,0,0,1]},shutter:180};
 const number=v=>Number.isInteger(v)?`${v}.0`:String(v);
const table=(name,rows)=>`const ${name}=array<array<f32,${rows[0].length}>,${rows.length}>(${rows.map(r=>`array<f32,${r.length}>(${r.map(number)})`).join(',')});`;
const F=D.focus,C=D.curves;
const shader=`
struct Frame { size:vec2f, time:f32, duration:f32 }
@group(0) @binding(0) var<uniform> f:Frame;
@group(0) @binding(1) var current:texture_2d<f32>;
@group(0) @binding(2) var previous0:texture_2d<f32>;
@group(0) @binding(3) var previous1:texture_2d<f32>;
${table('SHOT',D.SHOT)}
${table('CAMERA',D.CAMERA)}
${table('TRACK',D.TRACK)}
const CUT=array<f32,${D.CUT.length}>(${D.CUT.map(number)});
fn sampleImage(image:texture_2d<f32>,p:vec2f)->vec4f {
 let q=p-vec2f(.5);let a=vec2i(floor(q));let w=fract(q);let high=vec2i(textureDimensions(image))-vec2i(1);
 let c00=textureLoad(image,clamp(a,vec2i(0),high),0);let c10=textureLoad(image,clamp(a+vec2i(1,0),vec2i(0),high),0);
 let c01=textureLoad(image,clamp(a+vec2i(0,1),vec2i(0),high),0);let c11=textureLoad(image,clamp(a+vec2i(1),vec2i(0),high),0);
 return mix(mix(c00,c10,w.x),mix(c01,c11,w.x),w.y);
}
fn clamp01(v:f32)->f32{return clamp(v,0.,1.);}
fn bez(k0:f32,x1:f32,y1:f32,x2:f32,y2:f32)->f32{
 let k=clamp01(k0);var t=k;
 for(var i=0;i<8;i++){let m=1.-t;let x=3.*m*m*t*x1+3.*m*t*t*x2+t*t*t-k;let dx=3.*m*m*x1+6.*m*t*(x2-x1)+3.*t*t*(1.-x2);if(abs(dx)<1e-6){break;}t=clamp01(t-x/dx);}
 let m=1.-t;return 3.*m*m*t*y1+3.*m*t*t*y2+t*t*t;
}
fn shotAt(t:f32)->i32 {if(t<SHOT[0][0]){return -1;}var lo=0;var hi=${D.SHOT.length-1};while(lo<hi){let mid=(lo+hi+1)>>1;if(SHOT[mid][0]<=t){lo=mid;}else{hi=mid-1;}}return lo;}
fn cameraAt(t:f32)->i32 {if(t<CAMERA[0][0]){return -1;}var lo=0;var hi=${D.CAMERA.length-1};while(lo<hi){let mid=(lo+hi+1)>>1;if(CAMERA[mid][0]<=t){lo=mid;}else{hi=mid-1;}}return lo;}
fn trackBox(i:i32)->vec4f{return vec4f(TRACK[i][1],TRACK[i][2],TRACK[i][3],TRACK[i][4]);}
fn trackAt(s:array<f32,11>,t:f32)->vec4f{
 let a=i32(s[9]);let n=i32(s[10]);if(t<=TRACK[a][0]){return trackBox(a);}let b=a+n-1;if(t>=TRACK[b][0]){return trackBox(b);}
 var lo=a;var hi=b;while(hi-lo>1){let mid=(lo+hi)>>1;if(TRACK[mid][0]<=t){lo=mid;}else{hi=mid;}}
 let k=(t-TRACK[lo][0])/(TRACK[hi][0]-TRACK[lo][0]);return trackBox(lo)+(trackBox(hi)-trackBox(lo))*k;
}
fn trackVis(s:array<f32,11>,t:f32)->f32{
 let a=i32(s[9]);let b=a+i32(s[10])-1;if(t<=TRACK[a][0]){return TRACK[a][5];}if(t>=TRACK[b][0]){return TRACK[b][5];}
 var lo=a;var hi=b;while(hi-lo>1){let mid=(lo+hi)>>1;if(TRACK[mid][0]<=t){lo=mid;}else{hi=mid;}}
 return TRACK[lo][5]+(TRACK[hi][5]-TRACK[lo][5])*(t-TRACK[lo][0])/(TRACK[hi][0]-TRACK[lo][0]);
}
fn camAt(t:f32)->vec3f {
 let i=cameraAt(t);if(i<0){return vec3f(1,.5,.5);}let s=CAMERA[i];var k=1.;if(s[1]>=.00833){if(s[8]>.5){k=clamp01((t-s[0])/s[1]);}else{k=bez((t-s[0])/s[1],${C.move.map(number)});}}
 let w=1./s[2]+(1./s[5]-1./s[2])*k;return vec3f(1./w,s[3]+(s[6]-s[3])*k,s[4]+(s[7]-s[4])*k);
}
struct Box { rect:vec4f, look:vec2f, opacity:f32 }
fn boxAt(t:f32)->Box{
 let i=shotAt(t);if(i<0){return Box(vec4f(0),vec2f(0),0);}let s=SHOT[i];if(t>=s[6]){return Box(vec4f(0),vec2f(0),0);}
 var box=vec4f(s[2],s[3],s[4],s[5]);if(s[10]>0.){box=trackAt(s,t);}let look=vec2f(s[7],s[8]);let bin=s[0]+s[1];let bout=s[6]-${number(F.boxOut)};
 let a=bez((t-bin)/${number(F.boxIn)},${C.rise.map(number)});let b=1.-clamp01((t-bout)/${number(F.boxOut)});var vis=1.;if(s[10]>0.){vis=clamp01(trackVis(s,t));}return Box(box,look,min(a,b)*vis);
}
fn chamferBox(p:vec2f,x0:f32,y0:f32,x1:f32,y1:f32,c:f32)->f32{
 let d=max(max(x0-p.x,p.x-x1),max(y0-p.y,p.y-y1));let tl=(x0+y0+c-(p.x+p.y))*.70710678;let br=((p.x+p.y)-(x1+y1-c))*.70710678;return max(d,max(tl,br));
}
fn segDist(p:vec2f,a:vec2f,b:vec2f)->f32{let ab=b-a;let ap=p-a;let k=clamp01(dot(ap,ab)/dot(ab,ab));let d=ap-ab*k;return sqrt(dot(d,d));}
fn shade(uv:vec2f,scale:f32,s:f32,b:vec4f,look:vec2f)->vec4f{
 var c=sampleImage(current,uv);if(s<=0.){return c;}let u=f.size.y/2160./scale;let grow=(1.-s)*${number(F.grow)}*u;
 let x0=b.x*f.size.x-grow;let y0=b.y*f.size.y-grow;let x1=(b.x+b.z)*f.size.x+grow;let y1=(b.y+b.w)*f.size.y+grow;let cut=${number(F.chamfer)}*u;
 let d=chamferBox(uv,x0,y0,x1,y1,cut);let outside=clamp01((d+3.*u)/(6.*u))*s;
 if(outside>0.){let r=look.y*u*s;${trial
  ? 'if(r>.5){if(f.time>=82.4&&f.time<85.75){c=mix(c,sampleImage(previous1,uv),outside);}else{var acc=c;for(var k=0;k<12;k++){let a=f32(k)*2.39996323;let rr=r*select(1.,.5,k<6);acc+=sampleImage(current,uv+vec2f(cos(a),sin(a))*rr);}c=mix(c,acc/13.,outside);}}'
  : 'if(r>.35){c=mix(c,sampleImage(previous1,uv),outside);}'}let black=clamp01(look.x)*outside;c=vec4f(c.rgb*(1.-black),c.a);}
 let stroke=max(0.,1.-abs(d)/(${number(F.stroke/2)}*u))*${number(F.strokeAlpha)}*s;c=mix(c,vec4f(vec3f(${F.strokeColor.map(number)})*c.a,c.a),stroke);
 let o=${number(F.tick.offset)}*u;let q=o*.7071;let tick=min(segDist(uv,vec2f(x0-q,y0+cut-q),vec2f(x0+cut-q,y0-q)),segDist(uv,vec2f(x1-cut+q,y1+q),vec2f(x1+q,y1-cut+q)));
 let tk=max(0.,1.-max(0.,tick-${number(F.tick.width/2)}*u)/u)*s;return mix(c,vec4f(vec3f(${F.tick.color.map(number)})*c.a,c.a),tk);
}
fn sideOfCut(t0:f32,center:f32)->f32{var t=t0;for(var j=0;j<${D.CUT.length};j++){let c=CUT[j];if(c<=center&&t<c){t=c;}else if(c>center&&t>=c){t=c-1e-4;}}return t;}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f{let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);}
@fragment fn focus(@builtin(position) pos:vec4f)->@location(0) vec4f{
 let exposure=${number(D.shutter/360)};let half0=.5*exposure*f.duration;let c0=camAt(sideOfCut(f.time-half0,f.time));let c1=camAt(sideOfCut(f.time+half0,f.time));
 let moving=abs(c1.x-c0.x)>1e-4||abs(c1.y-c0.y)>1e-5||abs(c1.z-c0.z)>1e-5;var count=1;if(exposure>0.&&moving){count=16;}var sum=vec4f(0);
 for(var i=0;i<count;i++){var delta=0.;if(count>1){delta=((f32(i)+.5)/f32(count)-.5)*exposure*f.duration;}let t=sideOfCut(f.time+delta,f.time);let cam=camAt(t);let scale=max(1.,cam.x);let half=.5/scale;let cx=min(1.-half,max(half,cam.y));let cy=min(1.-half,max(half,cam.z));let uv=((pos.xy/f.size-vec2f(.5))/scale+vec2f(cx,cy))*f.size;let box=boxAt(t);sum+=shade(uv,scale,box.opacity,box.rect,box.look);}
 return sum/f32(count);
}
fn gaussian(p:vec2f,vertical:bool)->vec4f{
 ${trial ? 'if(f.time<82.4||f.time>=85.75){if(vertical){return sampleImage(previous0,p);}return sampleImage(current,p);}' : ''}
 let box=boxAt(f.time);let sg=${trial ? '7.' : 'max(0.,box.look.y)'}*(f.size.y/2160.)/max(1.,camAt(f.time).x)*box.opacity;
 if(sg<=.35){if(vertical){return sampleImage(previous0,p);}return sampleImage(current,p);}
 let radius=i32(ceil(3.*sg));var sum=vec4f(0);var weight=0.;
 for(var k=-radius;k<=radius;k++){let d=f32(k);let w=exp(-d*d/(2.*sg*sg));var q=p+vec2f(d,0);if(vertical){q=p+vec2f(0,d);sum+=sampleImage(previous0,q)*w;}else{sum+=sampleImage(current,q)*w;}weight+=w;}
 return sum/weight;
}
@fragment fn gaussian_x(@builtin(position) p:vec4f)->@location(0) vec4f{return gaussian(p.xy,false);}
@fragment fn gaussian_y(@builtin(position) p:vec4f)->@location(0) vec4f{return gaussian(p.xy,true);}
`;

 return shader;
}
module.exports={focusShader};
