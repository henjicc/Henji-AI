const assert = require('node:assert/strict')

const COMMON = `
struct Frame { size:vec2f, time:f32, duration:f32 }
@group(0) @binding(0) var<uniform> f:Frame;
@group(0) @binding(1) var current:texture_2d<f32>;
@group(0) @binding(2) var previous:texture_2d<f32>;
fn sampleImage(image:texture_2d<f32>,p:vec2f)->vec4f {
 let q=p-vec2f(.5);let a=vec2i(floor(q));let w=fract(q);let high=vec2i(textureDimensions(image))-vec2i(1);
 let c00=textureLoad(image,clamp(a,vec2i(0),high),0);
 let c10=textureLoad(image,clamp(a+vec2i(1,0),vec2i(0),high),0);
 let c01=textureLoad(image,clamp(a+vec2i(0,1),vec2i(0),high),0);
 let c11=textureLoad(image,clamp(a+vec2i(1),vec2i(0),high),0);
 return mix(mix(c00,c10,w.x),mix(c01,c11,w.x),w.y);
}
fn clamp01(v:f32)->f32{return clamp(v,0.,1.);}
fn bez(k0:f32,x1:f32,y1:f32,x2:f32,y2:f32)->f32 {
 let k=clamp01(k0);var t=k;
 for(var i=0;i<8;i++){let m=1.-t;let x=3.*m*m*t*x1+3.*m*t*t*x2+t*t*t-k;let dx=3.*m*m*x1+6.*m*t*(x2-x1)+3.*t*t*(1.-x2);if(abs(dx)<1e-6){break;}t=clamp01(t-x/dx);}
 let m=1.-t;return 3.*m*m*t*y1+3.*m*t*t*y2+t*t*t;
}
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
}
`

/** Keep the original constants, pixel-center coordinates and bilinear sample. */
function windowShader(id) {
  const values = {
    '6314410': ['694.', '452.', '1440.'],
    '13815500': ['136.825', '446.35', '1422.'],
    '5880153': ['340.', '600.', '1440.'],
  }[id]
  assert.ok(values, `未翻译的窗口滤镜：${id}`)
  const [left, width, sourceWidth] = values
  return COMMON + `
@fragment fn window(@builtin(position) pos:vec4f)->@location(0) vec4f {
 let p=pos.xy;let u=f.size.y/720.;
 let x=(p.x/u-${left})/${width};let y=(p.y/u-${id === '5880153' ? '118.' : '170.'})/${id === '5880153' ? '450.' : '339.'};
 if(x<0.||x>1.||y<0.||y>1.){return vec4f(0);}
 let k=f.size.y/2160.;
 return sampleImage(current,vec2f(f.size.x*.5+(x-.5)*${sourceWidth}*k,f.size.y*.5+(y-.5)*1080.*k));
}`
}

/** Extract the emitted table, never reconstruct glyph measurements or timing. */
function huaziShader(original) {
  const source = original.gpu.passes[0].source
  const count = Number(/#define N (\d+)/.exec(source)?.[1])
  const block = /BLOCK\[N\]\[9\]=\{([\s\S]*?)\};/.exec(source)?.[1]
  assert.ok(block && count, '原花字毛玻璃缺少 BLOCK 表')
  const rows = [...block.matchAll(/\{([^{}]+)\}/g)].map(match => match[1].split(',').map(value => Number(value.replace(/[()f]/g, ''))))
  assert.equal(rows.length, count)
  assert.ok(rows.every(row => row.length === 9 && row.every(Number.isFinite)))
  const number = value => Number.isInteger(value) ? `${value}.0` : String(value)
  const table = `const BLOCK=array<array<f32,9>,${count}>(${rows.map(row => `array<f32,9>(${row.map(number).join(',')})`).join(',')});`
  const pose = `
struct Pose { center:vec2f, halfSize:vec2f, chamfer:f32, opacity:f32 }
fn poseAt(i:i32)->Pose {
 let T=f.time;let b=BLOCK[i];
 if(T<b[5]||T>b[6]){return Pose(vec2f(0),vec2f(0),0.,0.);}
 let k=bez((T-b[5])/.8,.2,0.,0.,1.);
 let ex=clamp01((b[6]-T)/.32);let eo=1.-ex;
 let ox=b[7]*38.*(1.-k)-b[7]*16.*eo*eo;
 let fx=.8*sin(T*.7+b[8]);let fy=1.5*sin(T*1.1+b[8]*1.7);
 let sc=(.94+(1.-.94)*k)*(1.-.03*eo);
 let a=min(1.,k*2.2)*ex;
 if(a<=.001){return Pose(vec2f(0),vec2f(0),0.,0.);}
 let u=f.size.y/720.;
 return Pose(f.size*.5+vec2f(b[0]+ox+fx,b[1]+fy)*u,vec2f(b[2],b[3])*.5*sc*u,b[4]*sc*u,a);
}`
  return maskedBlurShader(count, table, pose)
}

function nodeGlassShader(original) {
  const source = original.gpu.passes[0].source
  const block = /NODE\[N\]\[5\]=\{([\s\S]*?)\};/.exec(source)?.[1]
  assert.ok(block, '原毛玻璃底缺少 NODE 表')
  const rows = [...block.matchAll(/\{([^{}]+)\}/g)].map(m => m[1].split(',').map(v => Number(v.replace(/f/g, ''))))
  assert.equal(rows.length, 3)
  const table = `const NODE=array<array<f32,5>,3>(${rows.map(row => `array<f32,5>(${row.map(n => Number.isInteger(n) ? `${n}.0` : n).join(',')})`).join(',')});`
  const offset = Number(/float T=float\(f.time\)-([\d.]+)f/.exec(source)?.[1])
  assert.ok(Number.isFinite(offset))
  return maskedBlurShader(3, table, `
struct Pose { center:vec2f, halfSize:vec2f, chamfer:f32, opacity:f32 }
fn poseAt(i:i32)->Pose {
 let T=f.time-${offset};let n=NODE[i];let k=bez((T-n[4])/.8,.2,0.,0.,1.);
 if(k<=0.){return Pose(vec2f(0),vec2f(0),0.,0.);}
 let cam=vec2f(8.*sin(T*.6),4.*sin(T*.8));let camz=1.+.012*sin(T*.45);
 let fl=1.5*sin(T*1.1+n[4]*3.);let world=vec2f(n[0]+n[2]*.5,n[1]+n[3]*.5+(1.-k)*18.+fl);
 let s=f.size.y/720.*camz;let sc=s*(.95+.05*k);
 let a=min(1.,k*1.5)*clamp01((10.85-T)/.45);
 if(a<=.001){return Pose(vec2f(0),vec2f(0),0.,0.);}
 return Pose((world-cam)*s+f.size*.5,vec2f(n[2],n[3])*.5*sc,16.*sc,a);
}`)
}

function maskedBlurShader(count, table, pose) {
  return COMMON + table + pose + `
fn shapeDist(q:vec2f,p:Pose)->f32 {
 let low=p.center-p.halfSize;let high=p.center+p.halfSize;
 let d=max(max(low.x-q.x,q.x-high.x),max(low.y-q.y,q.y-high.y));
 let tl=(low.x+low.y+p.chamfer-(q.x+q.y))*.70710678;
 let br=((q.x+q.y)-(high.x+high.y-p.chamfer))*.70710678;
 return max(d,max(tl,br));
}
@fragment fn blur_x(@builtin(position) pos:vec4f)->@location(0) vec4f {
 let p=pos.xy;let sg=28.*f.size.y/2160.;let reach=3.*sg+4.;var near=false;
 for(var i=0;i<${count}&&!near;i++){let q=poseAt(i);if(q.opacity>0.&&shapeDist(p,q)<reach){near=true;}}
 if(!near){return sampleImage(current,p);}
 var acc=vec4f(0);var wsum=0.;let step=3.*sg/16.;
 for(var k=-16;k<=16;k++){let x=f32(k)*step;let w=exp(-x*x/(2.*sg*sg));acc+=sampleImage(current,p+vec2f(x,0))*w;wsum+=w;}
 return acc/wsum;
}
@fragment fn blur_y(@builtin(position) pos:vec4f)->@location(0) vec4f {
 let p=pos.xy;let src=sampleImage(current,p);var m=0.;
 for(var i=0;i<${count};i++){let q=poseAt(i);if(q.opacity>0.){m=max(m,clamp01(.5-shapeDist(p,q))*q.opacity);}}
 if(m<=0.){return src;}
 let sg=28.*f.size.y/2160.;let step=3.*sg/16.;var acc=vec4f(0);var wsum=0.;
 for(var k=-16;k<=16;k++){let y=f32(k)*step;let w=exp(-y*y/(2.*sg*sg));acc+=sampleImage(previous,p+vec2f(0,y))*w;wsum+=w;}
 return mix(src,acc/wsum,m);
}`
}

function pairedWindowShader(original, id) {
  const source = original.gpu.passes[0].source
  const offset = Number(/float T=float\(f.time\)-\(([\d.]+)f\)/.exec(source)?.[1])
  assert.ok(Number.isFinite(offset), '对比窗缺少原时钟偏移')
  const right = id === '15934198'
  return COMMON + `
fn at(T:f32,p:vec2f)->vec4f {
 let start=${right ? '.3' : '0.'};let k=bez((T-start)/.8,.2,0.,0.,1.);
 if(k<=0.){return vec4f(0);}
 let m=bez((T+.4)/3.2,.32,0.,.12,1.);
 let cam=vec2f(8.*sin(T*.6),4.*sin(T*.8));let cz=(.96+.04*m)*(1.+.012*sin(T*.45));
 let s=f.size.y/720.*cz;let fl=1.5*sin(T*1.1+${right ? '.9' : '0.'});
 let world=vec2f(${right ? '280.' : '-280.'},(1.-k)*18.+fl);let sc=s*(.95+.05*k);
 let ck=bez((T-start-.1)/.75,.2,0.,0.,1.);if(ck<=0.){return vec4f(0);}
 let center=(world-cam)*s+f.size*.5+vec2f(0,12.*(1.-ck)*sc);
 let op=min(1.,k*1.5)*ck*clamp01((3.2-T)/.45);if(op<=.001){return vec4f(0);}
 let uv=((p-center)/sc+vec2f(206.,164.))/vec2f(412.,309.);
 let edge=vec2f(1.)/(sc*vec2f(412.,309.));let dist=min(uv,1.-uv)/edge;
 let mask=clamp01(min(dist.x,dist.y)+.5);if(mask<=0.){return vec4f(0);}
 let src=vec2f(${right ? '1600.' : '1604.'},840.)+(vec2f(.5)+(uv-.5)*vec2f(1.,${right ? '1.' : '.9875'}))*vec2f(${right ? '640.' : '632.'},480.);
 return sampleImage(current,src*f.size.y/2160.)*mask*op;
}
@fragment fn window(@builtin(position) p:vec4f)->@location(0) vec4f {
 let T=f.time-${offset};var count=1;if(T<${right ? '1.3' : '1.'}||T>2.7){count=8;}
 var sum=vec4f(0);for(var i=0;i<count;i++){var dt=0.;if(count>1){dt=((f32(i)+.5)/f32(count)-.5)*.008333;}sum+=at(T+dt,p.xy);}
 return sum/f32(count);
}`
}

/** Author-owned intermediates only; timeline input/target are always borrowed. */
function moduleSource(shader, entries) {
  return `import original from './original.js';
const shader=${JSON.stringify(shader)};
const entries=${JSON.stringify(entries)};
export default {name:original.name,kind:'filter',params:original.params??[],async createWebGPU(device){
 const module=device.createShaderModule({code:shader});
 const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:2,buffer:{type:'uniform'}},...[1,2,3].map(binding=>({binding,visibility:2,texture:{sampleType:'unfilterable-float'}}))]});
 const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
 const buffer=device.createBuffer({size:16,usage:72});
 const cache=new Map();let images=[],size='';
 return {async draw(target,time,_params,width,height,_assets,info,inputs){
  if(!inputs?.current)throw new Error('缺少正式滤镜输入');
  let pipelines=cache.get(target.format);
  if(!pipelines){pipelines=await Promise.all(entries.map((entryPoint,i)=>device.createRenderPipelineAsync({layout:pipelineLayout,vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint,targets:[{format:i<entries.length-1?'rgba32float':target.format}]},primitive:{topology:'triangle-list'}})));cache.set(target.format,pipelines);}
  const nextSize=width+'x'+height;
  if(size!==nextSize){await device.queue.onSubmittedWorkDone();images.forEach(image=>image.destroy());images=entries.slice(1).map(()=>device.createTexture({size:[width,height],format:'rgba32float',usage:22}));size=nextSize;}
  device.queue.writeBuffer(buffer,0,new Float32Array([width,height,time,info.frameDuration]));
  const encoder=device.createCommandEncoder();
  for(let i=0;i<entries.length;i++){
   const output=i<images.length?images[i]:target;
   const previous=i>0?images[0]:inputs.current;
   const previous1=i>1?images[1]:inputs.current;
   const pass=encoder.beginRenderPass({colorAttachments:[{view:output.createView(),loadOp:'clear',storeOp:'store'}]});
   pass.setPipeline(pipelines[i]);pass.setBindGroup(0,device.createBindGroup({layout,entries:[{binding:0,resource:{buffer}},{binding:1,resource:inputs.current.createView()},{binding:2,resource:previous.createView()},{binding:3,resource:previous1.createView()}]}));
   pass.draw(3);pass.end();
  }
  device.queue.submit([encoder.finish()]);
 },async dispose(){await device.queue.onSubmittedWorkDone();buffer.destroy();images.forEach(image=>image.destroy());cache.clear();}};
}};`
}

async function translateYogaFilter(effect) {
  const original = (await import(`data:text/javascript;base64,${Buffer.from(effect.source).toString('base64')}`)).default
  assert.equal(original.gpu?.abi, 'cuda-v1')
  if (['6314410', '13815500', '5880153'].includes(effect.id)) return moduleSource(windowShader(effect.id), ['window'])
  if (effect.id === '9642704') return moduleSource(huaziShader(original), ['blur_x', 'blur_y'])
  if (effect.id === '1270546') return moduleSource(nodeGlassShader(original), ['blur_x', 'blur_y'])
  if (['13119842', '8335157'].includes(effect.id)) return moduleSource(require('./yogaAuthorFocus.cjs').focusShader(original), ['gaussian_x', 'gaussian_y', 'focus'])
  if (['15969942', '15934198'].includes(effect.id)) return moduleSource(pairedWindowShader(original, effect.id), ['window'])
  if (effect.id === '16756797') return moduleSource(COMMON + `
@fragment fn fit(@builtin(position) p:vec4f)->@location(0) vec4f {
 let center=f.size*.5;return sampleImage(current,center+(p.xy-center)/2.25);
}`, ['fit'])
  throw new Error(`尚未翻译的 CUDA 效果：${effect.id} ${effect.name}`)
}

module.exports = { translateYogaFilter }
