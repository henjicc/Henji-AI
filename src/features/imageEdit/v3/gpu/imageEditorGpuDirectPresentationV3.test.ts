import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Gpu, Target } from 'vgpu'
import { createDefaultImageEditColorModeV3 } from '@/core/imageEdit/v3/colorTypes'
import { ImageEditorGpuRasterPresentationV3 } from './imageEditorGpuDirectPresentationV3'

const vgpuMocks = vi.hoisted(() => ({
  failDirect: false,
  surfaces: [] as Array<{
    kind: 'direct' | 'bitmap'
    size: [number, number]
    format: 'bgra8unorm'
    resize: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
  transferToImageBitmap: vi.fn(() => ({ close: vi.fn() } as unknown as ImageBitmap)),
  target: vi.fn(),
}))

vi.mock('vgpu', () => ({
  draw: vi.fn(() => ({
    compile: vi.fn(async () => undefined),
    layout: vi.fn(() => ({})),
    group: vi.fn(),
  })),
  frame: vi.fn((_gpu, encode: (value: { pass(options: { target: unknown }): void }) => void) => {
    let submittedKind: string | undefined
    encode({ pass: ({ target }) => { submittedKind = (target as { kind?: string }).kind } })
    return {
      done: submittedKind === 'direct' && vgpuMocks.failDirect
        ? Promise.reject(new Error('surface submit failed'))
        : Promise.resolve(),
    }
  }),
  surface: vi.fn((_gpu, canvas: unknown, options: { size: readonly [number, number] }) => {
    const entry = {
      kind: canvas instanceof OffscreenCanvasStub ? 'bitmap' as const : 'direct' as const,
      size: [...options.size] as [number, number],
      format: 'bgra8unorm' as const,
      resize: vi.fn((size: readonly [number, number]) => { entry.size = [...size] }),
      dispose: vi.fn(),
    }
    vgpuMocks.surfaces.push(entry as unknown as (typeof vgpuMocks.surfaces)[number])
    return entry
  }),
  target: vgpuMocks.target,
}))

class OffscreenCanvasStub {
  readonly transferToImageBitmap = vgpuMocks.transferToImageBitmap

  constructor(public width: number, public height: number) {}
}

function gpu(): Gpu {
  return {
    gpu: {
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() },
    },
    onError: vi.fn(() => vi.fn()),
    settled: vi.fn(async () => undefined),
  } as unknown as Gpu
}

function output(): Target {
  return {
    size: [32, 24],
    format: 'rgba16float',
    color: { view: {} },
  } as unknown as Target
}

describe('ImageEditorGpuRasterPresentationV3', () => {
  beforeEach(() => {
    vgpuMocks.failDirect = false
    vgpuMocks.surfaces.length = 0
    vgpuMocks.transferToImageBitmap.mockClear()
    vgpuMocks.target.mockClear()
    vi.stubGlobal('OffscreenCanvas', OffscreenCanvasStub)
  })

  it('正常Surface帧不创建ImageBitmap、不建立回读Target', async () => {
    const presentation = new ImageEditorGpuRasterPresentationV3(gpu(), vi.fn())
    presentation.attachSurface({ width: 1, height: 1 } as OffscreenCanvas, 1)

    const result = await presentation.render(
      output(), createDefaultImageEditColorModeV3(), 1, () => true,
    )

    expect(result).toEqual({
      kind: 'webgpu-surface', surfaceGeneration: 1, width: 32, height: 24,
    })
    expect(vgpuMocks.surfaces).toHaveLength(1)
    expect(vgpuMocks.surfaces[0].resize).toHaveBeenCalledWith([32, 24])
    expect(vgpuMocks.transferToImageBitmap).not.toHaveBeenCalled()
    expect(vgpuMocks.target).not.toHaveBeenCalled()
    presentation.dispose()
  })

  it('Surface提交失败只降一级到GPU ImageBitmap，并停用该Surface代次', async () => {
    vgpuMocks.failDirect = true
    const presentation = new ImageEditorGpuRasterPresentationV3(gpu(), vi.fn())
    presentation.attachSurface({ width: 32, height: 24 } as OffscreenCanvas, 1)

    const first = await presentation.render(
      output(), createDefaultImageEditColorModeV3(), 1, () => true,
    )
    await Promise.resolve()
    const second = await presentation.render(
      output(), createDefaultImageEditColorModeV3(), 1, () => true,
    )

    expect(first).toMatchObject({
      kind: 'webgpu-surface', surfaceGeneration: 1,
    })
    expect(second).toMatchObject({
      kind: 'gpu-image-bitmap', surfaceGeneration: 1,
      surfaceFailureReason: 'surface submit failed',
    })
    expect(vgpuMocks.surfaces.map((entry) => entry.kind)).toEqual(['direct', 'bitmap'])
    expect(vgpuMocks.surfaces[0].dispose).toHaveBeenCalledOnce()
    expect(vgpuMocks.transferToImageBitmap).toHaveBeenCalledOnce()
    expect(vgpuMocks.target).not.toHaveBeenCalled()
    presentation.dispose()
  })

  it('Surface帧被新视口取代时静默取消，不误生成ImageBitmap降级帧', async () => {
    const presentation = new ImageEditorGpuRasterPresentationV3(gpu(), vi.fn())
    presentation.attachSurface({ width: 32, height: 24 } as OffscreenCanvas, 1)

    await expect(presentation.render(
      output(), createDefaultImageEditColorModeV3(), 1, () => false,
    )).rejects.toThrow()

    expect(vgpuMocks.surfaces).toHaveLength(1)
    expect(vgpuMocks.surfaces[0].dispose).not.toHaveBeenCalled()
    expect(vgpuMocks.transferToImageBitmap).not.toHaveBeenCalled()
    expect(vgpuMocks.target).not.toHaveBeenCalled()
    presentation.dispose()
  })
})
