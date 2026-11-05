import { expect, it, vi } from 'vitest'
import { init } from 'vgpu/node'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditGpuFrameFences } from './videoEditGpuFrameFence'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import { setVideoEditGpuFaultObserver, VideoEditFrameGpu, videoEditGpuLedger } from './videoEditGpuErrorScope'

const ownDevice = async (): Promise<GpuDevice> => (await init()).gpu as unknown as GpuDevice

it('提交用到已销毁的纹理：窗口结清时拿到错误，同时记日志', async () => {
  const device = await ownDevice(), report = vi.fn(), stop = setVideoEditGpuFaultObserver(report)
  try {
    const texture = device.createTexture({ size: [4, 4], format: 'rgba8unorm', usage: 0x10 })
    const encoder = device.createCommandEncoder()
    encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] }] }).end()
    const commands = encoder.finish()
    texture.destroy()
    const window = videoEditGpuLedger(device).open()
    device.queue.submit([commands])
    const [fault] = await window.settle()
    expect(fault?.message).toMatch(/destroyed/i)
    expect(report).toHaveBeenCalledWith('video_edit.gpu.submit.failed', fault!.message, undefined)
  } finally { stop(); device.destroy() }
})

it('帧栅栏：正常提交结束后复用；设备被销毁时当帧失败，不当成做完了', async () => {
  const device = await ownDevice(), onLost = vi.fn()
  const fences = new VideoEditGpuFrameFences(device, onLost)
  const encoder = device.createCommandEncoder()
  const fence = fences.arm(encoder)
  device.queue.submit([encoder.finish()])
  await fence.wait()
  const next = device.createCommandEncoder()
  const armed = fences.arm(next)
  device.queue.submit([next.finish()])
  device.destroy()
  await expect(armed.wait()).rejects.toMatchObject({ name: 'AbortError' })
  expect(onLost).not.toHaveBeenCalled()
})

it('代码 GPU 的混合提交用到已销毁的输入：这一帧的窗口结清时拿到错误', async () => {
  const device = await ownDevice(), stop = setVideoEditGpuFaultObserver(vi.fn())
  const host = new VideoEditCodeGpu(device)
  try {
    const left = await host.target('left', 8, 8), right = await host.target('right', 8, 8)
    left.texture.destroy()
    const frame = new VideoEditFrameGpu(videoEditGpuLedger(device))
    await host.mix('output', left, right, .5)
    frame.end()
    const faults = await frame.settle()
    expect(faults.length).toBeGreaterThan(0)
    expect(await frame.outcome).toEqual(faults)
  } finally { stop(); await host.dispose(); device.destroy() }
})
