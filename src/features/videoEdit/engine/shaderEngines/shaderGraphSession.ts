/**
 * 着色器图（`shaders` 框架）在剪辑合成器里的执行会话：共用宿主 GPU 设备，渲染进宿主纹理。
 *
 * 框架原本面向网页画布与实时动画，这里补上剪辑需要的四件事：
 * - 输出：给框架一块“画布外壳”，它取到的当前纹理就是本会话的离屏纹理，再按宿主格式拷进输出；
 * - 输入：图层类型 `@input` / `@second` 是宿主画面（片段画面、转场前后两段），每帧先解预乘、转线性光写入；
 * - 时间：只走框架的确定性入口 `renderSyntheticFrame`，按与上一帧的秒差推进（可为负），任意寻帧同一结果；
 *   含计算工序的组件（模糊、辉光等）读的是上一次渲染的子图层结果，所以这类图每帧补渲一次零时差帧；
 * - 错误：框架在共享设备上挂的“未捕获错误”监听会吞掉宿主自己的错误，这里不让它挂；本会话的 GPU 工作
 *   包在自己的错误范围里，作者 WGSL 的报错原样带行号交还调用方。
 */
import { createGpuUniformsMap, resolveBoundingBox, rootPassthrough, shaderRendererGPU } from 'shaders/core'
import { defineShader, transformAngle, transformBoolean, transformColor, transformPosition, wgsl, wgslTypeForProp } from 'shaders/std'
import type { GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { SHADER_GRAPH_INPUT, SHADER_GRAPH_SECOND, type ShaderGraphCustomShader, type ShaderGraphLayer, type ShaderGraphSpec, shaderGraphCustomPropKind, shaderGraphStructureKey } from '@/core/videoEdit/shaderGraph/spec'
import { SHADER_COMPONENT_LOADERS } from './componentLoaders.generated'

type Renderer = ReturnType<typeof shaderRendererGPU>
// 框架的组件定义对象；类型来自 shaders 包，这里只按名称传递，不读内部字段以外的结构。
type Definition = { name: string; props: Record<string, { default?: unknown }>; fragment: unknown; compute?: unknown }
interface Texture extends GpuTexture { width: number; height: number; format: string }
interface HostTexture { texture: unknown; width: number; height: number; unwrap(): Texture; destroy(): void }
interface Encoder { beginRenderPass(descriptor: unknown): { setPipeline(pipeline: GpuRenderPipeline): void; setBindGroup(index: number, group: unknown): void; draw(count: number): void; end(): void }; finish(): unknown }
type ErrorDevice = GpuDevice & { addEventListener?: unknown; removeEventListener?: unknown }

/** 作者源码问题（WGSL 编译、未知组件、参数），消息可直接给作者看。 */
export class ShaderGraphError extends Error {
  constructor(message: string, readonly line?: number, readonly shader?: string) { super(message); this.name = 'ShaderGraphError' }
}

const FULLSCREEN = `struct V { @builtin(position) p: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> V { var o: V; let xy = vec2f(f32((i << 1u) & 2u), f32(i & 2u)); o.p = vec4f(xy * 2.0 - 1.0, 0.0, 1.0); o.uv = vec2f(xy.x, 1.0 - xy.y); return o; }
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
fn decode(c: vec3f) -> vec3f { return select(pow((c + 0.055) / 1.055, vec3f(2.4)), c / 12.92, c <= vec3f(0.04045)); }
// 宿主画面（预乘、sRGB 编码）→ 框架输入（直通 alpha、线性光）
@fragment fn upload(v: V) -> @location(0) vec4f { let c = textureSample(src, samp, v.uv); if (c.a <= 0.0) { return vec4f(0.0); } return vec4f(decode(clamp(c.rgb / c.a, vec3f(0.0), vec3f(1.0))), c.a); }
// 框架输出（预乘、sRGB 编码，常为 bgra8unorm）→ 宿主格式
@fragment fn present(v: V) -> @location(0) vec4f { return textureSample(src, samp, v.uv); }`

/** 每台宿主设备一个代理：框架拿到的“设备”不挂未捕获错误监听，错误范围的结果分给发起渲染的会话。 */
const hosts = new WeakMap<object, { device: GpuDevice; owner: ShaderGraphSession | null }>()
function hostDevice(device: GpuDevice): { device: GpuDevice; owner: ShaderGraphSession | null } {
  const known = hosts.get(device)
  if (known) return known
  const state: { device: GpuDevice; owner: ShaderGraphSession | null } = { device, owner: null }
  const target = device as ErrorDevice
  state.device = new Proxy(target, {
    get(object, key) {
      if (key === 'addEventListener' || key === 'removeEventListener') {
        const method = Reflect.get(object, key, object) as (type: string, ...rest: unknown[]) => void
        return (type: string, ...rest: unknown[]) => { if (type !== 'uncapturederror') method.call(object, type, ...rest) }
      }
      if (key === 'popErrorScope') return () => {
        const owner = state.owner
        return object.popErrorScope().then(error => { if (error?.message) owner?.noteGpuError(error.message); return error })
      }
      const value = Reflect.get(object, key, object)
      return typeof value === 'function' ? value.bind(object) : value
    },
  })
  hosts.set(device, state)
  return state
}

/** 作者着色器的属性 → 框架属性配置（颜色、位置、角度、开关带上框架自己的换算）。 */
function customProps(shader: ShaderGraphCustomShader): Record<string, { default: unknown; transform?: unknown }> {
  return Object.fromEntries(Object.entries(shader.props ?? {}).map(([key, prop]) => {
    const kind = shaderGraphCustomPropKind(prop)
    const transform = kind === 'color' ? transformColor : kind === 'position' ? transformPosition : kind === 'angle' ? transformAngle : kind === 'boolean' ? transformBoolean : undefined
    return [key, transform ? { default: prop.default, transform } : { default: prop.default }]
  }))
}

/**
 * 先用一份与框架绑定约定相同的外壳单独编译作者函数体：报错行号直接对应作者写的第几行。
 * 框架把属性按名字绑定（颜色 vec4f、位置 vec2f、数值 f32），上下文名见 `wgsl` 文档。
 */
async function checkCustomWgsl(device: GpuDevice, shader: ShaderGraphCustomShader): Promise<void> {
  const props = customProps(shader)
  const params = Object.entries(props).map(([key, config]) => `${key}: ${wgslTypeForProp(config as never) ?? 'f32'}`)
  const context = ['uv: vec2f', 'time: f32', 'aspect: f32', 'viewport: vec2f', 'pointer: vec2f', ...(shader.kind === 'filter' ? ['child: vec4f'] : [])]
  const head = `@group(0) @binding(0) var childTexture: texture_2d<f32>;\n@group(0) @binding(1) var childSampler: sampler;\nfn author(${[...context, ...params].join(', ')}) -> vec4f {\n`
  const offset = head.split('\n').length - 1
  const code = `${head}${shader.wgsl}\n}\n@fragment fn main(@location(0) uv: vec2f) -> @location(0) vec4f { return author(uv, 0.0, 1.0, vec2f(1.0), vec2f(0.5)${shader.kind === 'filter' ? ', textureSample(childTexture, childSampler, uv)' : ''}${params.map(() => ', ' + 'zero').join('')}); }`
  // 参数用零值占位：只检查函数体，不检查调用。
  const zeros = Object.values(props).map(config => ({ f32: '0.0', vec2f: 'vec2f(0.0)', vec3f: 'vec3f(0.0)', vec4f: 'vec4f(0.0)' } as Record<string, string>)[wgslTypeForProp(config as never) ?? 'f32'] ?? '0.0')
  let index = 0
  const filled = code.replace(/zero/g, () => zeros[index++] ?? '0.0')
  device.pushErrorScope('validation')
  const module = device.createShaderModule({ code: filled }) as { getCompilationInfo?: () => Promise<{ messages: ReadonlyArray<{ type: string; message: string; lineNum: number }> }> }
  const info = await module.getCompilationInfo?.()
  await device.popErrorScope()
  const error = info?.messages.find(message => message.type === 'error')
  if (error) {
    const line = error.lineNum - offset
    throw new ShaderGraphError(line >= 1 ? `着色器 ${shader.name} 第 ${line} 行：${error.message}` : `着色器 ${shader.name}：${error.message}`, line >= 1 ? line : undefined, shader.name)
  }
}

export interface ShaderGraphRenderRequest {
  /** 本帧秒时间（片段内时间或作者给的 time），任意顺序调用结果相同。 */
  timeSeconds: number
  width: number
  height: number
  /** 宿主画面：预乘 alpha、sRGB 编码；图里引用 `@input` / `@second` 时必需。 */
  input?: GpuTexture
  second?: GpuTexture
  /** 每个图层的属性值（按图层 id），只写有变化的项。 */
  props?: ReadonlyMap<string, Readonly<Record<string, unknown>>>
  output: GpuTexture
  outputFormat: string
}

/**
 * 一个图结构（图层树、组件类型、作者着色器源码）一个会话；属性变化只改数值，不重建。
 * 结构变了由调用方按 `shaderGraphStructureKey` 换会话。
 */
export class ShaderGraphSession {
  readonly key: string
  private renderer?: Renderer
  private readonly hostTextures = new Map<string, HostTexture>()
  private readonly lastProps = new Map<string, Record<string, unknown>>()
  private readonly nodes = new Map<string, { definition: Definition; layer: ShaderGraphLayer }>()
  private target?: Texture
  private targetFormat = 'bgra8unorm'
  private size = { width: 0, height: 0 }
  private elapsed = 0
  private gpuError?: string
  private computes = false
  private disposed = false
  private readonly pipelines = new Map<string, GpuRenderPipeline>()
  private module?: unknown
  private sampler?: unknown

  private constructor(private readonly device: GpuDevice, readonly spec: ShaderGraphSpec) { this.key = shaderGraphStructureKey(spec) }

  static async create(device: GpuDevice, spec: ShaderGraphSpec): Promise<ShaderGraphSession> {
    const session = new ShaderGraphSession(device, spec)
    await session.initialize()
    return session
  }

  /** 由设备代理调用：本会话发起的 GPU 工作报了错（多为作者 WGSL）。 */
  noteGpuError(message: string): void { this.gpuError ??= message }

  private async definitions(): Promise<Map<string, Definition>> {
    const result = new Map<string, Definition>()
    for (const shader of this.spec.shaders ?? []) {
      await checkCustomWgsl(this.device, shader)
      const body = wgsl(shader.wgsl)
      const config = { name: shader.name, props: customProps(shader), ...(shader.kind === 'filter' ? { effect: body } : { paint: body }), ...(shader.speedProp ? { animatedTime: { speed: shader.speedProp } } : {}) }
      result.set(shader.name, defineShader(config as never) as unknown as Definition)
    }
    const visit = async (layers: readonly ShaderGraphLayer[]): Promise<void> => {
      for (const layer of layers) {
        if (!result.has(layer.type) && layer.type !== SHADER_GRAPH_INPUT && layer.type !== SHADER_GRAPH_SECOND) {
          const load = SHADER_COMPONENT_LOADERS[layer.type]
          if (!load) throw new ShaderGraphError(`未知着色器组件 ${layer.type}。`)
          result.set(layer.type, (await load()).componentDefinition as Definition)
        }
        await visit(layer.children ?? [])
      }
    }
    await visit(this.spec.layers)
    return result
  }

  /** 宿主画面图层：一张线性光、直通 alpha 的媒体纹理，尺寸跟随渲染尺寸。 */
  private hostDefinition(type: string): Definition {
    const fragment = (params: { createMediaTexture(options: unknown): HostTexture; registerMediaTexture(get: () => unknown): { sample(uv: unknown): unknown }; onCleanup(fn: () => void): void; ctx: { uv: unknown }; uvContext?: unknown }): unknown => {
      const make = (width: number, height: number) => params.createMediaTexture({ width: Math.max(1, width), height: Math.max(1, height), format: 'rgba16float', label: type })
      let current = make(this.size.width, this.size.height)
      this.hostTextures.set(type, { get texture() { return current.texture }, get width() { return current.width }, get height() { return current.height }, unwrap: () => current.unwrap(), destroy: () => current.destroy() })
      const kit = params.registerMediaTexture(() => current.texture)
      params.onCleanup(() => { current.destroy(); if (this.hostTextures.get(type)?.texture === current.texture) this.hostTextures.delete(type) })
      this.resizeHost.set(type, (width, height) => { if (current.width === width && current.height === height) return; const previous = current; current = make(width, height); previous.destroy() })
      return kit.sample(params.uvContext ?? params.ctx.uv)
    }
    return { name: type, props: {}, fragment }
  }
  private readonly resizeHost = new Map<string, (width: number, height: number) => void>()

  private async initialize(): Promise<void> {
    const definitions = await this.definitions()
    const host = hostDevice(this.device)
    const canvas = {
      // 0×0：初始化时不画第一帧（那一帧按墙钟推进时间，会让同一时刻的画面因会话而异）。
      width: 0, height: 0, style: {},
      getBoundingClientRect: () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0 }),
      getContext: () => context,
    }
    const context = {
      canvas,
      configure: (descriptor: { format: string }) => { this.targetFormat = descriptor.format },
      unconfigure: () => undefined,
      getCurrentTexture: (): Texture => {
        this.draws++
        const current = this.target
        if (current && current.width === canvas.width && current.height === canvas.height && current.format === this.targetFormat) return current
        current?.destroy()
        // RENDER_ATTACHMENT | TEXTURE_BINDING | COPY_SRC；WebGPU 纹理自带 width/height/format。
        return this.target = this.device.createTexture({ size: [canvas.width, canvas.height], format: this.targetFormat, usage: 0x10 | 0x04 | 0x01 }) as Texture
      },
    }
    const renderer = shaderRendererGPU()
    let failure: string | undefined
    renderer.setOnUnavailable((reason: string) => { failure = reason })
    await renderer.initialize({ canvas: canvas as never, gpu: { device: host.device as never }, observeElement: false, colorSpace: 'srgb' })
    if (failure) throw new Error(`着色器渲染器不可用：${failure}`)
    // 时钟交给宿主：只有显式的 renderSyntheticFrame 才画，属性更新、异步扫描不再按墙钟补画。
    renderer.setFrameLocked(true)
    renderer.stopAnimation()
    renderer.registerNode('root', rootPassthrough.fragment, null, null, {}, rootPassthrough)
    const register = (layers: readonly ShaderGraphLayer[], parent: string, prefix: string): void => {
      layers.forEach((layer, index) => {
        const id = layer.id ?? `${prefix}${index}`
        const definition = layer.type === SHADER_GRAPH_INPUT || layer.type === SHADER_GRAPH_SECOND ? this.hostDefinition(layer.type) : definitions.get(layer.type)!
        if (definition.compute) this.computes = true
        const props = { ...(layer.props ?? {}) }
        const values = Object.fromEntries(Object.entries(definition.props).map(([key, config]) => [key, props[key] !== undefined ? props[key] : config.default]))
        renderer.registerNode(id, definition.fragment as never, parent, this.metadata(layer, index, id) as never, createGpuUniformsMap(definition as never, values, id), definition as never)
        this.nodes.set(id, { definition, layer })
        this.lastProps.set(id, props)
        register(layer.children ?? [], id, `${id}.`)
      })
    }
    register(this.spec.layers, 'root', 'layer')
    this.renderer = renderer
  }

  private metadata(layer: ShaderGraphLayer, order: number, id: string): Record<string, unknown> {
    const props = layer.props ?? {}
    return {
      blendMode: typeof props.blendMode === 'string' ? props.blendMode : 'normal',
      opacity: typeof props.opacity === 'number' ? props.opacity : undefined,
      visible: typeof props.visible === 'boolean' ? props.visible : undefined,
      renderOrder: order, id,
      mask: typeof props.maskSource === 'string' ? { source: props.maskSource, type: typeof props.maskType === 'string' ? props.maskType : 'alpha' } : undefined,
      transform: props.transform && typeof props.transform === 'object' ? { offsetX: 0, offsetY: 0, rotation: 0, scale: 1, anchorX: 0.5, anchorY: 0.5, edges: 'transparent', ...props.transform } : undefined,
      boundingBox: props.boundingBox ? resolveBoundingBox(props.boundingBox as never) : undefined,
    }
  }

  private applyProps(values: ReadonlyMap<string, Readonly<Record<string, unknown>>> | undefined): void {
    if (!values || !this.renderer) return
    for (const [id, props] of values) {
      const node = this.nodes.get(id)
      if (!node) throw new ShaderGraphError(`着色器图里没有图层 ${id}。`)
      const last = this.lastProps.get(id) ?? {}
      let metadataChanged = false
      for (const [key, value] of Object.entries(props)) {
        if (Object.is(last[key], value) || (typeof value === 'object' && JSON.stringify(last[key]) === JSON.stringify(value))) continue
        last[key] = value
        if (key in node.definition.props) this.renderer.updateUniformValue(id, key, value)
        else metadataChanged = true
      }
      this.lastProps.set(id, last)
      if (metadataChanged) {
        const { renderOrder: _order, id: _id, ...metadata } = this.metadata({ ...node.layer, props: last }, 0, id)
        this.renderer.updateNodeMetadata(id, metadata as never)
      }
    }
  }

  private pipeline(entry: 'upload' | 'present', format: string): GpuRenderPipeline {
    const key = `${entry}:${format}`
    let pipeline = this.pipelines.get(key)
    if (!pipeline) {
      this.module ??= this.device.createShaderModule({ code: FULLSCREEN })
      pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module: this.module, entryPoint: 'vs' }, fragment: { module: this.module, entryPoint: entry, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      this.pipelines.set(key, pipeline)
    }
    return pipeline
  }

  private copy(encoder: Encoder, entry: 'upload' | 'present', source: GpuTexture, target: GpuTexture, format: string): void {
    this.sampler ??= this.device.createSampler({ minFilter: 'linear', magFilter: 'linear' })
    const pipeline = this.pipeline(entry, format)
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: source.createView() }, { binding: 1, resource: this.sampler }] }))
    pass.draw(3); pass.end()
  }

  private draws = 0
  /**
   * 推进时间并画一帧。新结构的管线在框架里异步建好，建好前的帧什么也不画（不取画布纹理），
   * 这时以零时差重画直到真正出图；作者 WGSL 出错时框架停画，这里随即带着错误退出。
   */
  private async draw(renderer: Renderer, delta: number): Promise<void> {
    const before = this.draws
    await renderer.renderSyntheticFrame(delta, { waitForGpu: false })
    const deadline = Date.now() + 20_000
    while (this.draws === before) {
      if (this.gpuError || renderer.getFailureReason()) return
      if (Date.now() > deadline) throw new ShaderGraphError('着色器图准备超时（20 秒内没有画出第一帧）。')
      await new Promise(resolve => setTimeout(resolve, 4))
      await renderer.renderSyntheticFrame(0, { waitForGpu: false })
    }
  }

  /** 渲染一帧到 `output`（与之同尺寸）。作者着色器报错时抛 `ShaderGraphError`。 */
  async render(request: ShaderGraphRenderRequest): Promise<void> {
    const renderer = this.renderer
    if (!renderer || this.disposed) throw new Error('着色器图会话已关闭。')
    if (!Number.isFinite(request.timeSeconds)) throw new ShaderGraphError('着色器时间必须是有限秒数。')
    const { width, height } = request
    if (width !== this.size.width || height !== this.size.height) {
      this.size = { width, height }
      renderer.beginRecordingResolution(width, height, 1)
      for (const resize of this.resizeHost.values()) resize(width, height)
    }
    this.applyProps(request.props)
    const host = hostDevice(this.device)
    const scopes = ['validation', 'out-of-memory', 'internal'] as const
    scopes.forEach(scope => this.device.pushErrorScope(scope))
    host.owner = this
    let thrown: unknown
    try {
      // 首次渲染才建合成（宿主图层纹理在那时创建），所以先推进时间、再填宿主画面、再正式渲染。
      const delta = request.timeSeconds - this.elapsed
      this.elapsed = request.timeSeconds
      const needsHost = this.hostTextures.size === 0 && [...this.nodes.values()].some(node => node.layer.type === SHADER_GRAPH_INPUT || node.layer.type === SHADER_GRAPH_SECOND)
      if (needsHost) await this.draw(renderer, 0)
      const encoder = this.device.createCommandEncoder() as unknown as Encoder
      for (const [type, texture] of this.hostTextures) {
        const source = type === SHADER_GRAPH_SECOND ? request.second : request.input
        if (!source) throw new ShaderGraphError(type === SHADER_GRAPH_SECOND ? '这张着色器图需要第二段画面（转场后段）。' : '这张着色器图需要输入画面，只能用作滤镜或转场。')
        this.copy(encoder, 'upload', source, texture.unwrap(), 'rgba16float')
      }
      this.device.queue.submit([encoder.finish()])
      await this.draw(renderer, delta)
      if (this.computes) await this.draw(renderer, 0)
      if (!this.target) throw new Error('着色器图没有产出画面。')
      const present = this.device.createCommandEncoder() as unknown as Encoder
      this.copy(present, 'present', this.target, request.output, request.outputFormat)
      this.device.queue.submit([present.finish()])
    } catch (error) { thrown = error }
    host.owner = null
    const errors = await Promise.all(scopes.map(() => this.device.popErrorScope())).catch(() => [])
    const message = this.gpuError ?? errors.find(error => error?.message)?.message
    const failure = renderer.getFailureReason()
    this.gpuError = undefined
    // GPU 报的错（多为作者 WGSL）比后续“没有产出画面”更接近原因，优先交还。
    if (message || failure) throw new ShaderGraphError(message ? `着色器在 GPU 上编译或运行失败：${message}` : `着色器渲染器停止：${failure}`)
    if (thrown) throw thrown
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.renderer?.cleanup(); this.renderer = undefined
    this.target?.destroy(); this.target = undefined
    this.pipelines.clear(); this.hostTextures.clear(); this.resizeHost.clear()
  }
}
