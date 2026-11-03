import type * as Three from 'three'
import type { GpuDevice, GpuTexture, GpuRenderPipeline } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { authorLibraryDependencyError, resolveAuthorLibraryModule, type AuthorLibraryVersions } from '@/core/videoEdit/codeMaterial/authorLibraries'
import { VideoEditAuthorThreeClock } from './videoEditAuthorThreeClock'
import { runVideoEditGpuSection } from './videoEditGpuRootQueue'
import { guardVideoEditGpu } from './videoEditGpuErrorScope'
import { videoEditThreeTargetBytes } from './videoEditGpuBudget'

export interface ManagedThreeRenderer {
  init(): Promise<void>
  compileAsync(scene: Three.Scene, camera: Three.Camera): Promise<void>
  render(scene: Three.Scene, camera: Three.Camera): void
  setRenderTarget(target: Three.RenderTarget | null): void
  setOutputRenderTarget(target: Three.RenderTarget | null): void
  copyTextureToTexture(source: Three.Texture, target: Three.Texture): void
  setSize(width: number, height: number, updateStyle?: boolean): void
  setClearColor(color: number, alpha: number): void
  dispose(): Promise<void>
  toneMapping: number
  outputColorSpace: string
  onDeviceLost: (info: unknown) => void
  backend: { isWebGPUBackend?: boolean; isWebGLBackend?: boolean }
}
export type AuthorThreeLibrary = typeof Three & {
  WebGPURenderer: new (options: Record<string, unknown>) => ManagedThreeRenderer
  ExternalTexture: new (texture: GpuTexture) => Three.Texture & { sourceTexture: GpuTexture }
}
// 与作者模块保持同一原生 ESM URL，适配器不打包另一份 three 实例。
const importLibrary = new Function('url', 'return import(url)') as (url: string) => Promise<AuthorThreeLibrary>
export async function loadAuthorThreeLibrary(libraries?: AuthorLibraryVersions): Promise<AuthorThreeLibrary> {
  const resolved = resolveAuthorLibraryModule('three/webgpu', libraries)
  if (!resolved || resolved.version !== '0.186.1') throw new Error('受管 three 需要已验证的 three 0.186.1。')
  return importLibrary(resolved.url)
}

/** 建在 three 上的内置库（如路径追踪器）：它钉住的 three 必须就是受管场景用的这一份，否则类与材质互不认识。 */
export async function loadAuthorThreeDependent<T>(specifier: string, libraries?: AuthorLibraryVersions): Promise<T> {
  const resolved = resolveAuthorLibraryModule(specifier, libraries)
  if (!resolved) throw new Error(`没有内置库入口 ${specifier}。`)
  const error = authorLibraryDependencyError(resolved.library, resolved.version, { three: '0.186.1', ...libraries })
  if (error) throw new Error(error)
  return importLibrary(resolved.url) as Promise<T>
}

/** 作者版 three 的其他入口（three/tsl、three/addons/…），与场景同一份库实例。 */
export async function loadAuthorThreeModule<T>(specifier: string, libraries?: AuthorLibraryVersions): Promise<T> {
  const resolved = resolveAuthorLibraryModule(specifier, libraries)
  if (!resolved || resolved.version !== '0.186.1') throw new Error(`受管 three 缺少已验证的入口 ${specifier}。`)
  return importLibrary(resolved.url) as Promise<T>
}

export type AuthorThreeBackend = 'webgpu' | 'webgl'
/** 公开 ExternalTexture 只借用宿主纹理；RenderTarget 的深度与 MSAA 归 three。 */
export class VideoEditAuthorThreeWebGpu {
  readonly renderer: ManagedThreeRenderer
  private clock?: VideoEditAuthorThreeClock
  private target?: Three.RenderTarget
  private linear?: GpuTexture
  private external?: Three.Texture
  private readonly pipelines = new Map<string, GpuRenderPipeline>()
  private width = 0
  private height = 0
  private failure?: Error
  private closed = false
  private constructor(readonly library: AuthorThreeLibrary, private readonly device: GpuDevice,
    readonly backend: AuthorThreeBackend, private readonly canvas: OffscreenCanvas) {
    this.renderer = new library.WebGPURenderer({ canvas, alpha: true, antialias: true,
      ...(backend === 'webgl' ? { forceWebGL: true } : { device }) })
    this.renderer.onDeviceLost = () => { this.failure = new Error('受管 three 渲染设备已丢失。') }
    this.renderer.setClearColor(0, 0)
    this.renderer.toneMapping = library.NeutralToneMapping
    this.renderer.outputColorSpace = backend === 'webgpu' ? library.LinearSRGBColorSpace : library.SRGBColorSpace
  }
  static async create(library: AuthorThreeLibrary, device: GpuDevice, backend: AuthorThreeBackend = 'webgpu',
    canvas = new OffscreenCanvas(1, 1)): Promise<VideoEditAuthorThreeWebGpu> {
    const bridge = new VideoEditAuthorThreeWebGpu(library, device, backend, canvas)
    try {
      // WebGL 后端不触碰宿主设备的作用域与处理器，不占根队列。
      if (backend === 'webgl') await bridge.renderer.init()
      else await runVideoEditGpuSection(device, async () => {
        // r186 初始化会赋值 onuncapturederror；宿主保有错误处理器的所有权，区段结束前恢复。
        const errors = device as GpuDevice & { onuncapturederror?: unknown }
        const previous = errors.onuncapturederror
        try { await bridge.renderer.init() } finally { errors.onuncapturederror = previous }
      })
      bridge.clock = new VideoEditAuthorThreeClock(bridge.renderer, library.REVISION)
      if (backend === 'webgpu' && !bridge.renderer.backend.isWebGPUBackend || backend === 'webgl' && !bridge.renderer.backend.isWebGLBackend) {
        throw new Error('受管 three 后端与宿主请求不一致。')
      }
      return bridge
    } catch (error) { await bridge.dispose(); throw error }
  }
  get allocationBytes(): number { return videoEditThreeTargetBytes(this.width, this.height, this.backend) }
  async render(scene: Three.Scene, camera: Three.Camera, texture: GpuTexture, width: number, height: number,
    sourceTime: number, assertCurrent: () => void, compile = false): Promise<void> {
    if (this.closed || this.failure) throw this.failure ?? new Error('受管 three 已关闭。')
    assertCurrent()
    if (width !== this.width || height !== this.height) {
      this.renderer.setRenderTarget(null)
      this.renderer.setOutputRenderTarget(null)
      this.target?.dispose()
      this.external?.dispose()
      this.linear?.destroy()
      this.target = undefined
      this.width = width; this.height = height
      this.renderer.setSize(width, height, false)
      this.linear = this.device.createTexture({ size: [width, height], format: this.backend === 'webgpu' ? 'rgba16float' : 'rgba8unorm', usage: 0x02 | 0x04 | 0x10 })
      if (this.backend === 'webgpu') {
        const target = new this.library.RenderTarget(width, height, { samples: 4, depthBuffer: true, type: this.library.HalfFloatType })
        const external = new this.library.ExternalTexture(this.linear)
        external.image = { width, height }
        external.colorSpace = this.library.LinearSRGBColorSpace
        external.type = this.library.HalfFloatType
        external.generateMipmaps = false
        this.external = external
        this.target = target
      }
    }
    this.renderer.setRenderTarget(this.target ?? null)
    this.renderer.setOutputRenderTarget(this.target ?? null)
    await this.clock!.run(sourceTime, async () => {
      // compileAsync 在等待异步管线时保持 three 的错误作用域，必须独占设备根队列。
      if (compile) await (this.backend === 'webgpu' ? runVideoEditGpuSection(this.device, () => this.renderer.compileAsync(scene, camera)) : this.renderer.compileAsync(scene, camera))
      assertCurrent()
      // 提交里的校验错误（如用到已销毁的资源）让这一层失败，而不是当成画好了。
      await guardVideoEditGpu(this.device, '三维渲染', () => {
        this.renderer.render(scene, camera)
        assertCurrent()
        if (this.backend === 'webgpu') this.renderer.copyTextureToTexture(this.target!.texture, this.external!)
        if (this.backend === 'webgl') this.device.queue.copyExternalImageToTexture(
          { source: this.canvas }, { texture: this.linear!, premultipliedAlpha: true }, { width, height })
        this.convert(texture)
      })
    })
  }
  private convert(target: GpuTexture): void {
    const format = target.format ?? 'rgba8unorm'
    let pipeline = this.pipelines.get(format)
    if (!pipeline) {
      const shader = this.device.createShaderModule({ code: `
@group(0) @binding(0) var picture: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
  let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1);
}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f {
  let c=textureLoad(picture,vec2i(p.xy),0);
  let rgb=select(c.rgb,c.rgb/max(c.a,0.0000001),c.a>0.0);
  ${this.backend === 'webgl' ? 'let linear=select(rgb/12.92,pow((rgb+0.055)/1.055,vec3f(2.4)),rgb>vec3f(0.04045));' : 'let linear=rgb;'}
  return vec4f(pow(max(linear,vec3f(0)),vec3f(1.0/2.4))*select(1.0,c.a,c.a>0.0),c.a);
}` })
      pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module: shader, entryPoint: 'vs' }, fragment: { module: shader, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      this.pipelines.set(format, pipeline)
    }
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: this.linear!.createView() }] }))
    pass.draw(3); pass.end(); this.device.queue.submit([encoder.finish()])
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clock?.stop()
    try { this.target?.dispose(); this.external?.dispose() } finally {
      try { await this.renderer.dispose() } finally { this.linear?.destroy(); this.canvas.width = this.canvas.height = 1 }
    }
    this.target = undefined
  }
}
