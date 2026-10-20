import type { CodeAuthorBundle, CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { loadAuthorModule, type AuthorModule } from './videoEditAuthorModule'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import { authorEffectMetadata } from './videoEditAuthorParameters'

/** Modules are immutable per source version; GPU resources belong to instances.
 * Owned by the timeline compositor, never a separate worker or device. */
export class VideoEditAuthorPrograms {
  private readonly modules = new Map<CodeAuthorBundle, { url: string; module: Promise<AuthorModule> }>()
  private readonly instances = new Map<string, { program: CodeAuthorProgram; runtime: VideoEditAuthorRuntime }>()
  private closed = false
  private lifecycle: Promise<unknown> = Promise.resolve()
  private closing?: Promise<void>
  constructor(private readonly device: GpuDevice) {}

  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    const result = this.lifecycle.then(action)
    this.lifecycle = result.catch(() => undefined)
    return result
  }

  private module(bundle: CodeAuthorBundle): Promise<AuthorModule> {
    if (this.closed) return Promise.reject(new Error('作者渲染会话已关闭。'))
    const known = this.modules.get(bundle)
    if (known) return known.module
    const url = URL.createObjectURL(new Blob([bundle.code], { type: 'text/javascript' }))
    const module = loadAuthorModule(url).catch(error => {
      this.modules.delete(bundle)
      URL.revokeObjectURL(url)
      throw error
    })
    this.modules.set(bundle, { url, module })
    return module
  }

  inspect(bundle: CodeAuthorBundle): Promise<CodeAuthorProgram> {
    return this.enqueue(async () => {
      const effect = await this.module(bundle)
      if (this.closed) throw new Error('作者渲染会话已关闭。')
      const program: CodeAuthorProgram = { ...authorEffectMetadata(effect), seed: 0, apiVersion: 4, languageVersion: 4, bundle }
      const pinned = new Set([bundle, ...[...this.instances.values()].map(value => value.program.bundle)])
      let bytes = [...this.modules.keys()].reduce((sum, value) => sum + 2 * (value.code.length + value.map.length), 0)
      for (const [source, entry] of this.modules) {
        if (this.modules.size <= 32 && bytes <= 64 * 1024 ** 2) break
        if (pinned.has(source)) continue
        this.modules.delete(source); bytes -= 2 * (source.code.length + source.map.length)
        try { await (await entry.module).dispose?.() } finally { URL.revokeObjectURL(entry.url) }
      }
      return program
    })
  }

  instance(key: string, program: CodeAuthorProgram): Promise<VideoEditAuthorRuntime> {
    return this.enqueue(async () => {
      if (this.closed) throw new Error('作者渲染会话已关闭。')
      const previous = this.instances.get(key)
      if (previous?.program === program) return previous.runtime
      if (previous) { this.instances.delete(key); await previous.runtime.dispose() }
      const effect = await this.module(program.bundle)
      if (this.closed) throw new Error('作者渲染会话已关闭。')
      const runtime = new VideoEditAuthorRuntime(this.device, effect, program.bundle.locations, false)
      this.instances.set(key, { program, runtime })
      return runtime
    })
  }

  observe(key: string): ReturnType<VideoEditAuthorRuntime['observeElements']> { return this.instances.get(key)?.runtime.observeElements() ?? [] }

  retain(keys: ReadonlySet<string>): Promise<void> {
    const retained = new Set(keys)
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
      finally { URL.revokeObjectURL(entry.url) }
    }))
    for (const result of results) if (result.status === 'rejected') errors.push(result.reason)
    if (errors.length) throw new AggregateError(errors, '作者渲染会话释放失败。')
    })
    return this.closing
  }
}
