import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { init, type Gpu } from 'vgpu/node'
import sharp from 'sharp'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { evaluateCodeMaterial } from '@/core/videoEdit/codeMaterial/evaluate'
import { layoutCodeText } from '@/core/videoEdit/codeMaterial/textLayout'
import { codeFont } from '@/core/videoEdit/codeMaterial/textLayout'
import type { CodeDrawCommand, CodePaint, CodeTextMeasurer } from '@/core/videoEdit/codeMaterial/contract'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditCodeGpuV3 } from './videoEditCodeGpuV3'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import { emitCodeMaterialFilter } from './codeGpuFilter'
import { writeFileSync } from 'node:fs'

let gpu: Gpu; let device: Gpu['gpu']; let wrapped: GpuDevice; let runtime: VideoEditCodeGpuV3
const W = 64; const H = 64
const source = (body: string, kind = 'generator'): string => `export default {apiVersion:1,languageVersion:3,name:"GPU v3",kind:"${kind}",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:42,parameters:{},render(ctx){${body}}}`
const context = { time: .4, localTime: .4, sequenceTime: .4, width: W, height: H, frame: 24, fps: 60 }
const testMeasure: CodeTextMeasurer = request => layoutCodeText(request, (text, font) => Array.from(text).length * Number(font.match(/([\d.]+)px/)![1]) * .6)
const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
const color = (paint: number[]): string => `rgba(${paint[0] * 255},${paint[1] * 255},${paint[2] * 255},${paint[3]})`
/** Native libvips SVG raster fixture isolates GPU compositing/effects; Canvas API/layout is tested separately. */
async function rasterFixture(command: CodeDrawCommand, image: { x: number; y: number; width: number; height: number; resolution?: number }): Promise<OffscreenCanvas> {
  const definitions: string[] = []
  const paint = (value: CodePaint): string => {
    if (Array.isArray(value)) return color(value)
    const id = `g${definitions.length}`; const stops = value.stops.map(([at, ink]) => `<stop offset="${at}" stop-color="${color(ink)}"/>`).join('')
    definitions.push(value.kind === 'linearGradient' ? `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${value.x1}" y1="${value.y1}" x2="${value.x2}" y2="${value.y2}">${stops}</linearGradient>` : `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${value.cx}" cy="${value.cy}" r="${value.r}">${stops}</radialGradient>`)
    return `url(#${id})`
  }
  const fill = paint(command.paint ?? ('fill' in command ? command.fill : 'color' in command ? command.color : [1, 1, 1, 1]))
  const stroke = command.stroke ? `stroke="${paint(command.stroke)}" stroke-width="${command.strokeWidth ?? 0}"` : ''
  let geometry = ''
  if (command.kind === 'rect') geometry = `<rect x="${command.x}" y="${command.y}" width="${command.width}" height="${command.height}" rx="${command.radius}" fill="${fill}" ${stroke}/>`
  if (command.kind === 'ellipse') geometry = `<ellipse cx="${command.x + command.width / 2}" cy="${command.y + command.height / 2}" rx="${command.width / 2}" ry="${command.height / 2}" fill="${fill}" ${stroke}/>`
  if (command.kind === 'path') geometry = `<path d="${command.points.map(path => path.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ') + (command.closed ? ' Z' : '')).join(' ')}" fill="${fill}" ${stroke}/>`
  if (command.kind === 'text') geometry = `<text x="${command.x}" y="${command.y + command.fontSize * .3}" font-size="${command.fontSize}" font-family="sans-serif" fill="${fill}" ${stroke}>${escape(command.text)}</text>`
  const width = image.width * (image.resolution ?? 1); const height = image.height * (image.resolution ?? 1)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${image.x} ${image.y} ${image.width} ${image.height}"><defs>${definitions.join('')}</defs>${geometry}</svg>`
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  // The GPU stores premultiplied pixels, as production copyExternalImageToTexture requests.
  for (let i = 0; i < data.length; i += 4) { const a = data[i + 3] / 255; data[i] = Math.round(data[i] * a); data[i + 1] = Math.round(data[i + 1] * a); data[i + 2] = Math.round(data[i + 2] * a) }
  return { pixels: data, width, height } as unknown as OffscreenCanvas
}
beforeAll(async () => {
  gpu = await init(); device = gpu.gpu
  const queue = new Proxy(device.queue, { get(target, key) {
    if (key === 'copyExternalImageToTexture') return (from: { source: { pixels: Uint8Array; width: number; height: number } }, to: { texture: Parameters<typeof device.queue.writeTexture>[0]['texture'] }) => target.writeTexture(to, from.source.pixels, { bytesPerRow: from.source.width * 4 }, [from.source.width, from.source.height])
    const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
  } })
  wrapped = new Proxy(device, { get(target, key) {
    if (key === 'queue') return queue
    if (key === 'createTexture') return (descriptor: Parameters<typeof device.createTexture>[0]) => target.createTexture({ ...descriptor, usage: descriptor.usage | 0x01 })
    const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
  } }) as unknown as GpuDevice
  runtime = new VideoEditCodeGpuV3(wrapped, { allocate: (width, height) => texture(width, height), release: texture => texture.destroy() }, rasterFixture)
})
afterAll(async () => { await runtime?.dispose(); gpu?.dispose() })
function texture(width = W, height = H): GpuTexture { return device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x10 }) as unknown as GpuTexture }
async function read(texture: GpuTexture, width = W, height = H): Promise<Uint8Array> {
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256; const buffer = device.createBuffer({ size: bytesPerRow * height, usage: 0x01 | 0x08 }); const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture: texture as never }, { buffer, bytesPerRow }, { width, height, depthOrArrayLayers: 1 }); device.queue.submit([encoder.finish()]); await buffer.mapAsync(1)
  const mapped = new Uint8Array(buffer.getMappedRange()); const pixels = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) pixels.set(mapped.subarray(y * bytesPerRow, y * bytesPerRow + width * 4), y * width * 4)
  buffer.unmap(); buffer.destroy(); return pixels
}
const pixel = (pixels: Uint8Array, x: number, y: number): number[] => [...pixels.slice((y * W + x) * 4, (y * W + x) * 4 + 4)]
async function run(body: string): Promise<Uint8Array> {
  const target = texture(); device.pushErrorScope('validation')
  try {
    await runtime.render(target, W, H, evaluateCodeMaterial(compileCodeMaterial(source(body)), context, {}, { measureText: testMeasure }))
    const result = await read(target); expect(await device.popErrorScope()).toBeNull(); return result
  } finally { target.destroy() }
}
describe('v3 真实 GPU 像素与工作预算', () => {
  it('4K180帧文字加形状动画复用局部字形，分辨率分档提升且预览/导出像素一致', async () => {
    const calls: Array<{ width: number; height: number; ms: number }> = []
    const host = new VideoEditCodeGpuV3(wrapped, { allocate: (width, height) => texture(width, height), release: texture => texture.destroy() }, async (command, image) => {
      const start = performance.now(); const result = await rasterFixture(command, image)
      calls.push({ width: result.width, height: result.height, ms: performance.now() - start }); return result
    })
    const program = compileCodeMaterial(source('return [rect({x:900,y:500,width:800,height:600,fill:[.2,.3,.4,1]}),text({x:1200+ctx.frame*2,y:1000,text:"Motion",fontSize:144,rotation:ctx.frame/2,opacity:.3+ctx.frame/300,scale:.5+ctx.frame/360})];'))
    const target = texture(3840, 2160); const exportTarget = texture(3840, 2160); const frames: number[] = []
    device.pushErrorScope('validation')
    try {
      let commands: CodeDrawCommand[] = []
      for (let frame = 0; frame < 180; frame++) {
        const start = performance.now(); commands = evaluateCodeMaterial(program, { ...context, width: 3840, height: 2160, frame, time: frame / 60 }, {}, { measureText: testMeasure })
        await host.render(target, 3840, 2160, commands); await device.queue.onSubmittedWorkDone(); frames.push(performance.now() - start)
      }
      expect(calls).toHaveLength(1); expect(host.counts.uploads).toBe(1); expect(calls[0].width * calls[0].height).toBeLessThan(3840 * 2160 / 10)
      await host.render(exportTarget, 3840, 2160, commands)
      expect(Buffer.from(await read(exportTarget, 3840, 2160)).equals(Buffer.from(await read(target, 3840, 2160)))).toBe(true)
      const sorted = [...frames].sort((a, b) => a - b)
      let fullFrameReference: { rasterCalls: number; uploadedPixels: number; rasterMs: number; totalMs: number; p95Ms: number } | undefined
      if (process.env.HENJI_TYPOGRAPHY_GPU_COMPARE) {
        // Workload reference for the removed full-frame Canvas path. Native libvips replaces Chromium Canvas;
        // this measures the cost of repeated full-frame raster/upload, not Electron drag throughput.
        const input = texture(3840, 2160); const referenceFrames: number[] = []; let rasterMs = 0
        try {
          for (let frame = 0; frame < 180; frame++) {
            const start = performance.now(); const x = 1200 + frame * 2; const scale = .5 + frame / 360
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="3840" height="2160"><rect x="900" y="500" width="800" height="600" fill="${color([.2,.3,.4,1])}"/><g opacity="${.3 + frame / 300}" transform="translate(${x},1000) rotate(${frame / 2}) scale(${scale})"><text x="0" y="43.2" font-size="144" font-family="sans-serif" fill="${color([1,1,1,1])}">Motion</text></g></svg>`
            const data = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer(); rasterMs += performance.now() - start
            // The reference writes unpremultiplied pixels, matching the removed compositor bitmap upload.
            device.queue.writeTexture({ texture: input as never }, data, { bytesPerRow: 3840 * 4 }, [3840,2160])
            await host.render(exportTarget,3840,2160,[{ kind:'image',source:{kind:'image',mediaId:'reference'},x:0,y:0,width:3840,height:2160,opacity:1 }],new Map([['reference',{texture:input,width:3840,height:2160,owner:wrapped,premultiplied:false}]]))
            await device.queue.onSubmittedWorkDone(); referenceFrames.push(performance.now()-start)
          }
          const ordered = [...referenceFrames].sort((a,b)=>a-b)
          fullFrameReference = { rasterCalls:180, uploadedPixels:3840*2160*180, rasterMs, totalMs:referenceFrames.reduce((sum,ms)=>sum+ms,0),p95Ms:ordered[171] }
        } finally { input.destroy() }
      }
      if (process.env.HENJI_TYPOGRAPHY_GPU_OUT) writeFileSync(process.env.HENJI_TYPOGRAPHY_GPU_OUT, JSON.stringify({ frames: 180, rasterCalls: calls.length, rasterMs: calls[0].ms, uploads: host.counts.uploads, canvas: calls[0], frameP95Ms: sorted[171], totalMs: frames.reduce((sum, ms) => sum + ms, 0), fullFrameReference }, null, 2))
      const text = commands[1] as Extract<CodeDrawCommand, { kind: 'text' }>
      await host.render(target, 3840, 2160, [{ ...text, scaleX: 1.1, scaleY: 1.1 }]); expect(calls).toHaveLength(2)
      await host.render(target, 3840, 2160, [{ ...text, scaleX: 1.8, scaleY: 1.8, rotation: 15, opacity: .5, elementTransform: [1, 0, 0, 1, 300, 200] }]); expect(calls).toHaveLength(2)
      expect(calls[1].width).toBe(calls[0].width * 2); expect(await device.popErrorScope()).toBeNull()
    } finally { target.destroy(); exportTarget.destroy(); await host.dispose() }
  }, 60_000)
  it('分组旋转、不透明度与 multiply/screen/overlay/add/lighten/darken 有实际像素', async () => {
    const modes = ['normal', 'multiply', 'screen', 'overlay', 'add', 'lighten', 'darken']
    const expected = [.8, .8 * .2, .8 + .2 - .8 * .2, 2 * .8 * .2, 1, .8, .2]
    for (let i = 0; i < modes.length; i++) {
      const pixels = await run(`return [rect({x:0,y:0,width:64,height:64,fill:[.2,.2,.2,1]}),group({x:32,y:32,rotation:90,blend:"${modes[i]}"},[rect({x:0,y:0,width:16,height:16,fill:[.8,.8,.8,1]})])];`)
      expect(pixel(pixels, 24, 40)[0], modes[i]).toBeCloseTo(Math.round(expected[i] * 255), -1)
    }
    const pixels = await run('return [group({opacity:.5},[rect({x:0,y:0,width:40,height:40,fill:[1,0,0,1]}),rect({x:10,y:0,width:40,height:40,fill:[0,1,0,1]})])];')
    expect(pixel(pixels, 20, 20)[3]).toBeCloseTo(128, -1)
  })
  it('渐变与贝塞尔路径缓存上传；阴影发光与模糊由 GPU 散射出界', async () => {
    const gradient = await run('return [path({d:"M 8 8 L 56 8 Q 56 56 8 56 Z",fill:linearGradient({x1:8,y1:0,x2:56,y2:0,stops:[[0,[1,0,0,1]],[1,[0,0,1,1]]]})})];')
    expect(pixel(gradient, 14, 15)[0]).toBeGreaterThan(pixel(gradient, 14, 15)[2]); expect(pixel(gradient, 47, 15)[2]).toBeGreaterThan(pixel(gradient, 47, 15)[0]); expect(pixel(gradient, 60, 60)[3]).toBe(0)
    const body = 'return [rect({x:24,y:24,width:16,height:16,fill:[1,1,1,1],shadow:{x:10,y:0,blur:2,color:[1,0,0,1]},glow:{radius:4,intensity:2,color:[0,1,0,1]}})];'
    const glow = await run(body); expect(pixel(glow, 43, 32)[3]).toBeGreaterThan(0); expect(pixel(glow, 43, 32)[0] + pixel(glow, 43, 32)[1]).toBeGreaterThan(0)
    const grouped = await run(`return [group({},[rect({x:24,y:24,width:16,height:16,fill:[1,1,1,1],glow:{radius:4,intensity:2,color:[0,1,0,1]}})])];`)
    expect(pixel(grouped, 43, 32)[3]).toBeGreaterThan(0)
    const before = runtime.counts.uploads; await run(body); expect(runtime.counts.uploads).toBe(before)
    const blur = await run('return [rect({x:24,y:24,width:16,height:16,fill:[1,1,1,1],blur:4})];'); expect(pixel(blur, 22, 32)[3]).toBeGreaterThan(0)
  })
  it('滤镜 repeat 展开 64 次采样，模糊/辉光/色彩原语在真实设备编译', async () => {
    const host = new VideoEditCodeGpu(wrapped); const input = await host.target('input', W, H)
    const data = new Uint8Array(W * H * 4); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([x < 32 ? 255 : 0, 0, 0, 255], (y * W + x) * 4)
    device.queue.writeTexture({ texture: input.texture as never }, data, { bytesPerRow: W * 4 }, [W, H])
    try {
      for (const body of ['return average(repeat(64,i=>sampleOffset(i-32,0)));', 'return blur(4);', 'return glow(.1,4,1);', 'return saturate(contrast(sampleOffset(0,0),1.2),.5);', 'return hsv(noise(.1,.2,.3),.5,.8);', 'return hsl(.6,.8,.4);', 'return toHsv(sampleOffset(0,0));', 'return toHsl(sampleOffset(0,0));', 'return rgba(progress(ctx.time,0,1),cubicBezier(.2,0,.8,1,.5),tween(ctx.time,0,1,0,1,"expoOut"),1);']) {
        const program = compileCodeMaterial(source(body, 'filter')); expect(emitCodeMaterialFilter(program)).toContain('@fragment')
        device.pushErrorScope('validation'); const output = await host.filter('filter', body, program, context, {}, input); const pixels = await read(output.texture); expect(await device.popErrorScope()).toBeNull(); expect(pixel(pixels, 32, 32)[3], body).toBe(255)
      }
      data.fill(0); data.set([0, 0, 0, 255], (32 * W + 32) * 4); device.queue.writeTexture({ texture: input.texture as never }, data, { bytesPerRow: W * 4 }, [W, H])
      const black = await host.filter('filter', 'zero-threshold-black', compileCodeMaterial(source('return glow(0,4,1);', 'filter')), context, {}, input)
      const blackPixels = await read(black.texture); expect(pixel(blackPixels, 32, 32)[3]).toBe(255); expect(pixel(blackPixels, 34, 32)[3]).toBe(0)
    } finally { await host.dispose() }
  })
  it('逐字错峰与径向渐变有效；图片同样接受组裁切、混合与GPU发光', async () => {
    const pixels = await run('return [text({x:10,y:20,text:"AB",fontSize:20,baseline:"top",fill:radialGradient({cx:20,cy:20,r:30,stops:[[0,[1,0,0,1]],[1,[0,0,1,1]]]}),perChar:(i,n)=>({x:12,opacity:i===0?0:1}),glow:{radius:2,intensity:1,color:[0,1,0,1]}})];')
    expect(pixels.filter((_, i) => i % 4 === 3).some(a => a > 0)).toBe(true)
    expect(pixel(pixels, 12, 20)[3]).toBe(0)
    const input = texture(8, 8); const output = texture(); const data = new Uint8Array(8 * 8 * 4).fill(255)
    device.queue.writeTexture({ texture: input as never }, data, { bytesPerRow: 32 }, [8, 8])
    const commands: CodeDrawCommand[] = [{ kind: 'image', source: { kind: 'image', mediaId: 'test-image' }, x: 24, y: 24, width: 16, height: 16, opacity: 1, glow: { radius: 4, intensity: 2, color: [0, 1, 0, 1] }, blend: 'screen', elementId: 'image' }]
    device.pushErrorScope('validation')
    try {
      await runtime.render(output, W, H, commands, new Map([['test-image', { texture: input, width: 8, height: 8, owner: wrapped, premultiplied: true }]]))
      const result = await read(output); expect(pixel(result, 41, 32)[3]).toBeGreaterThan(0); expect(await device.popErrorScope()).toBeNull()
    } finally { input.destroy(); output.destroy() }
  }, 30_000)
  it('正式生成器入口调用v3合成器，并在多帧滤镜后复用资源与释放驻留字节', async () => {
    const host = new VideoEditCodeGpu(wrapped)
    try {
      const generator = compileCodeMaterial(source('return [group({x:8,y:8,opacity:.5},[rect({x:0,y:0,width:32,height:32,fill:[1,0,0,1]})])];'))
      const output = await host.generator('generator', generator, context, {})
      expect(pixel(await read(output.texture), 16, 16)[3]).toBeCloseTo(128, -1)
      const filter = compileCodeMaterial(source('return glow(.2,8,1);', 'filter'))
      for (let frame = 0; frame < 3; frame++) await host.filter('filtered', 'glow-version', filter, { ...context, frame }, {}, output)
      const resident = host.diagnostics().residentBytes
      for (let frame = 3; frame < 6; frame++) await host.filter('filtered', 'glow-version', filter, { ...context, frame }, {}, output)
      expect(host.diagnostics().residentBytes).toBe(resident); expect(host.diagnostics().pipelines).toBeGreaterThan(9)
    } finally { await host.dispose(); expect(host.diagnostics().residentBytes).toBe(0) }
  })
  it('4K 标题约50元素与1000粒子的 CPU 求值、GPU提交和完成实测', async () => {
    if (process.env.HENJI_CODE_V3_BENCH !== '1') return
    const width = 3840; const height = 2160; const target = texture(width, height)
    const scenes = [
      source('return [group({x:tween(ctx.time,0,.6,-800,100,"expoOut"),y:200,glow:{radius:18,intensity:1.5,color:[.2,.6,1,1]}},[rect({x:0,y:0,width:1900,height:200,fill:[.05,.1,.2,1]}),text({x:30,y:100,text:"HENJI AI MOTION TITLE 012345678901234567890123456789",fontSize:50,color:[1,1,1,1],perChar:(i,n)=>({y:tween(ctx.time,stagger(i,.04),.6,100,0,"expoOut"),opacity:progress(ctx.time,stagger(i,.04),.3)})})])];'),
      source('return repeat(1000,i=>ellipse({x:(random(i)*ctx.width+ctx.time*120+noise(i*.03,ctx.time)*180)%ctx.width,y:(random(i+1000)*ctx.height+sin(ctx.time+i*.1)*50+ctx.height)%ctx.height,width:6,height:6,fill:mix([.1,.4,1,.7],[.8,.2,1,.7],random(i+2000))}));'),
      source('return repeat(4096,i=>rect({x:(i%128)*30,y:floor(i/128)*30,width:6,height:6,fill:[.2,.6,1,1]}));'),
    ]
    const evidence: unknown[] = []
    try {
      for (const [index, code] of scenes.entries()) {
        const program = compileCodeMaterial(code); const frameContext = { ...context, width, height, time: .15 }
        await runtime.render(target, width, height, evaluateCodeMaterial(program, frameContext, {}, { measureText: testMeasure })); await device.queue.onSubmittedWorkDone()
        const cpu: number[] = []; const submit: number[] = []; const completed: number[] = []
        const before = { ...runtime.counts }
        for (let frame = 0; frame < 60; frame++) {
          const t = performance.now(); const commands = evaluateCodeMaterial(program, { ...frameContext, time: .15 + frame / 60 }, {}, { measureText: testMeasure }); const afterCpu = performance.now()
          await runtime.render(target, width, height, commands); const afterSubmit = performance.now(); await device.queue.onSubmittedWorkDone()
          cpu.push(afterCpu - t); submit.push(afterSubmit - afterCpu); completed.push(performance.now() - t)
        }
        const statistics = (values: number[]) => ({ mean: values.reduce((a, b) => a + b, 0) / values.length, p95: [...values].sort((a, b) => a - b)[Math.floor(values.length * .95)], max: Math.max(...values) })
        evidence.push({ scene: ['title50', 'particles1000', 'simple4096'][index], resolution: [width, height], frames: 60, cpuMs: statistics(cpu), submitMs: statistics(submit), completedMs: statistics(completed), before, after: { ...runtime.counts }, resident: runtime.diagnostics(), program: program.metrics })
      }
      const host = new VideoEditCodeGpu(wrapped); const input = await host.target('sample-input', width, height)
      try {
        for (const [name, body] of [['sample64', 'return average(repeat(64,i=>sampleOffset(i-32,0)));'], ['glow4K', 'return glow(.2,32,1.5);']]) {
        const program = compileCodeMaterial(source(body, 'filter'))
        const times: number[] = []; const submissions: number[] = []
        await host.filter('sample-output', name, program, { ...context, width, height }, {}, input); await device.queue.onSubmittedWorkDone()
        for (let frame = 0; frame < 60; frame++) {
          const start = performance.now(); await host.filter('sample-output', name, program, { ...context, width, height, frame }, {}, input); submissions.push(performance.now() - start); await device.queue.onSubmittedWorkDone(); times.push(performance.now() - start)
        }
        const stats = (values: number[]) => ({ mean: values.reduce((a, b) => a + b, 0) / values.length, p95: [...values].sort((a, b) => a - b)[Math.floor(values.length * .95)], max: Math.max(...values) })
        evidence.push({ scene: name, resolution: [width, height], frames: 60, submitMs: stats(submissions), completedMs: stats(times), program: program.metrics, resident: host.diagnostics() })
        }
      } finally { await host.dispose() }
      const adapter = gpu.device.adapterInfo
      process.stdout.write(`CODE_V3_BENCH ${JSON.stringify({ adapter: { vendor: adapter.vendor, architecture: adapter.architecture, device: adapter.device, description: adapter.description }, scenes: evidence })}\n`)
    } finally { target.destroy() }
    // Measures submission and completion only; this is not an Electron presentation benchmark.
    expect(codeFont({ text: '', fontFamily: 'sans-serif', fontWeight: 400, fontStyle: 'normal', fontSize: 50, letterSpacing: 0, lineHeight: 1.2, maxWidth: 0, maxLines: 0, wrap: false })).toContain('50px')
  }, 120_000)
})


describe('t74 作者语言着色器GPU接线', () => {
  it('真实编译渲染极光逐字标题、光束产品卡；旋转裁切与帧内复用有像素证据', async () => {
    const aurora = 'shader({id:"sky",name:"aurora",params:{color_b:[.1,.8,.6,1]},x:0,y:0,width:64,height:64})'
    const sky = await run(`return [${aurora}];`)
    const title = await run(`return [${aurora},text({x:5,y:30,text:"AI",fontSize:22,color:[1,1,1,1],perChar:(i,n)=>({y:tween(ctx.time,stagger(i,.04),.3,8,0,"expoOut"),opacity:progress(ctx.time,stagger(i,.04),.3)})})];`)
    expect(sky.some((v,i)=>i%4!==3 && v>10)).toBe(true)
    expect(title.filter((v,i)=>i%4!==3 && v>200).length).toBeGreaterThan(sky.filter((v,i)=>i%4!==3 && v>200).length)
    const card = await run('return [rect({x:0,y:0,width:64,height:64,fill:[.1,.1,.1,1]}),group({x:32,y:10,rotation:15,opacity:.8,clip:{x:0,y:0,width:24,height:40}},[rect({x:0,y:0,width:24,height:40,radius:3,fill:[.2,.2,.3,1]}),shader({name:"beam",params:{direction:ctx.time*60},x:0,y:0,width:24,height:40,blend:"add"})])];')
    expect(card.some((v,i)=>i%4!==3 && v>80)).toBe(true); expect(pixel(card,0,0)[0]).toBeCloseTo(26,-1)
    const clipped = await run('return [group({x:32,y:32,rotation:90,clip:{x:0,y:0,width:16,height:16}},[shader({name:"linear_gradient",params:{color_a:[1,0,0,1],color_b:[0,0,1,1]},x:0,y:0,width:32,height:32})])];')
    expect(pixel(clipped,24,40)[3]).toBe(255); expect(pixel(clipped,8,40)[3]).toBe(0)
    const before = runtime.counts.allocations
    await run(`return [${aurora},${aurora}];`)
    const allocations = runtime.counts.allocations-before
    // Changing element position/id does not allocate another shader-result layer in the same frame.
    const before2 = runtime.counts.allocations
    await run(`return [${aurora},${aurora.replace('id:"sky"','id:"copy"').replace('x:0','x:4')}];`)
    expect(runtime.counts.allocations-before2).toBe(0); expect(allocations).toBeLessThanOrEqual(1)
  }, 30000)
  it('色差+颗粒串接，玻璃与原画/模糊组合，透明/同帧缓存与失败释放', async () => {
    const host = new VideoEditCodeGpu(wrapped); const input = await host.target('t74:input',W,H)
    const data = new Uint8Array(W*H*4)
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) data.set([x<32?220:20,y<32?140:50,80,x<4?0:255],(y*W+x)*4)
    device.queue.writeTexture({texture:input.texture as never},data,{bytesPerRow:W*4},[W,H])
    try {
      let index=0
      for(const body of ['const a=shaderFilter("chromatic",{strength:90}); return shaderFilter("grain",{strength:70,speed:ctx.time/2},a);','return clamp(mix(shaderFilter("glass",{scale:20}),blur(2),.5),0,1);']) {
        const program=compileCodeMaterial(source(body,'filter')); device.pushErrorScope('validation')
        const output=await host.filter('t74:output',`t74:${index++}`,program,context,{},input)
        const pixels=await read(output.texture); expect(await device.popErrorScope()).toBeNull()
        expect(pixels.some((v,i)=>i%4!==3 && v>100)).toBe(true); expect(pixels).not.toEqual(data)
        if(index===1) expect(pixel(pixels,0,20)[3]).toBe(0)
      }
      const repeated=compileCodeMaterial(source('return clamp(mix(shaderFilter("grain",{}),shaderFilter("grain",{speed:1}),.5),0,1);','filter'))
      const allocation=host.diagnostics().textureAllocations
      const one=await host.filter('t74:output','t74:repeated',repeated,context,{},input); const pixels=await read(one.texture)
      expect(host.diagnostics().textureAllocations-allocation).toBe(1)
      const again=await host.filter('t74:output','t74:repeated',repeated,context,{},input); expect(await read(again.texture)).toEqual(pixels)
      const bad=compileCodeMaterial(source('return shaderFilter("grain",{speed:ctx.time},shaderFilter("chromatic",{}));','filter'))
      const resident=host.diagnostics().residentBytes
      await expect(host.filter('t74:output','t74:bad',bad,{...context,time:5}, {},input)).rejects.toMatchObject({code:'PARAMETERS',sourceSpan:expect.objectContaining({startLine:1})})
      expect(host.diagnostics().residentBytes).toBe(resident)
    } finally {await host.dispose()}
  },30000)
  it('五种类别至少一个真实像素输出',async()=>{
    for(const name of ['linear_gradient','aurora','beam']) {
      const pixels=await run(`return [shader({name:"${name}",x:0,y:0,width:64,height:64})];`)
      expect(pixels.some((v,i)=>i%4!==3 && v>20),name).toBe(true)
    }
    // Style and optical categories are covered above by grain/chromatic and glass.
  },30000)
  it('4K四层/四工序边界与旋转开销实测（显式启用）',async()=>{
    if(process.env.HENJI_CODE_SHADER_BENCH!=='1') return
    const width=3840;const height=2160;const target=texture(width,height)
    const frame={...context,width,height}; const report:Record<string,unknown>={adapter:gpu.device.adapterInfo, width,height,method:'CPU evaluate + queue completion, warmup3, frames20'}
    const measure=async(name:string,render:(frame:number)=>Promise<void>):Promise<void>=>{
      for(let i=0;i<3;i++){await render(i);await device.queue.onSubmittedWorkDone()}
      const times:number[]=[]
      for(let i=0;i<20;i++){const start=performance.now();await render(i+3);await device.queue.onSubmittedWorkDone();times.push(performance.now()-start)}
      times.sort((a,b)=>a-b);report[name]={medianMs:times[10],p95Ms:times[18],maxMs:times[19]}
    }
    try {
      for(const rotation of [0,15]) {
        const program=compileCodeMaterial(source(`return [group({rotation:${rotation}},repeat(4,i=>shader({name:"aurora",params:{direction:i*20},time:ctx.time+i,x:0,y:0,width:ctx.width,height:ctx.height,opacity:.3})))];`))
        await measure(`layers4_rotation${rotation}`, async i=>{const ctx={...frame,time:i/60};await runtime.render(target,width,height,evaluateCodeMaterial(program,ctx))})
      }
      let peakResidentBytes = 0
      const measuredDevice = new Proxy(wrapped, { get(target, key) {
        if (key === 'createCommandEncoder') return () => { peakResidentBytes = Math.max(peakResidentBytes, host?.diagnostics().residentBytes ?? 0); return target.createCommandEncoder() }
        const value = Reflect.get(target, key) as unknown; return value instanceof Function ? value.bind(target) : value
      } })
      const host=new VideoEditCodeGpu(measuredDevice)
      try {
        const input=await host.target('t74:bench:input',width,height)
        const data = new Uint8Array(width * height * 4)
        for(let y=0;y<height;y++) for(let x=0;x<width;x++) data.set([Math.round(x/width*255),Math.round(y/height*255),x%120<60?255:40,255],(y*width+x)*4)
        device.queue.writeTexture({texture:input.texture as never},data,{bytesPerRow:width*4},[width,height])
        const program=compileCodeMaterial(source('return shaderFilter("glow_pro",{},shaderFilter("zoom_blur",{},shaderFilter("grain",{},shaderFilter("chromatic",{}))));','filter'))
        await measure('filters4_heavy',async i=>{await host!.filter('t74:bench:out','t74:bench:filter',program,{...frame,time:i/60}, {},input)})
        report.filterResidentBytes=host.diagnostics().residentBytes; report.filterPeakResidentBytes=peakResidentBytes
        expect(peakResidentBytes).toBeLessThanOrEqual(256 * 1024 ** 2)
      } finally{await host?.dispose()}
      const fs=await import('node:fs/promises');await fs.mkdir('node_modules/.cache/t74',{recursive:true});await fs.writeFile('node_modules/.cache/t74/performance.json',JSON.stringify(report,null,2))
    } finally{target.destroy()}
  },120000)
})
