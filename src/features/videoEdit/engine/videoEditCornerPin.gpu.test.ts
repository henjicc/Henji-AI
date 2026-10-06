import { expect, it } from 'vitest'
import { init } from 'vgpu/node'
import { invertVideoEditTrackMatrix, videoEditCornerPinMatrix, videoEditTrackProject, type VideoEditTrackQuad } from '@/core/videoEdit/tracking'
import { videoEditLayerShader } from './videoEditGpuShaders'

it('正式图层 WGSL 在真实设备将 UV 像素透视贴到平面，三角形交界无仿射接缝',async()=> {
  const gpu=await init();const device=gpu.gpu;const size=64
  const source=device.createTexture({size:[size,size],format:'rgba8unorm',usage:0x02|0x04})
  const target=device.createTexture({size:[size,size],format:'rgba8unorm',usage:0x01|0x10})
  const uniform=device.createBuffer({size:96,usage:0x08|0x40});const readback=device.createBuffer({size:size*size*4,usage:0x01|0x08})
  try {
    const pixels=new Uint8Array(size*size*4)
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)pixels.set([Math.round(x*255/(size-1)),Math.round(y*255/(size-1)),0,255],(y*size+x)*4)
    device.queue.writeTexture({texture:source},pixels,{bytesPerRow:size*4},[size,size])
    const quad:VideoEditTrackQuad=[[.1,.15],[.85,.25],[.8,.85],[.3,.75]];const h=videoEditCornerPinMatrix(quad);const inverse=invertVideoEditTrackMatrix(h)
    device.queue.writeBuffer(uniform,0,new Float32Array([1,1,1,0,0,0,1,1,1,1,0,0,h[0],h[1],h[2],0,h[3],h[4],h[5],0,h[6],h[7],h[8],0]))
    const module=device.createShaderModule({code:videoEditLayerShader(false)})
    const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}})
    const encoder=device.createCommandEncoder();const pass=encoder.beginRenderPass({colorAttachments:[{view:target.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]})
    pass.setPipeline(pipeline);pass.setBindGroup(0,device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:source.createView()},{binding:1,resource:device.createSampler({magFilter:'linear',minFilter:'linear'})},{binding:2,resource:{buffer:uniform}}]}));pass.draw(6);pass.end()
    encoder.copyTextureToBuffer({texture:target},{buffer:readback,bytesPerRow:size*4},{width:size,height:size,depthOrArrayLayers:1});device.queue.submit([encoder.finish()]);await readback.mapAsync(0x01)
    const result=new Uint8Array(readback.getMappedRange());let compared=0
    for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
      const [u,v]=videoEditTrackProject(inverse,(x+.5)/size,(y+.5)/size)
      if(u<.05 || u>.95 || v<.05 || v>.95)continue
      const at=(y*size+x)*4
      expect(result[at+3]).toBe(255)
      expect(Math.abs(result[at]-((u*size-.5)/(size-1))*255)).toBeLessThan(2)
      expect(Math.abs(result[at+1]-((v*size-.5)/(size-1))*255)).toBeLessThan(2)
      compared++
    }
    expect(compared).toBeGreaterThan(1000);expect(result[3]).toBe(0);readback.unmap()
  }finally{source.destroy();target.destroy();uniform.destroy();readback.destroy();gpu.dispose()}
},30000)
