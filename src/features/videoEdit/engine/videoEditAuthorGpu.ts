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
`
/**
 * 运动曝光的每次取样沿运动方向拉长到相邻样本的间距（各向异性过滤），样本之间不留缝：
 * 约每 4 像素一个样本就够平滑，不必每像素一个。没在动或位移小于一个像素时照常按缩放取样。
 */
const motionSample = `
fn localAt(pose:Pose,q:vec2f)->vec2f { return vec2f(dot(pose.row0.xyz,vec3f(q,1)),dot(pose.row1.xyz,vec3f(q,1))); }
fn motionSample(i:u32,q:vec2f,uv:vec2f,pose:Pose)->vec4f {
 let n=u32(p.info.x);
 let gx=vec2f(pose.row0.x,pose.row1.x)/p.source.zw; let gy=vec2f(pose.row0.y,pose.row1.y)/p.source.zw;
 let b=max(i,1u)-1u; let a=min(i+1u,n-1u);
 if(a<=b || p.poses[b].row0.w<=0.0 || p.poses[a].row0.w<=0.0) { return textureSampleGrad(image,sampler0,uv,gx,gy); }
 let step=(localAt(p.poses[a],q)-localAt(p.poses[b],q))/(p.source.zw*f32(a-b));
 let s=length(step);
 if(s<=max(length(gx),length(gy))) { return textureSampleGrad(image,sampler0,uv,gx,gy); }
 let along=step/s;
 let side=select(gy,gx,abs(dot(normalize(gx),along))<abs(dot(normalize(gy),along)));
 return textureSampleGrad(image,sampler0,uv,step,side);
}`
const motion = CODE_MOTION_WGSL.replace('textureSampleLevel(image,sampler0,uv,0.0)', 'motionSample(i,q,uv,pose)') + motionSample
const view = (texture: GpuTexture, level?: number): unknown => level === undefined ? texture.createView() : (texture as GpuTexture & { createView(descriptor: unknown): unknown }).createView({ baseMipLevel: level, mipLevelCount: 1 })

/** GPU passes ported from Frameflow, sharing the compositor device and exposure shader. */
export class VideoEditAuthorGpu {
  private readonly pipelines = new Map<string, GpuRenderPipeline>()
  private readonly sampler: unknown
  private readonly buffers: GpuBuffer[] = []
  private bufferIndex = 0
  private encoder?: ReturnType<GpuDevice['createCommandEncoder']>
  constructor(private readonly device: GpuDevice) {
    // 各向异性过滤：运动曝光沿运动方向拉长取样时用（显式指定层级的取样不受影响）
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', maxAnisotropy: 16 })
  }
  private readonly formats = new Map<string, Promise<void>>()
  prepareFormat(format: string): Promise<void> {
    let pending = this.formats.get(format)
    if (!pending) {
      pending = this.compile(format).catch(error => { this.formats.delete(format); throw error })
      this.formats.set(format, pending)
    }
    return pending
  }
  private async compile(format: string): Promise<void> {
    const pipelines = new Map<string, GpuRenderPipeline>()
    this.device.pushErrorScope('validation')
    try {
      for (const entry of ['motion', 'mip']) {
        const descriptor = this.descriptor(entry, format)
        pipelines.set(`${entry}:${format}`, await (this.device.createRenderPipelineAsync?.(descriptor) ?? this.device.createRenderPipeline(descriptor)))
      }
    } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
    const error = await this.device.popErrorScope()
    if (error) throw new Error(`作者图层 GPU 初始化失败：${error.message}`)
    for (const [key, pipeline] of pipelines) this.pipelines.set(key, pipeline)
  }
  private descriptor(entry: string, format: string): unknown {
    const module = this.device.createShaderModule({ code: entry === 'motion' ? motion : filter })
    return { layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: entry, targets: [{ format, ...(entry === 'motion' ? { blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } } : {}) }] }, primitive: { topology: 'triangle-list' } }
  }
  private pipeline(entry: string, format: string): GpuRenderPipeline {
    const key = `${entry}:${format}`
    let pipeline = this.pipelines.get(key)
    if (!pipeline) { pipeline = this.device.createRenderPipeline(this.descriptor(entry, format)); this.pipelines.set(key, pipeline) }
    return pipeline
  }
  private uniform(data: Float32Array): GpuBuffer {
    const buffer = this.buffers[this.bufferIndex++] ?? this.device.createBuffer({ size: CODE_MOTION_UNIFORM_BYTES, usage: 0x08 | 0x40 })
    this.buffers[this.bufferIndex - 1] = buffer
    this.device.queue.writeBuffer(buffer, 0, data)
    return buffer
  }
  async begin(target?: GpuTexture, format = target?.format ?? 'rgba8unorm'): Promise<void> {
    await this.prepareFormat('rgba8unorm')
    if (format !== 'rgba8unorm') await this.prepareFormat(format)
    this.bufferIndex = 0
    this.encoder = this.device.createCommandEncoder()
    if (target) this.clear(target)
  }
  clear(target: GpuTexture): void {
    const pass = this.commandEncoder().beginRenderPass({ colorAttachments: [{ view: view(target), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] })
    pass.end()
  }
  commandEncoder(): ReturnType<GpuDevice['createCommandEncoder']> {
    if (!this.encoder) throw new Error('作者帧尚未开始。')
    return this.encoder
  }
  /** Drops a frame whose author code must run again before anything was submitted. */
  abandon(): void { this.encoder = undefined }
  finish(): void {
    if (!this.encoder) return
    this.device.queue.submit([this.encoder.finish()])
    this.encoder = undefined
  }
  private pass(entry: string, source: unknown, target: unknown, data: Float32Array, format = 'rgba8unorm'): void {
    const encoder = this.encoder!, pipeline = this.pipeline(entry, format), buffer = this.uniform(data)
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target, loadOp: 'clear', storeOp: 'store' }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: source }, { binding: 2, resource: this.sampler }] }))
    pass.draw(6); pass.end()
  }
  mipmaps(texture: GpuTexture, width: number, height: number): void {
    const levels = 1 + Math.floor(Math.log2(Math.max(width, height)))
    for (let level = 1; level < levels; level++) {
      width = Math.max(1, Math.floor(width / 2)); height = Math.max(1, Math.floor(height / 2))
      this.pass('mip', view(texture, level - 1), view(texture, level), new Float32Array([width, height, 0, 0, 0, 0, 0, 0]), texture.format)
    }
  }
  copy(source: GpuTexture, target: GpuTexture, width: number, height: number): void {
    this.pass('mip', view(source), view(target), new Float32Array([width, height, 0, 0, 0, 0, 0, 0]), target.format)
  }
  /**
   * `width`/`height` 是 `target` 的像素尺寸；位姿与 `clip` 是画布像素。`scale`：画布像素到 `target` 像素的比例（回放分辨率
   * 降低时小于 1），叠在所有位姿外面；缺省为 1。
   */
  draw(output: GpuTexture | (() => GpuTexture), width: number, height: number, source: LayerImage, samples: CodeMotionSample[], clip?: readonly [number, number, number, number], scale?: readonly [number, number]): boolean {
    if (clip && scale) clip = [clip[0] * scale[0], clip[1] * scale[1], clip[2] * scale[0], clip[3] * scale[1]]
    const prepared = prepareCodeMotion(source, scale ? [scale[0], 0, 0, scale[1], 0, 0] : [1, 0, 0, 1, 0, 0], samples, width, height, Number.MAX_SAFE_INTEGER)
    if (!prepared) return false
    const { bounds, data } = prepared
    // Match Frameflow's fragment-center clip test, including fractional edges.
    const left = Math.max(0, bounds.x, Math.ceil((clip?.[0] ?? 0) - .5))
    const top = Math.max(0, bounds.y, Math.ceil((clip?.[1] ?? 0) - .5))
    const right = Math.min(width, bounds.x + bounds.width, Math.floor((clip?.[2] ?? width) - .5) + 1)
    const bottom = Math.min(height, bounds.y + bounds.height, Math.floor((clip?.[3] ?? height) - .5) + 1)
    if (right <= left || bottom <= top) return false
    const target = typeof output === 'function' ? output() : output
    data[2] = data[3] = 0 // Draw directly into the host target, not a cropped intermediate.
    const encoder = this.encoder!, pipeline = this.pipeline('motion', target.format ?? 'rgba8unorm'), buffer = this.uniform(data)
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: view(target), loadOp: 'load', storeOp: 'store' }] })
    ;(pass as typeof pass & { setScissorRect(x: number, y: number, width: number, height: number): void }).setScissorRect(left, top, right - left, bottom - top)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, { binding: 1, resource: view(source.texture) }, { binding: 2, resource: this.sampler }] }))
    pass.draw(6); pass.end()
    return true
  }
  async dispose(): Promise<void> {
    this.encoder = undefined
    await Promise.allSettled(this.formats.values())
    await this.device.queue.onSubmittedWorkDone().catch(() => {})
    this.buffers.forEach(buffer => buffer.destroy()); this.buffers.length = 0; this.pipelines.clear()
  }
}
