// @vitest-environment jsdom
import React from 'react'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCameraObject } from '../domain/sceneDefaults'
import { runPlaybackAppliers } from '../store/playbackAppliers'
import { seekCameraStagePlaybackRuntime } from './playbackRuntime'

const mocks = vi.hoisted(() => ({
  frameCallback: null as (() => void) | null,
  framePriority: undefined as number | undefined,
  camera: {
    position: { x: 0, y: 0, z: 0, set: vi.fn() },
    rotation: { x: 0, y: 0, z: 0, order: 'XYZ', set: vi.fn() },
    fov: 50,
    translateX: vi.fn(),
    translateY: vi.fn(),
    translateZ: vi.fn(),
    rotateX: vi.fn(),
    rotateY: vi.fn(),
    rotateZ: vi.fn(),
    updateProjectionMatrix: vi.fn(),
  },
}))

vi.mock('@react-three/fiber', () => ({
  useFrame: (callback: () => void, priority?: number) => {
    mocks.frameCallback = callback
    mocks.framePriority = priority
  },
}))

vi.mock('@react-three/drei', async () => {
  const react = await import('react')
  return {
    PerspectiveCamera: react.forwardRef((_props, ref) => {
      react.useImperativeHandle(ref, () => mocks.camera)
      return null
    }),
  }
})

import StageViewportCamera from './StageViewportCamera'
import { resolveStageViewportCameraId } from './viewportCameraRuntime'

describe('StageViewportCamera', () => {
  const schedule = [
    { startTime: 0, endTime: 1, cameraId: 'camera-a' },
    { startTime: 1, endTime: 2, cameraId: 'camera-b' },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.frameCallback = null
    mocks.framePriority = undefined
  })

  it('同帧 runtime 到达片段边界时直接切换实际 draw camera', () => {
    expect(resolveStageViewportCameraId(schedule, 'camera-a', null, 0.999)).toBe('camera-a')
    expect(resolveStageViewportCameraId(schedule, 'camera-a', null, 1)).toBe('camera-b')
  })

  it('固定机位不跟随播放时间表', () => {
    expect(resolveStageViewportCameraId(null, 'camera-fixed', 'camera-a', 1.5)).toBe('camera-fixed')
  })

  it('命令式采样无需等待 RAF 就把目标机位落到 Three camera，并在 controls 后重放', () => {
    const cameraA = { ...createCameraObject('A', 'red'), id: 'camera-a' }
    const cameraB = { ...createCameraObject('B', 'blue'), id: 'camera-b' }
    cameraB.transform = {
      ...cameraB.transform,
      position: { x: 4, y: 2, z: 8 },
    }
    const lookAtTargets = new Map([
      [cameraA.id, { x: 0, y: 1, z: 0 }],
      [cameraB.id, { x: 0, y: 1, z: 0 }],
    ])

    const view = render(
      <StageViewportCamera
        cameraObject={cameraA}
        lookAtTarget={lookAtTargets.get(cameraA.id)!}
        interactionRef={{ current: false }}
        cameraObjects={[cameraA, cameraB]}
        lookAtTargets={lookAtTargets}
        renderCameraSchedule={schedule}
        fallbackCameraId={cameraA.id}
      />,
    )
    expect(mocks.framePriority).toBe(-0.5)

    seekCameraStagePlaybackRuntime(1, false)
    expect(mocks.camera.position.set).toHaveBeenLastCalledWith(4, 2, 8)
    runPlaybackAppliers(cameraB.id, 'transform.position', { x: 7, y: 3, z: 9 }, 1)
    expect(mocks.camera.position.set).toHaveBeenLastCalledWith(7, 3, 9)

    view.unmount()
  })
})
