import { describe, expect, it, vi } from 'vitest'

import { createDefaultImageEditColorModeV3 } from '@/core/imageEdit/v3'
import type { ImageEditorGpuRasterCompositorV3Like } from './imageEditorGpuRasterPipelineContractsV3'
import type { ImageEditorGpuRasterSceneV3 } from './imageEditorGpuRasterSceneCompilerV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from './imageEditorGpuSceneProtocolV3'
import { ImageEditorGpuSceneExportRuntimeV3 } from './imageEditorGpuSceneExportRuntimeV3'
import type { Target } from 'vgpu'

function fakeTarget(width: number, height: number): Target {
  return { size: [width, height], color: { destroy: vi.fn() } } as unknown as Target
}

function scene(): ImageEditorGpuRasterSceneV3 {
  return {
    width: 2,
    height: 1,
    color: createDefaultImageEditColorModeV3(),
    geometry: { width: 2, height: 1, crop: null, orientation: { rotate: 0, mirrored: false } },
    layers: [],
    graph: [],
    outputNodeId: null,
    outputFingerprint: 'empty',
    requiredResourceKeys: [],
    requiresRenderGraph: false,
  }
}

function compositor(overrides: Partial<ImageEditorGpuRasterCompositorV3Like> = {}): ImageEditorGpuRasterCompositorV3Like {
  return {
    syncScene: vi.fn(),
    updateTransientTransform: vi.fn(),
    updateViewport: vi.fn(),
    updateExportViewport: vi.fn(),
    attachPresentationSurface: vi.fn(),
    memoryPressureBytes: vi.fn(() => 0),
    estimatedResidentGpuBytes: vi.fn(() => 32),
    estimateTileGpuBytes: vi.fn(() => 4),
    uploadTile: vi.fn(() => ({ destroy: vi.fn() }) as never),
    requiredResourceKeys: vi.fn(() => []),
    missingResources: vi.fn(() => []),
    render: vi.fn() as never,
    readLinearPixelsForTest: vi.fn(async () => new Float32Array()),
    readExportLinearPixels: vi.fn(async () => new Float32Array([1, 0, 0, 1])),
    snapshotStats: vi.fn(() => ({
      uploadCount: 0, pipelineCompileCount: 1, frameCount: 1,
      diagnosticReadbackCount: 0, exportReadbackCount: 1,
      transientUniformUpdateCount: 0, residentTileCount: 0,
      atlasPageCount: 0, allocatedAtlasBytes: 0,
      minimumPlannedMip: 0, maximumPlannedMip: 0,
      surfaceFrameCount: 0, imageBitmapFrameCount: 0, directSurfaceFailureCount: 0,
    })),
    dispose: vi.fn(),
    ...overrides,
  }
}

describe('ImageEditorGpuSceneExportRuntimeV3', () => {
  it('扣除预览常驻量、逐tile回读并等待sink确认后推进', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const budgets: number[] = []
    const exported = compositor()
    exported.readExportLinearPixels = vi.fn(async function (
      this: ImageEditorGpuRasterCompositorV3Like,
    ) {
      if (this !== exported) throw new Error('compositor method lost its receiver')
      return new Float32Array([1, 0, 0, 1])
    })
    const runtime = new ImageEditorGpuSceneExportRuntimeV3({
      emit: (event) => events.push(event),
      createCompositor: (budget) => { budgets.push(budget); return exported },
      previewCompositor: () => compositor({ estimatedResidentGpuBytes: () => 100 }),
      previewResource: () => null,
      currentSceneGeneration: () => 4,
      deviceGeneration: () => 2,
      sessionBudgetBytes: 256,
    })
    runtime.start({
      type: 'export', requestId: 'export-1', sceneGeneration: 4, quality: 'export',
      description: {
        width: 2, height: 1, bitDepth: 8, sampleFormat: 'uint', colorSpace: 'srgb',
        transferFunction: 'srgb', alphaMode: 'straight',
      },
      outputTiles: [
        { tileX: 0, tileY: 0, x: 0, y: 0, width: 1, height: 1,
          renderX: 0, renderY: 0, renderWidth: 1, renderHeight: 1,
          coreOffsetX: 0, coreOffsetY: 0 },
        { tileX: 1, tileY: 0, x: 1, y: 0, width: 1, height: 1,
          renderX: 1, renderY: 0, renderWidth: 1, renderHeight: 1,
          coreOffsetX: 0, coreOffsetY: 0 },
      ],
    }, scene())

    await vi.waitFor(() => expect(events.filter((event) => event.type === 'export-tile')).toHaveLength(1))
    expect(budgets).toEqual([156])
    expect(exported.readExportLinearPixels).toHaveBeenCalledTimes(1)
    runtime.acknowledge('export-1', 0, 0)
    await vi.waitFor(() => expect(events.filter((event) => event.type === 'export-tile')).toHaveLength(2))
    expect(exported.readExportLinearPixels).toHaveBeenCalledTimes(2)
    expect(events.filter((event) => event.type === 'export-tile').at(-1)).toMatchObject({
      diagnostics: { readbackCount: 2, previewResidentBytes: 100, sharedResidentBytes: 132 },
    })
    runtime.acknowledge('export-1', 1, 0)
    await vi.waitFor(() => expect(exported.dispose).toHaveBeenCalledOnce())
  })

  it('canonical Float32保留透明alpha以及HDR负值和超白', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const exported = compositor({ readExportLinearPixels: vi.fn(async () => new Float32Array([
      -0.125, 0.75, 1.25, 0.5,
      0.2, 0.2, 0.2, 0,
    ])) })
    const runtime = new ImageEditorGpuSceneExportRuntimeV3({
      emit: (event) => events.push(event), createCompositor: () => exported,
      previewCompositor: () => null, previewResource: () => null,
      currentSceneGeneration: () => 1, deviceGeneration: () => 1,
    })
    const hdrScene = { ...scene(), color: { ...createDefaultImageEditColorModeV3(),
      workingSpace: 'rec2020' as const, bitDepth: 'float32' as const,
      transferFunction: 'pq' as const } }
    runtime.start({ type: 'export', requestId: 'hdr', sceneGeneration: 1, quality: 'export',
      description: { width: 2, height: 1, bitDepth: 32, sampleFormat: 'float',
        colorSpace: 'rec2020', transferFunction: 'linear', alphaMode: 'straight' },
      outputTiles: [{ tileX: 0, tileY: 0, x: 0, y: 0, width: 2, height: 1,
        renderX: 0, renderY: 0, renderWidth: 2, renderHeight: 1,
        coreOffsetX: 0, coreOffsetY: 0 }] }, hdrScene)
    await vi.waitFor(() => expect(events.some((event) => event.type === 'export-tile')).toBe(true))
    const event = events.find((entry) => entry.type === 'export-tile')
    if (!event || event.type !== 'export-tile') throw new Error('缺少HDR export tile')
    const view = new DataView(event.pixels)
    expect(view.getFloat32(0, true)).toBeCloseTo(-0.25)
    expect(view.getFloat32(4, true)).toBeCloseTo(1.5)
    expect(view.getFloat32(8, true)).toBeCloseTo(2.5)
    expect(view.getFloat32(12, true)).toBeCloseTo(0.5)
    expect([...Array(4)].map((_, channel) => view.getFloat32(16 + channel * 4, true)))
      .toEqual([0, 0, 0, 0])
    runtime.acknowledge('hdr', 0, 0)
  })

  it('scene过期时停止后续tile并释放独立compositor', async () => {
    let generation = 7
    const release = vi.fn()
    const exported = compositor({
      dispose: release,
      missingResources: () => [{
        resourceRef: `sha256:${'a'.repeat(64)}`, mip: 0, tileX: 0, tileY: 0,
        contentVersion: 'v1',
      }],
    })
    const runtime = new ImageEditorGpuSceneExportRuntimeV3({
      emit: () => undefined,
      createCompositor: () => exported,
      previewCompositor: () => null,
      previewResource: () => null,
      currentSceneGeneration: () => generation,
      deviceGeneration: () => 1,
    })
    runtime.start({
      type: 'export', requestId: 'stale', sceneGeneration: 7, quality: 'export',
      description: { width: 1, height: 1, bitDepth: 8, sampleFormat: 'uint',
        colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight' },
      outputTiles: [{ tileX: 0, tileY: 0, x: 0, y: 0, width: 1, height: 1,
        renderX: 0, renderY: 0, renderWidth: 1, renderHeight: 1,
        coreOffsetX: 0, coreOffsetY: 0 }],
    }, scene())
    generation = 8
    runtime.cancelAll()
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce())
    expect(exported.readExportLinearPixels).not.toHaveBeenCalled()
  })

  it('预览与导出合计超过共享256MiB时在readback前失败并释放job', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const mib = 1024 * 1024
    const exported = compositor({ estimatedResidentGpuBytes: () => 80 * mib })
    const preview = compositor({ estimatedResidentGpuBytes: () => 192 * mib })
    const runtime = new ImageEditorGpuSceneExportRuntimeV3({
      emit: (event) => events.push(event),
      createCompositor: () => exported,
      previewCompositor: () => preview,
      previewResource: () => null,
      currentSceneGeneration: () => 1,
      deviceGeneration: () => 1,
      sessionBudgetBytes: 256 * mib,
    })
    runtime.start({ type: 'export', requestId: 'over-budget', sceneGeneration: 1,
      quality: 'export', description: { width: 1, height: 1, bitDepth: 8,
        sampleFormat: 'uint', colorSpace: 'srgb', transferFunction: 'srgb',
        alphaMode: 'straight' }, outputTiles: [{ tileX: 0, tileY: 0, x: 0, y: 0,
        width: 1, height: 1, renderX: 0, renderY: 0, renderWidth: 1, renderHeight: 1,
        coreOffsetX: 0, coreOffsetY: 0 }] }, scene())
    await vi.waitFor(() => expect(events.some((event) => event.type === 'failed')).toBe(true))
    expect(events.find((event) => event.type === 'failed')).toMatchObject({
      code: 'export-not-ready', requestId: 'over-budget',
    })
    expect(exported.readExportLinearPixels).not.toHaveBeenCalled()
    expect(exported.dispose).toHaveBeenCalledOnce()
  })

  it('极端support走2048全局分析+有界局部残差，最终仍仅一次readback', async () => {
    const events: ImageEditorGpuSceneWorkerEventV3[] = []
    const high = fakeTarget(32, 24)
    const low = fakeTarget(8, 6)
    const global = fakeTarget(2048, 1024)
    const jobCompositor = compositor({
      renderExportTarget: vi.fn()
        .mockResolvedValueOnce(high)
        .mockResolvedValueOnce(low),
      estimatedResidentGpuBytes: () => 1024,
    })
    const analysisCompositor = compositor({
      renderExportTarget: vi.fn(async () => global),
      estimatedResidentGpuBytes: () => 2048,
    })
    const clone = vi.fn(async (target: Target) => fakeTarget(target.size[0], target.size[1]))
    const read = vi.fn(async (target: Target) => new Float32Array(target.size[0] * target.size[1] * 4))
    const beginOverlapAdd = vi.fn(async () => undefined)
    const accumulatePatch = vi.fn(async () => undefined)
    const readOverlapAdd = vi.fn(async () => new Float32Array(16 * 16 * 4))
    const residualDispose = vi.fn()
    const compositors = [jobCompositor, analysisCompositor]
    const runtime = new ImageEditorGpuSceneExportRuntimeV3({
      emit: (event) => events.push(event),
      createCompositor: () => compositors.shift()!,
      createResidual: () => ({ clone, read: read as never, beginOverlapAdd,
        accumulatePatch, readOverlapAdd, dispose: residualDispose }),
      previewCompositor: () => compositor({ estimatedResidentGpuBytes: () => 4096 }),
      previewResource: () => null,
      currentSceneGeneration: () => 9,
      deviceGeneration: () => 3,
      sessionBudgetBytes: 256 * 1024 * 1024,
    })
    runtime.start({
      type: 'export', requestId: 'multiscale', sceneGeneration: 9, quality: 'export',
      description: { width: 8192, height: 4096, bitDepth: 8, sampleFormat: 'uint',
        colorSpace: 'srgb', transferFunction: 'srgb', alphaMode: 'straight' },
      multiscaleAnalysis: { width: 2048, height: 1024, localHalo: 256 },
      outputTiles: [{ tileX: 0, tileY: 0, x: 0, y: 0, width: 16, height: 16,
        renderX: 0, renderY: 0, renderWidth: 32, renderHeight: 24,
        coreOffsetX: 0, coreOffsetY: 0 }],
    }, { ...scene(), width: 8192, height: 4096,
      geometry: { width: 8192, height: 4096, crop: null,
        orientation: { rotate: 0, mirrored: false } } })

    await vi.waitFor(() => expect(events.some((event) => event.type === 'export-tile')).toBe(true))
    expect(analysisCompositor.renderExportTarget).toHaveBeenCalledOnce()
    expect(jobCompositor.renderExportTarget).toHaveBeenCalledTimes(2)
    expect(read).not.toHaveBeenCalled()
    expect(readOverlapAdd).toHaveBeenCalledOnce()
    expect(events.find((event) => event.type === 'export-tile')).toMatchObject({
      diagnostics: { readbackCount: 1 },
    })
    runtime.acknowledge('multiscale', 0, 0)
    await vi.waitFor(() => expect(residualDispose).toHaveBeenCalledOnce())
  })
})
