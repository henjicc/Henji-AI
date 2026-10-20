import { afterEach, expect, it, vi } from 'vitest'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { VideoEditGraphicDraw } from '@/core/videoEdit/graphics'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
const text = (x: number, y: number, value: string): VideoEditGraphicDraw => ({ command: { kind: 'text', x, y, text: value, fontSize: 32, color: [1,1,1,1], fontFamily: 'sans-serif', align: 'left' }, rotation: 0, pivotX: 0, pivotY: 0 })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('180帧时间码/计数器内容变化只新栅格当前内容，运动中的固定文字不被LRU逐出，纹理驻留有界', async () => {
  let paints = 0; let copies = 0
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { font: '', fillText() { paints++ }, measureText(text: string) { return { width: text.length * 30, actualBoundingBoxRight: text.length * 30, actualBoundingBoxLeft: 0 } } } }
  })
  const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }
  const device = { queue: { writeBuffer() {}, submit() {}, onSubmittedWorkDone: async () => {}, copyExternalImageToTexture() { copies++ } }, createShaderModule() {}, createRenderPipeline: () => ({ getBindGroupLayout() {} }), createSampler() {}, createTexture: () => ({ createView() { return {} }, destroy() {} }), createBuffer: () => ({ destroy() {} }), createBindGroup() {}, createCommandEncoder: () => ({ beginRenderPass: () => pass, finish() {} }), pushErrorScope() {}, popErrorScope: async () => null } as unknown as GpuDevice
  const runtime = new VideoEditCodeGpu(device)
  try {
    for (let frame = 0; frame < 180; frame++) {
      const before = copies
      await runtime.draw('counter', 3840, 2160, [text(frame, 200, '固定标题'), text(100, 300, `00:00:${Math.floor(frame / 60)}:${frame % 60} ${frame}`)])
      expect(copies - before).toBe(frame === 0 ? 2 : 1)
      expect(runtime.diagnostics().glyphs).toBeLessThanOrEqual(64)
      expect(runtime.diagnostics().residentBytes).toBeLessThan(256 * 1024 ** 2)
    }
    expect(paints).toBe(181)
  } finally { await runtime.dispose() }
})

