import { expect, it } from 'vitest'
import { runVideoEditGpuSection } from './videoEditGpuRootQueue'
import { VideoEditAuthorThreeWebGpu, type AuthorThreeLibrary } from './videoEditAuthorThreeWebGpu'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'

const tick = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

/** 记录设备级作用域栈：交错的区段会让弹出者取走别人的作用域。 */
function scopedDevice() {
  const stack: string[] = [], popped: Array<[string, string]> = []
  const device = { onuncapturederror: 'host' as unknown, pushErrorScope: (owner: string) => { stack.push(owner) }, popErrorScope: () => Promise.resolve(stack.pop() ?? null) }
  const scoped = (owner: string, waits = 3) => async () => {
    device.pushErrorScope(owner)
    for (let index = 0; index < waits; index++) await tick()
    popped.push([owner, (await device.popErrorScope()) as string])
  }
  return { device, popped, scoped }
}

it('同一设备的作用域区段逐个执行，失败不阻塞后续区段，不同设备互不等待', async () => {
  const first = scopedDevice(), second = scopedDevice()
  const failing = runVideoEditGpuSection(first.device, async () => { await first.scoped('three')(); throw new Error('编译失败') })
  const host = runVideoEditGpuSection(first.device, first.scoped('host'))
  let otherDone = false
  const other = runVideoEditGpuSection(second.device, second.scoped('other', 1)).then(() => { otherDone = true })
  await other
  expect(first.popped).toEqual([])
  expect(otherDone).toBe(true)
  await expect(failing).rejects.toThrow('编译失败')
  await host
  expect(first.popped).toEqual([['three', 'three'], ['host', 'host']])
})

it('three 初始化独占根队列，宿主区段看不到被替换的错误处理器', async () => {
  const { device, popped, scoped } = scopedDevice()
  const seen: unknown[] = []
  class Renderer {
    backend = { isWebGPUBackend: true }
    _animation = { stop() {} }
    _nodes = { nodeFrame: { time: 0, deltaTime: 0, frameId: 0, update() {} } }
    info = { frame: 0 }
    toneMapping = 0
    outputColorSpace = ''
    onDeviceLost = (): void => {}
    async init(): Promise<void> { device.onuncapturederror = 'three'; await tick(); await tick() }
    async compileAsync(): Promise<void> {}
    render(): void {}
    setRenderTarget(): void {}
    setOutputRenderTarget(): void {}
    copyTextureToTexture(): void {}
    setSize(): void {}
    setClearColor(): void {}
    async dispose(): Promise<void> {}
  }
  const library = { WebGPURenderer: Renderer, REVISION: '186', NeutralToneMapping: 0, LinearSRGBColorSpace: 'linear', SRGBColorSpace: 'srgb' } as unknown as AuthorThreeLibrary
  const created = VideoEditAuthorThreeWebGpu.create(library, device as unknown as GpuDevice, 'webgpu', {} as OffscreenCanvas)
  const host = runVideoEditGpuSection(device, async () => { seen.push(device.onuncapturederror); await scoped('host')() })
  await created
  await host
  expect(seen).toEqual(['host'])
  expect(device.onuncapturederror).toBe('host')
  expect(popped).toEqual([['host', 'host']])
})
