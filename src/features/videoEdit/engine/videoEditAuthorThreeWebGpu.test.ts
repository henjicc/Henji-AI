import { expect, it } from 'vitest'
import { loadAuthorThreeLibrary } from './videoEditAuthorThreeWebGpu'

it('不支持的库 pin 在加载前明确失败，不借用应用自己的 three', async () => {
  await expect(loadAuthorThreeLibrary({ three: '0.169.0' })).rejects.toThrow('0.186.1')
})

// 显式 GPU 专项：隔离 Chrome 原型，不连接开发端口，不作为 Electron 整片验收。
if (process.env.HENJI_THREE_GPU === '1') it('真实 G/W、ExternalTexture、TSL 时钟与目标生命周期', async () => {
  const { build } = await import('esbuild')
  const { chromium } = await import('playwright')
  const { createServer } = await import('node:http')
  const { readFile, mkdir, writeFile } = await import('node:fs/promises')
  const path = await import('node:path')
  const bundled = await build({ stdin: { contents: "export * from './src/features/videoEdit/engine/videoEditAuthorThreeWebGpu'; export * from './src/features/videoEdit/engine/videoEditAuthorThreeClock'", resolveDir: process.cwd() }, bundle: true, format: 'esm', write: false, alias: { '@': process.cwd() + '/src' }, define: { 'import.meta.env': '{}' } })
  const server = createServer(async (request, response) => {
    try {
      const name = new URL(request.url!, 'http://localhost').pathname
      response.setHeader('Content-Type', name === '/' ? 'text/html' : 'text/javascript')
      if (name === '/') response.end('<html><head><script type="importmap">{"imports":{"three":"/three.module.js","three/webgpu":"/three.webgpu.js","three/tsl":"/three.tsl.js"}}</script></head><body></body></html>')
      else if (name === '/bridge.js') response.end(bundled.outputFiles[0].text)
      else if (/^\/three\.(?:webgpu|core|tsl|module)\.js$/.test(name)) response.end(await readFile(path.resolve('node_modules/henji-author-three-0.186.1/build', name.slice(1))))
      else { response.statusCode = 404; response.end() }
    } catch (error) { response.statusCode = 500; response.end(String(error)) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-webgpu', '--disable-background-timer-throttling'] })
  try {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(`http://127.0.0.1:${address.port}`)
    const evidence = await page.evaluate<{ identity: boolean; direct: { error: string }; deviceErrors: string[]; frameUpdates: number[][]; renderUpdates: number[][]; results: Array<{ hashes: string[]; samples: number[][]; idle: boolean; computed: number[]; transparent: number[]; cancelled: boolean }> }>(`(async () => {
      const THREE = await import('/three.webgpu.js'), CORE = await import('/three.module.js'), TSL = await import('/three.tsl.js');
      const { VideoEditAuthorThreeWebGpu: Bridge, VideoEditAuthorThreeClock: Clock } = await import('/bridge.js');
      const adapter = await navigator.gpu.requestAdapter(); if(!adapter) throw Error('No GPU adapter');
      const device = await adapter.requestDevice(); const deviceErrors=[];
      const observer=e=>deviceErrors.push(e.error.message); device.onuncapturederror=observer;
      const scene=new THREE.Scene(), camera=new THREE.PerspectiveCamera(2*Math.atan(.5/(80/36))*180/Math.PI,1,.01,100); camera.position.z=80/36;
      const frameUpdates=[],renderUpdates=[];
      const frameValue=TSL.uniform(.2).onFrameUpdate(f=>{frameUpdates.push([f.time,f.deltaTime]);return .2;});
      const renderValue=TSL.uniform(.4).onRenderUpdate(f=>{renderUpdates.push([f.time,f.deltaTime]);return .4;});
      const material=new THREE.MeshBasicNodeMaterial(); material.colorNode=TSL.vec3(TSL.time.mul(.01).add(.1),frameValue,renderValue);
      const geometry=new THREE.PlaneGeometry(1,1); scene.add(new THREE.Mesh(geometry,material));
      const read=async(texture,w,h,bpp=4)=>{const row=Math.ceil(w*bpp/256)*256,b=device.createBuffer({size:row*h,usage:9}); const e=device.createCommandEncoder();e.copyTextureToBuffer({texture},{buffer:b,bytesPerRow:row},[w,h]);device.queue.submit([e.finish()]);await b.mapAsync(1);const data=new Uint8Array(b.getMappedRange().slice(0));b.unmap();b.destroy();return data;};
      const hash=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(x=>x.toString(16).padStart(2,'0')).join('');
      const results=[];
      for(const backend of ['webgpu','webgl']) {
        const bridge=await Bridge.create(THREE,device,backend,new OffscreenCanvas(1,1));
        if(device.onuncapturederror!==observer) throw Error('Host error handler overwritten');
        const target=device.createTexture({size:[64,64],format:'rgba8unorm',usage:23});
        let cancelled=false;try{await bridge.render(scene,camera,target,64,64,9,()=>{throw new DOMException('cancelled','AbortError')});}catch(e){cancelled=e.name==='AbortError';}
        const hashes=[],samples=[];
        for(const t of [0,37,12,37,37]){await bridge.render(scene,camera,target,64,64,t,()=>{},true);await device.queue.onSubmittedWorkDone();const data=await read(target,64,64);hashes.push(await hash(data));samples.push(Array.from(data.slice(32*256+32*4,32*256+32*4+4)));}
        const count=frameUpdates.length;await new Promise(r=>setTimeout(r,80));const idle=frameUpdates.length===count;
        await bridge.render(scene,camera,target,64,64,37,()=>{});hashes.push(await hash(await read(target,64,64)));
        const larger=device.createTexture({size:[128,64],format:'rgba16float',usage:23});
        material.transparent=true;material.opacity=.5;material.needsUpdate=true;
        await bridge.render(scene,camera,larger,128,64,37,()=>{},true);const half=await read(larger,128,64,8),dv=new DataView(half.buffer);
        const transparent=Array.from({length:4},(_,c)=>dv.getFloat16(32*1024+64*8+c*2,true));
        material.transparent=false;material.opacity=1;material.needsUpdate=true;
        await bridge.render(scene,camera,larger,128,64,37,()=>{});await device.queue.onSubmittedWorkDone();
        await bridge.render(scene,camera,target,64,64,37,()=>{});hashes.push(await hash(await read(target,64,64)));
        const clock=new Clock(bridge.renderer,THREE.REVISION),attribute=new THREE.StorageBufferAttribute(4,1),buffer=TSL.storage(attribute,'float',4);
        const compute=TSL.Fn(()=>{buffer.element(0).assign(TSL.time);})().compute(1),computed=[];
        for(const time of [0,37,12,37]){await clock.run(time,()=>bridge.renderer.compute(compute));computed.push(new Float32Array(await bridge.renderer.getArrayBufferAsync(attribute))[0]);}
        const benchmarks=[];
        if(${process.env.HENJI_THREE_BENCH === '1'}) for(const [w,h] of [[1920,1080],[3840,2160]]) for(const samplesPerFrame of [1,8,16]) {
          camera.aspect=w/h;camera.position.z=80*camera.aspect/36;camera.fov=2*Math.atan(.5/camera.position.z)*180/Math.PI;camera.updateProjectionMatrix();
          const image=device.createTexture({size:[w,h],format:'rgba8unorm',usage:23});
          for(let i=0;i<5;i++) await bridge.render(scene,camera,image,w,h,0,()=>{},i===0);
          await device.queue.onSubmittedWorkDone(); const cpu=[],latency=[];
          for(let i=0;i<120;i++) {const start=performance.now();for(let j=0;j<samplesPerFrame;j++)await bridge.render(scene,camera,image,w,h,(i+j/samplesPerFrame)/30,()=>{});cpu.push(performance.now()-start);await device.queue.onSubmittedWorkDone();latency.push(performance.now()-start);}
          const stats=a=>{a.sort((x,y)=>x-y);return {p50:a[59],p95:a[113],max:a[119]};};
          benchmarks.push({w,h,samplesPerFrame,frames:120,cpu:stats(cpu),latency:stats(latency),copiesPerFrame:samplesPerFrame,bridgeBytes:bridge.allocationBytes});image.destroy();
        }
        await bridge.dispose();
        // 销毁包装后宿主目标仍能写入，借入纹理与共享设备仍有效。
        const e=device.createCommandEncoder();const p=e.beginRenderPass({colorAttachments:[{view:target.createView(),loadOp:'clear',storeOp:'store',clearValue:{r:1,g:0,b:0,a:1}}]});p.end();device.queue.submit([e.finish()]);await device.queue.onSubmittedWorkDone();
        results.push({backend,hashes,samples,idle,computed,benchmarks,transparent,cancelled}); target.destroy();larger.destroy();
        camera.aspect=1;camera.position.z=80/36;camera.fov=2*Math.atan(.5/camera.position.z)*180/Math.PI;camera.updateProjectionMatrix();
      }
      // 直接挂载公开 ExternalTexture 作为输出，记录固定版本的可用性；不读取后端私有纹理。
      const renderer=new THREE.WebGPURenderer({device,canvas:new OffscreenCanvas(64,64),alpha:true});
      await renderer.init();const directClock=new Clock(renderer,THREE.REVISION);device.onuncapturederror=observer;
      const borrowed=device.createTexture({size:[64,64],format:'rgba8unorm',usage:23}),rt=new THREE.RenderTarget(64,64,{samples:4});
      rt.texture=new THREE.ExternalTexture(borrowed);rt.texture.image={width:64,height:64};rt.texture.generateMipmaps=false;
      renderer.setRenderTarget(rt);renderer.setOutputRenderTarget(rt);const direct={error:''};device.pushErrorScope('validation');
      try{await directClock.run(37,()=>renderer.render(scene,camera));await device.queue.onSubmittedWorkDone();}catch(e){direct.error=String(e);}
      const validation=await device.popErrorScope();if(validation)direct.error+=' '+validation.message;
      rt.dispose();await renderer.dispose();borrowed.destroy();
      material.dispose();geometry.dispose();await device.queue.onSubmittedWorkDone();device.destroy();
      return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,device:adapter.info.device,description:adapter.info.description},identity:THREE.Scene===CORE.Scene,results,direct,deviceErrors,frameUpdates,renderUpdates};
    })()`)
    await mkdir('.tmp/t16b', { recursive: true })
    await writeFile('.tmp/t16b/gpu-evidence.json', JSON.stringify({ evidence, errors }, null, 2))
    expect(errors).toEqual([])
    expect(evidence.deviceErrors).toEqual([])
    expect(evidence.identity).toBe(true)
    expect(evidence.direct.error).toContain('format')
    expect(evidence.frameUpdates.length).toBeGreaterThan(0)
    expect(evidence.renderUpdates.length).toBeGreaterThan(0)
    expect([...evidence.frameUpdates, ...evidence.renderUpdates].every((sample: number[]) => sample[1] === 0)).toBe(true)
    for (const result of evidence.results) {
      expect(new Set([result.hashes[1], ...result.hashes.slice(3)]).size).toBe(1)
      expect(result.hashes[0]).not.toBe(result.hashes[1])
      expect(result.samples[0][3]).toBe(255)
      expect(result.idle).toBe(true)
      expect(result.cancelled).toBe(true)
      expect(result.transparent[3]).toBeCloseTo(.5, 2)
      expect(result.transparent.slice(0, 3).every(channel => channel > 0 && channel < .5)).toBe(true)
      expect(result.computed).toEqual([0, 37, 12, 37])
    }
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
}, 600_000)
