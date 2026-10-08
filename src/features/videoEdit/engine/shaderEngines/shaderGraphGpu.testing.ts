import { init } from 'vgpu/node'

/**
 * Node 下的 Dawn（vgpu/node）没有 navigator.gpu；TypeGPU 配置画布时只向它要首选格式。
 * 只给 GPU 测试用：Worker 与 Electron 渲染进程本来就有 navigator.gpu。
 */
export function ensureNodeCanvasFormat(): void {
  const nav = globalThis.navigator as unknown as { gpu?: unknown } | undefined
  if (nav && !nav.gpu) Object.defineProperty(globalThis.navigator, 'gpu', { value: { getPreferredCanvasFormat: () => 'bgra8unorm' }, configurable: true })
}

/**
 * 跑着色器图的测试设备：与正式设备管理器一样，向兼容模式适配器（CI）要顶点阶段的存储资源上限；
 * 适配器不支持时逐级退回默认设备。
 */
export async function initShaderGraphTestGpu(options: Parameters<typeof init>[0] = {}): ReturnType<typeof init> {
  ensureNodeCanvasFormat()
  const attempts = [{ maxStorageBuffersInVertexStage: 8, maxStorageTexturesInVertexStage: 4 }, { maxStorageBuffersInVertexStage: 8 }]
  for (const requiredLimits of attempts) {
    try { return await init({ ...options, requiredLimits } as Parameters<typeof init>[0]) } catch { /* 适配器不认识或给不了这个上限 */ }
  }
  return init(options)
}
