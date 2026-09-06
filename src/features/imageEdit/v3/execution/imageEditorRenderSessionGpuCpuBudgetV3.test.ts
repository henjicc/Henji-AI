/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditorGpuSceneClientV3Like } from '../gpu/imageEditorGpuSceneClientV3'
import type { ImageEditorGpuSceneWorkerEventV3 } from '../gpu/imageEditorGpuSceneProtocolV3'
import type { ImageEditorViewportCompositeRuntimeEventV3 } from './viewportCompositeProtocolV3'
import type { ImageEditorManagedViewportCompositeV3, ImageEditorViewportCompositeRequestV3 } from './viewportCompositeTypesV3'
import { DefaultImageEditorRenderSessionV3, type ImageEditorRenderSessionStateV3, type ImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionV3'
import { result, layout, installImageEditorRenderSessionTestSurface } from './imageEditorRenderSessionTestFixtures'

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }))
vi.mock('@/core/logging', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/core/logging')>()
  return { ...actual, createLogger: (...args: Parameters<typeof actual.createLogger>) => ({ ...actual.createLogger(...args), warn }) }
})

function harness(onSync?: (snapshot: ImageEditorRenderSnapshotV3, emit: (event: ImageEditorGpuSceneWorkerEventV3) => void) => void): {
  session: DefaultImageEditorRenderSessionV3
  front: HTMLCanvasElement
  safety: HTMLCanvasElement
  gpu: HTMLCanvasElement
  pending: Array<{ request: ImageEditorViewportCompositeRequestV3; resolve(value?: ImageEditorManagedViewportCompositeV3): void; reject(error: Error): void }>
  snapshot(generation: number, documentId?: string): ImageEditorRenderSnapshotV3
  frame(generation: number, camera?: number): void
  emit(event: ImageEditorGpuSceneWorkerEventV3): void
  runtime(event: ImageEditorViewportCompositeRuntimeEventV3): void
  state(): ImageEditorRenderSessionStateV3
  requestedFrames: ReturnType<typeof vi.fn>
} {
  const pending: ReturnType<typeof harness>['pending'] = []
  let emit: (event: ImageEditorGpuSceneWorkerEventV3) => void = () => undefined
  let runtime: (event: ImageEditorViewportCompositeRuntimeEventV3) => void = () => undefined
  const requestedFrames = vi.fn()
  const gpuClient: ImageEditorGpuSceneClientV3Like = {
    syncScene: (snapshot) => onSync?.(snapshot, emit), uploadTiles: vi.fn(), updateTransientLayerTransform: vi.fn(), clearTransientLayerTransform: vi.fn(),
    updateViewport: vi.fn(), requestFrame: requestedFrames, dispose: vi.fn(),
    subscribe: (listener) => { emit = listener; return vi.fn() },
  }
  const client = {
    render: (request: ImageEditorViewportCompositeRequestV3) => new Promise<ImageEditorManagedViewportCompositeV3>((resolve, reject) => {
      pending.push({ request, resolve: (value = result(request)) => resolve(value), reject })
    }),
    cancel: vi.fn(), dispose: vi.fn(),
    subscribeRuntime: (listener: typeof runtime) => { runtime = listener; return vi.fn() },
  }
  const session = new DefaultImageEditorRenderSessionV3({ sessionId: 'gpu-cpu-budget' }, { client, gpuSceneClient: gpuClient })
  const front = document.createElement('canvas'), safety = document.createElement('canvas'), gpu = document.createElement('canvas')
  Object.assign(gpu, { transferControlToOffscreen: () => ({ width: 800, height: 500 }) as OffscreenCanvas })
  session.attachSurface({ surfaceId: 'budget', front, safety, gpu })
  session.updateViewport(layout)
  let state!: ImageEditorRenderSessionStateV3
  session.subscribeState((value) => { state = value })
  return { session, front, safety, gpu, pending, requestedFrames, emit: (event) => emit(event), runtime: (event) => runtime(event), state: () => state,
    snapshot: (generation, documentId = 'same-document') => ({
      document: { ...createImageEditDocumentV3({ width: 1600, height: 1000, documentId }), revision: generation - 1 },
      renderGeneration: generation, geometryHash: 'same-geometry', quality: 'stable', resourceDescriptors: [],
    }),
    frame: (generation, camera = 1) => emit({ type: 'surface-frame-ready', requestId: `frame-${generation}-${camera}`,
      sceneGeneration: generation, deviceGeneration: 1, cameraSequence: camera, interactionSequence: 0,
      surfaceGeneration: 1, quality: 'stable', width: 800, height: 500 }),
  }
}

describe('GPU 正常会话的 CPU 工作预算与恢复', () => {
  installImageEditorRenderSessionTestSurface()

  it('真实表面接管后 10 次权威编辑与 20 次跨 RAF 相机不再编译/排 CPU，旧任务完成不能改 GPU 状态', async () => {
    const h = harness()
    h.session.updateSnapshot(h.snapshot(1))
    expect(h.pending).toHaveLength(2)
    h.emit({ type: 'ready', sceneGeneration: 1, deviceGeneration: 1, recovered: false })
    expect(h.state().compositionBackend).toBe('cpu')
    h.frame(1)
    expect(h.pending).toHaveLength(3) // 原初始化两条任务 + 唯一整文档安全帧。
    const initialPlans = h.front.dataset.renderPlanCompileCount
    const initialTasks = h.front.dataset.cpuTaskStartCount
    for (let generation = 2; generation <= 11; generation += 1) {
      h.session.updateSnapshot(h.snapshot(generation)); h.frame(generation)
    }
    for (let index = 1; index <= 20; index += 1) {
      h.session.updateViewport({ ...layout, viewportKey: `camera-${index}`, viewport: { ...layout.viewport, documentX: index } })
      await vi.advanceTimersByTimeAsync(16)
      h.frame(11, index + 1)
    }
    expect(h.front.dataset.renderPlanCompileCount).toBe(initialPlans)
    expect(h.front.dataset.cpuTaskStartCount).toBe(initialTasks)
    const release = vi.fn()
    h.pending[0].resolve(result(h.pending[0].request, release))
    h.pending[1].reject(new Error('迟到 CPU 失败'))
    h.runtime({ type: 'runtime', requestId: 'late', sequence: 1, renderGeneration: 11,
      status: 'device-lost', reason: '旧CPU内部设备', deviceGeneration: 2 })
    await vi.advanceTimersByTimeAsync(0)
    expect(release).toHaveBeenCalledOnce()
    expect(h.pending).toHaveLength(3)
    expect(h.state()).toMatchObject({ compositionBackend: 'gpu', coverage: 1, targetMipCoverage: 1,
      rendering: false, diagnostic: null, deviceStatus: 'ready', renderGeneration: 11, cameraSequence: 21 })
    h.session.dispose()
  })

  it('安全帧只做一次 ≤1024 全文档检查点；它迟到不覆盖新GPU，丢失后启动最新文档与相机', async () => {
    const h = harness()
    h.session.updateSnapshot(h.snapshot(1)); h.frame(1)
    const checkpoint = h.pending[2]
    expect(checkpoint.request).toMatchObject({ coverage: 'document', preferredMip: 1, minimumMip: 1, quality: 'draft', analysisRequested: true })
    expect(Math.max(checkpoint.request.document.geometry.width, checkpoint.request.document.geometry.height) / 2 ** checkpoint.request.preferredMip!).toBeLessThanOrEqual(1024)
    h.session.updateSnapshot(h.snapshot(4))
    h.session.updateViewport({ ...layout, viewportKey: 'latest-camera', viewport: { ...layout.viewport, documentX: 80 } })
    await vi.advanceTimersByTimeAsync(16)
    h.frame(4, 2)
    const checkpointRelease = vi.fn()
    checkpoint.resolve(result(checkpoint.request, checkpointRelease))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.front.dataset.renderGeneration).toBe('4')
    expect(h.state().result).toBeNull()
    h.emit({ type: 'device-lost', sceneGeneration: 4, deviceGeneration: 1, reason: 'device lost', retryAfterMs: 1000 })
    expect(h.pending.slice(3)).toHaveLength(2)
    expect(h.pending.slice(3).every(({ request }) => request.document.revision === 3 && request.viewportKey === 'latest-camera')).toBe(true)
    expect(h.state()).toMatchObject({ compositionBackend: 'cpu', rendering: true, diagnostic: null })
    expect(checkpointRelease).not.toHaveBeenCalled()
    const count = h.pending.length
    h.emit({ type: 'ready', sceneGeneration: 4, deviceGeneration: 2, recovered: true })
    h.pending[3].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state().compositionBackend).toBe('cpu')
    h.frame(3, 2) // 旧 generation 不能暂停 CPU。
    expect(h.state().compositionBackend).toBe('cpu')
    h.frame(4, 2)
    expect(h.state()).toMatchObject({ compositionBackend: 'gpu', rendering: false })
    h.pending[4].reject(new Error('恢复后旧 CPU 失败'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.pending).toHaveLength(count + 1) // CPU 草稿完成时启动的现有 backdrop，不是GPU重编译。
    expect(h.state()).toMatchObject({ compositionBackend: 'gpu', coverage: 1, targetMipCoverage: 1, diagnostic: null })
    h.session.dispose()
    expect(checkpointRelease).toHaveBeenCalledOnce()
  })

  it('切换documentId清空旧图像安全表面并释放迟到旧结果，新文档有独立检查点', async () => {
    const h = harness()
    h.session.updateSnapshot(h.snapshot(1, 'first')); h.frame(1)
    const oldCheckpoint = h.pending[2]
    const clear = vi.mocked(h.front.getContext('2d')!.clearRect)
    const clearsBefore = clear.mock.calls.length
    h.session.updateSnapshot(h.snapshot(2, 'second'))
    expect(clear.mock.calls.length).toBeGreaterThan(clearsBefore)
    expect(h.gpu.style.visibility).toBe('hidden')
    const release = vi.fn()
    oldCheckpoint.resolve(result(oldCheckpoint.request, release))
    await vi.advanceTimersByTimeAsync(0)
    expect(release).toHaveBeenCalledOnce()
    h.frame(2)
    expect(h.pending.filter(({ request }) => request.coverage === 'document').map(({ request }) => request.document.id))
      .toEqual(['first', 'second'])
    expect(h.state().result).toBeNull()
    h.session.dispose()
    const late = h.pending.at(-1)!, lateRelease = vi.fn()
    late.resolve(result(late.request, lateRelease))
    await vi.advanceTimersByTimeAsync(0)
    expect(lateRelease).toHaveBeenCalledOnce()
  })

  it('安全帧失败不污染 GPU，真正初始化失败/设备丢失仍能按当前权威状态使用 CPU', async () => {
    const h = harness()
    h.session.updateSnapshot(h.snapshot(1)); h.frame(1)
    h.pending[2].reject(new Error('一次安全帧失败'))
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state()).toMatchObject({ compositionBackend: 'gpu', diagnostic: null, coverage: 1 })
    h.frame(1)
    expect(h.pending).toHaveLength(3)
    h.session.updateSnapshot(h.snapshot(2))
    h.emit({ type: 'failed', sceneGeneration: 2, deviceGeneration: 1, requestId: 'gpu-failed',
      code: 'initialization-failed', message: '初始化失败', recoverable: true })
    expect(h.pending.slice(3).every(({ request }) => request.document.revision === 1)).toBe(true)
    h.pending.find(({ request }) => request.renderGeneration === 2 && request.phase === 'target')!.resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state()).toMatchObject({ compositionBackend: 'cpu', diagnostic: null, targetMipCoverage: 1 })
    h.session.dispose()
  })

  it('隐藏时取消安全帧，旧完成不覆盖表面，重新显示后的当前 GPU 帧可重新建立一次安全帧', async () => {
    const h = harness()
    h.session.updateSnapshot(h.snapshot(1)); h.frame(1)
    const old = h.pending[2], release = vi.fn()
    h.session.setVisibility(false)
    h.session.updateSnapshot(h.snapshot(2))
    old.resolve(result(old.request, release))
    await vi.advanceTimersByTimeAsync(0)
    expect(release).toHaveBeenCalledOnce()
    expect(h.pending).toHaveLength(3)
    h.session.setVisibility(true)
    h.frame(2)
    expect(h.pending).toHaveLength(4)
    expect(h.pending[3].request).toMatchObject({ renderGeneration: 2, coverage: 'document' })
    const count = h.pending.length
    h.frame(2)
    expect(h.pending).toHaveLength(count)
    h.session.dispose()
  })

  it('syncScene 同步初始化失败只启动一组 CPU 当前请求，仍可完成正式目标帧', async () => {
    const h = harness((snapshot, emit) => emit({ type: 'failed', sceneGeneration: snapshot.renderGeneration,
      requestId: 'sync-initialize', deviceGeneration: 0, code: 'initialization-failed', message: '同步初始化失败', recoverable: true }))
    h.session.updateSnapshot(h.snapshot(1))
    expect(h.pending).toHaveLength(2)
    expect(h.front.dataset.renderPlanCompileCount).toBe('1')
    h.pending[1].resolve()
    await vi.advanceTimersByTimeAsync(0)
    expect(h.state()).toMatchObject({ compositionBackend: 'cpu', diagnostic: null, targetMipCoverage: 1 })
    expect(h.front.dataset.renderGeneration).toBe('1')
    h.session.dispose()
  })

  it('隐藏期间迟到 GPU 帧不得接管，show 主动请求当前 GPU 帧且保留 CPU 直到真实交接', async () => {
    const h = harness()
    h.session.updateSnapshot(h.snapshot(1))
    h.emit({ type: 'ready', sceneGeneration: 1, deviceGeneration: 1, recovered: false })
    h.emit({ type: 'scene-resources-ready', sceneGeneration: 1, deviceGeneration: 1 })
    h.session.setVisibility(false)
    const close = vi.fn()
    warn.mockClear()
    h.emit({ type: 'frame-ready', requestId: 'hidden-bitmap', sceneGeneration: 1, cameraSequence: 1,
      interactionSequence: 0, surfaceGeneration: 0, deviceGeneration: 1, quality: 'stable',
      bitmap: { width: 800, height: 500, close } as unknown as ImageBitmap })
    expect(close).toHaveBeenCalledOnce()
    expect(warn).not.toHaveBeenCalled()
    expect(h.gpu.style.visibility).toBe('hidden')
    expect(h.state().compositionBackend).toBe('cpu')
    const requests = h.requestedFrames.mock.calls.length
    h.session.setVisibility(true)
    expect(h.requestedFrames.mock.calls.length).toBe(requests + 1)
    expect(h.state().compositionBackend).toBe('cpu')
    h.frame(1)
    expect(h.gpu.style.visibility).toBe('visible')
    expect(h.state()).toMatchObject({ compositionBackend: 'gpu', rendering: false })
    h.session.dispose()
  })

  it('真正表面尺寸失败仍返回 false 并触发有事实日志的 CPU fallback，不与不可见 deferred 混淆', () => {
    const h = harness()
    h.session.updateSnapshot(h.snapshot(1)); h.frame(1)
    const requests = h.pending.length
    warn.mockClear()
    h.emit({ type: 'surface-frame-ready', requestId: 'wrong-size', sceneGeneration: 1, cameraSequence: 1,
      interactionSequence: 0, surfaceGeneration: 1, deviceGeneration: 1, quality: 'stable', width: 1, height: 1 })
    expect(h.state()).toMatchObject({ compositionBackend: 'cpu', rendering: true })
    expect(h.pending.length).toBeGreaterThan(requests)
    expect(warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'image_editor_v3.gpu_scene.fallback' }))
    h.session.dispose()
  })

  it('安全帧硬下界按最终裁剪/方向输出而不是原文档尺寸计算，普通 CPU 请求不继承该约束', () => {
    const h = harness()
    const snapshot = h.snapshot(1)
    snapshot.document.geometry = { width: 8192, height: 8192, crop: { x: 0, y: 0, width: 2048, height: 512 },
      orientation: { rotate: 90, mirrored: false } }
    h.session.updateSnapshot(snapshot)
    h.frame(1)
    expect(h.pending[2].request).toMatchObject({ preferredMip: 1, minimumMip: 1, coverage: 'document' })
    expect(h.pending[0].request.minimumMip).toBeUndefined()
    expect(h.pending[1].request.minimumMip).toBeUndefined()
    h.session.dispose()
  })

  it.each([0, 1])('初始化现存全图 mip%s 只有确实有界才复用为安全帧', async (mip) => {
    const h = harness()
    h.session.updateSnapshot(h.snapshot(1))
    h.pending[0].resolve()
    await vi.advanceTimersByTimeAsync(0)
    const backdrop = h.pending.find(({ request }) => request.coverage === 'document')!
    backdrop.resolve(result({ ...backdrop.request, preferredMip: mip }))
    await vi.advanceTimersByTimeAsync(0)
    const before = h.pending.length
    h.frame(1)
    expect(h.pending.length).toBe(before + (mip === 0 ? 1 : 0))
    if (mip === 0) expect(h.pending.at(-1)!.request.minimumMip).toBe(1)
    h.session.dispose()
  })
})
