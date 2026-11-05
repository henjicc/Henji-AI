import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { guardVideoEditGpu, reportVideoEditGpuFault } from './videoEditGpuErrorScope'

interface ThreeNamed { name?: string; type?: string }
interface ThreeRenderObject { pipeline: object; object?: ThreeNamed; material?: ThreeNamed }
interface ThreeWebGpuBackend {
  isWebGPUBackend?: boolean
  get?(object: object): { error?: boolean; pipeline?: unknown }
  draw?(renderObject: ThreeRenderObject, info: unknown): void
  createRenderPipeline?(renderObject: ThreeRenderObject, promises: Array<Promise<unknown>> | null): void
}
const label = ({ object, material }: ThreeRenderObject): string => `物体“${object?.name || object?.type || '未命名'}”的${material?.name || material?.type || '材质'}`

/**
 * three 建管线时自己压错误作用域、自己接走错误，只设一个失败标记；之后每次绘制看到标记就跳过这个物体。
 * 宿主的守卫什么也看不到，画面少了东西却报成功。这里记下新建的管线与被跳过的绘制，守卫结束后读取标记。
 */
class ThreePipelineProbe {
  private created: ThreeRenderObject[] = []
  private readonly skipped = new Set<string>()
  constructor(private readonly backend: ThreeWebGpuBackend & Required<Pick<ThreeWebGpuBackend, 'get' | 'draw' | 'createRenderPipeline'>>) {
    const { draw, createRenderPipeline } = backend
    backend.createRenderPipeline = (renderObject, promises) => {
      const before = promises?.length ?? 0
      createRenderPipeline.call(backend, renderObject, promises)
      this.created.push(renderObject)
      // 预热时 three 的作用域跨 await，别处没接住的错误会落进来，把好好的管线永久标成失败。异步建管线真失败时靠拒绝交出
      // （管线留空），所以拿到了管线而标记为失败的，错误不是它的。
      if (promises && promises.length > before) {
        const pending = promises[before]
        promises[before] = pending.then(() => {
          const data = backend.get(renderObject.pipeline)
          if (data.error === true && data.pipeline) data.error = false
        })
      }
    }
    backend.draw = (renderObject, info) => {
      if (backend.get(renderObject.pipeline).error === true) this.skipped.add(label(renderObject))
      draw.call(backend, renderObject, info)
    }
  }
  /** 新建的管线要到作用域弹出后才有标记，所以在守卫等完之后读。 */
  take(): string | undefined {
    const failed = new Set(this.skipped)
    for (const renderObject of this.created) if (this.backend.get(renderObject.pipeline).error === true) failed.add(label(renderObject))
    this.created = []; this.skipped.clear()
    return failed.size ? [...failed].join('、') : undefined
  }
}

const probes = new WeakMap<object, ThreePipelineProbe>()
/** 渲染器初始化之后调用：`backend` 此时才定下来。WebGL 后端与缺这些方法的版本不安装。 */
export function observeThreePipelines(renderer: { backend?: unknown }): void {
  const backend = renderer.backend as ThreeWebGpuBackend | undefined
  if (!backend?.isWebGPUBackend || !backend.get || !backend.draw || !backend.createRenderPipeline || probes.has(renderer)) return
  probes.set(renderer, new ThreePipelineProbe(backend as ConstructorParameters<typeof ThreePipelineProbe>[0]))
}

/** 守卫一段 three 绘制：管线失败比守卫给出的泛化错误更具体，优先交出。 */
type Synchronous<T> = T extends PromiseLike<unknown> ? never : T
export async function guardVideoEditThree<T>(renderer: object, device: GpuDevice, what: string, action: () => Synchronous<T>): Promise<T> {
  try { return await guardVideoEditGpu(device, what, action) }
  finally {
    const failed = probes.get(renderer)?.take()
    // eslint-disable-next-line no-unsafe-finally -- 同一段绘制的管线失败比泛化错误更接近原因。
    if (failed) throw new Error(`${what}失败：${failed}的着色管线无法创建，未画出。`)
  }
}

type ThreeConsole = (type: string, message: string, ...params: unknown[]) => void
interface ThreeConsoleLibrary { setConsoleFunction?(fn: ThreeConsole): void; getConsoleFunction?(): ThreeConsole | null }
const observedConsoles = new WeakSet<object>()
/** GPU 原文只经 three 的日志函数交出；判定不靠这段文本，它只进日志。 */
export function observeThreeConsole(library: object): void {
  const three = library as ThreeConsoleLibrary
  if (!three.setConsoleFunction || observedConsoles.has(library)) return
  observedConsoles.add(library)
  const previous = three.getConsoleFunction?.()
  three.setConsoleFunction((type, message, ...params) => {
    if (type === 'error' && /pipeline creation failed/i.test(String(message))) reportVideoEditGpuFault('video_edit.three.pipeline.failed', String(message))
    if (previous) previous(type, message, ...params)
    else (console as unknown as Record<string, (...args: unknown[]) => void>)[type](message, ...params)
  })
}
