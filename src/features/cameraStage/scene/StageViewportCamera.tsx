import React, { useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { PerspectiveCamera } from '@react-three/drei'
import type { PerspectiveCamera as ThreePerspectiveCamera } from 'three'
import { registerPlaybackApplier } from '../store/playbackAppliers'
import type { StageCameraObject, StageVec3 } from '../domain/sceneTypes'
import { sampleCameraEffectorOffsets } from '../domain/cameraEffectors'
import { useCameraStageStore } from '../store/cameraStageStore'

interface StageViewportCameraProps {
  cameraObject: StageCameraObject
  lookAtTarget: StageVec3
}

/** 摄像机视角真实渲染相机：位置/FOV/lookAt 完全来自当前摄像机对象数据 */
const StageViewportCamera: React.FC<StageViewportCameraProps> = ({ cameraObject, lookAtTarget }) => {
  const cameraRef = useRef<ThreePerspectiveCamera>(null)
  const { position } = cameraObject.transform

  const applyCameraSample = useCallback((camera: ThreePerspectiveCamera, basePosition: StageVec3, time: number): void => {
    camera.position.set(basePosition.x, basePosition.y, basePosition.z)
    camera.lookAt(lookAtTarget.x, lookAtTarget.y, lookAtTarget.z)
    const { positionOffset, rotationOffset } = sampleCameraEffectorOffsets(cameraObject.effectors, time)
    camera.translateX(positionOffset.x)
    camera.translateY(positionOffset.y)
    camera.translateZ(positionOffset.z)
    camera.rotateX(rotationOffset.x)
    camera.rotateY(rotationOffset.y)
    camera.rotateZ(rotationOffset.z)
    camera.updateProjectionMatrix()
  }, [cameraObject.effectors, lookAtTarget.x, lookAtTarget.y, lookAtTarget.z])

  // 播放期命令式采样：摄像机视角下真实渲染相机的位置/FOV 直接由采样值驱动（不写 store）
  useEffect(() => {
    const unregs: Array<() => void> = []
    unregs.push(
      registerPlaybackApplier(cameraObject.id, 'transform.position', (value, time) => {
        const camera = cameraRef.current
        if (!camera) return
        applyCameraSample(camera, value as StageVec3, time)
      }),
    )
    unregs.push(
      registerPlaybackApplier(cameraObject.id, 'fov', (value) => {
        const camera = cameraRef.current
        if (!camera) return
        camera.fov = value as number
        camera.updateProjectionMatrix()
      }),
    )
    return () => unregs.forEach((unregister) => unregister())
  }, [applyCameraSample, cameraObject.id])

  useLayoutEffect(() => {
    const camera = cameraRef.current
    if (!camera) return
    camera.fov = cameraObject.fov
    applyCameraSample(camera, position, useCameraStageStore.getState().playback.currentTime)
  }, [
    cameraObject.fov,
    cameraObject.effectors,
    applyCameraSample,
    lookAtTarget.x,
    lookAtTarget.y,
    lookAtTarget.z,
    position,
    position.x,
    position.y,
    position.z,
  ])

  return (
    <PerspectiveCamera
      ref={cameraRef}
      makeDefault
      fov={cameraObject.fov}
      near={0.05}
      far={1000}
      position={[position.x, position.y, position.z]}
    />
  )
}

export default StageViewportCamera
