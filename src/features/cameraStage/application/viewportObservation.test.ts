import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  persistSceneScreenshot: vi.fn().mockResolvedValue({
    mediaUrl: 'henji-media://camera-stage/preview.png',
    mediaPath: 'D:/media/camera-stage/preview.png',
  }),
}))

vi.mock('../export/cameraStageScreenshot', () => ({
  persistSceneScreenshot: mocks.persistSceneScreenshot,
}))

import { createDefaultAnimation } from '../domain/animationTypes'
import { createCameraObject, createDefaultSceneSettings, pickDefaultColor } from '../domain/sceneDefaults'
import { useCameraStageStore } from '../store/cameraStageStore'
import {
  observeCameraStageViewport,
  registerCameraStageViewportCaptureProvider,
} from './viewportObservation'

describe('三维视口视觉观察', () => {
  let unregister: (() => void) | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    const camera = createCameraObject('主摄像机', pickDefaultColor(0))
    useCameraStageStore.getState().loadSnapshot({
      objects: [camera],
      activeCameraId: camera.id,
      animation: createDefaultAnimation(),
      sceneSettings: createDefaultSceneSettings(),
      editorMode: 'simple',
      shots: [],
    }, { id: 'project-1', name: '观察测试' })
  })

  afterEach(() => unregister?.())

  it('返回应用媒体引用与声明区域元数据，不泄露本地路径', async () => {
    unregister = registerCameraStageViewportCaptureProvider({
      capture: () => 'data:image/png;base64,cHJldmlldw==',
      dimensions: () => ({ width: 1280, height: 720 }),
    })

    const result = await observeCameraStageViewport('project-1')

    expect(result).toMatchObject({
      previewRef: { kind: 'media.image', id: 'henji-media://camera-stage/preview.png' },
      surfaceId: 'tool.camera_stage',
      width: 1280,
      height: 720,
      dataClass: 'C1',
      maskPolicyId: 'camera_stage.viewport_declared_region',
      lifecycle: 'application_media',
    })
    expect(JSON.stringify(result)).not.toContain('D:/media')
  })

  it('观察器未挂载时明确降级，不伪造截图', async () => {
    await expect(observeCameraStageViewport('project-1')).rejects.toThrow('VIEWPORT_OBSERVER_NOT_AVAILABLE')
    expect(mocks.persistSceneScreenshot).not.toHaveBeenCalled()
  })
})
