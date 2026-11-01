/**
 * 共享 GPUDevice 的根调度队列。
 *
 * WebGPU 错误作用域是设备级的栈，未捕获错误处理器也只有一个：跨 await 持有它们的区段一旦交错，
 * 后弹出的一方会取走别人的作用域，three 初始化期间的宿主错误也会落进 three 的处理器。
 * three 的 WebGPU 初始化、compileAsync 预热与着色器图渲染因此在同一设备上逐个执行。
 *
 * 区段只能等待驱动与 GPU 的完成，不能等待帧准备、嵌套渲染、作者实例队列或另一区段：
 * 持有队列时等待需要队列的工作会自等待。能在让出前弹出作用域的地方先弹出再等待，不进队列；
 * 普通提交与上传也不进队列，它们在区段等待期间若产生校验错误，会记进当时栈顶的区段作用域。
 */
const tails = new WeakMap<object, Promise<void>>()

export function runVideoEditGpuSection<T>(device: object, section: () => T | Promise<T>): Promise<T> {
  const result = (tails.get(device) ?? Promise.resolve()).then(section)
  // 失败只交给本区段的调用方；队列继续让后续区段执行。
  tails.set(device, result.then(() => undefined, () => undefined))
  return result
}
