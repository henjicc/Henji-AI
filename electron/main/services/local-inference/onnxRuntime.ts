import type { InferenceSession } from 'onnxruntime-node'
import type { LocalModelRunner, LocalTensorInput, LocalTensorOutput } from './analysis'
import type { LocalInferenceModelFile } from './protocol'
import { createSessionWithFallback, type LocalExecutionProvider, type LocalInferenceLog } from './providers'

type OnnxRuntime = typeof import('onnxruntime-node')

/**
 * 加载 onnxruntime-node（只在本地推理后台进程与原生测试里调用）。
 *
 * 先移除全局 Float16Array：onnxruntime-common 1.30 在有 Float16Array 时把 float16 张量存成 Float16Array，
 * 而原生绑定按 N-API 类型数组读取，不认识 Float16Array，读到 0 字节（实测报
 * “not enough space: expected N, got 0”，CPU 与 DirectML 都一样）。去掉后回到 Uint16Array 存位模式，RVM fp16 正常运行。
 * 这个进程只做推理，不受影响。
 */
export async function loadOnnxRuntime(): Promise<OnnxRuntime> {
  if ('Float16Array' in globalThis) Reflect.deleteProperty(globalThis, 'Float16Array')
  const runtime = await import('onnxruntime-node')
  return ((runtime as unknown as { default?: OnnxRuntime }).default ?? runtime)
}

function sessionOptions(provider: LocalExecutionProvider): InferenceSession.SessionOptions {
  // DirectML 要求关闭内存模式并顺序执行（onnxruntime 官方 DirectML 说明）。
  return provider === 'dml'
    ? { executionProviders: ['dml'], graphOptimizationLevel: 'all', enableMemPattern: false, executionMode: 'sequential', logSeverityLevel: 3 }
    : { executionProviders: [provider], graphOptimizationLevel: 'all', logSeverityLevel: 3 }
}

class Runner implements LocalModelRunner {
  constructor(private readonly runtime: OnnxRuntime, private session: InferenceSession, public provider: LocalExecutionProvider, private remaining: LocalExecutionProvider[], private readonly model: LocalInferenceModelFile, private readonly log: LocalInferenceLog) {}
  async run(feeds: Readonly<Record<string, LocalTensorInput>>): Promise<Record<string, LocalTensorOutput>> {
    const tensors = Object.fromEntries(Object.entries(feeds).map(([name, input]) => [name, new this.runtime.Tensor(input.type, input.data, input.dims)]))
    for (;;) {
      try {
        const outputs = await this.session.run(tensors)
        return Object.fromEntries(Object.entries(outputs).map(([name, tensor]) => [name, { data: tensor.data, dims: tensor.dims }]))
      } catch (error) {
        // 显卡驱动不支持某个算子时常在第一次运行才暴露：换下一个执行提供者重试。
        const next = this.remaining.shift()
        if (!next) throw error
        this.log('warn', '本地模型运行失败，改用下一个执行提供者', 'local_inference.provider.fallback', { model: this.model.name, provider: this.provider, next, reason: error instanceof Error ? error.message.slice(0, 300) : String(error) })
        await this.session.release().catch(() => undefined)
        this.session = await this.runtime.InferenceSession.create(this.model.path, sessionOptions(next))
        this.provider = next
      }
    }
  }
  release(): Promise<void> { return this.session.release() }
}

/**
 * 会话复用：同一模型、同一输入尺寸、同一执行顺序复用一个会话（创建 DirectML 会话约 1 秒）。
 * 最多保留 3 个，超出时释放最久没用的。
 */
export class LocalModelSessions {
  private readonly sessions = new Map<string, Promise<Runner>>()
  constructor(private readonly runtime: OnnxRuntime, private readonly log: LocalInferenceLog, private readonly limit = 3) {}
  open(model: LocalInferenceModelFile, providers: readonly LocalExecutionProvider[], shape: string): Promise<LocalModelRunner> {
    const key = `${model.path}\u0000${shape}\u0000${providers.join(',')}`
    let pending = this.sessions.get(key)
    if (pending) { this.sessions.delete(key); this.sessions.set(key, pending); return pending }
    pending = createSessionWithFallback(providers, provider => this.runtime.InferenceSession.create(model.path, sessionOptions(provider)), this.log, model.name)
      .then(({ session, provider, remaining }) => new Runner(this.runtime, session, provider, remaining, model, this.log))
    this.sessions.set(key, pending)
    pending.catch(() => { if (this.sessions.get(key) === pending) this.sessions.delete(key) })
    while (this.sessions.size > this.limit) {
      const [oldest, value] = this.sessions.entries().next().value as [string, Promise<Runner>]
      this.sessions.delete(oldest)
      void value.then(runner => runner.release()).catch(() => undefined)
    }
    return pending
  }
  async dispose(): Promise<void> {
    const all = [...this.sessions.values()]; this.sessions.clear()
    await Promise.allSettled(all.map(async value => (await value).release()))
  }
}
