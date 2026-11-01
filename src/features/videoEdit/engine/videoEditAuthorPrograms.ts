import { documentFontRevision } from '@/platform/fontFaces'
import { withTextFontSession } from '@/core/imaging/vectorContent/shaping/fontContext'
import { prepareAuthorTextParameters } from './videoEditAuthorTextResources'
import type { AuthorEffectEnvironment } from '@/core/videoEdit/authorEffects'
import type { CodeAuthorBundle, CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { loadAuthorModule, type AuthorModule } from './videoEditAuthorModule'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import { authorEffectMetadata, authorParameterValues } from './videoEditAuthorParameters'
import type { VideoEditFrameFingerprint } from '@/core/videoEdit/renderFingerprint'
import type { AuthorFingerprintInput } from './videoEditAuthorFingerprint'
import { fingerprintAuthorFrameKey } from './videoEditAuthorFingerprint'
import type { AuthorFrameInfo } from './videoEditAuthorModule'
import type { AuthorElementOverrides } from './videoEditAuthorElements'
import { videoEditRenderSize, videoEditOutputRenderDivisor } from '@/core/videoEdit/playbackResolution'
import { prepareAuthorModuleUrls } from './videoEditAuthorModules'
import type { VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'

const bundleBytes = (bundle: CodeAuthorBundle): number => 2 * (bundle.modules ? Object.values(bundle.modules.files).reduce((sum, text) => sum + text.length, 0) : bundle.code.length + bundle.map.length)

/** Modules are immutable per source version; GPU resources belong to instances.
 * Owned by the timeline compositor, never a separate worker or device. */
export class VideoEditAuthorPrograms {
  private readonly modules = new Map<CodeAuthorBundle, { dispose(): void; module: Promise<AuthorModule> }>()
  private readonly instances = new Map<string, { program: CodeAuthorProgram; fontRevision: number; runtime: VideoEditAuthorRuntime }>()
  /** Instances warmed ahead of the playhead: kept until their clip is drawn, even while no current frame uses them. */
  private protectedKeys: ReadonlySet<string> = new Set()
  private closed = false
  private lifecycle: Promise<unknown> = Promise.resolve()
  private closing?: Promise<void>
  constructor(private readonly device: GpuDevice, private readonly effectEnvironment: () => AuthorEffectEnvironment = () => ({}), private readonly allocator?: VideoEditBuiltinScratchAllocator) {}

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(action)
    this.lifecycle = result.catch(() => undefined)
    return result
  }

  private module(bundle: CodeAuthorBundle): Promise<AuthorModule> {
    if (this.closed) return Promise.reject(new Error('作者渲染会话已关闭。'))
    const known = this.modules.get(bundle)
    if (known) return known.module
    let release = (): void => undefined
    const module = prepareAuthorModuleUrls(bundle).then(async urls => {
      release = urls.dispose
      const context = bundle.trustContext ?? bundle.modules?.trustContext ?? []
      return loadAuthorModule(urls.url, context, bundle.apiVersion, bundle)
    }).catch(error => {
      this.modules.delete(bundle)
      release()
      throw error
    })
    this.modules.set(bundle, { dispose: () => release(), module })
    return module
  }

  async inspect(bundle: CodeAuthorBundle): Promise<CodeAuthorProgram> {
    // 模块读取与加载不能占住实例生命周期队列，当前帧可继续使用已就绪的模块。
    const effect = await this.module(bundle)
    return this.enqueue(async () => {
      if (this.closed) throw new Error('作者渲染会话已关闭。')
      // 作者接口版本由编译输入指定（来自代码版本记录）；没有指定即第一个作者 JS 接口 v4。
      const program: CodeAuthorProgram = { ...authorEffectMetadata(effect, bundle.apiVersion), seed: 0, apiVersion: bundle.apiVersion ?? 4, languageVersion: 4, bundle }
      const pinned = new Set([bundle, ...[...this.instances.values()].map(value => value.program.bundle)])
      let bytes = [...this.modules.keys()].reduce((sum, value) => sum + bundleBytes(value), 0)
      for (const [source, entry] of this.modules) {
        if (this.modules.size <= 32 && bytes <= 64 * 1024 ** 2) break
        if (pinned.has(source)) continue
        this.modules.delete(source); bytes -= bundleBytes(source)
        try { await (await entry.module).dispose?.() } finally { entry.dispose() }
      }
      return program
    })
  }

  instance(key: string, program: CodeAuthorProgram): Promise<VideoEditAuthorRuntime> {
    return this.enqueue(async () => {
      if (this.closed) throw new Error('作者渲染会话已关闭。')
      const previous = this.instances.get(key)
      const fontRevision = documentFontRevision()
      // 字体变化会改变相同绘制指令的栅格，实例内部的层纹理也必须重新生成。
      if (previous?.program === program && previous.fontRevision === fontRevision) return previous.runtime
      if (previous) { this.instances.delete(key); await previous.runtime.dispose() }
      const effect = await this.module(program.bundle)
      if (this.closed) throw new Error('作者渲染会话已关闭。')
      const runtime = new VideoEditAuthorRuntime(this.device, effect, program.bundle.locations, false, program.apiVersion, this.effectEnvironment, this.allocator)
      this.instances.set(key, { program, fontRevision, runtime })
      return runtime
    })
  }

  observe(key: string): ReturnType<VideoEditAuthorRuntime['observeElements']> { return this.instances.get(key)?.runtime.observeElements() ?? [] }

  async textIdentity(program: CodeAuthorProgram, parameters: Readonly<Record<string, unknown>>, signal?: AbortSignal): Promise<string | undefined> {
    const effect = await this.module(program.bundle)
    const preparing = prepareAuthorTextParameters(effect, authorParameterValues({ ...program, types: program.types ?? {} }, parameters), signal)
    return preparing && (await preparing).identity
  }

  async frameKey(program: CodeAuthorProgram, size: { width: number; height: number }, parameters: Readonly<Record<string, unknown>>, info: AuthorFrameInfo,
    overrides: AuthorElementOverrides | undefined, motionBlur: boolean, divisor: number, environment: AuthorEffectEnvironment, inputs: Readonly<Record<string, AuthorFingerprintInput>>): Promise<VideoEditFrameFingerprint | undefined> {
    const effect = await this.module(program.bundle)
    if (!effect.frameKey) return undefined
    const output = divisor === 1 ? undefined : videoEditRenderSize(size.width, size.height, videoEditOutputRenderDivisor(size.width, size.height, 1 / divisor))
    const frameInfo = output ? { ...info, renderScale: output.height / size.height } : info
    // 原生 GPU 作者看到实际纹理尺寸，Canvas 作者仍使用逻辑画幅。
    const dimensions = output && (effect.createWebGPU || effect.createWebGL) ? output : size
    const params = authorParameterValues({ ...program, types: program.types ?? {} }, parameters)
    const preparing = prepareAuthorTextParameters(effect, params)
    const text = preparing && await preparing
    return withTextFontSession(text?.fonts, () => fingerprintAuthorFrameKey(effect, dimensions, params, frameInfo, inputs, text?.identity ?? '', undefined, overrides, motionBlur, environment, program.apiVersion))
  }

  get canvasBytes(): number { return [...this.instances.values()].reduce((bytes, entry) => bytes + entry.runtime.canvasBytes, 0) }

  protect(keys: ReadonlySet<string>): void { this.protectedKeys = new Set(keys) }

  retain(keys: ReadonlySet<string>): Promise<void> {
    const retained = new Set([...keys, ...this.protectedKeys])
    return this.enqueue(() => this.releaseInstances(retained))
  }

  private async releaseInstances(keys: ReadonlySet<string>): Promise<void> {
    const retired = [...this.instances].filter(([key]) => !keys.has(key))
    for (const [key] of retired) this.instances.delete(key)
    const results = await Promise.allSettled(retired.map(([, value]) => value.runtime.dispose()))
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : [])
    if (errors.length) throw new AggregateError(errors, '作者效果实例释放失败。')
  }

  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.closed = true
    this.closing = this.enqueue(async () => {
    const errors: unknown[] = []
    try { await this.releaseInstances(new Set()) } catch (error) { errors.push(error) }
    const modules = [...this.modules.values()]; this.modules.clear()
    const results = await Promise.allSettled(modules.map(async entry => {
      try { await (await entry.module).dispose?.() }
      finally { entry.dispose() }
    }))
    for (const result of results) if (result.status === 'rejected') errors.push(result.reason)
    if (errors.length) throw new AggregateError(errors, '作者渲染会话释放失败。')
    })
    return this.closing
  }
}
