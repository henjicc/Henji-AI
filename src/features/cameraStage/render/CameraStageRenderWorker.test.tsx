// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraStageRenderWorkerJob } from '@/platform/contracts/cameraStageRender'
import { createDefaultCameraStageSceneSnapshot } from '../domain/defaultSceneSnapshot'
import { createCharacterObject } from '../domain/sceneDefaults'
import { sceneToDocumentContent } from '../domain/sceneSerialization'
import type { StageCaptureFn } from '../scene/StageCaptureBridge'

const mocks = vi.hoisted(() => ({
  receive: null as ((request: CameraStageRenderWorkerJob) => void) | null,
  ready: null as ((id: string, error?: unknown) => void) | null,
  image: vi.fn(), video: vi.fn(), report: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/commands/cameraStageRender', () => ({
  notifyCameraStageRenderWorkerReady: vi.fn(),
  onCameraStageRenderWorkerJob: (cb: typeof mocks.receive) => { mocks.receive = cb; return () => undefined },
  onCameraStageRenderWorkerCancel: () => () => undefined,
  reportCameraStageRenderWorkerEvent: mocks.report,
}))
vi.mock('@react-three/fiber', () => ({ flushSync: (fn: () => void) => fn() }))
vi.mock('../export/cameraStageImage', () => ({ exportCameraStageImage: mocks.image }))
vi.mock('../export/cameraStageVideo', () => ({ exportCameraStageVideo: mocks.video }))
vi.mock('../scene/StageScene', () => ({ default: (props: {
  captureRef: { current: StageCaptureFn | null }; onAssetReady?: typeof mocks.ready
}) => {
  props.captureRef.current = Object.assign(vi.fn(), { disposeOffscreen: vi.fn() }) as unknown as StageCaptureFn
  mocks.ready = props.onAssetReady ?? null
  return null
} }))
import CameraStageRenderWorker from './CameraStageRenderWorker'

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); mocks.ready = null
  mocks.image.mockResolvedValue({ mediaUrl: 'henji-media://result.png', mediaPath: '/result.png', width: 1280, height: 720 })
  mocks.video.mockResolvedValue({ mediaUrl: 'henji-media://result.mp4', mediaPath: '/result.mp4', savedPath: '/result.mp4', width: 1280, height: 720, durationSeconds: 2, frameCount: 60 })
})
afterEach(() => { cleanup(); vi.useRealTimers() })

async function submit(outputKind: 'image' | 'video'): Promise<string> {
  const scene = createDefaultCameraStageSceneSnapshot()
  const character = createCharacterObject('角色', scene.objects[0].color)
  scene.objects.push(character)
  scene.sceneSettings.sky.environmentImageUrl = 'henji-media://panorama.jpg'
  scene.stateKeyframes.push({ ...structuredClone(scene.stateKeyframes[0]), id: 'end', time: 2 })
  render(<CameraStageRenderWorker />)
  await act(async () => {
    mocks.receive!({ requestId: 'render-1', canvasProjectId: 'canvas', nodeId: 'node', cameraStageDocumentId: 'stage', resolutionPreset: '720p', outputKind, sceneContent: sceneToDocumentContent(scene) })
  })
  await act(async () => { await vi.advanceTimersByTimeAsync(100) })
  return character.id
}

describe('后台抓帧等待真实场景资源', () => {
  it.each(['image', 'video'] as const)('%s 等待模型与全景均提交后才导出', async (kind) => {
    const id = await submit(kind)
    expect(mocks.image).not.toHaveBeenCalled()
    expect(mocks.video).not.toHaveBeenCalled()
    await act(async () => { mocks.ready!(id); await vi.advanceTimersByTimeAsync(100) })
    expect(mocks.image).not.toHaveBeenCalled()
    expect(mocks.video).not.toHaveBeenCalled()
    await act(async () => { mocks.ready!('environment'); await vi.advanceTimersByTimeAsync(100) })
    expect(mocks[kind]).toHaveBeenCalledTimes(1)
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ type: 'completed' }))
  })

  it('资源超时报告失败，不导出占位图', async () => {
    await submit('image')
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000) })
    expect(mocks.image).not.toHaveBeenCalled()
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ type: 'failed', message: expect.stringContaining('超时') }))
  })

  it('资源加载失败立即报告失败，不等到超时也不导出', async () => {
    const id = await submit('video')
    await act(async () => { mocks.ready!(id, new Error('模型加载失败')); await vi.advanceTimersByTimeAsync(100) })
    expect(mocks.video).not.toHaveBeenCalled()
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ type: 'failed', message: expect.stringContaining('模型加载失败') }))
  })
})
