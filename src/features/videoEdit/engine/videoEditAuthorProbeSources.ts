/** Fixed inspection fixtures use the same native author API as real projects. */
export function authorProbeFilter(name: string, expression: string, parameters = '[]'): string {
  const shader = `@group(0) @binding(0) var input: texture_2d<f32>;
@group(0) @binding(1) var<uniform> controls: vec4f;
@vertex fn vertex(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  var p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[i],0,1);
}
@fragment fn fragment(@builtin(position) p:vec4f)->@location(0) vec4f {
  let c=textureLoad(input,vec2i(p.xy),0);return ${expression};
}`
  return `export default {name:${JSON.stringify(name)},kind:"filter",mode:"static",params:${parameters},createWebGPU(device){
    const module=device.createShaderModule({code:${JSON.stringify(shader)}});
    const layout=device.createBindGroupLayout({entries:[{binding:0,visibility:2,texture:{sampleType:"unfilterable-float"}},{binding:1,visibility:2,buffer:{type:"uniform"}}]});
    const pipelines=new Map();const buffer=device.createBuffer({size:16,usage:72});
    return {draw(target,t,params,width,height,assets,info,inputs){
      let pipeline=pipelines.get(target.format);
      if(!pipeline){pipeline=device.createRenderPipeline({layout:device.createPipelineLayout({bindGroupLayouts:[layout]}),vertex:{module,entryPoint:"vertex"},fragment:{module,entryPoint:"fragment",targets:[{format:target.format}]},primitive:{topology:"triangle-list"}});pipelines.set(target.format,pipeline);}
      device.queue.writeBuffer(buffer,0,new Float32Array([params.gain??1,info.clip.time,0,0]));
      const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:inputs.current.createView()},{binding:1,resource:{buffer}}]});
      const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:"clear",storeOp:"store",clearValue:{r:0,g:0,b:0,a:0}}]});
      pass.setPipeline(pipeline);pass.setBindGroup(0,bind);pass.draw(3);pass.end();device.queue.submit([encoder.finish()]);
    },dispose(){buffer.destroy();}};
  }};`
}
export const AUTHOR_GAIN_SOURCE = authorProbeFilter('红色增益', 'vec4f(c.r*controls.x,c.g,c.b,c.a)', '[{key:"gain",type:"number",title:"增益",default:.5,min:0,max:1,step:.01,animatable:true}]')
