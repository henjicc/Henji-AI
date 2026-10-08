import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { shaderGraphIssues, shaderGraphLayerProps, shaderGraphStructureKey, type ShaderGraphSpec } from '@/core/videoEdit/shaderGraph/spec'
import { createLogger } from '@/core/logging'
import { ShaderGraphError, ShaderGraphSession, type ShaderGraphRenderRequest } from './shaderGraphSession'

const logger = createLogger('features.videoEdit.shaderGraph')
/** 结构相同的图共用一个会话；这么久没用到才释放（建一次要编译管线，约半秒）。 */
const IDLE_MS = 30_000

/**
 * 一台设备上的着色器图会话缓存：效果、转场、代码素材的 shader 图层都经过这里。
 * 同一会话的渲染串行进行（属性与时间是会话状态），不同会话互不等待。
 */
export class ShaderGraphCache {
  private readonly entries = new Map<string, { session: Promise<ShaderGraphSession>; used: number; queue: Promise<unknown> }>()
  constructor(private readonly device: GpuDevice) {}

  async render(spec: ShaderGraphSpec, request: ShaderGraphRenderRequest, allow: { input?: boolean; second?: boolean } = { input: true, second: true }): Promise<void> {
    const key = shaderGraphStructureKey(spec)
    let entry = this.entries.get(key)
    if (!entry) {
      const issues = shaderGraphIssues(spec, allow)
      if (issues.length) throw new ShaderGraphError(issues.join('\n'))
      const started = performance.now()
      const session = ShaderGraphSession.create(this.device, spec)
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
    // 同结构的图共用会话：没指定时按图里写的属性下发（第一次建会话时已带上，后续帧只改变化的项）。
    const frame = request.props ? request : { ...request, props: shaderGraphLayerProps(spec) }
    const run = current.queue.then(async () => (await current.session).render(frame))
    current.queue = run.catch(() => undefined)
    return run
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
    for (const entry of this.entries.values()) void entry.session.then(session => session.dispose(), () => undefined)
    this.entries.clear()
  }
}
