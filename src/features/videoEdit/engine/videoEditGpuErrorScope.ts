import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'

type ScopedDevice = GpuDevice & {
  pushErrorScope(filter: 'validation' | 'out-of-memory' | 'internal'): void
  popErrorScope(): Promise<{ message: string } | null>
}

/**
 * 在错误作用域里同步执行一段 GPU 提交，把这段里的校验与显存错误变成抛出的异常。
 *
 * WebGPU 的校验错误是异步、设备级的：不套作用域时只进“未捕获错误”日志，调用方照样把这一帧当成画好了
 * （例如提交里用到已销毁的缓冲区，整帧什么都没画，取帧却报已核验）。作用域是设备级的栈，
 * 所以 `action` 必须同步执行、中间不让出；两次弹出也在任何等待之前发出，不会与别的区段交错。
 */
/** 同步的结果：传入异步函数时作用域会在异步工作完成前弹出，类型上直接拒绝。 */
type Synchronous<T> = T extends PromiseLike<unknown> ? never : T
export async function guardVideoEditGpu<T>(device: GpuDevice, what: string, action: () => Synchronous<T>): Promise<T> {
  const scoped = device as unknown as ScopedDevice
  scoped.pushErrorScope('validation')
  scoped.pushErrorScope('out-of-memory')
  scoped.pushErrorScope('internal')
  let result: Synchronous<T> | undefined, thrown: unknown, failed = false
  try { result = action() } catch (error) { thrown = error; failed = true }
  const internal = scoped.popErrorScope(), memory = scoped.popErrorScope(), validation = scoped.popErrorScope()
  const error = (await internal) ?? (await memory) ?? (await validation)
  if (failed) throw thrown
  if (error) throw new Error(`${what}失败：${error.message}`)
  return result as T
}
