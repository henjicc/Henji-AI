import { getWebGpuContext, type GpuCanvasContext, type GpuDevice, type GpuRenderPipeline, type GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'

/** Canvas drawImage interoperability on the compositor device; no pixel readback.
 * The caller owns each returned bitmap. The reusable canvas owns no source texture. */
export class VideoEditGpuBitmapBridge {
  private canvas?: OffscreenCanvas
  private context?: GpuCanvasContext
  private pipeline?: GpuRenderPipeline
  private captureCanvas?: OffscreenCanvas
  private captureContext?: GpuCanvasContext
  private captureFormat?: string
  constructor(private readonly device: GpuDevice) {}
  /** Copy the current presentation before any await can expire its canvas texture.
   * The detached bitmap keeps GPU storage alive for transfer to the encoder host. */
  capture(texture: GpuTexture, width: number, height: number, format: string): ImageBitmap {
    if (!this.captureCanvas) {
      this.captureCanvas = new OffscreenCanvas(width, height)
      this.captureContext = getWebGpuContext(this.captureCanvas)
    }
    if (this.captureCanvas.width !== width) this.captureCanvas.width = width
    if (this.captureCanvas.height !== height) this.captureCanvas.height = height
    if (this.captureFormat !== format) {
      this.captureContext!.configure({ device: this.device, format, alphaMode: 'opaque', usage: 0x02 | 0x10 })
      this.captureFormat = format
    }
    const encoder = this.device.createCommandEncoder()
    ;(encoder as typeof encoder & { copyTextureToTexture(source: unknown, destination: unknown, size: unknown): void })
      .copyTextureToTexture({ texture }, { texture: this.captureContext!.getCurrentTexture() }, { width, height, depthOrArrayLayers: 1 })
    this.device.queue.submit([encoder.finish()])
    return this.captureCanvas.transferToImageBitmap()
  }
  copy(texture: GpuTexture, width: number, height: number): ImageBitmap {
    if (!this.canvas) {
      this.canvas = new OffscreenCanvas(width, height)
      this.context = getWebGpuContext(this.canvas)
      this.context.configure({ device: this.device, format: 'rgba8unorm', alphaMode: 'premultiplied', usage: 0x10 })
      const module = this.device.createShaderModule({ code: `
@group(0) @binding(0) var picture:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1);
}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f { return textureLoad(picture,vec2i(p.xy),0); }` })
      this.pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } })
    }
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    const encoder = this.device.createCommandEncoder(), pipeline = this.pipeline!
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context!.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: texture.createView() }] }))
    pass.draw(3); pass.end(); this.device.queue.submit([encoder.finish()])
    return this.canvas.transferToImageBitmap()
  }
  dispose(): void {
    if (this.canvas) this.canvas.width = this.canvas.height = 1
    if (this.captureCanvas) this.captureCanvas.width = this.captureCanvas.height = 1
    this.captureCanvas = undefined; this.captureContext = undefined; this.captureFormat = undefined
    this.canvas = undefined; this.context = undefined; this.pipeline = undefined
  }
}
