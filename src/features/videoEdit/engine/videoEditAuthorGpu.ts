import type { GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { CODE_MOTION_UNIFORM_BYTES, CODE_MOTION_WGSL, prepareCodeMotion } from './videoEditCodeMotion'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'

interface LayerImage { texture: GpuTexture; width: number; height: number; x: number; y: number }
const quad = `@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 let p=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1)); return vec4f(p[i],0,1); }`
const filter = `${quad}
struct P { extent:vec4f, options:vec4f }
@group(0) @binding(0) var<uniform> p:P;
@group(0) @binding(1) var image:texture_2d<f32>;
@group(0) @binding(2) var linearSampler:sampler;
@fragment fn mip(@builtin(position) position:vec4f)->@location(0) vec4f {
 return textureSampleLevel(image,linearSampler,position.xy/p.extent.xy,0.0);
}
@fragment fn lens(@builtin(position) position:vec4f)->@location(0) vec4f {
 let spacing=p.extent.z*sqrt(3.14159265/96.0); let lod=max(0.0,log2(spacing*.7));
 var sum=vec4f(0); var total=0.0;
 for(var i=0u;i<96u;i++) {
  let k=(f32(i)+.5)/96.0; let r=sqrt(k)*p.extent.z; let a=f32(i)*2.39996323;
  let c=textureSampleLevel(image,linearSampler,(position.xy+r*vec2f(cos(a),sin(a)))/p.extent.xy,lod);
  let w=1.0+2.0*pow(max(max(c.r,c.g),c.b),4.0); sum+=c*w; total+=w;
 }
 return sum/total;
}`
const motion = CODE_MOTION_WGSL.replace('textureSampleLevel(image,sampler0,uv,0.0)', 'textureSampleGrad(image,sampler0,uv,vec2f(pose.row0.x,pose.row1.x)/p.source.zw,vec2f(pose.row0.y,pose.row1.y)/p.source.zw)')
const view = (texture: GpuTexture, level?: number): unknown => level === undefined ? texture.createView() : (texture as GpuTexture & { createView(descriptor: unknown): unknown }).createView({ baseMipLevel: level, mipLevelCount: 1 })

/** GPU passes ported from Frameflow, sharing the compositor device and exposure shader. */
export class VideoEditAuthorGpu {
  private readonly pipelines = new Map<string, GpuRenderPipeline>()
  private readonly sampler: unknown
  private readonly buffers: GpuBuffer[] = []
  private bufferIndex = 0
  private encoder?: ReturnType<GpuDevice['createCommandEncoder']>
  private readonly ready: Promise<void>
  constructor(private readonly device: GpuDevice) {
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear' })
    this.ready = this.prepare()
  }
  private async prepare(): Promise<void> {
    this.device.pushErrorScope('validation')
    try {
      const modules = { motion: this.device.createShaderModule({ code: motion }), filter: this.device.createShaderModule({ code: filter }) }
      for (const entry of ['motion', 'mip', 'lens']) {
        const module = entry === 'motion' ? modules.motion : modules.filter
        const descriptor = { layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: entry, targets: [{ format: 'rgba8unorm', ...(entry === 'motion' ? { blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } } : {}) }] }, primitive: { topology: 'triangle-list' } }
        this.pipelines.set(entry, await (this.device.createRenderPipelineAsync?.(descriptor) ?? this.device.createRenderPipeline(descriptor)))
      }
    } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
    const error = await this.device.popErrorScope()
    if (error) throw new Error(`作者图层 GPU 初始化失败：${error.message}`)
  }
  private uniform(data: Float32Array): GpuBuffer {
    const buffer = this.buffers[this.bufferIndex++] ?? this.device.createBuffer({ size: CODE_MOTION_UNIFORM_BYTES, usage: 0x08 | 0x40 })
    this.buffers[this.bufferIndex - 1] = buffer
    this.device.queue.writeBuffer(buffer, 0, data)
    return buffer
  }
  async begin(target: GpuTexture): Promise<void> {
    await this.ready
    this.bufferIndex = 0
    const encoder = this.encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: view(target), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] })
    pass.end()
  }
  finish(): void {
    if (!this.encoder) return
    this.device.queue.submit([this.encoder.finish()])
    this.encoder = undefined
  }
  private pass(entry: string, source: unknown, target: unknown, data: Float32Array): void {
    const encoder = this.encoder!, pipeline = this.pipelines.get(entry)!, buffer = this.uniform(data)
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: source }, { binding: 2, resource: this.sampler }] }))
    pass.draw(6); pass.end()
  }
  mipmaps(texture: GpuTexture, width: number, height: number): void {
    const levels = 1 + Math.floor(Math.log2(Math.max(width, height)))
    for (let level = 1; level < levels; level++) {
      width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2))
      this.pass('mip', view(texture, level - 1), view(texture, level), new Float32Array([width, height, 0, 0, 0, 0, 0, 0]))
    }
  }
  lens(source: GpuTexture, target: GpuTexture, width: number, height: number, radius: number): void {
    this.pass('lens', view(source), view(target, 0), new Float32Array([width, height, radius, 0, 0, 0, 0, 0]))
  }
  draw(target: GpuTexture, width: number, height: number, source: LayerImage, samples: CodeMotionSample[], clip?: [number, number, number, number]): void {
    const prepared = prepareCodeMotion(source, [1, 0, 0, 1, 0, 0], samples, width, height, Number.MAX_SAFE_INTEGER)
    if (!prepared) return
    const { bounds, data } = prepared
    // Match Frameflow's fragment-center clip test, including fractional edges.
    const left = Math.max(0, bounds.x, Math.ceil((clip?.[0] ?? 0) - .5))
    const top = Math.max(0, bounds.y, Math.ceil((clip?.[1] ?? 0) - .5))
    const right = Math.min(width, bounds.x + bounds.width, Math.floor((clip?.[2] ?? width) - .5) + 1)
    const bottom = Math.min(height, bounds.y + bounds.height, Math.floor((clip?.[3] ?? height) - .5) + 1)
    if (right <= left || bottom <= top) return
    data[2] = data[3] = 0 // Draw directly into the host target, not a cropped intermediate.
    const encoder = this.encoder!, pipeline = this.pipelines.get('motion')!, buffer = this.uniform(data)
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: view(target), loadOp: 'load', storeOp: 'store' }] })
    ;(pass as typeof pass & { setScissorRect(x: number, y: number, width: number, height: number): void }).setScissorRect(left, top, right - left, bottom - top)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: view(source.texture) }, { binding: 2, resource: this.sampler }] }))
    pass.draw(6); pass.end()
  }
  async dispose(): Promise<void> {
    this.encoder = undefined
    await this.ready.catch(() => {})
    await this.device.queue.onSubmittedWorkDone().catch(() => {})
    this.buffers.forEach(buffer => buffer.destroy()); this.buffers.length = 0; this.pipelines.clear()
  }
}
