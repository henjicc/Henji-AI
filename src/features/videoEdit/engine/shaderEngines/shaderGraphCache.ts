import { recordVideoEditPreparation } from '../videoEditPreparationTiming'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { shaderClockRateProps, shaderComponent, shaderGraphIssues, shaderGraphLayerId, shaderGraphLayerProps, shaderGraphStructureKey, type ShaderGraphLayer, type ShaderGraphSpec } from '@/core/videoEdit/shaderGraph/spec'
import { createLogger } from '@/core/logging'
import { SHADER_COMPONENT_LOADERS } from './componentLoaders.generated'
import { ShaderGraphError, ShaderGraphSession, type ShaderGraphRenderRequest } from './shaderGraphSession'

const logger = createLogger('features.videoEdit.shaderGraph')
/** 合成结构相同的图共用一个会话；这么久没用到才释放（建一次要编译管线，约半秒）。 */
const IDLE_MS = 30_000

type LayerProps = ReadonlyMap<string, Readonly<Record<string, unknown>>>
type StructuralProp = { default?: unknown; compileTime?: boolean; compileTimeWhen?: (previous: unknown, next: unknown) => boolean }
const componentProps = new Map<string, Promise<Readonly<Record<string, StructuralProp>> | undefined>>()
function structuralProps(type: string): Promise<Readonly<Record<string, StructuralProp>> | undefined> {
  let found = componentProps.get(type)
  if (!found) {
    const load = SHADER_COMPONENT_LOADERS[type]
    found = load ? load().then(module => (module.componentDefinition as { props: Record<string, StructuralProp> }).props) : Promise.resolve(undefined)
    componentProps.set(type, found)
  }
  return found
}

/**
 * 会话按合成结构区分：图层结构之外，编译期属性的取值、带重建条件的属性落在默认值哪一侧（剪辑可用组件的条件都是阈值两侧）、
 * 混合模式、透明度是否不足 1（框架把它算进合成哈希）与是否可见，任一不同框架就要换一份合成。一种合成一个会话，几段片段交替用同一组件的不同设置时不必每帧重建、重新上传。
 * 时钟快慢（速度类属性）也分会话：时间按“秒差 × 速度”在会话里累加，速度不同的片段共用会话时结果会取决于渲染历史。
 */
async function compositionKey(spec: ShaderGraphSpec, props: LayerProps): Promise<string> {
  const parts: unknown[] = []
  const visit = async (layers: readonly ShaderGraphLayer[], prefix: string): Promise<void> => {
    for (const [index, layer] of layers.entries()) {
      const id = shaderGraphLayerId(layer, index, prefix), values = props.get(id) ?? layer.props ?? {}
      const component = shaderComponent(layer.type), clockRates = component ? shaderClockRateProps(component) : []
      for (const [key, config] of Object.entries(await structuralProps(layer.type) ?? {})) {
        const value = key in values ? values[key] : config.default
        if (config.compileTime || clockRates.includes(key)) parts.push([id, key, value])
        else if (config.compileTimeWhen) parts.push([id, key, config.compileTimeWhen(config.default, value)])
      }
      parts.push([id, 'blendMode', typeof values.blendMode === 'string' ? values.blendMode : 'normal'], [id, 'translucent', (typeof values.opacity === 'number' ? values.opacity : 1) < 1], [id, 'visible', values.visible !== false])
      await visit(layer.children ?? [], `${id}.`)
    }
  }
  await visit(spec.layers, 'layer')
  return `${shaderGraphStructureKey(spec)}|${JSON.stringify(parts)}`
}

/** 新会话直接按本帧属性建合成，第一帧就是要的结构；本帧没下发属性的图层（遮罩、隐藏的分组）沿用图里写的属性。 */
function withLayerProps(spec: ShaderGraphSpec, props: LayerProps): ShaderGraphSpec {
  const map = (layers: readonly ShaderGraphLayer[], prefix: string): ShaderGraphLayer[] => layers.map((layer, index) => {
    const id = shaderGraphLayerId(layer, index, prefix)
    return { ...layer, props: { ...(props.get(id) ?? layer.props ?? {}) }, ...(layer.children ? { children: map(layer.children, `${id}.`) } : {}) }
  })
  return { ...spec, layers: map(spec.layers, 'layer') }
}

/**
 * 一台设备上的着色器图会话缓存：片段效果、着色器转场与预热都经过这里。
 * 同一会话的渲染串行进行（属性与时间是会话状态），不同会话互不等待。
 */
export class ShaderGraphCache {
  private readonly entries = new Map<string, { session: Promise<ShaderGraphSession>; used: number; queue: Promise<unknown> }>()
  constructor(private readonly device: GpuDevice) {}

  async render(spec: ShaderGraphSpec, request: ShaderGraphRenderRequest, allow: { input?: boolean; second?: boolean } = { input: true, second: true }): Promise<void> {
    // 没指定时按图里写的属性下发；指定时是每个图层的完整属性表。
    const props: LayerProps = request.props ?? shaderGraphLayerProps(spec)
    const key = await compositionKey(spec, props)
    let entry = this.entries.get(key)
    if (!entry) {
      const issues = shaderGraphIssues(spec, allow)
      if (issues.length) throw new ShaderGraphError(issues.join('\n'))
      const started = performance.now()
      const session = ShaderGraphSession.create(this.device, withLayerProps(spec, props))
      session.then(() => recordVideoEditPreparation('contentPipelines', performance.now() - started), () => undefined)
      session.then(() => logger.info('着色器图已准备', { event: 'video_edit.shader_graph.prepared', context: { layers: spec.layers.length, custom: spec.shaders?.length ?? 0, ms: Math.round(performance.now() - started) } }), () => undefined)
      entry = { session, used: performance.now(), queue: Promise.resolve() }
      this.entries.set(key, entry)
      session.catch(error => {
        if (this.entries.get(key)?.session === session) this.entries.delete(key)
        logger.warn('着色器图准备失败', { event: 'video_edit.shader_graph.prepare_failed', context: { layers: spec.layers.length, custom: spec.shaders?.length ?? 0 }, error })
      })
    }
    entry.used = performance.now()
    const current = entry
    const run = current.queue.then(async () => (await current.session).render({ ...request, props }))
    current.queue = run.catch(() => undefined)
    return run
  }

  private warming: Promise<void> = Promise.resolve()
  private dummy?: { texture: GpuTexture; output: GpuTexture }
  /**
   * 后台预热：没缓存过的图先用 32×18 的透明画面渲一帧，把框架管线编译好（管线与尺寸无关，正式尺寸只重建纹理）。
   * 逐个排队执行，不并发抢 GPU；失败只记日志，正式渲染时会再报给用户。
   */
  warm(specs: readonly ShaderGraphSpec[]): Promise<void> {
    if (!specs.length) return this.warming
    this.warming = this.warming.then(async () => {
      for (const spec of specs) {
        if (this.entries.has(await compositionKey(spec, shaderGraphLayerProps(spec)))) continue
        this.dummy ??= { texture: this.device.createTexture({ size: [32, 18], format: 'rgba8unorm', usage: 0x04 | 0x10 }), output: this.device.createTexture({ size: [32, 18], format: 'rgba8unorm', usage: 0x04 | 0x10 }) }
        const started = performance.now()
        await this.render(spec, { timeSeconds: 0, width: 32, height: 18, input: this.dummy.texture, second: this.dummy.texture, output: this.dummy.output, outputFormat: 'rgba8unorm' }).then(
          () => logger.debug('着色器图预热完成', { event: 'video_edit.shader_graph.warmed', context: { layers: spec.layers.length, ms: Math.round(performance.now() - started) } }),
          error => logger.warn('着色器图预热失败', { event: 'video_edit.shader_graph.warm_failed', context: { layers: spec.layers.length }, error }))
      }
    })
    return this.warming
  }

  /** 帧边界调用：释放长时间没用到的会话。 */
  releaseIdle(now = performance.now()): void {
    for (const [key, entry] of this.entries) {
      if (now - entry.used < IDLE_MS) continue
      this.entries.delete(key)
      void entry.session.then(session => session.dispose(), () => undefined)
    }
  }

  dispose(): void {
    this.dummy?.texture.destroy(); this.dummy?.output.destroy(); this.dummy = undefined
    for (const entry of this.entries.values()) void entry.session.then(session => session.dispose(), () => undefined)
    this.entries.clear()
  }
}
